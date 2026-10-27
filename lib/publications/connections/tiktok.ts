import 'server-only';
import {ConnectionProviderError,type ConnectionValidation,type ProviderTransport,type TikTokConnectionProvider} from './providers';
import type {ProviderCredential} from './vault';
import type {TikTokUser} from './model';

// TikTok connection provider (TikTok for Developers, Login Kit web + API v2). Jeton d'accès Bearer de 24 h,
// jeton de rafraîchissement de 365 jours, scopes user.info.basic et video.publish exigés (sinon aucune publication
// possible). Le compte publié est celui de l'utilisateur qui a donné son accord (open_id). Aucune réponse du
// fournisseur n'est journalisée ni renvoyée à l'interface.
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const text=(v:unknown,max=300):string|null=>typeof v==='string'&&v.length>=1&&v.length<=max?v:null;
const opaque=(v:unknown):v is string=>typeof v==='string'&&v.length>=8&&v.length<=8192&&/^[\x21-\x7e]+$/.test(v);
const OPEN_ID=/^[A-Za-z0-9_.-]{1,100}$/;
export const TIKTOK_REQUIRED_SCOPES=['user.info.basic','video.publish'] as const;
function failure(status:number,body:unknown):ConnectionProviderError{
 const b=record(body),error=typeof b.error==='string'?b.error:typeof record(b.error).code==='string'?String(record(b.error).code):null;
 if(error==='invalid_grant'||error==='access_token_revoked')return new ConnectionProviderError('revoked');
 if(status===401||error==='access_token_invalid'||error==='access_token_expired')return new ConnectionProviderError('expired');
 if(status===429||error==='rate_limit_exceeded')return new ConnectionProviderError('rate_limited');
 if(status===403||error==='scope_not_authorized'||error==='scope_permission_missed')return new ConnectionProviderError('permission');
 return new ConnectionProviderError(status===400||error?'invalid':'unavailable');
}
export function tiktokCredentialOf(body:unknown,previous:ProviderCredential|null,now=Date.now()):ProviderCredential{
 const b=record(body);
 if(typeof b.error==='string'&&b.error)throw failure(400,b);
 if(!opaque(b.access_token)||typeof b.expires_in!=='number'||!Number.isFinite(b.expires_in)||b.expires_in<=120
  ||(typeof b.token_type==='string'&&b.token_type.toLowerCase()!=='bearer'))throw new ConnectionProviderError('invalid');
 const scopes=typeof b.scope==='string'?b.scope.split(/[ ,]+/).filter(Boolean).slice(0,50):previous?.scopes??[];
 if(!TIKTOK_REQUIRED_SCOPES.every(s=>scopes.includes(s)))throw new ConnectionProviderError('permission');
 const openId=text(b.open_id,100)??previous?.subject??null;
 if(!openId||!OPEN_ID.test(openId))throw new ConnectionProviderError('invalid');
 const refresh=opaque(b.refresh_token)?b.refresh_token:previous?.refreshToken??null;
 return {accessToken:b.access_token,refreshToken:refresh,expiresAt:new Date(now+(b.expires_in-120)*1000).toISOString(),scopes,provider:'tiktok',subject:openId};
}
export function createTikTokConnectionProvider(transport:ProviderTransport):TikTokConnectionProvider{
 const call=async(request:Parameters<ProviderTransport['request']>[0])=>{let r;try{r=await transport.request(request);}catch{throw new ConnectionProviderError('unavailable');}
  const body=record(r.body),apiError=record(body.error);
  if(r.status!==200||!r.body||typeof r.body!=='object'||(typeof body.error==='string'&&body.error)||(typeof apiError.code==='string'&&apiError.code!=='ok'))
   throw r.status===200&&!body.error?new ConnectionProviderError('invalid'):failure(r.status,r.body);
  return r.body;};
 const provider:TikTokConnectionProvider={
  async exchangeCode(code,redirectUri){
   if(!opaque(code)||!text(redirectUri,500))throw new ConnectionProviderError('invalid');
   return tiktokCredentialOf(await call({operation:'token',path:'token',params:{grant_type:'authorization_code',code,redirect_uri:redirectUri}}),null);},
  async refresh(credential){if(!credential.refreshToken)throw new ConnectionProviderError('revoked');
   return tiktokCredentialOf(await call({operation:'token',path:'token',params:{grant_type:'refresh_token'},credential}),credential);},
  async validateConnection(credential):Promise<ConnectionValidation>{
   try{const user=await provider.currentUser(credential);return {status:'active',externalIdentity:user.openId};}
   catch(e){if(e instanceof ConnectionProviderError&&(e.kind==='expired'||e.kind==='revoked'))return {status:e.kind,externalIdentity:null};throw e;}},
  async currentUser(credential){
   const body=record(await call({operation:'read',path:'user/info',params:{fields:'open_id,display_name'},credential}));
   const user=record(record(body.data).user),openId=text(user.open_id,100);
   if(!openId||!OPEN_ID.test(openId))throw new ConnectionProviderError('invalid');
   return {openId,displayName:text(user.display_name,200),username:null};},
 };
 return provider;
}
