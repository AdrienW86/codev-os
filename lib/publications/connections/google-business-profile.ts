import 'server-only';
import {ConnectionProviderError,type ConnectionValidation,type GoogleBusinessProfileConnectionProvider,type ProviderTransport} from './providers';
import type {ProviderCredential} from './vault';
import type {GbpAccount,GbpLocation} from './model';

// Google Business Profile connection provider over an injected server transport (same OAuth token semantics as
// the existing Google Drive connector: strict bearer token, explicit expiry). Not wired in P9; fake transport only.
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const text=(v:unknown,max=300):string|null=>typeof v==='string'&&v.length>=1&&v.length<=max?v:null;
const opaque=(v:unknown):v is string=>typeof v==='string'&&v.length>=8&&v.length<=8192&&/^[\x21-\x7e]+$/.test(v);
// Required OAuth scope: Google's business.manage scope (matched by its path, the host being Google's API domain).
const grantsBusinessManage=(scopes:string[])=>scopes.some(s=>/^https:\/\/www\.googleapis\.com\/auth\/business\.manage$/.test(s));
function failure(status:number,body:unknown):ConnectionProviderError{
 const b=record(body);
 if(b.error==='invalid_grant')return new ConnectionProviderError('revoked');
 if(status===401)return new ConnectionProviderError('expired');
 if(status===403)return new ConnectionProviderError('revoked');
 return new ConnectionProviderError(status===400?'invalid':'unavailable');
}
function credentialOf(body:unknown,previousRefresh:string|null):ProviderCredential{
 const b=record(body);
 if(!opaque(b.access_token)||typeof b.token_type!=='string'||b.token_type.toLowerCase()!=='bearer'||typeof b.expires_in!=='number'||!Number.isFinite(b.expires_in)||b.expires_in<=60)
  throw new ConnectionProviderError('invalid');
 const scopes=typeof b.scope==='string'?b.scope.split(' ').filter(Boolean):[];
 if(!grantsBusinessManage(scopes))throw new ConnectionProviderError('invalid');
 const refresh=opaque(b.refresh_token)?b.refresh_token:previousRefresh;
 return {accessToken:b.access_token,refreshToken:refresh,expiresAt:new Date(Date.now()+(b.expires_in-60)*1000).toISOString(),scopes};
}
export function createGoogleBusinessProfileConnectionProvider(transport:ProviderTransport):GoogleBusinessProfileConnectionProvider{
 const call=async(request:Parameters<ProviderTransport['request']>[0])=>{let r;try{r=await transport.request(request);}catch{throw new ConnectionProviderError('unavailable');}
  if(r.status!==200)throw failure(r.status,r.body);return r.body;};
 return {
  async exchangeCode(code,redirectUri){if(!opaque(code)||!text(redirectUri,500))throw new ConnectionProviderError('invalid');
   return credentialOf(await call({operation:'token',path:'token',params:{grant_type:'authorization_code',code,redirect_uri:redirectUri}}),null);},
  async refresh(credential){if(!credential.refreshToken)throw new ConnectionProviderError('revoked');
   return credentialOf(await call({operation:'token',path:'token',params:{grant_type:'refresh_token'},credential}),credential.refreshToken);},
  async validateConnection(credential):Promise<ConnectionValidation>{
   try{await call({operation:'read',path:'accounts',params:{pageSize:'1'},credential});return {status:'active',externalIdentity:null};}
   catch(e){if(e instanceof ConnectionProviderError&&(e.kind==='expired'||e.kind==='revoked'))return {status:e.kind,externalIdentity:null};throw e;}},
  async listAccounts(credential){const body=record(await call({operation:'read',path:'accounts',params:{pageSize:'20'},credential}));
   const list=Array.isArray(body.accounts)?body.accounts:[];
   return list.flatMap((a):GbpAccount[]=>{const r=record(a),name=text(r.name);return name&&/^accounts\/[^/]+$/.test(name)?[{name,accountName:text(r.accountName,200)}]:[];});},
  async listLocations(credential,accountName){if(!/^accounts\/[^/]+$/.test(accountName))throw new ConnectionProviderError('invalid');
   const body=record(await call({operation:'read',path:`${accountName}/locations`,params:{readMask:'name,title',pageSize:'100'},credential}));
   const list=Array.isArray(body.locations)?body.locations:[];
   return list.flatMap((l):GbpLocation[]=>{const r=record(l),name=text(r.name);return name&&/^locations\/[^/]+$/.test(name)?[{name,title:text(r.title,200),accountName}]:[];});},
 };
}
