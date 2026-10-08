import 'server-only';
import {ConnectionProviderError,type ConnectionValidation,type MetaConnectionProvider,type ProviderTransport} from './providers';
import type {ProviderCredential} from './vault';
import type {MetaInstagramAccount,MetaPage} from './model';

// Meta connection provider (Facebook pages + Instagram business accounts) over an injected server transport.
// Not wired in P9 (no OAuth configured, no transport implemented): only exercised with a fake transport.
// Strict parsing: only ids, names and links are kept; page access tokens returned by Meta are dropped.
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const text=(v:unknown,max=300):string|null=>typeof v==='string'&&v.length>=1&&v.length<=max?v:null;
const opaque=(v:unknown):v is string=>typeof v==='string'&&v.length>=8&&v.length<=8192&&/^[\x21-\x7e]+$/.test(v);
// Meta error 190 = invalid OAuth token; subcode 463 = expired, other subcodes (458, 460, 467…) = revoked / invalidated.
function failure(status:number,body:unknown):ConnectionProviderError{
 const error=record(record(body).error);
 if(error.code===190||status===401)return new ConnectionProviderError(error.error_subcode===463?'expired':'revoked');
 return new ConnectionProviderError(status===400?'invalid':'unavailable');
}
function credentialOf(body:unknown):ProviderCredential{
 const b=record(body);if(!opaque(b.access_token)||(b.token_type!==undefined&&String(b.token_type).toLowerCase()!=='bearer'))throw new ConnectionProviderError('invalid');
 const seconds=typeof b.expires_in==='number'&&Number.isFinite(b.expires_in)&&b.expires_in>0?b.expires_in:null;
 return {accessToken:b.access_token,refreshToken:null,expiresAt:seconds?new Date(Date.now()+seconds*1000).toISOString():null,scopes:[]};
}
export function createMetaConnectionProvider(transport:ProviderTransport):MetaConnectionProvider{
 const call=async(request:Parameters<ProviderTransport['request']>[0])=>{let r;try{r=await transport.request(request);}catch{throw new ConnectionProviderError('unavailable');}
  if(r.status!==200)throw failure(r.status,r.body);return r.body;};
 return {
  async exchangeCode(code,redirectUri){if(!opaque(code)||!text(redirectUri,500))throw new ConnectionProviderError('invalid');return credentialOf(await call({operation:'token',path:'oauth/access_token',params:{code,redirect_uri:redirectUri}}));},
  // Long-lived user tokens are extended by exchanging them (fb_exchange_token); there is no refresh token.
  async refresh(credential){return credentialOf(await call({operation:'token',path:'oauth/access_token',params:{grant_type:'fb_exchange_token'},credential}));},
  async validateConnection(credential):Promise<ConnectionValidation>{
   try{const me=record(await call({operation:'read',path:'me',params:{fields:'id'},credential}));return {status:'active',externalIdentity:text(me.id)};}
   catch(e){if(e instanceof ConnectionProviderError&&(e.kind==='expired'||e.kind==='revoked'))return {status:e.kind,externalIdentity:null};throw e;}},
  async listFacebookPages(credential){const body=record(await call({operation:'read',path:'me/accounts',params:{fields:'id,name,category',limit:'100'},credential}));
   const data=Array.isArray(body.data)?body.data:[];
   return data.flatMap((p):MetaPage[]=>{const r=record(p),id=text(r.id),name=text(r.name,200);return id&&name?[{id,name,category:text(r.category,200)}]:[];});},
  async listInstagramAccounts(credential){const body=record(await call({operation:'read',path:'me/accounts',params:{fields:'id,instagram_business_account{id,username,name}',limit:'100'},credential}));
   const data=Array.isArray(body.data)?body.data:[];
   return data.flatMap((p):MetaInstagramAccount[]=>{const r=record(p),ig=record(r.instagram_business_account),pageId=text(r.id),id=text(ig.id);
    return pageId&&id?[{id,pageId,username:text(ig.username,200),name:text(ig.name,200)}]:[];});},
 };
}
