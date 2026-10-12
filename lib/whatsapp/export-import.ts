import "server-only";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import { baseName, extensionOf, fileNameInstant, IMAGE_EXTENSIONS, isChatFile, parseChat } from "./export-parser";
import { extractEntry, readCentralDirectory, ZipFailure, type RangeReader, type ZipEntry } from "./zip";
import { archiveReader, ExportStorageFailure, listExportObjects, MAX_ARCHIVE_BYTES, purgeExportFiles, removeExportObjects, signedArchiveUpload, signedPreviews, storePreview, type StoredExportObject } from "./export-storage";
import { generateDriveId, ImportFailure, importDriveToken, maxImageBytes, thumbnail, uploadDrive, type UploadBytes } from "./providers";
import { storeThumbnail } from "./service";
import type { ExportItemRow } from "./types";

// Socle lot 3 : import d'un export de discussion WhatsApp depuis la fiche client.
// 1. start : l'admin confirme les droits ; une URL signée reçoit l'archive directement dans un bucket privé.
// 2. analyze : répertoire central + discussion (en mémoire, jamais stockée) → une ligne par photo avec date et légende.
// 3. analyzeBatch : vérification binaire, empreintes, doublons, aperçu réduit — par lots.
// 4. sélection et filtres (période, avec légende), aperçu ;
// 5. importBatch : Drive (accès d'import drive.file) puis photothèque (origine « whatsapp_export »), par lots.
// 6. fin, annulation ou expiration (24 h) : archive et aperçus supprimés, légendes des lignes d'import effacées.
// Les légendes sont des données : aucune n'est interprétée, aucune ne déclenche d'action ni n'atteint un prompt ici.
export const MAX_CHAT_BYTES = 20 * 1024 * 1024;
export const MAX_EXPORT_PHOTOS = 5000;
export const ANALYZE_BATCH = 15;
export const IMPORT_BATCH = 8;
const ACTIVE = ["uploading", "analyzing", "ready", "importing"] as const;
const TERMINAL = ["completed", "cancelled", "expired", "failed"] as const;
const RETENTION_MS = 24 * 3600000;
// Réservation d'une photo par un lot d'import (deux onglets ne traitent jamais la même) ; reprise après 10 min sans fin.
const CLAIM_STALE_MS = 10 * 60000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export type ExportResult<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; code: string };
export type ImportRow = { id: string; client_id: string; drive_folder_id: string; status: string; storage_path: string; archive_size: number | null; counts: Record<string, number>; incomplete: boolean; error_code: string | null; expires_at: string; purged_at: string | null; created_at: string };
type ItemRow = ExportItemRow;
export type ExportDeps = {
  reader(path: string): Promise<RangeReader>; signedUpload(path: string): Promise<string>; purge(clientId: string, importId: string): Promise<void>;
  storePreview(path: string, bytes: Uint8Array): Promise<boolean>; signedPreviews(paths: string[]): Promise<Map<string, string>>;
  inspect(bytes: Uint8Array): Promise<{ mime: string; width: number | null; height: number | null } | null>; thumbnail(bytes: Uint8Array): Promise<Uint8Array | null>;
  driveToken(): Promise<string>; generateDriveId(token: string): Promise<string>; uploadDrive(token: string, id: string, folder: string, bytes: UploadBytes): Promise<string>;
  storeThumbnail(asset: { id: string; client_id: string; thumbnail_path?: string | null }, bytes: Uint8Array): Promise<void>;
  audit(actor: Actor, entry: Parameters<typeof writeAudit>[1]): Promise<void>; now(): Date;
  listObjects(): Promise<StoredExportObject[]>; removeObjects(paths: string[]): Promise<void>;
};
// Vérification binaire : JPEG, PNG ou WebP réellement décodables, dimensions bornées. Rien d'autre n'est importé.
async function inspectImage(bytes: Uint8Array) {
  try {
    const info = await sharp(Buffer.from(bytes), { limitInputPixels: 40000000 }).metadata();
    const mime = info.format === "jpeg" ? "image/jpeg" : info.format === "png" ? "image/png" : info.format === "webp" ? "image/webp" : null;
    return mime ? { mime, width: info.width ?? null, height: info.height ?? null } : null;
  } catch { return null; }
}
export const productionExportDeps: ExportDeps = {
  reader: archiveReader, signedUpload: signedArchiveUpload, purge: purgeExportFiles, storePreview, signedPreviews, inspect: inspectImage, thumbnail,
  driveToken: importDriveToken, generateDriveId, uploadDrive, storeThumbnail: (asset, bytes) => storeThumbnail(getSupabaseServerClient(), asset, bytes),
  audit: writeAudit, now: () => new Date(), listObjects: () => listExportObjects(), removeObjects: removeExportObjects,
};
const db = () => getSupabaseServerClient();
const admin = (userId: string): Actor => ({ kind: "admin", userId });
const failure = (error: unknown) => error instanceof ZipFailure || error instanceof ExportStorageFailure || error instanceof ImportFailure ? error.code : "unexpected";

