import 'server-only';
import type {GbpPublishTransport} from '@/lib/integrations/publications-gbp-publish';
import type {ProviderCredential} from '../connections/vault';
import type {PublicationPublisher,PublicationReconciler,PublishInput,PublishResult,ReconcileInput,ReconcileResult} from './publisher';
import type {DeliveryErrorClass} from './model';

// Real Google Business Profile publisher (Lot 4.3 P12), implementing the P10 contract. Official flow (My Business
// API v4, still listed as available, not on the deprecation schedule): POST accounts/{a}/locations/{l}/localPosts
// with a STANDARD LocalPost (languageCode, summary, optional PHOTO media by public sourceUrl). The response is the
// LocalPost (name accounts/{a}/locations/{l}/localPosts/{id}, state LIVE / PROCESSING / REJECTED).
// Access token: Google access tokens live about one hour; when the stored one is expired it is refreshed IN MEMORY
// before any write (refresh token from the vault, never stored again, never logged). The refresh cannot publish.
// At most once: the P10 engine has set the dispatch marker before this call. Google offers no idempotency key on
// localPosts.create: anything that may have produced a post (timeout, network loss, 5xx, 409 or an answer without a
// post name after the create) is UNCERTAIN, never retried. Errors carry a class and a short safe code, never text.
type Phase='read'|'write';
type Failure={ok:false;errorClass:DeliveryErrorClass;errorCode:string|null;retryAfterSeconds?:number|null}|{ok:false;uncertain:true;errorCode:string|null};
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const opaque=(v:unknown):v is string=>typeof v==='string'&&v.length>=8&&v.length<=8192&&/^[\x21-\x7e]+$/.test(v);
const fail=(errorClass:DeliveryErrorClass,errorCode:string,retryAfterSeconds:number|null=null):Failure=>({ok:false,errorClass,errorCode,retryAfterSeconds});
const uncertain=(errorCode:string):Failure=>({ok:false,uncertain:true,errorCode});
const SEG='[0-9A-Za-z_-]{1,100}';
const LOCATION=new RegExp(`^accounts/${SEG}/locations/${SEG}$`);
const POST_NAME=new RegExp(`^accounts/${SEG}/locations/${SEG}/localPosts/${SEG}$`);
// Conservative summary limit (the Business Profile post editor caps the description at 1500 characters; the v4
// reference gives no number). A longer text is refused before any call.
export const GBP_SUMMARY_MAX=1500;
// Photo constraints of the v4 MediaItem reference: JPG or PNG (size / resolution checked upstream by P8 derivatives).
export const GBP_PHOTO_TYPES=['image/jpeg','image/png'] as const;

// Google error (google.rpc.Status JSON: {error:{code,status,details}}) → P10 class. A request rejected with an
// explicit 4xx did not create anything; a transport failure, a 5xx or a 409 during the create may have.
export function classifyGbpError(status:number,body:unknown,phase:Phase):Failure{
 const error=record(record(body).error),code=typeof error.status==='string'?error.status:null;
 if(status===401||code==='UNAUTHENTICATED')return fail('auth','token_invalid');
 if(status===429||code==='RESOURCE_EXHAUSTED')return fail('rate_limit','rate_limited');
 // 403: API not enabled, project quota not granted (0 QPM before approval) or no access to the location.
 if(status===403||code==='PERMISSION_DENIED')return fail('auth','permission_missing');
 if(status===404||code==='NOT_FOUND')return fail('auth','location_unavailable');
 if(status===400||code==='INVALID_ARGUMENT'||code==='FAILED_PRECONDITION'||code==='OUT_OF_RANGE')return fail('invalid_payload','invalid_parameter');
 if(phase==='write')return uncertain(status===409||code==='ALREADY_EXISTS'||code==='ABORTED'?'provider_conflict':status>=500?'provider_5xx':'provider_error');
 return status>=500?fail('provider_unavailable','provider_5xx'):fail('permanent','provider_error');
}

export type GbpTokenRefresher=(credential:ProviderCredential)=>Promise<ProviderCredential>;
export type GbpPublisherOptions={refresh?:GbpTokenRefresher|null;now?:()=>number;languageCode?:string};
// Access token valid for the request: the stored one when it is still valid for one minute, a refreshed one
// otherwise. A failed refresh happens before any write: nothing can have been published.
async function accessTokenOf(credential:ProviderCredential|undefined,refresh:GbpTokenRefresher|null,now:()=>number):Promise<{ok:true;token:string}|Failure>{
 if(!credential||!opaque(credential.accessToken)||(credential.provider!==undefined&&credential.provider!=='google_business_profile'))return fail('auth','credential_invalid');
 const expires=credential.expiresAt?Date.parse(credential.expiresAt):NaN;
 if(Number.isFinite(expires)&&expires>now()+60_000)return {ok:true,token:credential.accessToken};
 if(!refresh||!credential.refreshToken)return fail('auth','token_expired');
 try{const fresh=await refresh(credential);return opaque(fresh?.accessToken)?{ok:true,token:fresh.accessToken}:fail('auth','token_invalid');}
 catch(error){const kind=error&&typeof error==='object'&&'kind' in error?String((error as {kind:unknown}).kind):'unavailable';
  if(kind==='revoked'||kind==='expired')return fail('auth','token_revoked');
  if(kind==='permission')return fail('auth','permission_missing');
  if(kind==='rate_limited')return fail('rate_limit','rate_limited');
  return fail('provider_unavailable','token_refresh_failed');}
}

