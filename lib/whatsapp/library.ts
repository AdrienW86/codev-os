import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import { selectAIProvider } from "@/lib/ai/providers";
import { getPublicationProjectChannels } from "@/lib/publications/project-channels";
import { projectAllowsPlatform } from "@/lib/publications/channels";
import { IMAGE_BUCKET } from "@/lib/publications/editor";
import { adaptImage } from "@/lib/publications/media/transform";
import { saveDraft, currentRevision } from "@/lib/publications/workspace";
import type { PublicationPlatform } from "@/lib/publications/types";
import { captionPrompt, checkSelection, cleanSuggestion, draftFields } from "./library-model";
import { downloadDrive, importDriveToken, maxImageBytes, maxVideoBytes } from "./providers";
import { THUMBNAIL_BUCKET } from "./service";
import type { Asset, AssetUse, LibraryStatus } from "./types";

// Photothèque interne : lecture strictement filtrée par client, miniatures privées en URL signées courtes,
// originaux relus depuis Drive par le serveur uniquement. Les appelants ont déjà vérifié requireAdmin().
const db = () => getSupabaseServerClient();
const THUMBNAIL_URL_TTL = 300;
export type LibraryUse = AssetUse & { subject: string | null; status: string | null };
export type LibraryItem = Asset & { thumbnailUrl: string | null; uses: LibraryUse[] };

export async function listClientLibrary(clientId: string, status?: LibraryStatus | null): Promise<LibraryItem[]> {
  let query = db().from("whatsapp_assets").select("*").eq("client_id", clientId).not("imported_at", "is", null);
  query = status ? query.eq("library_status", status) : query.neq("library_status", "archived");
  const { data, error } = await query.order("imported_at", { ascending: false }).limit(120);
  if (error) throw Error("library_unavailable");
  const assets = (data ?? []) as Asset[];
  if (!assets.length) return [];
  const paths = assets.flatMap(asset => asset.thumbnail_path?.startsWith(`${clientId}/`) ? [asset.thumbnail_path] : []);
  const signed = paths.length ? await db().storage.from(THUMBNAIL_BUCKET).createSignedUrls(paths, THUMBNAIL_URL_TTL) : { data: [], error: null };
  const urls = new Map((signed.data ?? []).flatMap(item => item.path && item.signedUrl ? [[item.path, item.signedUrl] as const] : []));
  const { data: uses, error: usesError } = await db().from("whatsapp_asset_uses").select("*").eq("client_id", clientId).in("asset_id", assets.map(asset => asset.id)).order("used_at", { ascending: false });
  if (usesError) throw Error("library_unavailable");
  const publicationIds = [...new Set((uses ?? []).map(use => use.publication_id))];
  const { data: publications } = publicationIds.length ? await db().from("publications").select("id,subject,status").eq("client_id", clientId).in("id", publicationIds) : { data: [] };
  const byPublication = new Map((publications ?? []).map(p => [p.id, p]));
  return assets.map(asset => ({
    ...asset,
    thumbnailUrl: asset.thumbnail_path ? urls.get(asset.thumbnail_path) ?? null : null,
    uses: (uses ?? []).filter(use => use.asset_id === asset.id).map(use => ({ ...use, subject: byPublication.get(use.publication_id)?.subject ?? null, status: byPublication.get(use.publication_id)?.status ?? null })),
  }));
}

export async function setLibraryStatus(userId: string, clientId: string, assetIds: string[], status: LibraryStatus) {
  const { data, error } = await db().from("whatsapp_assets").update({ library_status: status, status_changed_at: new Date().toISOString(), status_changed_by: userId })
    .eq("client_id", clientId).in("id", assetIds).not("imported_at", "is", null).select("id");
  if (error) throw Error("library_unavailable");
  await writeAudit({ kind: "admin", userId }, { action: "whatsapp.library.status", resource_type: "client", resource_id: clientId, metadata: { status, asset_ids: (data ?? []).map(row => row.id) } });
  return data?.length ?? 0;
}

/** Original Drive d'un média du client, pour la prévisualisation interne (jamais de lien public). */
export async function readOriginal(clientId: string, assetId: string) {
  const { data: asset, error } = await db().from("whatsapp_assets").select("*").eq("id", assetId).eq("client_id", clientId).not("imported_at", "is", null).maybeSingle();
  if (error || !asset) return null;
  const bytes = await downloadDrive(await importDriveToken(), asset.drive_file_id, asset.drive_folder_id, asset.md5, asset.media_kind === "video" ? maxVideoBytes : maxImageBytes);
  return { bytes, mime: asset.mime_type };
}