const IMPORT_COLUMNS = "id,client_id,drive_folder_id,status,storage_path,archive_size,counts,incomplete,error_code,expires_at,purged_at,created_at";
async function loadImport(importId: unknown, clientId?: unknown): Promise<ImportRow | null> {
  if (typeof importId !== "string" || !UUID.test(importId)) return null;
  let query = db().from("whatsapp_export_imports").select(IMPORT_COLUMNS).eq("id", importId);
  if (clientId !== undefined) { if (typeof clientId !== "string" || !UUID.test(clientId)) return null; query = query.eq("client_id", clientId); }
  const { data, error } = await query.maybeSingle();
  if (error) throw Error("export_unavailable");
  return (data as ImportRow | null) ?? null;
}
const live = (row: ImportRow, now: Date) => !row.purged_at && Date.parse(row.expires_at) > now.getTime();

/** Import en cours du client (le plus récent non terminé et non expiré), pour reprendre après un rechargement. */
export async function currentExportImport(clientId: string, now = new Date()): Promise<ImportRow | null> {
  const { data, error } = await db().from("whatsapp_export_imports").select(IMPORT_COLUMNS)
    .eq("client_id", clientId).in("status", [...ACTIVE]).is("purged_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw Error("export_unavailable");
  const row = data as ImportRow | null;
  return row && live(row, now) ? row : null;
}

/** Le client a-t-il un dossier Drive WhatsApp actif, droits confirmés (cible de l'import) ? */
export async function exportFolderReady(clientId: string): Promise<boolean> {
  const { data, error } = await db().from("whatsapp_senders").select("drive_folder_id").eq("client_id", clientId).eq("enabled", true).eq("rights_confirmed", true).limit(1);
  if (error) throw Error("export_unavailable");
  return Boolean(data?.length);
}
export async function startExportImport(userId: string, clientId: unknown, size: unknown, rightsConfirmed: boolean, deps: ExportDeps = productionExportDeps): Promise<ExportResult<{ importId: string; uploadUrl: string }>> {
  if (typeof clientId !== "string" || !UUID.test(clientId)) return { ok: false, code: "invalid_client" };
  if (!rightsConfirmed) return { ok: false, code: "rights_required" };
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 22) return { ok: false, code: "archive_invalid" };
  if (size > MAX_ARCHIVE_BYTES) return { ok: false, code: "archive_too_large" };
  // Dossier Drive du client : celui de son association WhatsApp active (droits confirmés), le plus récent.
  const folder = await db().from("whatsapp_senders").select("drive_folder_id").eq("client_id", clientId).eq("enabled", true).eq("rights_confirmed", true).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (folder.error) throw Error("export_unavailable");
  if (!folder.data) return { ok: false, code: "no_folder" };
  // Un seul import actif par client (index unique partiel en base) : un import actif mais expiré est clos avant d'en créer un.
  const active = await db().from("whatsapp_export_imports").select(IMPORT_COLUMNS).eq("client_id", clientId).in("status", [...ACTIVE]).limit(5);
  if (active.error) throw Error("export_unavailable");
  for (const stale of (active.data ?? []) as ImportRow[]) {
    if (live(stale, deps.now())) return { ok: false, code: "already_running" };
    await finish(null, stale, "expired", deps);
  }
  const id = randomUUID(), path = `${clientId}/${id}.zip`;
  const { error } = await db().from("whatsapp_export_imports").insert({ id, client_id: clientId, drive_folder_id: folder.data.drive_folder_id, storage_path: path, rights_confirmed: true, created_by: userId, status: "uploading",
    expires_at: new Date(deps.now().getTime() + RETENTION_MS).toISOString() });
  // Deux démarrages simultanés : l'index unique partiel refuse le second.
  if (error?.code === "23505") return { ok: false, code: "already_running" };
  if (error) throw Error("export_unavailable");
  const uploadUrl = await deps.signedUpload(path);
  await deps.audit(admin(userId), { action: "whatsapp.export.started", resource_type: "whatsapp_export_import", resource_id: id, metadata: { client_id: clientId, size } });
  return { ok: true, importId: id, uploadUrl };
}

