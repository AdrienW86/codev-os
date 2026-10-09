import 'server-only';
import {waitMilliseconds,type MetaPublishTransport} from '@/lib/integrations/publications-meta-publish';
import type {PublicationPublisher,PublicationReconciler,PublishInput,PublishResult,ReconcileInput,ReconcileResult} from './publisher';
import type {DeliveryErrorClass} from './model';

// Real Meta publisher (Lot 4.3 P11-b), implementing the P10 contract. Official flows (Graph API v26.0):
//  Facebook: Page access token (GET /{page-id}?fields=access_token with the long-lived user token, kept in memory
//   only) → POST /{page-id}/feed (message) or POST /{page-id}/photos (url, caption).
//  Instagram (Instagram API with Facebook Login, Page token): POST /{ig-id}/media (image_url, caption) → container,
//   GET /{container}?fields=status_code until FINISHED (bounded polling) → POST /{ig-id}/media_publish (creation_id).
// At most once: the P10 engine has set the dispatch marker before this call. Anything that may have produced a post
// (timeout, network loss, 5xx or an answer without id after feed / photos / media_publish) is UNCERTAIN, never
// retried. Retryable only when no post can exist (Page token lookup, container creation / status, explicit rate
// limits). Meta offers no idempotency key: duplicates are prevented by P10 (unique delivery, dispatch marker,
// reconciliation), not by the provider. Errors carry a class and a short safe code, never provider text.
type Phase='read'|'write';
type Failure={ok:false;errorClass:DeliveryErrorClass;errorCode:string|null;retryAfterSeconds?:number|null}|{ok:false;uncertain:true;errorCode:string|null};
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const id=(v:unknown,pattern=/^[0-9]{1,30}(_[0-9]{1,30})?$/):string|null=>typeof v==='string'&&pattern.test(v)?v:null;
const opaque=(v:unknown):v is string=>typeof v==='string'&&v.length>=8&&v.length<=8192&&/^[\x21-\x7e]+$/.test(v);
const fail=(errorClass:DeliveryErrorClass,errorCode:string,retryAfterSeconds:number|null=null):Failure=>({ok:false,errorClass,errorCode,retryAfterSeconds});
const uncertain=(errorCode:string):Failure=>({ok:false,uncertain:true,errorCode});
export const INSTAGRAM_CAPTION_MAX=2200,INSTAGRAM_HASHTAGS_MAX=30,INSTAGRAM_MENTIONS_MAX=20,FACEBOOK_MESSAGE_MAX=63206;