async function selectedAssets(clientId: string, ids: string[]) {
  const { data, error } = await db().from("whatsapp_assets").select("*").eq("client_id", clientId).in("id", ids);
  if (error) throw Error("library_unavailable");
  return (data ?? []) as Asset[];
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
export async function preparePublication(userId: string, input: PrepareInput): Promise<{ id?: string; message: string }> {
  const assets = await selectedAssets(input.clientId, input.assetIds);
  const check = checkSelection(input.clientId, input.assetIds, assets, input.allowReuse);
  if (!check.ok) return { message: check.message };
  const { data: project, error: projectError } = await db().from("projects").select("id,client_id,type").eq("id", input.projectId).eq("client_id", input.clientId).maybeSingle();
  if (projectError || !project) return { message: "Projet introuvable pour ce client." };
  const capabilities = await getPublicationProjectChannels(project);
  if (!input.platforms.length || input.platforms.some(platform => !projectAllowsPlatform(capabilities, platform))) return { message: "Choisissez des plateformes autorisées par ce projet." };
  const ordered = input.assetIds.map(id => assets.find(asset => asset.id === id)!);
  const suggestion = input.text ?? (input.suggest ? await suggestCaption(input.clientId, ordered) : null);
  const fields = draftFields({ receivedAt: ordered.map(asset => asset.received_at ?? asset.imported_at ?? asset.created_at), messages: ordered.flatMap(asset => asset.caption ? [asset.caption] : []), suggestion });
  const form = (extra: (form: FormData) => void) => {
    const data = new FormData();
    for (const [key, value] of Object.entries({ client_id: input.clientId, project_id: input.projectId, title: fields.title, angle: fields.angle, source: fields.source })) data.set(key, value);
    for (const platform of input.platforms) { data.set(`${platform}_enabled`, "on"); data.set(`${platform}_text`, fields.text); }
    extra(data);
    return data;
  };
  const draft = await saveDraft(form(() => {}));
  if (!draft.id) return { message: draft.message ?? "Brouillon non créé." };
  const publicationId = draft.id;
  const partial = { id: publicationId, message: "Brouillon créé, mais les médias n’ont pas pu être attachés. Ajoutez-les depuis la publication ou réessayez." };
  const revision = await currentRevision(publicationId);
  if (!revision?.revision_id) return partial;
  const attached: Record<string, string[]> = {};
  const uses: { asset_id: string; platform: PublicationPlatform; publication_asset_id: string }[] = [];
  try {
    const token = await importDriveToken();
    for (const asset of ordered) {
      const original = await downloadDrive(token, asset.drive_file_id, asset.drive_folder_id, asset.md5, maxImageBytes);
      for (const platform of input.platforms) {
        const derivative = await adaptImage(original, platform);
        const publicationAssetId = randomUUID(), path = `${input.clientId}/${publicationId}/${publicationAssetId}`;
        const upload = await db().storage.from(IMAGE_BUCKET).upload(path, derivative.bytes, { contentType: derivative.mime_type, upsert: false });
        if (upload.error) return partial;
        const registered = await db().rpc("publication_register_image", { p_publication_id: publicationId, p_revision_id: revision.revision_id, p_asset_id: publicationAssetId, p_path: path, p_hash: createHash("sha256").update(derivative.bytes).digest("hex"), p_mime: derivative.mime_type, p_provenance: `WhatsApp client, reçu le ${new Date(asset.received_at ?? asset.created_at).toISOString().slice(0, 10)} · original Drive ${asset.drive_file_id}`, p_actor_id: userId });
        if (registered.error) { await db().storage.from(IMAGE_BUCKET).remove([path]); return partial; }
        (attached[platform] ??= []).push(publicationAssetId);
        uses.push({ asset_id: asset.id, platform, publication_asset_id: publicationAssetId });
      }
    }
  } catch { console.error("[whatsapp] Préparation des médias interrompue."); return partial; }
  const revised = await saveDraft(form(data => { data.set("publication_id", publicationId); data.set("revision_id", revision.revision_id!); for (const [platform, ids] of Object.entries(attached)) for (const id of ids) data.append(`${platform}_assets`, id); }));
  if (!revised.id) return partial;
  const { error: useError } = await db().from("whatsapp_asset_uses").insert(uses.map(use => ({ ...use, client_id: input.clientId, publication_id: publicationId, used_by: userId })));
  if (!useError) await db().from("whatsapp_assets").update({ library_status: "used", status_changed_at: new Date().toISOString(), status_changed_by: userId }).eq("client_id", input.clientId).in("id", input.assetIds);
  await writeAudit({ kind: "admin", userId }, { action: "whatsapp.library.publication_prepared", resource_type: "publication", resource_id: publicationId, metadata: { client_id: input.clientId, asset_ids: input.assetIds, platforms: input.platforms, ai_suggestion: Boolean(suggestion && !input.text) } });
  return { id: publicationId, message: useError ? "Brouillon prêt, mais l’historique d’utilisation n’a pas été enregistré." : "Brouillon de publication prêt à relire." };
}

/** Dossiers Drive attribués au client (associations WhatsApp), pour les liens de la photothèque. */
export async function clientFolders(clientId: string) {
  const { data, error } = await db().from("whatsapp_senders").select("drive_folder_id,enabled").eq("client_id", clientId);
  if (error) throw Error("library_unavailable");
  return [...new Set((data ?? []).map(row => row.drive_folder_id))];
}
