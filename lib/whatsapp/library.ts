import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import { selectAIProvider } from "@/lib/ai/providers";
import { getPublicationProjectChannels } from "@/lib/publications/project-channels";
import { projectAllowsPlatform } from "@/lib/publications/channels";
import { IMAGE_BUCKET } from "@/lib/publications/editor";
import { adaptImage } from "@/lib/publications/media/transform";
import { saveDraft, saveUnscheduledDraft, currentRevision } from "@/lib/publications/workspace";
import type { PublicationPlatform } from "@/lib/publications/types";
import { promptSafeCaption } from "@/lib/media-intelligence/model";
import { captionPrompt, checkSelection, cleanSuggestion, draftFields, manualStatuses, statusLabels } from "./library-model";
import { importDriveToken } from "./providers";
import { assetOriginal } from "./originals";
export { assetOriginal };
import { THUMBNAIL_BUCKET } from "./service";
import type { Asset, AssetAssessment, AssetDecision, LibraryStatus } from "./types";
import { cleanCaption } from "./payload";
import { LIBRARY_PAGE_SIZE, searchPayload, type LibraryFilters } from "./library-filters";
import { listAssetUsageHistory, reuseState, type AssetUsage, type UsageHistoryDb } from "./usage-history";

// Photothèque interne : lecture strictement filtrée par client, miniatures privées en URL signées courtes,
// originaux relus depuis Drive par le serveur uniquement. Les appelants ont déjà vérifié requireAdmin().
const db = () => getSupabaseServerClient();
const THUMBNAIL_URL_TTL = 300;
const MISSING_RPC = ["PGRST202", "42883"];
export type LibraryAssessment = Pick<AssetAssessment, "verdict" | "business_relevance" | "publishability" | "sensitive" | "confidential" | "description" | "quality" | "quality_issues" | "manual_verdict"> & Partial<Pick<AssetAssessment, "topics" | "reviewed_by" | "reviewed_at" | "analyzed_at">>;
export type LibraryItem = Asset & { thumbnailUrl: string | null; history: AssetUsage[]; assessment: LibraryAssessment | null; decisions: AssetDecision[] };
export type ReuseSettings = { allowed: boolean; afterDays: number };
export type LibraryPage = { items: LibraryItem[]; total: number; searchable: boolean };

/** Réglage de réemploi du client (Publications). Illisible ou absent : réemploi refusé (choix prudent, comme l'agent). */
export async function clientReuseSettings(clientId: string): Promise<ReuseSettings> {
  const { data, error } = await db().from("publication_client_settings").select("media_reuse_allowed,media_reuse_after_days").eq("client_id", clientId).maybeSingle();
  if (error || !data) return { allowed: false, afterDays: 180 };
  const days = Number(data.media_reuse_after_days);
  return { allowed: data.media_reuse_allowed === true, afterDays: Number.isFinite(days) && days > 0 ? days : 180 };
}

/**
 * Page de la photothèque filtrée et paginée par la base (RPC whatsapp_library_search) : statut, origine, service ou
 * sujet, texte libre, période d'origine, déjà utilisée. Avant la migration des outils, repli sur la liste historique
 * (filtre de statut seulement, 120 photos au plus).
 */
export async function searchClientLibrary(clientId: string, filters: LibraryFilters): Promise<LibraryPage> {
  const search = await db().rpc("whatsapp_library_search", { p_client_id: clientId, p_filters: searchPayload(filters), p_limit: LIBRARY_PAGE_SIZE, p_offset: filters.page * LIBRARY_PAGE_SIZE });
  if (search.error) {
    if (!MISSING_RPC.includes(search.error.code ?? "")) throw Error("library_unavailable");
    const legacy: Partial<Record<LibraryFilters["status"], LibraryStatus>> = { to_review: "to_review", validated: "validated", used: "used", quarantined: "quarantined", rejected: "rejected", archived: "archived" };
    const items = await listClientLibrary(clientId, legacy[filters.status] ?? null);
    return { items, total: items.length, searchable: false };
  }
  const rows = (search.data ?? []) as { asset_id: string; total: number }[];
  const total = Number(rows[0]?.total ?? 0);
  if (!rows.length) return { items: [], total, searchable: true };
  const { data, error } = await db().from("whatsapp_assets").select("*").eq("client_id", clientId).in("id", rows.map(row => row.asset_id));
  if (error) throw Error("library_unavailable");
  const byId = new Map(((data ?? []) as Asset[]).map(asset => [asset.id, asset]));
  const assets = rows.flatMap(row => { const asset = byId.get(row.asset_id); return asset && !asset.purged_at ? [asset] : []; });
  return { items: await enrich(clientId, assets), total, searchable: true };
}