export function createGoogleBusinessProfilePublisher(transport:GbpPublishTransport,options:GbpPublisherOptions={}):PublicationPublisher{
 const now=options.now??Date.now,refresh=options.refresh??null,languageCode=options.languageCode??'fr';
 return {async publish(input:PublishInput):Promise<PublishResult>{
  if(input.platform!=='google_business_profile')return fail('permanent','unsupported_platform');
  const location=input.account.externalAccountId;if(!LOCATION.test(location))return fail('auth','location_unavailable');
  const summary=input.text.trim();
  if(!summary)return fail('invalid_payload','empty_post');
  if(summary.length>GBP_SUMMARY_MAX)return fail('invalid_payload','text_too_long');
  const image=input.media[0]??null;
  if(input.media.length>1)return fail('invalid_payload','too_many_media');
  if(image&&(!(GBP_PHOTO_TYPES as readonly string[]).includes(image.mimeType)||!/^https:\/\//.test(image.url)))return fail('invalid_payload','invalid_media');
  const token=await accessTokenOf(input.credential,refresh,now);if(!token.ok)return token;
  const body={languageCode,summary,topicType:'STANDARD',...(image?{media:[{mediaFormat:'PHOTO',sourceUrl:image.url}]}:{})};
  let r;
  try{r=await transport.request({method:'POST',path:`${location}/localPosts`,params:{},body,token:token.token});}
  catch(error){const kind=error&&typeof error==='object'&&'kind' in error?String((error as {kind:unknown}).kind):'network';
   if(kind==='invalid_path')return fail('permanent','invalid_request');
   return uncertain(kind==='timeout'?'timeout_after_dispatch':'network_after_dispatch');}
  if(r.status!==200)return classifyGbpError(r.status,r.body,'write');
  const post=record(r.body),name=typeof post.name==='string'&&POST_NAME.test(post.name)&&post.name.startsWith(location+'/')?post.name:null;
  if(!name)return uncertain('remote_id_missing');
  // A post refused by Google's review is not visible: the content must change (no automatic resend).
  if(post.state==='REJECTED')return fail('invalid_payload','post_rejected');
  return {ok:true,remoteId:name,simulated:false};
 }};
}

// Reconciliation: a known post name is read directly (404 → missing); otherwise the location's posts are listed
// (bounded pages, no documented order) and matched on the exact summary created after the dispatch. One match →
// exists; none after reading every page → missing; several, unreadable or more pages than the bound → unknown.
const MAX_RECONCILE_PAGES=5;
export function createGoogleBusinessProfileReconciler(transport:GbpPublishTransport,options:Pick<GbpPublisherOptions,'refresh'|'now'>={}):PublicationReconciler{
 const now=options.now??Date.now,refresh=options.refresh??null;
 const read=async(path:string,params:Record<string,string>,token:string)=>{try{return await transport.request({method:'GET',path,params,token});}catch{return null;}};
 return {async reconcile(d:ReconcileInput):Promise<ReconcileResult>{
  const unknown:ReconcileResult={status:'unknown',remoteId:null};
  const location=d.account?.externalAccountId??'';
  if(d.platform!=='google_business_profile'||!LOCATION.test(location))return unknown;
  const token=await accessTokenOf(d.credential,refresh,now);if(!token.ok)return unknown;
  if(d.remoteId){
   if(!POST_NAME.test(d.remoteId)||!d.remoteId.startsWith(location+'/'))return unknown;
   const r=await read(d.remoteId,{},token.token);if(!r)return unknown;
   if(r.status===200&&record(r.body).name===d.remoteId)return record(r.body).state==='REJECTED'?{status:'missing',remoteId:null}:{status:'exists',remoteId:d.remoteId};
   return r.status===404?{status:'missing',remoteId:null}:unknown;
  }
  const text=(d.text??'').trim(),since=d.since?Date.parse(d.since):NaN;if(!text||!Number.isFinite(since))return unknown;
  const matches:string[]=[];let pageToken:string|null=null;
  for(let i=0;;i++){
   if(i>=MAX_RECONCILE_PAGES)return unknown;
   const r=await read(`${location}/localPosts`,{pageSize:'100',...(pageToken?{pageToken}:{})},token.token);
   if(!r||r.status!==200)return unknown;
   const body=record(r.body);
   for(const p of (Array.isArray(body.localPosts)?body.localPosts:[]).map(record)){
    const at=typeof p.createTime==='string'?Date.parse(p.createTime):NaN;
    if(typeof p.name==='string'&&POST_NAME.test(p.name)&&p.state!=='REJECTED'&&Number.isFinite(at)&&at>=since-120_000&&String(p.summary??'').trim()===text)matches.push(p.name);
   }
   pageToken=typeof body.nextPageToken==='string'&&body.nextPageToken.length>0&&body.nextPageToken.length<=500?body.nextPageToken:null;
   if(!pageToken)break;
  }
  if(matches.length===1)return {status:'exists',remoteId:matches[0]};
  return matches.length===0?{status:'missing',remoteId:null}:unknown;
 }};
}
