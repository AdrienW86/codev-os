import 'server-only';
import {driveAccessTokenSource,driveCredentials} from '@/lib/integrations/google-drive-oauth';

// Reprise des dossiers Drive volumineux (photothèque, synchronisation) : le lecteur Publications ne liste que les 100
// photos les plus récemment modifiées. Ce parcours complémentaire lit le dossier du plus ancien au plus récent, après un
// curseur (date de modification), par pages bornées. Même accès lecture seule Publications (drive.readonly), jamais
// l'accès d'import. Aucune écriture dans Drive.
export type DriveSyncFile={drive_file_id:string;mime_type:string;modified_at:string};
export type DriveBackfill=(folderId:string,after:string|null)=>Promise<{files:DriveSyncFile[];complete:boolean;last:string|null}>;
const base='https://www.googleapis.com/drive/v3/files';
const validId=(id:string)=>/^[a-zA-Z0-9_-]{10,200}$/.test(id);
export const BACKFILL_PAGE=100;

export function driveFolderBackfill():DriveBackfill{
 const accessToken=driveAccessTokenSource(driveCredentials());
 return async(folderId,after)=>{
  if(!validId(folderId))throw Error('Invalid folder');
  // Curseur relu en base (timestamptz) : « …+00:00 » côté Supabase, ramené au format RFC 3339 « …Z » attendu par Drive.
  if(after!==null&&!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/.test(after))throw Error('Invalid cursor');
  const cursor=after===null?null:new Date(after.replace(' ','T').replace(/([+-]\d{2})$/,'$1:00'));
  if(cursor!==null&&!Number.isFinite(cursor.getTime()))throw Error('Invalid cursor');
  after=cursor?cursor.toISOString():null;
  const url=new URL(base);
  url.searchParams.set('q',`'${folderId}' in parents and trashed = false and (mimeType = 'image/jpeg' or mimeType = 'image/png' or mimeType = 'image/webp')${after?` and modifiedTime > '${after}'`:''}`);
  url.searchParams.set('fields','nextPageToken,files(id,modifiedTime,mimeType,size)');
  url.searchParams.set('pageSize',String(BACKFILL_PAGE));url.searchParams.set('orderBy','modifiedTime');
  const r=await fetch(url,{method:'GET',headers:{Authorization:`Bearer ${await accessToken()}`},signal:AbortSignal.timeout(20000),cache:'no-store',redirect:'error'});
  if(!r.ok)throw Error('Drive read failed');
  const body=await r.json() as {nextPageToken?:string;files?:{id:string;modifiedTime:string;mimeType:string;size:string}[]};
  const raw=body.files??[];
  // Dernière date lue, fichiers écartés compris (trop gros, format) : le curseur avance même sur une page sans photo retenue.
  const lastRaw=raw.length?new Date(raw[raw.length-1].modifiedTime):null;
  const files=raw.filter(f=>validId(f.id)&&Number(f.size)>0&&Number(f.size)<=8388608&&typeof f.modifiedTime==='string')
   .map(f=>({drive_file_id:f.id,mime_type:f.mimeType,modified_at:new Date(f.modifiedTime).toISOString()}));
  return {files,complete:!body.nextPageToken,last:lastRaw&&Number.isFinite(lastRaw.getTime())?lastRaw.toISOString():null};
 };
}