export async function listClientLibrary(clientId: string, status?: LibraryStatus | null): Promise<LibraryItem[]> {
  let query = db().from("whatsapp_assets").select("*").eq("client_id", clientId).not("imported_at", "is", null);
  // Vue par défaut : ni archivés, ni quarantaine, ni rejetés (consultables par leur filtre). Les médias purgés n'apparaissent plus.
  query = status ? query.eq("library_status", status) : query.not("library_status", "in", "(archived,quarantined,rejected)");
  const { data, error } = await query.order("imported_at", { ascending: false }).limit(120);
  if (error) throw Error("library_unavailable");
  return enrich(clientId, ((data ?? []) as Asset[]).filter(asset => !asset.purged_at));
}

// Miniatures signées, historique d'utilisation, évaluation IA et décisions humaines des photos d'une page.
async function enrich(clientId: string, assets: Asset[]): Promise<LibraryItem[]> {
  if (!assets.length) return [];
  const ids = assets.map(asset => asset.id);
  const paths = assets.flatMap(asset => asset.thumbnail_path?.startsWith(`${clientId}/`) ? [asset.thumbnail_path] : []);
  const signed = paths.length ? await db().storage.from(THUMBNAIL_BUCKET).createSignedUrls(paths, THUMBNAIL_URL_TTL) : { data: [], error: null };
  const urls = new Map((signed.data ?? []).flatMap(item => item.path && item.signedUrl ? [[item.path, item.signedUrl] as const] : []));
  let history: Map<string, AssetUsage[]>;
  try { history = await listAssetUsageHistory(db() as unknown as UsageHistoryDb, clientId, ids); } catch { throw Error("library_unavailable"); }
  // Évaluations IA et décisions : facultatives (migration non appliquée ou photo jamais analysée), jamais bloquantes.
  const [assessed, decided] = await Promise.all([
    db().from("whatsapp_asset_assessments").select("asset_id,verdict,business_relevance,publishability,sensitive,confidential,description,quality,quality_issues,manual_verdict,topics,reviewed_by,reviewed_at,analyzed_at").eq("client_id", clientId).in("asset_id", ids),
    db().from("whatsapp_asset_decisions").select("*").eq("client_id", clientId).in("asset_id", ids).order("created_at", { ascending: false }).limit(500),
  ]);
  const assessments = new Map(assessed.error ? [] : ((assessed.data ?? []) as (LibraryAssessment & { asset_id: string })[]).map(({ asset_id, ...rest }) => [asset_id, rest]));
  const decisions = decided.error ? [] : (decided.data ?? []) as AssetDecision[];
  return assets.map(asset => ({
    ...asset,
    assessment: assessments.get(asset.id) ?? null,
    thumbnailUrl: asset.thumbnail_path ? urls.get(asset.thumbnail_path) ?? null : null,
    history: history.get(asset.id) ?? [],
    decisions: decisions.filter(decision => decision.asset_id === asset.id).slice(0, 10),
  }));
}

/** Reclassement manuel d'une photo (administrateur, motif obligatoire), tracé et jamais écrasé par l'analyse automatique. */
export async function reclassifyAsset(userId: string, clientId: string, assetId: string, status: (typeof manualStatuses)[number], reason: string): Promise<{ ok: boolean; message: string }> {
  const { error } = await db().rpc("whatsapp_asset_reclassify", { p_client_id: clientId, p_asset_id: assetId, p_status: status, p_reason: reason, p_actor_id: userId });
  if (!error) return { ok: true, message: `Photo reclassée « ${statusLabels[status]} ». La décision est enregistrée et ne sera pas modifiée par l’analyse automatique.` };
  if (error.code === "22023") return { ok: false, message: "Indiquez un motif de 3 à 500 caractères et un statut valide." };
  if (error.code === "55000") return { ok: false, message: "Photo introuvable, purgée ou déjà dans ce statut." };
  if (MISSING_RPC.includes(error.code ?? "")) return { ok: false, message: "Reclassement indisponible : appliquez la migration des outils de la photothèque." };
  return { ok: false, message: "Reclassement impossible. Réessayez." };
}

