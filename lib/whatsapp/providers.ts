import "server-only";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { boundedBytes, folderSchema, imageMimes, videoMimes } from "./payload";
import { driveErrorCode, oauthErrorCode, type ImportVariable } from "./drive-errors";

// Limites Meta : images 5 Mo, vidéos 16 Mo (H.264/AAC, MP4 ou 3GPP). Marge conservée pour les images.
export const maxImageBytes = 8 * 1024 * 1024;
export const maxVideoBytes = 16 * 1024 * 1024;
const opaque = z.string().min(10).max(4096).regex(/^[\x21-\x7e]+$/);
const driveFileId = folderSchema;
const mediaMetadata = z.object({ id: z.string(), url: z.string().url(), mime_type: z.string().max(100).transform(value => value.split(";")[0].trim().toLowerCase()).pipe(z.enum([...imageMimes, ...videoMimes])), file_size: z.coerce.number().int().min(1).max(maxVideoBytes), sha256: z.string().regex(/^[a-fA-F0-9]{64}$/) });
export type MediaBytes = { bytes: Uint8Array; mime: string; sha256: string; md5: string; kind: "image" | "video"; width: number | null; height: number | null };
// Ce dont l'upload Drive a besoin, pour une photo comme pour une vidéo.
export type UploadBytes = Pick<MediaBytes, "bytes" | "mime" | "sha256" | "md5">;
const isVideoMime = (mime: string) => (videoMimes as readonly string[]).includes(mime);
// Conteneur ISO BMFF (MP4/3GPP) : boîte « ftyp » en tête de fichier. Le décodage n'est pas tenté côté serveur.
export function isIsoVideo(bytes: Uint8Array) {
  return bytes.length >= 12 && Buffer.from(bytes.subarray(4, 8)).toString("latin1") === "ftyp";
}
// Le message ne contient que le code : aucune donnée de requête, de réponse ni de credential.
export class ImportFailure extends Error {
  constructor(public readonly code: string, public readonly context: { stage?: string; status?: number; variable?: ImportVariable } = {}) { super(code); }
}
// Transferts de fichiers (jusqu'à 16 Mo) : délai plus long que les appels de métadonnées.
async function request(url: string | URL, init: RequestInit = {}, timeout = 15000) {
  try { return await fetch(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeout) }); }
  catch { throw new ImportFailure("provider_unavailable"); }
}
async function json(response: Response): Promise<unknown> {
  if (!response.ok) throw new ImportFailure(response.status === 401 || response.status === 403 ? "provider_permission" : "provider_unavailable");
  try { return JSON.parse(Buffer.from(await boundedBytes(response, 65536)).toString("utf8")); }
  catch { throw new ImportFailure("provider_response"); }
}
// Réponses Google : en cas d'erreur, seul un identifiant connu (error / reason) est extrait du corps, puis oublié.
async function googleJson(response: Response, stage: "oauth" | "drive"): Promise<unknown> {
  if (!response.ok) {
    let body: unknown = null;
    try { body = JSON.parse(Buffer.from(await boundedBytes(response, 65536)).toString("utf8")); } catch { body = null; }
    throw new ImportFailure(stage === "oauth" ? oauthErrorCode(response.status, body) : driveErrorCode(response.status, body), { stage, status: response.status });
  }
  try { return JSON.parse(Buffer.from(await boundedBytes(response, 65536)).toString("utf8")); }
  catch { throw new ImportFailure("provider_response", { stage, status: response.status }); }
}
function parseGoogle<T>(schema: z.ZodType<T>, value: unknown, stage: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ImportFailure("provider_response", { stage });
  return parsed.data;
}
export async function downloadWhatsApp(mediaId: string, expectedMime?: string): Promise<MediaBytes> {
  if (!/^[0-9]{1,100}$/.test(mediaId)) throw new ImportFailure("invalid_media");
  const token = opaque.parse(process.env.WHATSAPP_ACCESS_TOKEN);
  const meta = mediaMetadata.parse(await json(await request(`https://graph.facebook.com/v25.0/${mediaId}?phone_number_id=${encodeURIComponent(process.env.WHATSAPP_PHONE_NUMBER_ID ?? "")}`, { headers: { Authorization: `Bearer ${token}` } })));
  if (meta.id !== mediaId) throw new ImportFailure("media_mismatch");
  const video = isVideoMime(meta.mime_type);
  // Le type annoncé par le webhook et celui de Meta doivent désigner la même famille (photo ou vidéo).
  if (expectedMime && isVideoMime(expectedMime) !== video) throw new ImportFailure("media_mismatch");
  if (!video && meta.file_size > maxImageBytes) throw new ImportFailure("media_too_large");
  const url = new URL(meta.url);
  // Ne transmet jamais la clé à une URL fournie hors du CDN Meta connu.
  if (url.protocol !== "https:" || url.hostname !== "lookaside.fbsbx.com" || url.port || url.username || url.password) throw new ImportFailure("media_host");
  const response = await request(url, { headers: { Authorization: `Bearer ${token}` } }, 60000);
  if (!response.ok) throw new ImportFailure("media_unavailable");
  const bytes = await boundedBytes(response, video ? maxVideoBytes : maxImageBytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== meta.file_size || sha256 !== meta.sha256.toLowerCase()) throw new ImportFailure("media_integrity");
  const md5 = createHash("md5").update(bytes).digest("hex");
  if (video) {
    if (!isIsoVideo(bytes)) throw new ImportFailure("invalid_video");
    return { bytes, mime: meta.mime_type, sha256, md5, kind: "video", width: null, height: null };
  }
  let info: { format?: string; width?: number; height?: number };
  try { info = await sharp(Buffer.from(bytes), { limitInputPixels: 40000000 }).metadata(); }
  catch { throw new ImportFailure("invalid_image"); }
  const mime = info.format === "jpeg" ? "image/jpeg" : info.format === "png" ? "image/png" : info.format === "webp" ? "image/webp" : null;
  if (!mime || mime !== meta.mime_type) throw new ImportFailure("invalid_image");
  return { bytes, mime, sha256, md5, kind: "image", width: info.width ?? null, height: info.height ?? null };
}

