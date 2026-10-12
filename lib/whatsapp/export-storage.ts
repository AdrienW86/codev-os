import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { boundedBytes } from "./payload";
import type { RangeReader } from "./zip";

// Socle lot 3 : stockage temporaire privé des archives d'export (bucket « whatsapp-exports », aucune politique).
// Lecture par plages via une URL signée courte, limitée à l'hôte Supabase du projet.
export const EXPORT_BUCKET = "whatsapp-exports";
export const MAX_ARCHIVE_BYTES = 500 * 1024 * 1024;
const MAX_RANGE = 24 * 1024 * 1024;
export class ExportStorageFailure extends Error { constructor(public readonly code: string) { super(code); } }

function projectHost() {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname; } catch { return ""; }
}
async function rangeFetch(url: string, start: number, end: number) {
  let response: Response;
  try { response = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(60000) }); }
  catch { throw new ExportStorageFailure("storage_unavailable"); }
  if (response.status !== 206 && response.status !== 200) throw new ExportStorageFailure(response.status === 404 || response.status === 400 ? "archive_missing" : "storage_unavailable");
  return response;
}
// Lecteur par plages sur l'archive déposée. La taille réelle vient du stockage (Content-Range), jamais du navigateur.
export async function archiveReader(path: string): Promise<RangeReader> {
  const { data, error } = await getSupabaseServerClient().storage.from(EXPORT_BUCKET).createSignedUrl(path, 900);
  if (error || !data?.signedUrl) throw new ExportStorageFailure("archive_missing");
  const url = new URL(data.signedUrl);
  if (url.protocol !== "https:" || url.hostname !== projectHost() || url.username || url.password) throw new ExportStorageFailure("storage_host");
  const probe = await rangeFetch(url.toString(), 0, 1);
  const total = Number(/\/(\d+)$/.exec(probe.headers.get("content-range") ?? "")?.[1] ?? (probe.status === 200 ? probe.headers.get("content-length") : NaN));
  await probe.body?.cancel().catch(() => undefined);
  if (!Number.isSafeInteger(total) || total < 22) throw new ExportStorageFailure("archive_invalid");
  if (total > MAX_ARCHIVE_BYTES) throw new ExportStorageFailure("archive_too_large");
  return {
    size: total,
    async read(start, end) {
      const from = Math.max(0, start), to = Math.min(total, end);
      if (to <= from) return new Uint8Array();
      if (to - from > MAX_RANGE) throw new ExportStorageFailure("range_too_large");
      const response = await rangeFetch(url.toString(), from, to);
      // Un serveur qui ignore la plage renvoie tout : refusé au-delà de la plage demandée (pas de lecture complète).
      if (response.status === 200 && (from !== 0 || to !== total)) { await response.body?.cancel().catch(() => undefined); throw new ExportStorageFailure("range_unsupported"); }
      const bytes = await boundedBytes(response, to - from);
      if (bytes.length !== to - from) throw new ExportStorageFailure("archive_truncated");
      return bytes;
    },
  };
}
export async function signedArchiveUpload(path: string) {
  const { data, error } = await getSupabaseServerClient().storage.from(EXPORT_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.signedUrl) throw new ExportStorageFailure("storage_unavailable");
  return data.signedUrl;
}
// Suppression de l'archive et des aperçus d'un import (idempotent).
export async function purgeExportFiles(clientId: string, importId: string) {
  const storage = getSupabaseServerClient().storage.from(EXPORT_BUCKET);
  const previews: string[] = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const { data, error } = await storage.list(`${clientId}/${importId}`, { limit: 1000, offset });
    if (error) throw new ExportStorageFailure("storage_unavailable");
    previews.push(...(data ?? []).map(f => `${clientId}/${importId}/${f.name}`));
    if ((data ?? []).length < 1000) break;
  }
  for (let i = 0; i < previews.length; i += 500) { const { error } = await storage.remove(previews.slice(i, i + 500)); if (error) throw new ExportStorageFailure("storage_unavailable"); }
  const { error } = await storage.remove([`${clientId}/${importId}.zip`]);
  if (error) throw new ExportStorageFailure("storage_unavailable");
}
export async function storePreview(path: string, bytes: Uint8Array) {
  const { error } = await getSupabaseServerClient().storage.from(EXPORT_BUCKET).upload(path, bytes, { contentType: "image/webp", upsert: true });
  return !error;
}
export async function signedPreviews(paths: string[]): Promise<Map<string, string>> {
  if (!paths.length) return new Map();
  const { data, error } = await getSupabaseServerClient().storage.from(EXPORT_BUCKET).createSignedUrls(paths, 900);
  if (error || !data) return new Map();
  return new Map(data.flatMap(d => d.path && d.signedUrl ? [[d.path, d.signedUrl] as [string, string]] : []));
}