/** Légende d'une photo, modifiée par un administrateur (vide = effacée). Reste une donnée, jamais une consigne. */
export async function saveAssetCaption(userId: string, clientId: string, assetId: string, caption: string): Promise<{ ok: boolean; message: string }> {
  const clean = cleanCaption(caption) ?? "";
  const { data, error } = await db().rpc("whatsapp_asset_caption_save", { p_client_id: clientId, p_asset_id: assetId, p_caption: clean, p_actor_id: userId });
  if (!error) return data ? { ok: true, message: clean ? "Légende enregistrée." : "Légende effacée." } : { ok: false, message: "Photo introuvable ou purgée." };
  if (MISSING_RPC.includes(error.code ?? "")) return { ok: false, message: "Édition indisponible : appliquez la migration des outils de la photothèque." };
  return { ok: false, message: "Légende non enregistrée (3 000 caractères au plus)." };
}

// Décision humaine : passe par whatsapp_assets_review (verdict manuel, journal d'audit). Si la migration de la photothèque
// intelligente n'est pas encore appliquée, les anciens statuts restent modifiables comme avant.
export async function setLibraryStatus(userId: string, clientId: string, assetIds: string[], status: LibraryStatus) {
  const { data: count, error } = await db().rpc("whatsapp_assets_review", { p_client_id: clientId, p_asset_ids: assetIds, p_status: status, p_actor_id: userId });
  if (!error) return Number(count ?? 0);
  if (!["PGRST202", "42883"].includes(error.code ?? "") || status === "quarantined" || status === "rejected") throw Error("library_unavailable");
  const { data, error: legacyError } = await db().from("whatsapp_assets").update({ library_status: status, status_changed_at: new Date().toISOString(), status_changed_by: userId })
    .eq("client_id", clientId).in("id", assetIds).not("imported_at", "is", null).select("id");
  if (legacyError) throw Error("library_unavailable");
  await writeAudit({ kind: "admin", userId }, { action: "whatsapp.library.status", resource_type: "client", resource_id: clientId, metadata: { status, asset_ids: (data ?? []).map(row => row.id) } });
  return data?.length ?? 0;
}

/** Original Drive d'un média du client, pour la prévisualisation interne (jamais de lien public). */
export async function readOriginal(clientId: string, assetId: string) {
  const { data: asset, error } = await db().from("whatsapp_assets").select("*").eq("id", assetId).eq("client_id", clientId).not("imported_at", "is", null).maybeSingle();
  if (error || !asset) return null;
  if (asset.purged_at) return null;
  return { bytes: await assetOriginal(asset), mime: asset.mime_type };
}

async function selectedAssets(clientId: string, ids: string[]) {
  const { data, error } = await db().from("whatsapp_assets").select("*").eq("client_id", clientId).in("id", ids);
  if (error) throw Error("library_unavailable");
  return (data ?? []) as Asset[];
}
// Évaluations IA des médias sélectionnés (absentes tant que la migration n'est pas appliquée ou l'analyse non faite).
async function assessmentsFor(clientId: string, ids: string[]) {
  const { data, error } = await db().from("whatsapp_asset_assessments").select("asset_id,confidential,manual_verdict").eq("client_id", clientId).in("asset_id", ids);
  return new Map(error ? [] : ((data ?? []) as Pick<AssetAssessment, "asset_id" | "confidential" | "manual_verdict">[]).map(a => [a.asset_id, a]));
}

/** Proposition de légende à relire, fondée uniquement sur la fiche client et les messages du client. */
export async function suggestCaption(clientId: string, assets: Pick<Asset, "caption">[]): Promise<string | null> {
  const provider = selectAIProvider();
  if (!provider) return null;
  const { data: client, error } = await db().from("clients").select("name,activity,geographic_area").eq("id", clientId).single();
  if (error || !client) return null;
  const prompt = captionPrompt({ clientName: client.name, activity: client.activity, area: client.geographic_area, messages: assets.flatMap(asset => asset.caption ? [asset.caption] : []) });
  try {
    const response = await provider.complete({ system: prompt.system, messages: [{ role: "user", content: prompt.user }], tools: [], signal: AbortSignal.timeout(30000) });
    return cleanSuggestion(response.text) || null;
  } catch { console.error("[whatsapp] Suggestion de légende indisponible."); return null; }
}