// Analyse de l'archive déposée : jamais de texte de conversation conservé, seulement les pièces jointes images.
export async function analyzeExportArchive(userId: string, clientId: unknown, importId: unknown, deps: ExportDeps = productionExportDeps): Promise<ExportResult<{ photos: number; incomplete: boolean }>> {
  const row = await loadImport(importId, clientId);
  if (!row || !live(row, deps.now())) return { ok: false, code: "import_missing" };
  if (row.status !== "uploading") return { ok: false, code: "already_analyzed" };
  // Échec : uniquement si l'import est encore « uploading » (une analyse concurrente qui a abouti n'est jamais défaite).
  const fail = async (code: string) => {
    const failed = await db().from("whatsapp_export_imports").update({ status: "failed", error_code: code }).eq("id", row.id).eq("status", "uploading").select("id");
    if (failed.error) throw Error("export_unavailable");
    if (failed.data?.length) await safePurge(row, deps);
    return { ok: false as const, code };
  };
  let reader: RangeReader, entries: ZipEntry[];
  try { reader = await deps.reader(row.storage_path); entries = await readCentralDirectory(reader); }
  catch (error) { return fail(failure(error)); }
  const chats = entries.filter(e => isChatFile(e.name) && !e.name.startsWith("__MACOSX/") && !e.overlap);
  let parsed = { media: [] as { fileName: string; at: string | null; caption: string | null }[], omitted: 0, messages: 0 };
  if (chats.length) {
    try { parsed = parseChat(Buffer.from(await extractEntry(reader, chats[0], MAX_CHAT_BYTES)).toString("utf8")); }
    catch (error) { return fail(failure(error) === "entry_too_large" ? "chat_too_large" : failure(error)); }
  }
  const files = entries.filter(e => !e.name.startsWith("__MACOSX/") && !isChatFile(e.name));
  const byName = new Map(files.map(e => [baseName(e.name), e]));
  const images = files.filter(e => IMAGE_EXTENSIONS[extensionOf(e.name)]);
  const referenced = new Map(parsed.media.map(m => [m.fileName, m]));
  const counts = {
    photos: images.length, other_files: files.length - images.length, missing: parsed.media.filter(m => !byName.has(m.fileName)).length,
    omitted: parsed.omitted, unreferenced: chats.length ? images.filter(e => !referenced.has(baseName(e.name))).length : images.length, with_caption: 0,
  };
  if (images.length > MAX_EXPORT_PHOTOS) return fail("too_many_photos");
  // Noms d'entrée en double (après nettoyage) : la première est retenue, les suivantes deviennent des lignes « invalid »
  // sous un nom distinct ; entrées qui se chevauchent : « invalid », jamais lues.
  const seen = new Set<string>();
  const rows = images.map(e => {
    const ref = referenced.get(baseName(e.name));
    const clean = e.name.slice(0, 300).replace(/[\x00-\x1f]/g, "_");
    let entryName = clean, duplicateName = false;
    for (let n = 2; seen.has(entryName); n++) { duplicateName = true; const suffix = ` (${n})`; entryName = clean.slice(0, 300 - suffix.length) + suffix; }
    seen.add(entryName);
    const rejected = duplicateName ? "duplicate_entry" : e.overlap ? "zip_overlap" : e.encrypted ? "zip_encrypted" : e.method !== 0 && e.method !== 8 ? "zip_method" : null;
    return { import_id: row.id, client_id: row.client_id, entry_name: entryName, entry_offset: e.offset, compressed_size: e.compressedSize, size: e.size, method: e.method === 0 || e.method === 8 ? e.method : 0, crc32: e.crc32,
      captured_at: ref?.at ?? fileNameInstant(baseName(e.name)), caption: rejected ? null : ref?.caption ?? null,
      status: (rejected ? "invalid" : e.size > maxImageBytes ? "too_large" : "pending") as ItemRow["status"], selected: !rejected && e.size <= maxImageBytes, error_code: rejected };
  });
  counts.with_caption = rows.filter(r => r.caption).length;
  // Lignes idempotentes (une analyse relancée ou concurrente n'en crée jamais deux), puis passage « uploading » → « analyzing »
  // en compare-and-set : une seule analyse l'emporte, l'autre répond « déjà analysée ».
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db().from("whatsapp_export_items").upsert(rows.slice(i, i + 500), { onConflict: "import_id,entry_name", ignoreDuplicates: true });
    if (error) return fail("items_unavailable");
  }
  const incomplete = !chats.length || counts.missing > 0 || counts.omitted > 0;
  const { data: claimed, error } = await db().from("whatsapp_export_imports").update({ status: "analyzing", archive_size: reader.size, counts, incomplete }).eq("id", row.id).eq("status", "uploading").select("id");
  if (error) throw Error("export_unavailable");
  if (!claimed?.length) return { ok: false, code: "already_analyzed" };
  await deps.audit(admin(userId), { action: "whatsapp.export.analyzed", resource_type: "whatsapp_export_import", resource_id: row.id, metadata: { client_id: row.client_id, ...counts, incomplete } });
  return { ok: true, photos: images.length, incomplete };
}
const entryOf = (item: ItemRow): ZipEntry => ({ name: item.entry_name, method: item.method, compressedSize: item.compressed_size, size: item.size, crc32: item.crc32, offset: item.entry_offset, encrypted: false });

