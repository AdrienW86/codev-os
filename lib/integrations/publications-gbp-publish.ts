import 'server-only';
import type {FetchLike} from './publications-oauth/http';

// Google Business Profile publishing transport (Lot 4.3 P12), separate from the read-only OAuth transport. Official
// endpoint: My Business API v4, accounts.locations.localPosts (create / get / list). The allowlist covers exactly
// those three calls on one location. Every call: token in the Authorization header (never in the URL), timeout,
// no redirect, bounded JSON body, NO retry (a create may have happened). Never logs anything: callers only see
// {status, body} or a transport error kind.
export class GbpPublishTransportError extends Error{constructor(readonly kind:'network'|'timeout'|'too_large'|'invalid_path'){super(`GBP publish transport: ${kind}`);}}
export type GbpPublishRequest={method:'GET'|'POST';path:string;params:Record<string,string>;body?:Record<string,unknown>;token:string};
export interface GbpPublishTransport{request(request:GbpPublishRequest):Promise<{status:number;body:unknown}>}
const API='https://mybusiness.googleapis.com/v4/';
const MAX_BODY=1_048_576,TIMEOUT_MS=20_000;
const SEG='[0-9A-Za-z_-]{1,100}';
const LOCATION=`accounts/${SEG}/locations/${SEG}`;
const READ=new RegExp(`^${LOCATION}/localPosts(/${SEG})?$`);
const WRITE=new RegExp(`^${LOCATION}/localPosts$`);
export function gbpPublishTransport(fetchImpl:FetchLike=fetch):GbpPublishTransport{
 return {async request(r){
  if((r.method!=='GET'&&r.method!=='POST')||!(r.method==='GET'?READ:WRITE).test(r.path)||!r.token||(r.method==='GET'&&r.body))throw new GbpPublishTransportError('invalid_path');
  const headers:Record<string,string>={Authorization:`Bearer ${r.token}`,Accept:'application/json'};
  const query=Object.keys(r.params).length?'?'+new URLSearchParams(r.params).toString():'';
  const init:RequestInit=r.method==='GET'?{method:'GET',headers}:{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(r.body??{})};
  let response:Response;
  try{response=await fetchImpl(API+r.path+query,{...init,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(TIMEOUT_MS)});}
  catch(error){throw new GbpPublishTransportError(error instanceof Error&&error.name==='TimeoutError'?'timeout':'network');}
  if(Number(response.headers.get('content-length')??'0')>MAX_BODY)throw new GbpPublishTransportError('too_large');
  const text=await response.text();if(text.length>MAX_BODY)throw new GbpPublishTransportError('too_large');
  let body:unknown=null;if(/json/.test(response.headers.get('content-type')??'')){try{body=JSON.parse(text);}catch{body=null;}}
  return {status:response.status,body};
 }};
}