export type PrepareInput = { clientId: string; projectId: string; platforms: PublicationPlatform[]; assetIds: string[]; allowReuse: boolean; text: string | null; suggest: boolean };
/**
 * Transmet des photos validées au circuit Publications existant : brouillon (saveDraft), dérivés par plateforme
 * dans le stockage privé Publications (publication_register_image), puis révision qui attache les médias.
 * La publication reste un brouillon : soumission et approbation humaines obligatoires avant toute diffusion.
 */
// Brouillon non planifié : aucun créneau éditorial n'est réservé (la planification se fait ensuite dans Publications).
// Les étapes sans effet de bord (Drive, dérivés) précèdent la création ; un échec après création archive le brouillon
// créé par cet appel, pour ne laisser ni brouillon incomplet ni doublon. Les publications existantes ne sont jamais touchées.
export async function preparePublication(userId: string, input: PrepareInput): Promise<{ id?: string; message: string }> {
  const assets = await selectedAssets(input.clientId, input.assetIds);
  const check = checkSelection(input.clientId, input.assetIds, assets, input.allowReuse);
  if (!check.ok) return { message: check.message };
  // Réemploi explicite : il respecte toujours le réglage du client (désactivé par défaut, délai minimal entre deux usages).
  const reusedAssets = assets.filter(asset => asset.library_status === "used");
  if (reusedAssets.length) {
    const [settings, uses] = await Promise.all([clientReuseSettings(input.clientId), db().from("whatsapp_asset_uses").select("asset_id,used_at").eq("client_id", input.clientId).in("asset_id", reusedAssets.map(asset => asset.id))]);
    if (uses.error) return { message: "Photothèque indisponible : réessayez." };
    for (const asset of reusedAssets) {
      const dates = ((uses.data ?? []) as { asset_id: string; used_at: string }[]).filter(use => use.asset_id === asset.id).map(use => ({ usedAt: use.used_at }));
      const known = dates.length ? dates : Number.isFinite(Date.parse(asset.status_changed_at)) ? [{ usedAt: asset.status_changed_at }] : [];
      const state = reuseState(known, settings, new Date());
      if (state.reason === "reuse_disabled" || (!known.length && !settings.allowed)) return { message: "Le réemploi des photos est désactivé pour ce client (réglages Publications du client) : choisissez une photo jamais utilisée." };
      if (state.reason === "too_recent") return { message: `Une photo a été utilisée trop récemment : réemploi possible à partir du ${new Date(state.reusableFrom!).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })} (réglage du client).` };
    }
  }
  // Photo signalée confidentielle par l'analyse : utilisable seulement après une validation humaine postérieure.
  const assessments = await assessmentsFor(input.clientId, input.assetIds);
  if ([...assessments.values()].some(a => a.confidential && a.manual_verdict !== "relevant")) return { message: "Une photo a été signalée confidentielle par l’analyse : vérifiez-la puis validez-la à nouveau avant de l’utiliser." };
  // Les légendes d'un média confidentiel ne sont jamais reprises dans un prompt ni dans la source du brouillon.
  const captioned = (asset: Asset) => promptSafeCaption({ caption: asset.caption, libraryStatus: asset.library_status, assessment: assessments.get(asset.id) ?? null });
  const { data: project, error: projectError } = await db().from("projects").select("id,client_id,type").eq("id", input.projectId).eq("client_id", input.clientId).maybeSingle();
  if (projectError || !project) return { message: "Projet introuvable pour ce client." };
  const capabilities = await getPublicationProjectChannels(project);
  if (!input.platforms.length || input.platforms.some(platform => !projectAllowsPlatform(capabilities, platform))) return { message: "Choisissez des plateformes autorisées par ce projet." };
  const ordered = input.assetIds.map(id => assets.find(asset => asset.id === id)!);
  // Réservation des médias encore « validés » : un double envoi ne crée pas deux brouillons avec les mêmes photos.
  const claimable = ordered.filter(asset => asset.library_status === "validated").map(asset => asset.id);
  const claimedAt = new Date().toISOString();
  let claimed: string[] = [];
  if (claimable.length) {
    const { data, error } = await db().from("whatsapp_assets").update({ library_status: "used", status_changed_at: claimedAt, status_changed_by: userId })
      .eq("client_id", input.clientId).in("id", claimable).eq("library_status", "validated").select("id");
    claimed = (data ?? []).map(row => (row as { id: string }).id);
    if (error || claimed.length !== claimable.length) {
      await release(userId, input.clientId, claimed);
      return { message: error ? "Photothèque indisponible : réessayez." : "Ces médias sont déjà en cours d’utilisation dans un autre brouillon. Rechargez la photothèque." };
    }
  }
  const fail = async (message: string, publicationId?: string) => {
    if (publicationId) {
      const archived = await db().rpc("publication_archive", { p_publication_id: publicationId, p_actor_id: userId });
      if (archived.error) console.error("[whatsapp] Archivage du brouillon incomplet impossible.");
    }
    await release(userId, input.clientId, claimed);
    return { message };
  };
  // 1. Originaux Drive et dérivés par plateforme, avant toute écriture.
  const prepared: { asset: Asset; platform: PublicationPlatform; bytes: Uint8Array; mime: string }[] = [];
  try {
    const token = ordered.some(asset => asset.origin !== "drive") ? await importDriveToken() : undefined;
    for (const asset of ordered) {
      const original = await assetOriginal(asset, token);
      for (const platform of input.platforms) {
        const derivative = await adaptImage(original, platform);
        prepared.push({ asset, platform, bytes: derivative.bytes, mime: derivative.mime_type });
      }
    }
  } catch {
    console.error("[whatsapp] Préparation des médias interrompue.");
    return fail("Les photos n’ont pas pu être lues dans Drive ou adaptées. Aucun brouillon n’a été créé.");
  }
  const suggestion = input.text ?? (input.suggest ? await suggestCaption(input.clientId, ordered.map(asset => ({ caption: captioned(asset) }))) : null);
  const fields = draftFields({ receivedAt: ordered.map(asset => asset.received_at ?? asset.imported_at ?? asset.created_at), messages: ordered.flatMap(asset => { const caption = captioned(asset); return caption ? [caption] : []; }), suggestion });
  const form = (extra: (form: FormData) => void) => {
    const data = new FormData();
    for (const [key, value] of Object.entries({ client_id: input.clientId, project_id: input.projectId, title: fields.title, angle: fields.angle, source: fields.source })) data.set(key, value);
    for (const platform of input.platforms) { data.set(`${platform}_enabled`, "on"); data.set(`${platform}_text`, fields.text); }
    extra(data);
    return data;
  };
  // 2. Brouillon non planifié, puis médias enregistrés sur sa révision, puis nouvelle révision qui les attache.
  const draft = await saveUnscheduledDraft(form(() => {}));
  if (!draft.id) return fail(draft.message ?? "Brouillon non créé.");
  const publicationId = draft.id;
  const incomplete = "Les médias n’ont pas pu être attachés : le brouillon incomplet a été archivé. Réessayez.";
  let revisionId: string | null | undefined;
  try { revisionId = (await currentRevision(publicationId))?.revision_id; } catch { revisionId = null; }
  if (!revisionId) return fail(incomplete, publicationId);
  const attached: Record<string, string[]> = {};
  const uses: { asset_id: string; platform: PublicationPlatform; publication_asset_id: string }[] = [];
  for (const item of prepared) {
    const publicationAssetId = randomUUID(), path = `${input.clientId}/${publicationId}/${publicationAssetId}`;
    const upload = await db().storage.from(IMAGE_BUCKET).upload(path, item.bytes, { contentType: item.mime, upsert: false });
    if (upload.error) return fail(incomplete, publicationId);
    const registered = await db().rpc("publication_register_image", { p_publication_id: publicationId, p_revision_id: revisionId, p_asset_id: publicationAssetId, p_path: path, p_hash: createHash("sha256").update(item.bytes).digest("hex"), p_mime: item.mime, p_provenance: `${item.asset.origin === "drive" ? "Dossier Drive du client" : item.asset.origin === "whatsapp_export" ? "Export WhatsApp du client" : "WhatsApp client"}, ${item.asset.captured_at ? "pris" : "reçu"} le ${new Date(item.asset.captured_at ?? item.asset.received_at ?? item.asset.created_at).toISOString().slice(0, 10)} · original Drive ${item.asset.drive_file_id}`, p_actor_id: userId });
    if (registered.error) { await db().storage.from(IMAGE_BUCKET).remove([path]); return fail(incomplete, publicationId); }
    (attached[item.platform] ??= []).push(publicationAssetId);
    uses.push({ asset_id: item.asset.id, platform: item.platform, publication_asset_id: publicationAssetId });
  }
  const revised = await saveDraft(form(data => { data.set("publication_id", publicationId); data.set("revision_id", revisionId!); for (const [platform, ids] of Object.entries(attached)) for (const id of ids) data.append(`${platform}_assets`, id); }));
  if (!revised.id) return fail(incomplete, publicationId);
  // 3. Historique d'utilisation ; les médias réutilisés passent aussi au statut « utilisé ».
  const { error: useError } = await db().from("whatsapp_asset_uses").insert(uses.map(use => ({ ...use, client_id: input.clientId, publication_id: publicationId, used_by: userId })));
  const reused = ordered.filter(asset => asset.library_status !== "validated").map(asset => asset.id);
  if (!useError && reused.length) await db().from("whatsapp_assets").update({ library_status: "used", status_changed_at: new Date().toISOString(), status_changed_by: userId }).eq("client_id", input.clientId).in("id", reused);
  await writeAudit({ kind: "admin", userId }, { action: "whatsapp.library.publication_prepared", resource_type: "publication", resource_id: publicationId, metadata: { client_id: input.clientId, asset_ids: input.assetIds, platforms: input.platforms, ai_suggestion: Boolean(suggestion && !input.text), unscheduled: true } });
  return { id: publicationId, message: useError ? "Brouillon non planifié prêt, mais l’historique d’utilisation n’a pas été enregistré." : "Brouillon non planifié prêt à relire. Planifiez-le depuis Publications." };
}
// Rend aux médias réservés par cet appel leur statut « validé » (uniquement s'ils n'ont pas changé depuis).
async function release(userId: string, clientId: string, ids: string[]) {
  if (!ids.length) return;
  const { error } = await db().from("whatsapp_assets").update({ library_status: "validated", status_changed_at: new Date().toISOString(), status_changed_by: userId }).eq("client_id", clientId).in("id", ids).eq("library_status", "used");
  if (error) console.error("[whatsapp] Libération des médias réservés impossible.");
}

