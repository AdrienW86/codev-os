import 'server-only';
import {createHmac} from 'node:crypto';
import {META_GRAPH_VERSION,type MetaOAuthConfig} from './publications-oauth/config';
import type {FetchLike} from './publications-oauth/http';

// Meta publishing transport (Lot 4.3 P11-b), separate from the read-only OAuth transport. Graph API v26.0 only;
// the allowlist covers exactly: Page token lookup, Page feed / photo posts, Instagram container creation, container
// status, media_publish, and the two reconciliation reads. Every call: token in the Authorization header (never in
// the URL), appsecret_proof, timeout, no redirect, bounded JSON body, NO retry (a write may have happened).
// Never logs anything: callers only see {status, body} or a TransportError kind.
export class MetaPublishTransportError extends Error{constructor(readonly kind:'network'|'timeout'|'too_large'|'invalid_path'){super(`Meta publish transport: ${kind}`);}}
export type MetaPublishRequest={method:'GET'|'POST';path:string;params:Record<string,string>;token:string};
export interface MetaPublishTransport{request(request:MetaPublishRequest):Promise<{status:number;body:unknown}>}
const GRAPH=`https://graph.facebook.com/${META_GRAPH_VERSION}/`;
const MAX_BODY=1_048_576,TIMEOUT_MS=20_000;
const ID='[0-9]{1,30}';
const READ=new RegExp(`^(${ID}|${ID}_${ID}|${ID}/(published_posts|media))$`);
const WRITE=new RegExp(`^${ID}/(feed|photos|media|media_publish)$`);
export function metaPublishTransport(config:Pick<MetaOAuthConfig,'appSecret'>,fetchImpl:FetchLike=fetch):MetaPublishTransport{
 return {async request(r){
  if(!(r.method==='GET'?READ:WRITE).test(r.path)||!r.token)throw new MetaPublishTransportError('invalid_path');
  const proof=createHmac('sha256',config.appSecret).update(r.token).digest('hex');
  const params=new URLSearchParams({...r.params,appsecret_proof:proof});
  const headers:Record<string,string>={Authorization:`Bearer ${r.token}`,Accept:'application/json'};
  const init:RequestInit=r.method==='GET'?{method:'GET',headers}:{method:'POST',headers:{...headers,'Content-Type':'application/x-www-form-urlencoded'},body:params.toString()};
  let response:Response;
  try{response=await fetchImpl(GRAPH+r.path+(r.method==='GET'?'?'+params.toString():''),{...init,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(TIMEOUT_MS)});}
  catch(error){throw new MetaPublishTransportError(error instanceof Error&&error.name==='TimeoutError'?'timeout':'network');}
  if(Number(response.headers.get('content-length')??'0')>MAX_BODY)throw new MetaPublishTransportError('too_large');
  const text=await response.text();if(text.length>MAX_BODY)throw new MetaPublishTransportError('too_large');
  let body:unknown=null;if(/json|javascript/.test(response.headers.get('content-type')??'')){try{body=JSON.parse(text);}catch{body=null;}}
  return {status:response.status,body};
 }};
}
// Bounded wait used between two Instagram container status checks (the only wait of the publisher).
export function waitMilliseconds(ms:number):Promise<void>{return new Promise(resolve=>setTimeout(resolve,Math.min(Math.max(ms,0),10_000)));}
