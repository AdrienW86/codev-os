import 'server-only';
import type {FetchLike} from './publications-oauth/http';
import {publicationRetryAfterSeconds} from './publications-retry-after';

// TikTok publishing transport (Content Posting API v2), séparé du transport OAuth en lecture. Liste fermée de trois
// appels : informations du créateur (niveaux de confidentialité autorisés), initialisation d'un post photo, statut
// d'une publication. Jeton dans l'en-tête Authorization, délai, aucune redirection, corps JSON borné, JAMAIS de
// nouvelle tentative ici (une initialisation peut avoir créé un post). Ne journalise rien.
export class TikTokPublishTransportError extends Error{constructor(readonly kind:'network'|'timeout'|'too_large'|'invalid_path'){super(`TikTok publish transport: ${kind}`);}}
export const TIKTOK_PUBLISH_PATHS=['post/publish/creator_info/query','post/publish/content/init','post/publish/status/fetch'] as const;
export type TikTokPublishPath=typeof TIKTOK_PUBLISH_PATHS[number];
export type TikTokPublishRequest={path:TikTokPublishPath;body:Record<string,unknown>;token:string};
export interface TikTokPublishTransport{request(request:TikTokPublishRequest):Promise<{status:number;body:unknown;retryAfterSeconds?:number}>}
const API='https://open.tiktokapis.com/v2/';
const MAX_BODY=1_048_576,TIMEOUT_MS=20_000;
export function tiktokPublishTransport(fetchImpl:FetchLike=fetch):TikTokPublishTransport{
 return {async request(r){
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
