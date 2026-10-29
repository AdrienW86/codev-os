import "server-only";
// Métadonnées réelles des images, vidéos et sons du dossier Drive confirmé.
import { requireAdmin } from "@/lib/require-admin";
import { driveAccessTokenSource, driveCredentials } from "@/lib/integrations/google-drive-oauth";
import { MOTION_DRIVE_ID, type MotionFile } from "@/lib/motion/model";
import { listMotionSources } from "@/lib/motion/service";

const allowedMime = new Set([
 "image/jpeg","image/png","image/webp","image/svg+xml",
 "video/mp4","video/quicktime","video/webm",
 "audio/mpeg","audio/mp4","audio/wav","audio/x-wav",
 "font/woff","font/woff2"
]);

export async function listMotionDriveFiles(clientId:string,folderId:string):Promise<MotionFile[]> {
 await requireAdmin();
 if(!MOTION_DRIVE_ID.test(folderId))throw Error("Dossier Drive invalide.");
 // Vérification d'appartenance effectuée avant d'ouvrir un accès au fournisseur.
 const allowed=(await listMotionSources()).some(s=>s.clientId===clientId && s.folderId===folderId);
 if(!allowed)throw Error("Dossier Drive non autorisé pour ce client.");
 const access=driveAccessTokenSource(driveCredentials());
 const url=new URL("https://www.googleapis.com/drive/v3/files");
 url.searchParams.set("q", "'"+folderId+"' in parents and trashed = false");
 url.searchParams.set("fields", "files(id,name,mimeType,size,modifiedTime)");
 url.searchParams.set("pageSize","100");
 url.searchParams.set("orderBy","modifiedTime desc");
 const response=await fetch(url,{method:"GET",headers:{Authorization:"Bearer "+await access()},signal:AbortSignal.timeout(20000),redirect:"error",cache:"no-store"});
 if(!response.ok)throw Error("Lecture Drive indisponible.");
 const payload=await response.json() as {files?:unknown};
 if(!Array.isArray(payload.files))throw Error("Réponse Drive invalide.");
 return payload.files.flatMap((file:unknown)=>{
  if(!file || typeof file!=="object" || Array.isArray(file))return [];
  const f=file as Record<string,unknown>;
  if(typeof f.id!=="string" || !MOTION_DRIVE_ID.test(f.id) ||
   typeof f.name!=="string" || !f.name.trim() || f.name.length>300 ||
   typeof f.mimeType!=="string" || !allowedMime.has(f.mimeType) ||
   typeof f.modifiedTime!=="string" || !Number.isFinite(Date.parse(f.modifiedTime)))return [];
  const size=Number(f.size);
  if(!Number.isFinite(size)||size<0 || size>10_000_000_000)return [];
  return [{id:f.id,name:f.name,mimeType:f.mimeType,size,modifiedTime:f.modifiedTime}];
 });
}