// Vérification, empreintes, doublons (photothèque du client et archive elle-même) et aperçu, par lots.
export async function analyzeExportBatch(clientId: unknown, importId: unknown, deps: ExportDeps = productionExportDeps): Promise<ExportResult<{ remaining: number }>> {
  const row = await loadImport(importId, clientId);
  if (!row || !live(row, deps.now())) return { ok: false, code: "import_missing" };
  if (row.status !== "analyzing") return row.status === "ready" ? { ok: true, remaining: 0 } : { ok: false, code: "wrong_state" };
  const { data, error } = await db().from("whatsapp_export_items").select("*").eq("import_id", row.id).eq("status", "pending").order("entry_name").limit(ANALYZE_BATCH);
  if (error) throw Error("export_unavailable");
  const items = (data ?? []) as ItemRow[];
  if (items.length) {
    let reader: RangeReader;
    try { reader = await deps.reader(row.storage_path); } catch (e) { return { ok: false, code: failure(e) }; }
    for (const item of items) {
      let update: Partial<ItemRow>;
      try {
        const bytes = await extractEntry(reader, entryOf(item), maxImageBytes);
        const info = await deps.inspect(bytes);
        if (!info) update = { status: "invalid", selected: false, error_code: "invalid_image" };
        else {
          const sha256 = createHash("sha256").update(bytes).digest("hex"), md5 = createHash("md5").update(bytes).digest("hex");
          const [existing, twin] = await Promise.all([
            // Seules les photos réellement importées comptent : une ligne laissée par un import interrompu (imported_at nul) est reprise.
            db().from("whatsapp_assets").select("id").eq("client_id", row.client_id).eq("sha256", sha256).not("imported_at", "is", null).limit(1),
            db().from("whatsapp_export_items").select("id").eq("import_id", row.id).eq("sha256", sha256).neq("id", item.id).limit(1)]);
          if (existing.error || twin.error) throw Error("export_unavailable");
          const duplicate = Boolean(existing.data?.length || twin.data?.length);
          let preview: string | null = null;
          const small = await deps.thumbnail(bytes);
          if (small) { const path = `${row.client_id}/${row.id}/${item.id}.webp`; if (await deps.storePreview(path, small)) preview = path; }
          update = { status: duplicate ? "duplicate" : "ready", selected: !duplicate && item.selected, sha256, md5, mime_type: info.mime, width: info.width, height: info.height, preview_path: preview, error_code: null };
        }
      } catch (e) { update = { status: failure(e) === "entry_too_large" ? "too_large" : "invalid", selected: false, error_code: failure(e) }; }
      const saved = await db().from("whatsapp_export_items").update(update).eq("id", item.id).eq("status", "pending");
      if (saved.error) throw Error("export_unavailable");
    }
  }
  const left = await db().from("whatsapp_export_items").select("id").eq("import_id", row.id).eq("status", "pending").limit(1000);
  if (left.error) throw Error("export_unavailable");
  const remaining = left.data?.length ?? 0;
  if (!remaining) await db().from("whatsapp_export_imports").update({ status: "ready" }).eq("id", row.id).eq("status", "analyzing");
  return { ok: true, remaining };
}

