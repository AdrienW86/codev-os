import 'server-only';
import {createHmac} from 'node:crypto';
import type {ProviderRequest,ProviderTransport} from '@/lib/publications/connections/providers';
import {META_GRAPH_VERSION,type GoogleOAuthConfig,type MetaOAuthConfig} from './config';

// Provider HTTP transports (Lot 4.3 P11-a). Official endpoints are constants; a request only chooses a validated
// relative path. Every call: timeout, no redirect, bounded body, JSON only, never logged, never retried here (an
// OAuth code is single use). Client secrets and tokens are added here, server side, and never leave this module
// except in the request itself. Only OAuth, token inspection / refresh and account discovery are reachable: there is
// no endpoint that publishes anything.
export type FetchLike=(url:string,init:RequestInit)=>Promise<Response>;
export class TransportError extends Error{constructor(readonly kind:'network'|'timeout'|'too_large'|'invalid_path'){super(`Provider transport: ${kind}`);}}
const MAX_BODY=1_048_576,TIMEOUT_MS=15_000;
const META_GRAPH=`https://graph.facebook.com/${META_GRAPH_VERSION}/`;
const GOOGLE_TOKEN='https://oauth2.googleapis.com/token';
const GOOGLE_ACCOUNTS='https://mybusinessaccountmanagement.googleapis.com/v1/accounts';
const GOOGLE_INFORMATION='https://mybusinessbusinessinformation.googleapis.com/v1/';
export const META_AUTHORIZE=`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`;
export const GOOGLE_AUTHORIZE='https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_BUSINESS_SCOPE='https://www.googleapis.com/auth/business.manage';
// Minimum Meta permissions (official permission reference): list the managed Pages, read the Page / its linked
// Instagram professional account, and the two publishing permissions needed later (P11-b) so that no second consent
// is required. business_management is NOT requested (only for Pages reachable through Business Manager only).
export const META_SCOPES=['pages_show_list','pages_read_engagement','pages_manage_posts','instagram_basic','instagram_content_publish'] as const;

async function call(fetchImpl:FetchLike,url:string,init:RequestInit):Promise<{status:number;body:unknown}>{
 let response:Response;
 try{response=await fetchImpl(url,{...init,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(TIMEOUT_MS)});}
 catch(error){throw new TransportError(error instanceof Error&&error.name==='TimeoutError'?'timeout':'network');}
 const declared=Number(response.headers.get('content-length')??'0');if(declared>MAX_BODY)throw new TransportError('too_large');
 const text=await response.text();if(text.length>MAX_BODY)throw new TransportError('too_large');
 const type=response.headers.get('content-type')??'';let body:unknown=null;
 if(/json|javascript/.test(type)){try{body=JSON.parse(text);}catch{body=null;}}
 return {status:response.status,body};
}
const safePath=(path:string,pattern:RegExp)=>{if(!pattern.test(path)||path.includes('..'))throw new TransportError('invalid_path');return path;};
const query=(params:Record<string,string>)=>new URLSearchParams(params).toString();

export function metaTransport(config:MetaOAuthConfig,fetchImpl:FetchLike=fetch):ProviderTransport{
 return {async request(r:ProviderRequest){
  if(r.operation==='token'){
   safePath(r.path,/^oauth\/access_token$/);
   const params:Record<string,string>={...r.params,client_id:config.appId,client_secret:config.appSecret};
   if(r.params.grant_type==='fb_exchange_token'){if(!r.credential)throw new TransportError('invalid_path');params.fb_exchange_token=r.credential.accessToken;}
   else params.redirect_uri=config.redirectUri;
   return call(fetchImpl,META_GRAPH+'oauth/access_token?'+query(params),{method:'GET'});}
  if(!r.credential)throw new TransportError('invalid_path');
  if(r.operation==='debug'){safePath(r.path,/^debug_token$/);
   return call(fetchImpl,META_GRAPH+'debug_token?'+query({input_token:r.credential.accessToken,access_token:`${config.appId}|${config.appSecret}`}),{method:'GET'});}
  // Reads: bearer header + appsecret_proof (HMAC-SHA256 of the token with the app secret), never the token in the URL.
  const path=safePath(r.path,/^(me|me\/accounts|[0-9]{1,30}|[0-9]{1,30}\/accounts)$/);
  const proof=createHmac('sha256',config.appSecret).update(r.credential.accessToken).digest('hex');
  return call(fetchImpl,META_GRAPH+path+'?'+query({...r.params,appsecret_proof:proof}),{method:'GET',headers:{Authorization:`Bearer ${r.credential.accessToken}`,Accept:'application/json'}});
 }};
}
export function googleTransport(config:GoogleOAuthConfig,fetchImpl:FetchLike=fetch):ProviderTransport{
 return {async request(r:ProviderRequest){
  if(r.operation==='token'){
   safePath(r.path,/^token$/);
   const params:Record<string,string>={...r.params,client_id:config.clientId,client_secret:config.clientSecret};
   if(r.params.grant_type==='refresh_token'){if(!r.credential?.refreshToken)throw new TransportError('invalid_path');params.refresh_token=r.credential.refreshToken;}
   else params.redirect_uri=config.redirectUri;
   return call(fetchImpl,GOOGLE_TOKEN,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:query(params)});}
  if(r.operation!=='read'||!r.credential)throw new TransportError('invalid_path');
  const headers={Authorization:`Bearer ${r.credential.accessToken}`,Accept:'application/json'};
  if(r.path==='accounts')return call(fetchImpl,GOOGLE_ACCOUNTS+'?'+query(r.params),{method:'GET',headers});
  const path=safePath(r.path,/^accounts\/[0-9A-Za-z_-]{1,100}\/locations$/);
  return call(fetchImpl,GOOGLE_INFORMATION+path+'?'+query(r.params),{method:'GET',headers});
 }};
}
// Authorization URLs (official hosts only; the state / PKCE challenge come from the server).
export function metaAuthorizeUrl(config:MetaOAuthConfig,state:string):string{
 return META_AUTHORIZE+'?'+query({client_id:config.appId,redirect_uri:config.redirectUri,state,response_type:'code',scope:META_SCOPES.join(',')});
}
export function googleAuthorizeUrl(config:GoogleOAuthConfig,state:string,codeChallenge:string):string{
 return GOOGLE_AUTHORIZE+'?'+query({client_id:config.clientId,redirect_uri:config.redirectUri,response_type:'code',scope:GOOGLE_BUSINESS_SCOPE,access_type:'offline',
  prompt:'consent',include_granted_scopes:'false',state,code_challenge:codeChallenge,code_challenge_method:'S256'});
}