/** Miniature privée d'une photo (l'original n'est jamais modifié). `null` si la photo ne peut pas être réduite. */
export async function thumbnail(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const output = await sharp(Buffer.from(bytes), { limitInputPixels: 40000000, animated: false }).rotate().resize(480, 480, { fit: "inside", withoutEnlargement: true }).webp({ quality: 70 }).toBuffer();
    return output.length <= 262144 ? new Uint8Array(output) : null;
  } catch { return null; }
}

// Accès d'import distinct : ne réutilise pas et n'élargit pas le connecteur de lecture Publications.
// Les espaces et retours à la ligne collés autour d'une valeur sont ignorés ; la valeur n'est jamais journalisée.
function importCredential(name: ImportVariable) {
  const value = process.env[name]?.trim();
  if (!value) throw new ImportFailure("config_missing", { stage: "config", variable: name });
  if (!opaque.safeParse(value).success || (name === "GOOGLE_DRIVE_IMPORT_CLIENT_ID" && !value.endsWith(".apps.googleusercontent.com"))) throw new ImportFailure("config_invalid", { stage: "config", variable: name });
  return value;
}
const driveFileScope = "https://www.googleapis.com/auth/drive.file";
const readOnlyDriveScopes = new Set(["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.metadata.readonly"]);
export async function importDriveToken() {
  const clientId = importCredential("GOOGLE_DRIVE_IMPORT_CLIENT_ID");
  const clientSecret = importCredential("GOOGLE_DRIVE_IMPORT_CLIENT_SECRET");
  const refreshToken = importCredential("GOOGLE_DRIVE_IMPORT_REFRESH_TOKEN");
  const data = parseGoogle(z.object({ access_token: opaque, token_type: z.string(), scope: z.string() }), await googleJson(await request("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  }), "oauth"), "oauth");
  const scopes = data.scope.split(" ");
  if (data.token_type.toLowerCase() !== "bearer") throw new ImportFailure("provider_response", { stage: "oauth" });
  const driveScopes = scopes.filter(scope => scope.startsWith("https://www.googleapis.com/auth/drive"));
  if (!driveScopes.includes(driveFileScope)) {
    if (driveScopes.length && driveScopes.every(scope => readOnlyDriveScopes.has(scope))) throw new ImportFailure("drive_scope_readonly", { stage: "oauth" });
    if (driveScopes.length) throw new ImportFailure("drive_scope_too_broad", { stage: "oauth" });
    throw new ImportFailure("drive_scope_missing", { stage: "oauth" });
  }
  if (driveScopes.some(scope => scope !== driveFileScope)) throw new ImportFailure("drive_scope_too_broad", { stage: "oauth" });
  return data.access_token;
}
export async function checkFolder(token: string, folder: string) {
  folderSchema.parse(folder);
  const response = await googleJson(await request(`https://www.googleapis.com/drive/v3/files/${folder}?fields=id,mimeType,trashed,capabilities(canAddChildren)&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } }), "drive");
  const data = z.object({ id: z.string(), mimeType: z.literal("application/vnd.google-apps.folder"), trashed: z.boolean().optional(), capabilities: z.object({ canAddChildren: z.literal(true) }) }).safeParse(response);
  if (!data.success || data.data.id !== folder || data.data.trashed) throw new ImportFailure("drive_folder", { stage: "drive" });
}
export async function generateDriveId(token: string) {
  const data = parseGoogle(z.object({ ids: z.array(driveFileId).length(1) }), await googleJson(await request("https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files", { headers: { Authorization: `Bearer ${token}` } }), "drive"), "drive");
  return data.ids[0];
}
export async function driveFileMatches(token: string, id: string, folder: string, md5: string) {
  driveFileId.parse(id);
  const response = await request(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,parents,md5Checksum,trashed&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 404) return false;
  const data = parseGoogle(z.object({ id: z.string(), parents: z.array(z.string()).optional(), md5Checksum: z.string().optional(), trashed: z.boolean().optional() }), await googleJson(response, "drive"), "drive");
  if (data.id !== id || data.trashed || !data.parents?.includes(folder) || data.md5Checksum !== md5) throw new ImportFailure("drive_file_conflict");
  return true;
}
const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/3gpp": "3gp" };
export async function uploadDrive(token: string, id: string, folder: string, image: UploadBytes) {
  driveFileId.parse(id); folderSchema.parse(folder);
  if (await driveFileMatches(token, id, folder, image.md5)) return "existing" as const;
  await checkFolder(token, folder);
  const extension = extensions[image.mime];
  if (!extension) throw new ImportFailure("invalid_media");
  const metadata = { id, name: `chantier-${image.sha256.slice(0, 20)}.${extension}`, parents: [folder], mimeType: image.mime };
  const start = await request("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Upload-Content-Type": image.mime, "X-Upload-Content-Length": String(image.bytes.length) }, body: JSON.stringify(metadata),
  });
  if (start.status === 409 && await driveFileMatches(token, id, folder, image.md5)) return "existing" as const;
  if (!start.ok) throw new ImportFailure("drive_upload");
  const location = new URL(start.headers.get("location") ?? "invalid:");
  if (location.protocol !== "https:" || location.hostname !== "www.googleapis.com" || location.port || location.username || location.password || !location.pathname.startsWith("/upload/drive/")) throw new ImportFailure("drive_upload_host");
  const response = await request(location, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": image.mime }, body: new Blob([Uint8Array.from(image.bytes)]) }, 60000);
  if (!response.ok && response.status !== 409) throw new ImportFailure("drive_upload");
  if (!await driveFileMatches(token, id, folder, image.md5)) throw new ImportFailure("drive_upload");
  return response.status === 409 ? "existing" as const : "created" as const;
}
/**
 * Relit un original importé par l'application (portée drive.file) : parent, corbeille et MD5 vérifiés, taille bornée.
 * Utilisé pour la prévisualisation interne et la préparation des publications ; aucun lien public n'est créé.
 */
export async function downloadDrive(token: string, id: string, folder: string, md5: string, max = maxVideoBytes) {
  driveFileId.parse(id); folderSchema.parse(folder);
  if (!await driveFileMatches(token, id, folder, md5)) throw new ImportFailure("drive_file_missing");
  const response = await request(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } }, 60000);
  if (!response.ok) await googleJson(response, "drive");
  const bytes = await boundedBytes(response, max);
  if (createHash("md5").update(bytes).digest("hex") !== md5) throw new ImportFailure("drive_file_conflict");
  return bytes;
}
/**
 * Met à la corbeille (récupérable 30 jours dans Drive) un fichier créé par l'application (portée drive.file).
 * Utilisé uniquement pour un média rejeté par un humain, selon la politique de suppression du client.
 */
export async function trashDrive(token: string, id: string, folder: string, md5: string) {
  driveFileId.parse(id); folderSchema.parse(folder);
  if (!await driveFileMatches(token, id, folder, md5)) return "missing" as const;
  const response = await request(`https://www.googleapis.com/drive/v3/files/${id}?supportsAllDrives=true`, {
    method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }),
  });
  if (!response.ok) await googleJson(response, "drive");
  return "trashed" as const;
}
export async function createImportFolder(token: string, name: string) {
  const id = await generateDriveId(token);
  const data = parseGoogle(z.object({ id: driveFileId }), await googleJson(await request("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id, name: `Photos chantier — ${name.slice(0, 100)}`, mimeType: "application/vnd.google-apps.folder" }),
  }), "drive"), "drive");
  if (data.id !== id) throw new ImportFailure("drive_folder_create", { stage: "drive" });
  return id;
}
// Exported for deterministic lease ids in provider-independent workers.
export const newLease = randomUUID;