export type PreviewItem = { id: string; status: string; selected: boolean; capturedAt: string | null; caption: string | null; preview: string | null; width: number | null; height: number | null };
export async function exportPreview(clientId: unknown, importId: unknown, page = 0, deps: ExportDeps = productionExportDeps): Promise<{ import: ImportRow; items: PreviewItem[]; totals: Record<string, number> } | null> {
  const row = await loadImport(importId, clientId);
  // Plus rien n'est montré (aperçus, légendes) une fois l'import terminé, annulé ou expiré.
  if (!row || !live(row, deps.now()) || !(ACTIVE as readonly string[]).includes(row.status)) return null;
  const all = await db().from("whatsapp_export_items").select("id,status,selected").eq("import_id", row.id).limit(MAX_EXPORT_PHOTOS);
  const { data, error } = await db().from("whatsapp_export_items").select("id,status,selected,captured_at,caption,preview_path,width,height").eq("import_id", row.id)
    .order("captured_at", { ascending: true }).order("entry_name").range(page * 60, page * 60 + 59);
  if (error || all.error) throw Error("export_unavailable");
  const rows = (data ?? []) as Pick<ItemRow, "id" | "status" | "selected" | "captured_at" | "caption" | "preview_path" | "width" | "height">[];
  const urls = await deps.signedPreviews(rows.flatMap(r => r.preview_path ? [r.preview_path] : []));
  const totals: Record<string, number> = { selected: 0 };
  for (const r of (all.data ?? []) as { status: string; selected: boolean }[]) { totals[r.status] = (totals[r.status] ?? 0) + 1; if (r.selected && r.status === "ready") totals.selected++; }
  return { import: row, totals, items: rows.map(r => ({ id: r.id, status: r.status, selected: r.selected, capturedAt: r.captured_at, caption: r.caption, preview: r.preview_path ? urls.get(r.preview_path) ?? null : null, width: r.width, height: r.height })) };
}

// Sélection manuelle (cases à cocher) : seules des photos prêtes peuvent être sélectionnées.
export async function selectExportItems(clientId: unknown, importId: unknown, ids: unknown[], selected: boolean, deps: ExportDeps = productionExportDeps): Promise<ExportResult> {
  const row = await loadImport(importId, clientId);
  if (!row || !live(row, deps.now()) || row.status !== "ready") return { ok: false, code: "wrong_state" };
  const valid = ids.filter((id): id is string => typeof id === "string" && UUID.test(id)).slice(0, 500);
  if (!valid.length) return { ok: false, code: "nothing_selected" };
  const { error } = await db().from("whatsapp_export_items").update({ selected }).eq("import_id", row.id).eq("status", "ready").in("id", valid);
  if (error) throw Error("export_unavailable");
  return { ok: true };
}
// Filtres : période (dates incluses, heure de Paris) et « avec légende seulement ». Recalcule la sélection des photos prêtes.
export async function filterExportItems(clientId: unknown, importId: unknown, filter: { from?: string | null; to?: string | null; captionOnly?: boolean }, deps: ExportDeps = productionExportDeps): Promise<ExportResult<{ selected: number }>> {
  const row = await loadImport(importId, clientId);
  if (!row || !live(row, deps.now()) || row.status !== "ready") return { ok: false, code: "wrong_state" };
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if ((filter.from && !day.test(filter.from)) || (filter.to && !day.test(filter.to)) || (filter.from && filter.to && filter.from > filter.to)) return { ok: false, code: "invalid_period" };
  const { data, error } = await db().from("whatsapp_export_items").select("id,captured_at,caption").eq("import_id", row.id).eq("status", "ready").limit(MAX_EXPORT_PHOTOS);
  if (error) throw Error("export_unavailable");
  const paris = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const keep = (r: { captured_at: string | null; caption: string | null }) => {
    if (filter.captionOnly && !r.caption) return false;
    if ((filter.from || filter.to) && !r.captured_at) return false;
    const d = r.captured_at ? paris(r.captured_at) : null;
    return !(d && ((filter.from && d < filter.from) || (filter.to && d > filter.to)));
  };
  const rows = (data ?? []) as { id: string; captured_at: string | null; caption: string | null }[];
  const yes = rows.filter(keep).map(r => r.id), no = rows.filter(r => !keep(r)).map(r => r.id);
  for (const [ids, selected] of [[yes, true], [no, false]] as const)
    for (let i = 0; i < ids.length; i += 500) { const r = await db().from("whatsapp_export_items").update({ selected }).eq("import_id", row.id).in("id", ids.slice(i, i + 500)); if (r.error) throw Error("export_unavailable"); }
  return { ok: true, selected: yes.length };
}

