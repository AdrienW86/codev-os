import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import type { IncomingMedia } from "./payload";
import { downloadWhatsApp, importDriveToken, generateDriveId, uploadDrive, newLease, thumbnail, ImportFailure } from "./providers";

export const THUMBNAIL_BUCKET = "whatsapp-thumbnails";
export const ingestionEnabled = () => process.env.WHATSAPP_INGESTION_ENABLED === "true";
export async function enqueueMedia(media: IncomingMedia[]) {
  if (!media.length) return;
  const { error } = await getSupabaseServerClient().from("whatsapp_inbox").upsert(media, { onConflict: "waba_id,message_id", ignoreDuplicates: true });
  if (error) throw Error("inbox_unavailable");
}

// Une miniature manquante n'empêche pas l'import : la photothèque affiche alors un aperçu générique.
export async function storeThumbnail(db: ReturnType<typeof getSupabaseServerClient>, asset: { id: string; client_id: string; thumbnail_path?: string | null }, bytes: Uint8Array) {
  if (asset.thumbnail_path) return;
  try {
    const small = await thumbnail(bytes);
    if (!small) return;
    const path = `${asset.client_id}/${asset.id}.webp`;
    const { error } = await db.storage.from(THUMBNAIL_BUCKET).upload(path, small, { contentType: "image/webp", upsert: true });
    if (!error) await db.from("whatsapp_assets").update({ thumbnail_path: path }).eq("id", asset.id).eq("client_id", asset.client_id);
  } catch { console.error("[whatsapp] Miniature non générée."); }
}

// Un seul média par invocation : borne la mémoire et la durée, et permet plusieurs workers.
export async function processOneMedia(actor: Actor) {
  if (!ingestionEnabled()) return "disabled";
  const db = getSupabaseServerClient();
  const lease = newLease();
  const { data: jobs, error } = await db.rpc("whatsapp_claim", { p_lease: lease });
  if (error) throw Error("inbox_unavailable");
  const job = jobs?.[0];
  if (!job) return "idle";
  if (!job.client_id || !job.drive_folder_id) throw Error("scope_missing");
  let outcome: "imported" | "duplicate" | undefined;
  try {
    const media = await downloadWhatsApp(job.media_id, job.mime_type);
    const token = await importDriveToken();
    // Réserve un ID de fichier stable avant l'appel externe. Une reprise réutilise cet ID.
    const proposedId = await generateDriveId(token);
    const { error: insertError } = await db.from("whatsapp_assets").upsert({
      client_id: job.client_id, drive_folder_id: job.drive_folder_id, sha256: media.sha256, md5: media.md5, mime_type: media.mime, size: media.bytes.length, drive_file_id: proposedId,
      media_kind: media.kind, width: media.width, height: media.height, caption: job.caption, sender: job.sender, received_at: job.received_at,
    }, { onConflict: "client_id,drive_folder_id,sha256", ignoreDuplicates: true });
    if (insertError) throw Error("asset_unavailable");
    const { data: asset, error: assetError } = await db.from("whatsapp_assets").select("*").eq("client_id", job.client_id).eq("drive_folder_id", job.drive_folder_id).eq("sha256", media.sha256).single();
    if (assetError || !asset) throw Error("asset_unavailable");
    const upload = await uploadDrive(token, asset.drive_file_id, job.drive_folder_id, media);
    outcome = upload === "existing" ? "duplicate" : "imported";
    // Le fichier est vérifié dans Drive : il devient visible dans la photothèque.
    if (!asset.imported_at) {
      const { error: importedError } = await db.from("whatsapp_assets").update({ imported_at: new Date().toISOString() }).eq("id", asset.id).eq("client_id", job.client_id);
      if (importedError) throw Error("asset_unavailable");
    }
    if (media.kind === "image") await storeThumbnail(db, asset, media.bytes);
    await writeAudit(actor, { action: `whatsapp.${outcome}`, resource_type: "whatsapp_inbox", resource_id: job.id, metadata: { client_id: job.client_id, drive_file_id: asset.drive_file_id, media_kind: media.kind } });
    const { data: saved, error: saveError } = await db.from("whatsapp_inbox").update({ status: outcome, drive_file_id: asset.drive_file_id, asset_id: asset.id, error_code: null, lease: null, lease_until: null }).eq("id", job.id).eq("lease", lease).select("id");
    if (saveError || !saved?.length) throw Error("lease_lost");
    return outcome;
  } catch (error) {
    const code = error instanceof ImportFailure ? error.code : "import_unavailable";
    const { error: saveError } = await db.from("whatsapp_inbox").update({ status: job.attempts >= 5 ? "failed" : "pending", error_code: code, lease: null, lease_until: null, retry_at: new Date(Date.now() + Math.min(60 * 60, 30 * 2 ** job.attempts) * 1000).toISOString() }).eq("id", job.id).eq("lease", lease);
    console.error("[whatsapp] Import interrompu.", { code });
    if (saveError) throw Error("inbox_unavailable");
    return "retry";
  }
}

/** Traitement opportuniste borné ; la file durable demeure la source de vérité. */
export async function processMediaBatch(actor: Actor, limit = 10, budgetMs = 10000) {
  const started = Date.now();
  let processed = 0;
  while (processed < limit && Date.now() - started < budgetMs) {
    const status = await processOneMedia(actor);
    if (status !== "imported" && status !== "duplicate") return { processed, status };
    processed++;
  }
  return { processed, status: "pending" };
}

/**
 * Conservation des données personnelles : purge les messages et numéros des imports terminés plus anciens que
 * WHATSAPP_RETENTION_DAYS (désactivé si absent). Les fichiers Drive ne sont jamais supprimés automatiquement.
 */
export async function purgeExpiredPersonalData(now = new Date(), env: Record<string, string | undefined> = process.env) {
  const days = Number(env.WHATSAPP_RETENTION_DAYS);
  if (!Number.isInteger(days) || days < 30 || days > 3650) return { disabled: true as const };
  const { data, error } = await getSupabaseServerClient().rpc("whatsapp_purge_personal_data", { p_before: new Date(now.getTime() - days * 86400000).toISOString() });
  if (error) throw Error("purge_unavailable");
  return { purged: data ?? 0 };
}