/** Brouillon multi-plateforme planifié en plusieurs publications : l'historique d'utilisation suit chaque publication. */
export async function recordScheduledSplit(userId: string, clientId: string, sourcePublicationId: string, publications: { publicationId: string; platform: PublicationPlatform }[]) {
  const { data, error } = await db().from("whatsapp_asset_uses").select("asset_id,platform,publication_asset_id").eq("client_id", clientId).eq("publication_id", sourcePublicationId);
  if (error) throw Error("library_unavailable");
  const rows = publications.flatMap(target => (data ?? []).filter(use => use.platform === target.platform)
    .map(use => ({ asset_id: use.asset_id, client_id: clientId, publication_id: target.publicationId, platform: target.platform, publication_asset_id: use.publication_asset_id, used_by: userId })));
  if (!rows.length) return 0;
  const { error: insertError } = await db().from("whatsapp_asset_uses").insert(rows);
  if (insertError) throw Error("library_unavailable");
  return rows.length;
}

/** Dossiers Drive attribués au client (associations WhatsApp), pour les liens de la photothèque. */
export async function clientFolders(clientId: string) {
  const { data, error } = await db().from("whatsapp_senders").select("drive_folder_id,enabled").eq("client_id", clientId);
  if (error) throw Error("library_unavailable");
  return [...new Set((data ?? []).map(row => row.drive_folder_id))];
}

/** Services et sujets proposés au filtre : prestations du profil média, puis thèmes les plus fréquents des évaluations. */
export async function libraryServiceOptions(clientId: string, profileServices: string[]): Promise<string[]> {
  const { data, error } = await db().from("whatsapp_asset_assessments").select("topics").eq("client_id", clientId).limit(1000);
  const counts = new Map<string, number>();
  for (const row of error ? [] : (data ?? []) as { topics: string[] | null }[]) for (const topic of row.topics ?? []) { const t = topic.trim(); if (t) counts.set(t, (counts.get(t) ?? 0) + 1); }
  const topics = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([topic]) => topic);
  const seen = new Set<string>();
  return [...profileServices, ...topics].filter(value => { const key = value.toLocaleLowerCase("fr"); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 40);
}