// Import par lots : relecture de l'archive, empreinte identique à l'analyse, Drive puis photothèque.
export async function importExportBatch(userId: string, clientId: unknown, importId: unknown, deps: ExportDeps = productionExportDeps): Promise<ExportResult<{ remaining: number; imported: number; done: boolean }>> {
  const row = await loadImport(importId, clientId);
  if (!row || !live(row, deps.now())) return { ok: false, code: "import_missing" };
  if (row.status !== "ready" && row.status !== "importing") return { ok: false, code: "wrong_state" };
  if (row.status === "ready") {
    const { error } = await db().from("whatsapp_export_imports").update({ status: "importing" }).eq("id", row.id).eq("status", "ready");
    if (error) throw Error("export_unavailable");
  }
  // Photos prêtes et sélectionnées, plus celles réservées par un lot interrompu depuis plus de 10 min.
  const staleBefore = new Date(deps.now().getTime() - CLAIM_STALE_MS).toISOString();
  const [fresh, stale] = await Promise.all([
    db().from("whatsapp_export_items").select("*").eq("import_id", row.id).eq("status", "ready").eq("selected", true).order("captured_at", { ascending: true }).limit(IMPORT_BATCH),
    db().from("whatsapp_export_items").select("*").eq("import_id", row.id).eq("status", "importing").lt("updated_at", staleBefore).limit(IMPORT_BATCH)]);
  if (fresh.error || stale.error) throw Error("export_unavailable");
  const candidates = [...(stale.data ?? []), ...(fresh.data ?? [])].slice(0, IMPORT_BATCH) as ItemRow[];
  // Réservation photo par photo (compare-and-set) : deux onglets ne traitent jamais la même photo.
  const items: ItemRow[] = [];
  for (const item of candidates) {
    let claim = db().from("whatsapp_export_items").update({ status: "importing", updated_at: deps.now().toISOString() }).eq("id", item.id).eq("status", item.status);
    claim = item.status === "ready" ? claim.eq("selected", true) : claim.eq("updated_at", item.updated_at);
    const { data: won, error: claimError } = await claim.select("id");
    if (claimError) throw Error("export_unavailable");
    if (won?.length) items.push(item);
  }
  let imported = 0;
  if (items.length) {
    let reader: RangeReader, token: string;
    try { reader = await deps.reader(row.storage_path); token = await deps.driveToken(); }
    catch (e) { for (const item of items) await markItem(item.id, { status: "ready" }); return { ok: false, code: failure(e) }; }
    for (const item of items) {
      try {
        const bytes = await extractEntry(reader, entryOf(item), maxImageBytes);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        if (sha256 !== item.sha256 || !item.md5 || !item.mime_type) { await markItem(item.id, { status: "failed", error_code: "archive_changed" }); continue; }
        // Doublon seulement si la photo est réellement importée ; une ligne orpheline (imported_at nul, envoi Drive interrompu)
        // du même dossier est reprise ci-dessous par l'upsert (même identifiant Drive, envoi idempotent).
        const existing = await db().from("whatsapp_assets").select("id").eq("client_id", row.client_id).eq("sha256", sha256).not("imported_at", "is", null).limit(1);
        if (existing.error) throw Error("export_unavailable");
        if (existing.data?.length) { await markItem(item.id, { status: "duplicate", selected: false }); continue; }
        const proposedId = await deps.generateDriveId(token);
        const insert = await db().from("whatsapp_assets").upsert({ client_id: row.client_id, drive_folder_id: row.drive_folder_id, sha256, md5: item.md5, mime_type: item.mime_type, size: bytes.length, drive_file_id: proposedId,
          media_kind: "image", width: item.width, height: item.height, caption: item.caption, sender: null, received_at: null, origin: "whatsapp_export", captured_at: item.captured_at }, { onConflict: "client_id,drive_folder_id,sha256", ignoreDuplicates: true });
        if (insert.error) throw Error("asset_unavailable");
        const asset = await db().from("whatsapp_assets").select("id,client_id,drive_file_id,thumbnail_path,imported_at").eq("client_id", row.client_id).eq("drive_folder_id", row.drive_folder_id).eq("sha256", sha256).single();
        if (asset.error || !asset.data) throw Error("asset_unavailable");
        await deps.uploadDrive(token, asset.data.drive_file_id, row.drive_folder_id, { bytes, mime: item.mime_type, sha256, md5: item.md5 });
        if (!asset.data.imported_at) { const r = await db().from("whatsapp_assets").update({ imported_at: deps.now().toISOString() }).eq("id", asset.data.id).eq("client_id", row.client_id); if (r.error) throw Error("asset_unavailable"); }
        await deps.storeThumbnail(asset.data, bytes);
        await markItem(item.id, { status: "imported", asset_id: asset.data.id, error_code: null });
        imported++;
      } catch (e) {
        const code = failure(e);
        await markItem(item.id, { status: "failed", error_code: code === "unexpected" && e instanceof Error && /^[a-z_]{1,40}$/.test(e.message) ? e.message : code });
        console.error("[whatsapp-export] Photo non importée.", { code });
      }
    }
  }
  // Restantes : prêtes et sélectionnées, ou réservées par un autre lot en cours. Fin seulement quand il n'y a plus rien.
  const [left, busy] = await Promise.all([
    db().from("whatsapp_export_items").select("id").eq("import_id", row.id).eq("status", "ready").eq("selected", true).limit(MAX_EXPORT_PHOTOS),
    db().from("whatsapp_export_items").select("id").eq("import_id", row.id).eq("status", "importing").limit(MAX_EXPORT_PHOTOS)]);
  if (left.error || busy.error) throw Error("export_unavailable");
  const remaining = (left.data?.length ?? 0) + (busy.data?.length ?? 0);
  if (!remaining) await finish(userId, row, "completed", deps);
  return { ok: true, remaining, imported, done: remaining === 0 };
}
async function markItem(id: string, update: Partial<ItemRow>) {
  const { error } = await db().from("whatsapp_export_items").update(update).eq("id", id);
  if (error) throw Error("export_unavailable");
}
async function safePurge(row: Pick<ImportRow, "id" | "client_id">, deps: ExportDeps) {
  try { await deps.purge(row.client_id, row.id); return true; } catch { console.error("[whatsapp-export] Archive non supprimée : nouvel essai au prochain passage."); return false; }
}
// Fin d'un import (terminé, annulé, expiré) : fichiers temporaires supprimés, légendes des lignes d'import effacées.
// purged_at n'est posé que si l'archive, les aperçus ET les légendes ont bien été supprimés ; sinon le planificateur réessaie.
async function finish(userId: string | null, row: ImportRow, status: "completed" | "cancelled" | "expired", deps: ExportDeps) {
  const purged = await safePurge(row, deps);
  const items = await db().from("whatsapp_export_items").select("status").eq("import_id", row.id).limit(MAX_EXPORT_PHOTOS);
  if (items.error) throw Error("export_unavailable");
  const totals: Record<string, number> = {};
  for (const i of (items.data ?? []) as { status: string }[]) totals[i.status] = (totals[i.status] ?? 0) + 1;
  const cleared = await db().from("whatsapp_export_items").update({ caption: null, preview_path: null }).eq("import_id", row.id);
  if (cleared.error) console.error("[whatsapp-export] Légendes non effacées : nouvel essai au prochain passage.");
  // Compare-and-set sur un statut actif : deux fins concurrentes (deux onglets, planificateur) n'écrivent qu'une fois.
  const { data, error } = await db().from("whatsapp_export_imports").update({ status, counts: { ...row.counts, result: totals } as never, ...(purged && !cleared.error ? { purged_at: deps.now().toISOString() } : {}) })
    .eq("id", row.id).in("status", [...ACTIVE]).select("id");
  if (error) throw Error("export_unavailable");
  if (!data?.length) return;
  await deps.audit(userId ? admin(userId) : { kind: "system", worker: "whatsapp-export" }, { action: `whatsapp.export.${status}`, resource_type: "whatsapp_export_import", resource_id: row.id, metadata: { client_id: row.client_id, ...totals } });
}
export async function cancelExportImport(userId: string, clientId: unknown, importId: unknown, deps: ExportDeps = productionExportDeps): Promise<ExportResult> {
  const row = await loadImport(importId, clientId);
  if (!row || row.purged_at || !(ACTIVE as readonly string[]).includes(row.status)) return { ok: false, code: "wrong_state" };
  await finish(userId, row, "cancelled", deps);
  return { ok: true };
}
/**
 * Planificateur (en premier dans le passage) : imports expirés (24 h) clos, imports terminés dont la suppression a échoué
 * repris, puis balayage borné des fichiers orphelins du bucket. Les imports en cours et non expirés ne sont jamais touchés.
 * Une erreur sur une ligne n'arrête pas les suivantes. Les photos importées restent.
 */
