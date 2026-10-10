import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import type { IncomingImage } from "./payload";
import { downloadWhatsApp, importDriveToken, generateDriveId, uploadDrive, newLease, ImportFailure } from "./providers";

export const ingestionEnabled = () => process.env.WHATSAPP_INGESTION_ENABLED === "true";
export async function enqueueImages(images: IncomingImage[]) {
  if (!images.length) return;
  const { error } = await getSupabaseServerClient().from("whatsapp_inbox").upsert(images, { onConflict: "waba_id,message_id", ignoreDuplicates: true });
  if (error) throw Error("inbox_unavailable");
}

// Une seule image par invocation : borne la mémoire et la durée, et permet plusieurs workers.
export async function processOneImage(actor: Actor) {
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
    const image = await downloadWhatsApp(job.media_id);
    const token = await importDriveToken();
    // Réserve un ID de fichier stable avant l'appel externe. Une reprise réutilise cet ID.
    const proposedId = await generateDriveId(token);
    const { error: insertError } = await db.from("whatsapp_assets").upsert({ client_id: job.client_id, drive_folder_id: job.drive_folder_id, sha256: image.sha256, md5: image.md5, mime_type: image.mime, size: image.bytes.length, drive_file_id: proposedId }, { onConflict: "client_id,drive_folder_id,sha256", ignoreDuplicates: true });
    if (insertError) throw Error("asset_unavailable");
    const { data: asset, error: assetError } = await db.from("whatsapp_assets").select("*").eq("client_id", job.client_id).eq("drive_folder_id", job.drive_folder_id).eq("sha256", image.sha256).single();
    if (assetError || !asset) throw Error("asset_unavailable");
    const upload = await uploadDrive(token, asset.drive_file_id, job.drive_folder_id, image);
    outcome = upload === "existing" ? "duplicate" : "imported";
    await writeAudit(actor, { action: `whatsapp.${outcome}`, resource_type: "whatsapp_inbox", resource_id: job.id, metadata: { client_id: job.client_id, drive_file_id: asset.drive_file_id } });
    const { data: saved, error: saveError } = await db.from("whatsapp_inbox").update({ status: outcome, drive_file_id: asset.drive_file_id, error_code: null, lease: null, lease_until: null }).eq("id", job.id).eq("lease", lease).select("id");
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
export async function processImageBatch(actor: Actor) {
  const started = Date.now();
  let processed = 0;
  while (processed < 10 && Date.now() - started < 10000) {
    const status = await processOneImage(actor);
    if (status !== "imported" && status !== "duplicate") return { processed, status };
    processed++;
  }
  return { processed, status: "pending" };
}
