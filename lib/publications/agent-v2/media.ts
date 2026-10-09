import 'server-only';
import {createHash} from 'node:crypto';
import {IMAGE_BUCKET,MAX_IMAGE_BYTES} from '../editor';
import {isPublicationUuid} from '../validation';
import {publicationPlatforms,type PublicationPlatform} from '../types';
import {checkSourceImage} from '../media/validate';
import type {PublicationMediaRef,PublicationMediaSource} from '../media/source';
import type {AgentV2MediaFailure,AgentV2MediaOutcome} from './media-view';

// Agent v2 media step (Lot 4.3 P8), after the drafts were created and the media reserved by finish (pending).
// Compensable workflow, external I/O outside any transaction:
//  claim (DB guard, new attempt) → read from the media source → binary validation → derivatives → private upload → ONE atomic
//  attach RPC. Any failure between fetch and attach: uploaded objects of the attempt removed, media released, run
//  explicitly needs_media (drafts kept, approval impossible until a media is attached). The database is the
//  authority: a file is removed only once the database confirms it is not linked (never a link to a missing file).
type DbError={code?:string;message?:string}|null;
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:DbError}>;
type Bucket={upload(path:string,body:Uint8Array,options:{contentType:string;upsert:boolean}):PromiseLike<{error:unknown}>;remove(paths:string[]):PromiseLike<{error:unknown}>};
export type AgentV2MediaDb={rpc:Rpc;from(table:string):{select(columns:string):{eq(column:string,value:string):{maybeSingle():PromiseLike<{data:unknown;error:unknown}>}}};storage:{from(bucket:string):Bucket}};
export type ImageAdapter=(bytes:Uint8Array,platform:PublicationPlatform)=>Promise<{bytes:Uint8Array;width:number;height:number;mime_type:'image/jpeg'}>;
export type AgentV2MediaDeps={db:AgentV2MediaDb;source:PublicationMediaSource;adapt:ImageAdapter};
type Claim={attempt:number;clientId:string;media:PublicationMediaRef;targets:{publicationId:string;platform:PublicationPlatform}[]};
type RunMediaState={media_status:string;media_attempts:number;media_error_code:string|null};

