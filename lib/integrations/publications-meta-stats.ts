import 'server-only';
import {createHmac} from 'node:crypto';
import {META_GRAPH_VERSION,type MetaOAuthConfig} from './publications-oauth/config';
import type {FetchLike} from './publications-oauth/http';

// Transport Meta en LECTURE SEULE pour les statistiques des posts (architecture des agents, lot 3). Séparé du
// transport de publication : GET uniquement, sur un identifiant de Page, de post (page_post) ou de média, avec une
// liste fermée de champs. Jeton dans l'en-tête Authorization, appsecret_proof, délai, aucune redirection, corps borné.
// Ne journalise rien.
export type MetaStatsRequest={path:string;fields:string;token:string};
export interface MetaStatsTransport{read(request:MetaStatsRequest):Promise<{status:number;body:unknown}>}
const GRAPH=`https://graph.facebook.com/${META_GRAPH_VERSION}/`;
const PATH=/^[0-9]{1,30}(_[0-9]{1,30})?$/;
export const META_STATS_FIELDS=new Set(['access_token','reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares','like_count,comments_count']);
const MAX_BODY=262_144,TIMEOUT_MS=15_000;
export function metaStatsTransport(config:Pick<MetaOAuthConfig,'appSecret'>,fetchImpl:FetchLike=fetch):MetaStatsTransport{
 return {async read(r){
  if(!PATH.test(r.path)||!META_STATS_FIELDS.has(r.fields)||!r.token)throw Error('invalid stats request');
  const params=new URLSearchParams({fields:r.fields,appsecret_proof:createHmac('sha256',config.appSecret).update(r.token).digest('hex')});
  const response=await fetchImpl(`${GRAPH}${r.path}?${params.toString()}`,{method:'GET',headers:{Authorization:`Bearer ${r.token}`,Accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(TIMEOUT_MS)});
  const text=await response.text();if(text.length>MAX_BODY)throw Error('stats response too large');
  let body:unknown=null;try{body=JSON.parse(text);}catch{body=null;}
  return {status:response.status,body};
 }};
}
