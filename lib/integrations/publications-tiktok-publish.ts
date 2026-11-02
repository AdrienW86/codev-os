import 'server-only';
import type {FetchLike} from './publications-oauth/http';
import {publicationRetryAfterSeconds} from './publications-retry-after';

// TikTok publishing transport (Content Posting API v2), séparé du transport OAuth en lecture. Liste fermée d'appels :
// informations du créateur (niveaux de confidentialité autorisés), initialisation d'un post photo ou vidéo, statut
// d'une publication ; plus, pour la vidéo, la lecture du fichier dans le stockage du projet et son envoi (PUT) vers
// l'URL d'envoi donnée par TikTok (hôte *.tiktokapis.com uniquement). Jeton dans l'en-tête Authorization, délai, aucune redirection, corps JSON borné, JAMAIS de
// nouvelle tentative ici (une initialisation peut avoir créé un post). Ne journalise rien.
export class TikTokPublishTransportError extends Error{constructor(readonly kind:'network'|'timeout'|'too_large'|'invalid_path'|'invalid_media'){super(`TikTok publish transport: ${kind}`);}}
export const TIKTOK_PUBLISH_PATHS=['post/publish/creator_info/query','post/publish/content/init','post/publish/video/init','post/publish/status/fetch'] as const;
export type TikTokPublishPath=typeof TIKTOK_PUBLISH_PATHS[number];
export type TikTokPublishRequest={path:TikTokPublishPath;body:Record<string,unknown>;token:string};
export interface TikTokPublishTransport{request(request:TikTokPublishRequest):Promise<{status:number;body:unknown;retryAfterSeconds?:number}>;
 /** Attente entre deux lectures du statut (le publisher n'a ni minuterie ni réseau). */
 wait?(ms:number):Promise<void>;
 /** Vidéo : lecture du fichier (URL signée du stockage du projet uniquement). */
 readMedia?(url:string):Promise<Uint8Array>;
 /** Vidéo : envoi en un seul morceau vers l'URL d'envoi TikTok (PUT, Content-Range). Écriture : jamais rejouée ici. */
 uploadVideo?(uploadUrl:string,bytes:Uint8Array,mimeType:string):Promise<{status:number}>}
export const TIKTOK_VIDEO_MAX_BYTES=64*1024*1024;
/** Hôte d'envoi TikTok (HTTPS, sous-domaine de tiktokapis.com) ; tout autre hôte est refusé. */
export function isTikTokUploadUrl(value:string):boolean{try{const u=new URL(value);return u.protocol==='https:'&&/(^|\.)tiktokapis\.com$/.test(u.hostname)&&!u.username&&!u.password;}catch{return false;}}
const API='https://open.tiktokapis.com/v2/';
const MAX_BODY=1_048_576,TIMEOUT_MS=20_000;
export function tiktokPublishTransport(fetchImpl:FetchLike=fetch,options:{mediaOrigin?:string|null}={}):TikTokPublishTransport{
 return {async readMedia(url){
  let origin:string|null=null;try{origin=new URL(url).origin;}catch{origin=null;}
  if(!origin||!options.mediaOrigin||origin!==options.mediaOrigin)throw new TikTokPublishTransportError('invalid_media');
  let response:Response;
  try{response=await fetchImpl(url,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(60_000)});}
  catch(error){throw new TikTokPublishTransportError(error instanceof Error&&error.name==='TimeoutError'?'timeout':'network');}
  if(!response.ok)throw new TikTokPublishTransportError('invalid_media');
  if(Number(response.headers.get('content-length')??'0')>TIKTOK_VIDEO_MAX_BYTES)throw new TikTokPublishTransportError('too_large');
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length>TIKTOK_VIDEO_MAX_BYTES)throw new TikTokPublishTransportError('too_large');
  return bytes;
 },async uploadVideo(uploadUrl,bytes,mimeType){
  if(!isTikTokUploadUrl(uploadUrl)||mimeType!=='video/mp4'||!bytes.length||bytes.length>TIKTOK_VIDEO_MAX_BYTES)throw new TikTokPublishTransportError('invalid_path');
  let response:Response;
  try{response=await fetchImpl(uploadUrl,{method:'PUT',headers:{'Content-Type':mimeType,'Content-Length':String(bytes.length),'Content-Range':`bytes 0-${bytes.length-1}/${bytes.length}`},
   body:new Blob([new Uint8Array(bytes)],{type:mimeType}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(90_000)});}
  catch(error){throw new TikTokPublishTransportError(error instanceof Error&&error.name==='TimeoutError'?'timeout':'network');}
  await response.arrayBuffer().catch(()=>null);
  return {status:response.status};
 },wait:ms=>new Promise(resolve=>setTimeout(resolve,Math.min(Math.max(ms,0),10_000))),async request(r){
  if(!(TIKTOK_PUBLISH_PATHS as readonly string[]).includes(r.path)||!r.token)throw new TikTokPublishTransportError('invalid_path');
  let response:Response;
  try{response=await fetchImpl(API+r.path+'/',{method:'POST',headers:{Authorization:`Bearer ${r.token}`,Accept:'application/json','Content-Type':'application/json; charset=UTF-8'},
   body:JSON.stringify(r.body),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(TIMEOUT_MS)});}
  catch(error){throw new TikTokPublishTransportError(error instanceof Error&&error.name==='TimeoutError'?'timeout':'network');}
  if(Number(response.headers.get('content-length')??'0')>MAX_BODY)throw new TikTokPublishTransportError('too_large');
  const text=await response.text();if(text.length>MAX_BODY)throw new TikTokPublishTransportError('too_large');
  let body:unknown=null;if(/json/.test(response.headers.get('content-type')??'')){try{body=JSON.parse(text);}catch{body=null;}}
  const retryAfter=response.status===429?publicationRetryAfterSeconds(response.headers.get('retry-after')):null;
  return {status:response.status,body,...(retryAfter===null?{}:{retryAfterSeconds:retryAfter})};
 }};
}