// Deterministic asset id per run, attempt and draft: a retry of the same attempt never duplicates, and orphans of
// superseded attempts can be found again for cleanup. Path = client/publication/asset (private bucket).
export function agentMediaAssetId(runId:string,attempt:number,publicationId:string):string{
 const h=createHash('sha256').update(`codev:agent-v2-media:${runId}:${attempt}:${publicationId}`).digest('hex');
 return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-${((parseInt(h[16],16)&3)|8).toString(16)}${h.slice(17,20)}-${h.slice(20,32)}`;
}
const assetPath=(clientId:string,publicationId:string,assetId:string)=>`${clientId}/${publicationId}/${assetId}`;
const sha256=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

function parseClaim(data:unknown):Claim|'attached'|null{
 if(!data||typeof data!=='object')return null;const d=data as Record<string,unknown>;
 if(d.media_status==='attached')return 'attached';
 const media=d.media as Record<string,unknown>|undefined,targets=d.targets;
 if(d.media_status!=='pending'||!Number.isInteger(d.attempt)||(d.attempt as number)<1||!isPublicationUuid(d.client_id)||!media||!isPublicationUuid(media.id)
  ||typeof media.drive_file_id!=='string'||typeof media.drive_folder_id!=='string'||typeof media.mime_type!=='string'||typeof media.file_size!=='number'
  ||!Array.isArray(targets)||!targets.length||targets.length>3)return null;
 const parsed=targets.map(t=>t as Record<string,unknown>).filter(t=>isPublicationUuid(t.publication_id)&&(publicationPlatforms as readonly unknown[]).includes(t.platform))
  .map(t=>({publicationId:t.publication_id as string,platform:t.platform as PublicationPlatform}));
 if(parsed.length!==targets.length||new Set(parsed.map(t=>t.publicationId)).size!==parsed.length)return null;
 return {attempt:d.attempt as number,clientId:d.client_id as string,targets:parsed,
  media:{id:media.id as string,driveFileId:media.drive_file_id,driveFolderId:media.drive_folder_id,mimeType:media.mime_type,fileSize:media.file_size}};
}
async function readMediaState(db:AgentV2MediaDb,runId:string):Promise<RunMediaState|null>{
 try{const r=await db.from('publication_agent_v2_runs').select('media_status,media_attempts,media_error_code').eq('id',runId).maybeSingle();
  const s=r.data as RunMediaState|null;return r.error||!s||!Number.isInteger(s.media_attempts)?null:s;}catch{return null;}
}
async function settle<T>(work:()=>PromiseLike<T>,fallback:T):Promise<T>{try{return await work();}catch{return fallback;}}

export async function attachAgentV2Media(runId:string,actorId:string,{db,source,adapt}:AgentV2MediaDeps):Promise<AgentV2MediaOutcome>{
 if(!isPublicationUuid(runId))return {state:'unconfirmed'};
 const fail=async(attempt:number,code:AgentV2MediaFailure):Promise<AgentV2MediaOutcome>=>{
  const r=await settle(()=>db.rpc('publication_agent_v2_media_fail',{p_run_id:runId,p_attempt:attempt,p_error_code:code,p_actor_id:actorId}),{data:null,error:{code:'network'}});
  if(r.error)return {state:'unconfirmed'};
  const status=(r.data as {media_status?:unknown}|null)?.media_status;return status==='attached'?{state:'attached'}:{state:'needs_media',code};};
 const claimed=await settle(()=>db.rpc('publication_agent_v2_media_claim',{p_run_id:runId,p_actor_id:actorId}),{data:null,error:{code:'network'}});
 if(claimed.error){
  if(claimed.error.code==='55P03')return {state:'in_progress'};
  if(claimed.error.code!=='23514')return {state:'unconfirmed'};
  // Media or draft refused by the database guard before any external I/O: the attempt is closed explicitly.
  const run=await readMediaState(db,runId);
  if(run?.media_status==='needs_media')return {state:'needs_media',code:(run.media_error_code??'media_unavailable') as AgentV2MediaFailure};
  return run?.media_status==='pending'?fail(run.media_attempts,'media_unavailable'):{state:'unconfirmed'};}
 const claim=parseClaim(claimed.data);
 if(claim==='attached')return {state:'attached'};
 const attempt=(claimed.data as {attempt?:unknown}|null)?.attempt;
 if(!claim)return Number.isInteger(attempt)?fail(attempt as number,'media_unavailable'):{state:'unconfirmed'};
 const bucket=db.storage.from(IMAGE_BUCKET);
 // Objects of superseded attempts are never linked (only the attached attempt is): removed, best effort.
 if(claim.attempt>1){const stale:string[]=[];for(let a=1;a<claim.attempt;a++)for(const t of claim.targets)stale.push(assetPath(claim.clientId,t.publicationId,agentMediaAssetId(runId,a,t.publicationId)));
  await settle(()=>bucket.remove(stale),{error:null});}
 let fetched;
 try{fetched=await source.fetchMedia(claim.media);}catch{return fail(claim.attempt,'fetch_failed');}
 // The bytes must be the analysed file: declared mime, real signature and the catalogued size (a file edited on
 // Drive since its analysis is refused; the original hash is then checked by the attach RPC when already known).
 const checked=checkSourceImage(fetched?.bytes,claim.media.mimeType);
 if(!checked.ok||fetched.mimeType!==claim.media.mimeType||checked.size!==claim.media.fileSize)return fail(claim.attempt,'invalid_media');
 const assets:{publication_id:string;asset_id:string;storage_path:string;file_hash:string;mime_type:string;width:number;height:number;bytes:Uint8Array}[]=[];
 try{
  for(const t of claim.targets){const d=await adapt(fetched.bytes,t.platform);
   if(!(d.bytes instanceof Uint8Array)||!d.bytes.length||d.bytes.length>MAX_IMAGE_BYTES||d.mime_type!=='image/jpeg')throw Error('Derivative invalid');
   const id=agentMediaAssetId(runId,claim.attempt,t.publicationId);
   assets.push({publication_id:t.publicationId,asset_id:id,storage_path:assetPath(claim.clientId,t.publicationId,id),file_hash:sha256(d.bytes),mime_type:d.mime_type,width:d.width,height:d.height,bytes:d.bytes});}
 }catch{return fail(claim.attempt,'invalid_media');}
 const written:string[]=[];
 const cleanup=()=>written.length?settle(()=>bucket.remove(written),{error:null}):Promise.resolve({error:null});
 for(const a of assets){written.push(a.storage_path);
  const u=await settle(()=>bucket.upload(a.storage_path,a.bytes,{contentType:a.mime_type,upsert:false}),{error:'network'});
  if(u.error){await cleanup();return fail(claim.attempt,'upload_failed');}}
 const attached=await settle(()=>db.rpc('publication_agent_v2_media_attach',{p_run_id:runId,p_attempt:claim.attempt,p_original_hash:checked.sha256,
  p_assets:assets.map(a=>({publication_id:a.publication_id,asset_id:a.asset_id,storage_path:a.storage_path,file_hash:a.file_hash,mime_type:a.mime_type,width:a.width,height:a.height})),p_actor_id:actorId}),{data:null,error:{code:'network'}});
 if(!attached.error)return {state:'attached'};
 // Ambiguous or refused attachment: the database decides. Files are kept if (and only if) this attempt is linked.
 const run=await readMediaState(db,runId);
 if(!run)return {state:'unconfirmed'};
 if(run.media_status==='attached'&&run.media_attempts===claim.attempt)return {state:'attached'};
 await cleanup();return fail(claim.attempt,'attach_failed');
}