export async function purgeExportImports(deps: ExportDeps = productionExportDeps, limit = 20) {
  const now = deps.now();
  const [expired, terminal] = await Promise.all([
    db().from("whatsapp_export_imports").select(IMPORT_COLUMNS).is("purged_at", null).lte("expires_at", now.toISOString()).order("expires_at").limit(limit),
    db().from("whatsapp_export_imports").select(IMPORT_COLUMNS).is("purged_at", null).in("status", [...TERMINAL]).order("expires_at").limit(limit)]);
  if (expired.error || terminal.error) throw Error("export_unavailable");
  const rows = new Map<string, ImportRow>();
  for (const row of [...(expired.data ?? []), ...(terminal.data ?? [])] as ImportRow[]) rows.set(row.id, row);
  let purged = 0, failed = 0;
  for (const row of [...rows.values()].slice(0, limit)) {
    const isTerminal = (TERMINAL as readonly string[]).includes(row.status);
    if (!isTerminal && Date.parse(row.expires_at) > now.getTime()) continue;
    try {
      if (!isTerminal) { await finish(null, row, "expired", deps); purged++; continue; }
      if (!await safePurge(row, deps)) { failed++; continue; }
      const cleared = await db().from("whatsapp_export_items").update({ caption: null, preview_path: null }).eq("import_id", row.id);
      if (cleared.error) { failed++; continue; }
      const done = await db().from("whatsapp_export_imports").update({ purged_at: now.toISOString() }).eq("id", row.id).is("purged_at", null);
      if (done.error) { failed++; continue; }
      purged++;
    } catch { failed++; console.error("[whatsapp-export] Purge d'un import différée."); }
  }
  let orphans: number | null = null;
  try { orphans = await sweepExportOrphans(deps, now); } catch { console.error("[whatsapp-export] Balayage des archives orphelines différé."); }
  return { purged, failed, orphans };
}
// Fichiers du bucket de plus de 24 h dont l'import est purgé, expiré ou absent (envoi terminé après une annulation, ligne perdue).
// Inventaire et suppression bornés ; un fichier d'un import en cours n'est jamais supprimé.
const OBJECT_PATH = /^([0-9a-f-]{36})\/([0-9a-f-]{36})(?:\.zip|\/[0-9a-f-]{36}\.webp)$/;
async function sweepExportOrphans(deps: ExportDeps, now: Date, max = 500) {
  const cutoff = now.getTime() - RETENTION_MS;
  const old = (await deps.listObjects()).flatMap(o => {
    const m = OBJECT_PATH.exec(o.path), at = o.createdAt ? Date.parse(o.createdAt) : NaN;
    return m && Number.isFinite(at) && at <= cutoff ? [{ path: o.path, clientId: m[1], importId: m[2] }] : [];
  }).slice(0, max);
  if (!old.length) return 0;
  const ids = [...new Set(old.map(o => o.importId))], known = new Map<string, Pick<ImportRow, "id" | "client_id" | "expires_at" | "purged_at">>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db().from("whatsapp_export_imports").select("id,client_id,expires_at,purged_at").in("id", ids.slice(i, i + 100));
    if (error) throw Error("export_unavailable");
    for (const r of (data ?? []) as Pick<ImportRow, "id" | "client_id" | "expires_at" | "purged_at">[]) known.set(r.id, r);
  }
  const doomed = old.filter(o => {
    const r = known.get(o.importId);
    return !r || r.client_id !== o.clientId || Boolean(r.purged_at) || Date.parse(r.expires_at) <= now.getTime();
  }).map(o => o.path);
  if (doomed.length) await deps.removeObjects(doomed);
  return doomed.length;
}
