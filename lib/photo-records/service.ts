import "server-only";
// Fiches photo (lot 2) : lecture des fiches, photos à confirmer, décision de l'administrateur.
// Table absente (migration 20261210000000 non appliquée) : aucune fiche, comportement d'avant.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { THUMBNAIL_BUCKET } from "@/lib/whatsapp/service";
import { todayInParis } from "@/lib/dashboard/home";
import { parsePhotoRecordInput, photoState, type PhotoRecord, type PhotoState } from "./model";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const db = () => getSupabaseServerClient();
const missingTable = (error: unknown) => {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === "42P01" || e?.code === "PGRST205" || /could not find the table|does not exist/i.test(e?.message ?? "");
};
export const PHOTO_RECORDS_NOT_INSTALLED = "Fiches photo non installées : appliquez la migration 20261210000000_photo_records.";

type Row = { asset_id: string; status: "validated" | "excluded"; intervention: string | null; commune: string | null; work_month: string | null; done_by_client: boolean | null; publication_allowed: boolean; note: string | null };
const toRecord = (r: Row): PhotoRecord => ({ assetId: r.asset_id, status: r.status, intervention: r.intervention, commune: r.commune, workMonth: r.work_month, doneByClient: r.done_by_client, publicationAllowed: r.publication_allowed, note: r.note });

/** Fiches du client par photo. Map vide si la table n'existe pas ; erreur de lecture : exception. */
export async function photoRecordsOf(clientId: string): Promise<Map<string, PhotoRecord>> {
  if (!UUID.test(clientId)) throw new Error("client invalid");
  const { data, error } = await db().from("photo_records" as never).select("asset_id,status,intervention,commune,work_month,done_by_client,publication_allowed,note").eq("client_id", clientId).limit(5000);
  if (error) { if (missingTable(error)) return new Map(); throw new Error("photo records read"); }
  return new Map(((data ?? []) as Row[]).map((r) => [r.asset_id, toRecord(r)]));
}

export type PhotoToConfirm = { id: string; thumbnailUrl: string | null; observed: string | null; caption: string | null; state: PhotoState; record: PhotoRecord | null };

/**
 * Photos à confirmer : publiables d'après l'analyse (ou la décision humaine), sans fiche, légende du client d'abord.
 * null : fiches non installées.
 */
export async function photosToConfirm(clientId: string, limit = 12): Promise<PhotoToConfirm[] | null> {
  if (!UUID.test(clientId)) throw new Error("client invalid");
  const probe = await db().from("photo_records" as never).select("asset_id").eq("client_id", clientId).limit(1);
  if (probe.error) { if (missingTable(probe.error)) return null; throw new Error("photo records read"); }
  const [records, assets] = await Promise.all([
    photoRecordsOf(clientId),
    db().from("whatsapp_assets").select("id,caption,thumbnail_path,library_status,media_kind,purged_at,imported_at").eq("client_id", clientId).eq("media_kind", "image")
      .not("imported_at", "is", null).is("purged_at", null).not("library_status", "in", "(archived,quarantined,rejected)").order("imported_at", { ascending: false }).limit(200),
  ]);
  if (assets.error) throw new Error("photo records read");
  const rows = (assets.data ?? []) as { id: string; caption: string | null; thumbnail_path: string | null }[];
  const ids = rows.map((r) => r.id);
  const assessed = ids.length ? await db().from("whatsapp_asset_assessments").select("asset_id,verdict,manual_verdict,description").eq("client_id", clientId).in("asset_id", ids) : { data: [], error: null };
  if (assessed.error) throw new Error("photo records read");
  const byAsset = new Map(((assessed.data ?? []) as { asset_id: string; verdict: string; manual_verdict: string | null; description: string }[]).map((a) => [a.asset_id, a]));
  const pending = rows.map((r) => {
    const a = byAsset.get(r.id) ?? null;
    return { r, a, state: photoState({ assessment: a, caption: r.caption, record: records.get(r.id) ?? null }) };
  }).filter((x) => x.state === "to_verify" || x.state === "analyzed")
    .sort((x, y) => Number(Boolean(y.r.caption?.trim())) - Number(Boolean(x.r.caption?.trim())))
    .slice(0, Math.max(1, Math.min(limit, 30)));
  const paths = pending.flatMap((x) => x.r.thumbnail_path?.startsWith(`${clientId}/`) ? [x.r.thumbnail_path] : []);
  const signed = paths.length ? await db().storage.from(THUMBNAIL_BUCKET).createSignedUrls(paths, 300) : { data: [] };
  const urls = new Map((signed.data ?? []).flatMap((s) => s.path && s.signedUrl ? [[s.path, s.signedUrl] as const] : []));
  return pending.map(({ r, a, state }) => ({ id: r.id, thumbnailUrl: r.thumbnail_path ? urls.get(r.thumbnail_path) ?? null : null, observed: a?.description ?? null, caption: r.caption?.trim() || null, state, record: null }));
}

/** Décision de l'administrateur sur une photo : chantier confirmé (avec ses informations) ou photo exclue. */
export async function savePhotoRecord(userId: string, clientId: string, assetId: string, form: Parameters<typeof parsePhotoRecordInput>[0]) {
  if (!/^user_[a-zA-Z0-9_-]{1,200}$/.test(userId) || !UUID.test(clientId) || !UUID.test(assetId)) return { ok: false, message: "Requête invalide." };
  const parsed = parsePhotoRecordInput(form, todayInParis());
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const { error } = await db().from("photo_records" as never).upsert({
    asset_id: assetId, client_id: clientId, status: v.decision === "validate" ? "validated" : "excluded", intervention: v.intervention, commune: v.commune,
    work_month: v.workMonth, done_by_client: v.doneByClient, publication_allowed: v.publicationAllowed, note: v.note, confirmed_by: userId, confirmed_at: new Date().toISOString(),
  } as never, { onConflict: "asset_id" });
  if (error) return { ok: false, message: missingTable(error) ? PHOTO_RECORDS_NOT_INSTALLED : error.code === "23503" ? "Photo introuvable pour ce client." : "Fiche non enregistrée." };
  return { ok: true, message: v.decision === "validate" ? "Chantier confirmé : les agents peuvent citer ces informations." : "Photo exclue des publications." };
}
