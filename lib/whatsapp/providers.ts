import "server-only";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { boundedBytes, folderSchema } from "./payload";

const maxImageBytes = 8 * 1024 * 1024;
const opaque = z.string().min(10).max(4096).regex(/^[\x21-\x7e]+$/);
const driveFileId = folderSchema;
const mediaMetadata = z.object({ id: z.string(), url: z.string().url(), mime_type: z.enum(["image/jpeg", "image/png", "image/webp"]), file_size: z.coerce.number().int().min(1).max(maxImageBytes), sha256: z.string().regex(/^[a-fA-F0-9]{64}$/) });
export type ImageBytes = { bytes: Uint8Array; mime: string; sha256: string; md5: string };
export class ImportFailure extends Error {
  constructor(public readonly code: string) { super(code); }
}
async function request(url: string | URL, init: RequestInit = {}) {
  try { return await fetch(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) }); }
  catch { throw new ImportFailure("provider_unavailable"); }
}
async function json(response: Response): Promise<unknown> {
  if (!response.ok) throw new ImportFailure(response.status === 401 || response.status === 403 ? "provider_permission" : "provider_unavailable");
  try { return JSON.parse(Buffer.from(await boundedBytes(response, 65536)).toString("utf8")); }
  catch { throw new ImportFailure("provider_response"); }
}
export async function downloadWhatsApp(mediaId: string): Promise<ImageBytes> {
  if (!/^[0-9]{1,100}$/.test(mediaId)) throw new ImportFailure("invalid_media");
  const token = opaque.parse(process.env.WHATSAPP_ACCESS_TOKEN);
  const meta = mediaMetadata.parse(await json(await request(`https://graph.facebook.com/v25.0/${mediaId}?phone_number_id=${encodeURIComponent(process.env.WHATSAPP_PHONE_NUMBER_ID ?? "")}`, { headers: { Authorization: `Bearer ${token}` } })));
  if (meta.id !== mediaId) throw new ImportFailure("media_mismatch");
  const url = new URL(meta.url);
  // Ne transmet jamais la clé à une URL fournie hors du CDN Meta connu.
  if (url.protocol !== "https:" || url.hostname !== "lookaside.fbsbx.com" || url.port || url.username || url.password) throw new ImportFailure("media_host");
  const response = await request(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new ImportFailure("media_unavailable");
  const bytes = await boundedBytes(response, maxImageBytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== meta.file_size || sha256 !== meta.sha256.toLowerCase()) throw new ImportFailure("media_integrity");
  let format: string | undefined;
  try { format = (await sharp(Buffer.from(bytes), { limitInputPixels: 40000000 }).metadata()).format; }
  catch { throw new ImportFailure("invalid_image"); }
  const mime = format === "jpeg" ? "image/jpeg" : format === "png" ? "image/png" : format === "webp" ? "image/webp" : null;
  if (!mime || mime !== meta.mime_type) throw new ImportFailure("invalid_image");
  return { bytes, mime, sha256, md5: createHash("md5").update(bytes).digest("hex") };
}

// Accès d'import distinct : ne réutilise pas et n'élargit pas le connecteur de lecture Publications.
export async function importDriveToken() {
  const clientId = opaque.parse(process.env.GOOGLE_DRIVE_IMPORT_CLIENT_ID);
  const clientSecret = opaque.parse(process.env.GOOGLE_DRIVE_IMPORT_CLIENT_SECRET);
  const refreshToken = opaque.parse(process.env.GOOGLE_DRIVE_IMPORT_REFRESH_TOKEN);
  const data = z.object({ access_token: opaque, token_type: z.string(), scope: z.string() }).parse(await json(await request("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  })));
  const scopes = data.scope.split(" ");
  if (data.token_type.toLowerCase() !== "bearer" || !scopes.includes("https://www.googleapis.com/auth/drive.file") || scopes.some(scope => scope.startsWith("https://www.googleapis.com/auth/drive") && scope !== "https://www.googleapis.com/auth/drive.file")) throw new ImportFailure("drive_scope");
  return data.access_token;
}
export async function checkFolder(token: string, folder: string) {
  folderSchema.parse(folder);
  const data = z.object({ id: z.string(), mimeType: z.literal("application/vnd.google-apps.folder"), trashed: z.boolean().optional(), capabilities: z.object({ canAddChildren: z.literal(true) }) }).parse(await json(await request(`https://www.googleapis.com/drive/v3/files/${folder}?fields=id,mimeType,trashed,capabilities(canAddChildren)&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } })));
  if (data.id !== folder || data.trashed) throw new ImportFailure("drive_folder");
}
export async function generateDriveId(token: string) {
  const data = z.object({ ids: z.array(driveFileId).length(1) }).parse(await json(await request("https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files", { headers: { Authorization: `Bearer ${token}` } })));
  return data.ids[0];
}
export async function driveFileMatches(token: string, id: string, folder: string, md5: string) {
  driveFileId.parse(id);
  const response = await request(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,parents,md5Checksum,trashed&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 404) return false;
  const data = z.object({ id: z.string(), parents: z.array(z.string()).optional(), md5Checksum: z.string().optional(), trashed: z.boolean().optional() }).parse(await json(response));
  if (data.id !== id || data.trashed || !data.parents?.includes(folder) || data.md5Checksum !== md5) throw new ImportFailure("drive_file_conflict");
  return true;
}
export async function uploadDrive(token: string, id: string, folder: string, image: ImageBytes) {
  driveFileId.parse(id); folderSchema.parse(folder);
  if (await driveFileMatches(token, id, folder, image.md5)) return "existing" as const;
  await checkFolder(token, folder);
  const extension = image.mime === "image/jpeg" ? "jpg" : image.mime === "image/png" ? "png" : "webp";
  const metadata = { id, name: `chantier-${image.sha256.slice(0, 20)}.${extension}`, parents: [folder], mimeType: image.mime };
  const start = await request("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Upload-Content-Type": image.mime, "X-Upload-Content-Length": String(image.bytes.length) }, body: JSON.stringify(metadata),
  });
  if (start.status === 409 && await driveFileMatches(token, id, folder, image.md5)) return "existing" as const;
  if (!start.ok) throw new ImportFailure("drive_upload");
  const location = new URL(start.headers.get("location") ?? "invalid:");
  if (location.protocol !== "https:" || location.hostname !== "www.googleapis.com" || location.port || location.username || location.password || !location.pathname.startsWith("/upload/drive/")) throw new ImportFailure("drive_upload_host");
  const response = await request(location, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": image.mime }, body: new Blob([Uint8Array.from(image.bytes)]) });
  if (!response.ok && response.status !== 409) throw new ImportFailure("drive_upload");
  if (!await driveFileMatches(token, id, folder, image.md5)) throw new ImportFailure("drive_upload");
  return response.status === 409 ? "existing" as const : "created" as const;
}
export async function createImportFolder(token: string, name: string) {
  const id = await generateDriveId(token);
  const data = z.object({ id: driveFileId }).parse(await json(await request("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id, name: `Photos chantier — ${name.slice(0, 100)}`, mimeType: "application/vnd.google-apps.folder" }),
  })));
  if (data.id !== id) throw new ImportFailure("drive_folder");
  return id;
}
// Exported for deterministic lease ids in provider-independent workers.
export const newLease = randomUUID;