// Meta error → P10 class. A request rejected with an explicit Meta error object did not create anything; a transport
// failure or a 5xx during a write may have.
export function classifyMetaError(status:number,body:unknown,phase:Phase):Failure{
 const error=record(record(body).error),code=typeof error.code==='number'?error.code:null,sub=typeof error.error_subcode==='number'?error.error_subcode:null;
 if(code===null){if(status===429)return fail('rate_limit','rate_limited');return phase==='write'?uncertain(status>=500?'provider_5xx':'malformed_response'):fail('provider_unavailable',status>=500?'provider_5xx':'malformed_response');}
 if(code===190)return fail('auth',sub===463?'token_expired':sub===460||sub===458||sub===467?'token_revoked':'token_invalid');
 if(code===10||(code>=200&&code<300))return fail('auth','permission_missing');
 if([4,9,17,32,613].includes(code)||(code>=80001&&code<=80014))return fail('rate_limit','rate_limited');
 if(code===100&&sub===33)return fail('auth','account_unavailable');
 if(code===9004||(code>=36000&&code<=36010)||(sub!==null&&sub>=2207000&&sub<2208000))return fail('invalid_payload','invalid_media');
 if(code===100||code===368)return fail('invalid_payload',code===368?'content_blocked':'invalid_parameter');
 if(code===1||code===2)return phase==='write'?uncertain('provider_transient'):fail('provider_unavailable','provider_transient');
 return phase==='write'?uncertain('provider_error'):fail('permanent','provider_error');
}
export type MetaPublisherOptions={sleep?:(ms:number)=>Promise<void>;pollAttempts?:number;pollIntervalMs?:number;now?:()=>number};
export function createMetaPublisher(transport:MetaPublishTransport,options:MetaPublisherOptions={}):PublicationPublisher{
 const sleep=options.sleep??waitMilliseconds;const attempts=options.pollAttempts??10,interval=options.pollIntervalMs??3000,now=options.now??Date.now;
 // One request; transport failures classified by phase (never retried here).
 async function call(method:'GET'|'POST',path:string,params:Record<string,string>,token:string,phase:Phase):Promise<{ok:true;body:Record<string,unknown>}|Failure>{
  let r;try{r=await transport.request({method,path,params,token});}
  catch(error){const kind=error&&typeof error==='object'&&'kind' in error?String((error as {kind:unknown}).kind):'network';
   if(kind==='invalid_path')return fail('permanent','invalid_request');
   return phase==='write'?uncertain(kind==='timeout'?'timeout_after_dispatch':'network_after_dispatch'):fail('provider_unavailable',kind==='timeout'?'timeout':'network');}
  if(r.status!==200||!r.body||typeof r.body!=='object')return r.status===200?(phase==='write'?uncertain('malformed_response'):fail('provider_unavailable','malformed_response')):classifyMetaError(r.status,r.body,phase);
  return {ok:true,body:record(r.body)};
 }
 async function pageToken(pageId:string,userToken:string):Promise<{ok:true;token:string}|Failure>{
  const r=await call('GET',pageId,{fields:'access_token'},userToken,'read');if(!r.ok)return r;
  return opaque(r.body.access_token)?{ok:true,token:r.body.access_token}:fail('auth','page_unavailable');
 }
 function checkCredential(input:PublishInput):Failure|null{
  const c=input.credential;
  if(!c||!opaque(c.accessToken)||(c.provider!==undefined&&c.provider!=='meta'))return fail('auth','credential_invalid');
  if(c.expiresAt&&Date.parse(c.expiresAt)<=now())return fail('auth','token_expired');
  return null;
 }
 async function facebook(input:PublishInput):Promise<PublishResult>{
  const pageId=id(input.account.externalAccountId,/^[0-9]{1,30}$/);if(!pageId)return fail('auth','page_unavailable');
  const text=input.text.trim();if(text.length>FACEBOOK_MESSAGE_MAX)return fail('invalid_payload','text_too_long');
  const image=input.media[0]??null;
  if(!text&&!image)return fail('invalid_payload','empty_post');
  if(image&&!/^https:\/\//.test(image.url))return fail('invalid_payload','invalid_media');
  const token=await pageToken(pageId,input.credential.accessToken);if(!token.ok)return token;
  const r=image?await call('POST',`${pageId}/photos`,{url:image.url,...(text?{caption:text}:{})},token.token,'write')
   :await call('POST',`${pageId}/feed`,{message:text},token.token,'write');
  if(!r.ok)return r;
  const remote=id(r.body.post_id)??id(r.body.id);
  return remote?{ok:true,remoteId:remote,simulated:false}:uncertain('remote_id_missing');
 }
 async function instagram(input:PublishInput):Promise<PublishResult>{
  const igId=id(input.account.externalAccountId,/^[0-9]{1,30}$/),pageId=id(input.account.parentExternalId,/^[0-9]{1,30}$/);
  if(!igId||!pageId)return fail('auth','instagram_unavailable');
  const image=input.media[0];
  if(!image)return fail('invalid_payload','image_required');
  if(image.mimeType!=='image/jpeg'||!/^https:\/\//.test(image.url))return fail('invalid_payload','invalid_media');
  const caption=input.text.trim();
  if(caption.length>INSTAGRAM_CAPTION_MAX||(caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu)??[]).length>INSTAGRAM_HASHTAGS_MAX||(caption.match(/(^|\s)@[A-Za-z0-9._]+/g)??[]).length>INSTAGRAM_MENTIONS_MAX)
   return fail('invalid_payload','caption_invalid');
  const token=await pageToken(pageId,input.credential.accessToken);if(!token.ok)return token;
  // A container is not a post: failures up to media_publish leave nothing published (safe to retry later).
  const container=await call('POST',`${igId}/media`,{image_url:image.url,...(caption?{caption}:{})},token.token,'read');
  if(!container.ok)return container;
  const creation=id(container.body.id,/^[0-9]{1,30}$/);if(!creation)return fail('provider_unavailable','container_id_missing');
  for(let i=0;;i++){
   const status=await call('GET',creation,{fields:'status_code'},token.token,'read');if(!status.ok)return status;
   const code=status.body.status_code;
   if(code==='FINISHED')break;
   if(code==='ERROR')return fail('invalid_payload','container_error');
   if(code==='EXPIRED')return fail('retryable','container_expired');
   if(code==='PUBLISHED')return uncertain('container_already_published');
   if(i+1>=attempts)return fail('retryable','container_processing');
   await sleep(interval);
  }
  const published=await call('POST',`${igId}/media_publish`,{creation_id:creation},token.token,'write');
  if(!published.ok)return published;
  const remote=id(published.body.id,/^[0-9]{1,30}$/);
  return remote?{ok:true,remoteId:remote,simulated:false}:uncertain('remote_id_missing');
 }
 return {async publish(input){
  const credential=checkCredential(input);if(credential)return credential;
  if(input.platform==='facebook')return facebook(input);
  if(input.platform==='instagram')return instagram(input);
  return fail('permanent','unsupported_platform');
 }};
}

// Reconciliation: a known remote id is checked directly; otherwise the post is looked up among the Page / Instagram
// account's recent posts created after the dispatch with the exact same text. One match → exists; none → missing;
// several or unverifiable → unknown. Never invents an id.
const RECONCILE_PAGE_SIZE=25;
const meta_time=(v:unknown)=>typeof v==='string'?Date.parse(v.replace(/([+-]\d{2})(\d{2})$/,'$1:$2')):NaN;
export function createMetaReconciler(transport:MetaPublishTransport):PublicationReconciler{
 const publisher={async read(path:string,params:Record<string,string>,token:string){try{const r=await transport.request({method:'GET',path,params,token});return r;}catch{return null;}}};
 return {async reconcile(d:ReconcileInput):Promise<ReconcileResult>{
  const unknown:ReconcileResult={status:'unknown',remoteId:null};
  if(d.platform!=='facebook'&&d.platform!=='instagram')return unknown;
  const pageId=d.platform==='facebook'?d.account?.externalAccountId:d.account?.parentExternalId;
  if(!pageId||!/^[0-9]{1,30}$/.test(pageId)||!opaque(d.credential?.accessToken))return unknown;
  const tokenAnswer=await publisher.read(pageId,{fields:'access_token'},d.credential.accessToken);
  const token=tokenAnswer?.status===200?record(tokenAnswer.body).access_token:null;if(!opaque(token))return unknown;
  if(d.remoteId){
   if(!id(d.remoteId))return unknown;
   const r=await publisher.read(d.remoteId,{fields:'id'},token);if(!r)return unknown;
   if(r.status===200&&id(record(r.body).id))return {status:'exists',remoteId:d.remoteId};
   const e=record(record(r.body).error);return e.code===100&&e.error_subcode===33?{status:'missing',remoteId:null}:unknown;
  }
  const text=(d.text??'').trim(),since=d.since?Date.parse(d.since):NaN;if(!Number.isFinite(since))return unknown;
  const path=d.platform==='facebook'?`${pageId}/published_posts`:`${d.account?.externalAccountId}/media`;
  if(d.platform==='instagram'&&!/^[0-9]{1,30}$/.test(d.account?.externalAccountId??''))return unknown;
  const r=await publisher.read(path,d.platform==='facebook'?{fields:'id,message,created_time',since:String(Math.floor(since/1000)-120),limit:String(RECONCILE_PAGE_SIZE)}:{fields:'id,caption,timestamp',limit:String(RECONCILE_PAGE_SIZE)},token);
  if(!r||r.status!==200)return unknown;
  const data=(Array.isArray(record(r.body).data)?record(r.body).data as unknown[]:[]).map(record);
  const timeOf=(p:Record<string,unknown>)=>meta_time(d.platform==='facebook'?p.created_time:p.timestamp);
  const matches=data.filter(p=>{const at=timeOf(p);
   return Number.isFinite(at)&&at>=since-120_000&&String((d.platform==='facebook'?p.message:p.caption)??'').trim()===text;});
  if(matches.length===1){const remote=id(matches[0].id);return remote?{status:'exists',remoteId:remote}:unknown;}
  if(matches.length>1)return unknown;
  // "missing" only when the whole window since the dispatch was read: a page that is not full, or a post older than
  // the window in it. A full page of newer posts may hide ours (a false "missing" would allow a duplicate).
  const covered=data.length<RECONCILE_PAGE_SIZE||data.some(p=>{const at=timeOf(p);return Number.isFinite(at)&&at<since-120_000;});
  return covered?{status:'missing',remoteId:null}:unknown;
 }};
}
