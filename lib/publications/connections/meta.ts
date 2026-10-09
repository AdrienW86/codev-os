import 'server-only';
import {ConnectionProviderError,type ConnectionValidation,type MetaConnectionProvider,type ProviderTransport} from './providers';
import type {ProviderCredential} from './vault';
import type {MetaInstagramAccount,MetaPage} from './model';

// Meta connection provider (Facebook Login for Business, manual flow; official docs, Graph API v26.0):
// code → short-lived user token → long-lived user token (fb_exchange_token, ~60 days, no refresh token: extended by
// exchanging it again while still valid) → debug_token (validity, app, user, scopes, expiry). Pages from
// /me/accounts (paginated); the Instagram professional account linked to a Page from its instagram_business_account
// field (a Page may have none). Page access tokens returned by Meta are DROPPED: they are derived again from the
// user token when a publication needs them (P11-b), never stored separately.
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const text=(v:unknown,max=300):string|null=>typeof v==='string'&&v.length>=1&&v.length<=max?v:null;
const opaque=(v:unknown):v is string=>typeof v==='string'&&v.length>=8&&v.length<=8192&&/^[\x21-\x7e]+$/.test(v);
const MAX_PAGES=10;
// Permission without which nothing can be discovered.
export const META_REQUIRED_SCOPES=['pages_show_list'] as const;
// Meta errors: 190 invalid OAuth token (subcode 463 = expired, others = revoked / invalidated), 4/17/32/613 rate
// limits, 10/200-299 permission errors.
function failure(status:number,body:unknown):ConnectionProviderError{
 const error=record(record(body).error),code=typeof error.code==='number'?error.code:null;
 if(code===190||status===401)return new ConnectionProviderError(error.error_subcode===463?'expired':'revoked');
 if(code!==null&&[4,17,32,613].includes(code)||status===429)return new ConnectionProviderError('rate_limited');
 if(code===10||(code!==null&&code>=200&&code<300)||status===403)return new ConnectionProviderError('permission');
 return new ConnectionProviderError(status===400?'invalid':'unavailable');
}
export function createMetaConnectionProvider(transport:ProviderTransport,options:{appId?:string;now?:()=>number}={}):MetaConnectionProvider{
 const now=options.now??Date.now;
 const call=async(request:Parameters<ProviderTransport['request']>[0])=>{let r;try{r=await transport.request(request);}catch{throw new ConnectionProviderError('unavailable');}
  if(r.status!==200||!r.body||typeof r.body!=='object')throw r.status===200?new ConnectionProviderError('invalid'):failure(r.status,r.body);return r.body;};
 const token=(body:unknown):string=>{const b=record(body);if(!opaque(b.access_token)||(b.token_type!==undefined&&String(b.token_type).toLowerCase()!=='bearer'))throw new ConnectionProviderError('invalid');return b.access_token;};
 // Official token inspection with the app token: validity, issuing app, user and granted scopes.
 async function inspect(accessToken:string):Promise<{valid:boolean;subject:string|null;scopes:string[];expiresAt:string|null;expiredReason:boolean}>{
  const data=record(record(await call({operation:'debug',path:'debug_token',params:{},credential:{accessToken,refreshToken:null,expiresAt:null,scopes:[]}})).data);
  if(options.appId&&String(data.app_id??'')!==options.appId)throw new ConnectionProviderError('invalid');
  const expires=typeof data.expires_at==='number'&&data.expires_at>0?new Date(data.expires_at*1000).toISOString():null;
  const scopes=Array.isArray(data.scopes)?data.scopes.filter((s):s is string=>typeof s==='string'&&/^[a-z_]{1,80}$/.test(s)):[];
  const err=record(data.error);
  return {valid:data.is_valid===true,subject:text(data.user_id,100),scopes,expiresAt:expires,expiredReason:err.subcode===463||err.code===463};
 }
 async function credentialFrom(accessToken:string):Promise<ProviderCredential>{
  const info=await inspect(accessToken);
  if(!info.valid)throw new ConnectionProviderError(info.expiredReason?'expired':'revoked');
  if(META_REQUIRED_SCOPES.some(s=>!info.scopes.includes(s)))throw new ConnectionProviderError('permission');
  return {accessToken,refreshToken:null,expiresAt:info.expiresAt,scopes:info.scopes,provider:'meta',subject:info.subject&&/^[A-Za-z0-9_.-]{1,100}$/.test(info.subject)?info.subject:null};
 }
 async function* pages(fields:string,credential:ProviderCredential){
  let after:string|null=null;
  for(let i=0;i<MAX_PAGES;i++){
   const body=record(await call({operation:'read',path:'me/accounts',params:{fields,limit:'100',...(after?{after}:{})},credential}));
   for(const item of Array.isArray(body.data)?body.data:[])yield record(item);
   const next=record(record(body.paging).cursors).after;
   if(!record(body.paging).next||typeof next!=='string'||next.length>500)return;after=next;
  }
 }
 return {
  async exchangeCode(code,redirectUri){
   if(!opaque(code)||!text(redirectUri,500))throw new ConnectionProviderError('invalid');
   const short=token(await call({operation:'token',path:'oauth/access_token',params:{code,redirect_uri:redirectUri}}));
   const long=token(await call({operation:'token',path:'oauth/access_token',params:{grant_type:'fb_exchange_token'},credential:{accessToken:short,refreshToken:null,expiresAt:null,scopes:[]}}));
   return credentialFrom(long);},
  // A long-lived user token is extended by exchanging it again while it is still valid.
  async refresh(credential){
   if(credential.expiresAt&&Date.parse(credential.expiresAt)<=now())throw new ConnectionProviderError('expired');
   return credentialFrom(token(await call({operation:'token',path:'oauth/access_token',params:{grant_type:'fb_exchange_token'},credential})));},
  async validateConnection(credential):Promise<ConnectionValidation>{
   const info=await inspect(credential.accessToken);
   if(!info.valid)return {status:info.expiredReason?'expired':'revoked',externalIdentity:null};
   if(info.expiresAt&&Date.parse(info.expiresAt)<=now())return {status:'expired',externalIdentity:null};
   return {status:'active',externalIdentity:info.subject};},
  async listFacebookPages(credential){const out:MetaPage[]=[];
   for await(const r of pages('id,name,category',credential)){const id=text(r.id),name=text(r.name,200);if(id&&name)out.push({id,name,category:text(r.category,200)});}
   return out;},
  async listInstagramAccounts(credential){const out:MetaInstagramAccount[]=[];
   for await(const r of pages('id,instagram_business_account{id,username,name}',credential)){const ig=record(r.instagram_business_account),pageId=text(r.id),id=text(ig.id);
    if(pageId&&id)out.push({id,pageId,username:text(ig.username,200),name:text(ig.name,200)});}
   return out;},
 };
}
