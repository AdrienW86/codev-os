import 'server-only';
import {ConnectionProviderError,type ConnectionValidation,type GoogleBusinessProfileConnectionProvider,type ProviderTransport} from './providers';
import type {ProviderCredential} from './vault';
import type {GbpAccount,GbpLocation} from './model';

// Google Business Profile connection provider (official docs): OAuth 2.0 web server flow with PKCE (S256), scope
// business.manage only, offline access (refresh token). Accounts from the Account Management API v1 (20 per page),
// locations from the Business Information API v1 (readMask name,title, 100 per page). Same token semantics as the
// Drive connector: strict bearer token, explicit expiry, granted scope checked.
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const text=(v:unknown,max=300):string|null=>typeof v==='string'&&v.length>=1&&v.length<=max?v:null;
const opaque=(v:unknown):v is string=>typeof v==='string'&&v.length>=8&&v.length<=8192&&/^[\x21-\x7e]+$/.test(v);
const MAX_ACCOUNT_PAGES=10,MAX_LOCATION_PAGES=20;
// Required OAuth scope: Google's business.manage scope (matched by its path, the host being Google's API domain).
const grantsBusinessManage=(scopes:string[])=>scopes.some(s=>/^https:\/\/www\.googleapis\.com\/auth\/business\.manage$/.test(s));
function failure(status:number,body:unknown):ConnectionProviderError{
 const b=record(body),error=record(b.error);
 if(b.error==='invalid_grant')return new ConnectionProviderError('revoked');
 if(status===401)return new ConnectionProviderError('expired');
 if(status===429||error.status==='RESOURCE_EXHAUSTED')return new ConnectionProviderError('rate_limited');
 // 403: API not enabled, quota not granted or no access to the business: a permission problem, not a revocation.
 if(status===403)return new ConnectionProviderError('permission');
 return new ConnectionProviderError(status===400?'invalid':'unavailable');
}
function credentialOf(body:unknown,previousRefresh:string|null):ProviderCredential{
 const b=record(body);
 if(!opaque(b.access_token)||typeof b.token_type!=='string'||b.token_type.toLowerCase()!=='bearer'||typeof b.expires_in!=='number'||!Number.isFinite(b.expires_in)||b.expires_in<=60)
  throw new ConnectionProviderError('invalid');
 const scopes=typeof b.scope==='string'?b.scope.split(' ').filter(Boolean).slice(0,50):[];
 if(!grantsBusinessManage(scopes))throw new ConnectionProviderError('permission');
 const refresh=opaque(b.refresh_token)?b.refresh_token:previousRefresh;
 return {accessToken:b.access_token,refreshToken:refresh,expiresAt:new Date(Date.now()+(b.expires_in-60)*1000).toISOString(),scopes,provider:'google_business_profile',subject:null};
}
export function createGoogleBusinessProfileConnectionProvider(transport:ProviderTransport):GoogleBusinessProfileConnectionProvider{
 const call=async(request:Parameters<ProviderTransport['request']>[0])=>{let r;try{r=await transport.request(request);}catch{throw new ConnectionProviderError('unavailable');}
  if(r.status!==200||!r.body||typeof r.body!=='object')throw r.status===200?new ConnectionProviderError('invalid'):failure(r.status,r.body);return r.body;};
 return {
  async exchangeCode(code,redirectUri,codeVerifier){
   if(!opaque(code)||!text(redirectUri,500)||(codeVerifier!==undefined&&!/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)))throw new ConnectionProviderError('invalid');
   return credentialOf(await call({operation:'token',path:'token',params:{grant_type:'authorization_code',code,redirect_uri:redirectUri,...(codeVerifier?{code_verifier:codeVerifier}:{})}}),null);},
  async refresh(credential){if(!credential.refreshToken)throw new ConnectionProviderError('revoked');
   return credentialOf(await call({operation:'token',path:'token',params:{grant_type:'refresh_token'},credential}),credential.refreshToken);},
  async validateConnection(credential):Promise<ConnectionValidation>{
   try{await call({operation:'read',path:'accounts',params:{pageSize:'1'},credential});return {status:'active',externalIdentity:null};}
   catch(e){if(e instanceof ConnectionProviderError&&(e.kind==='expired'||e.kind==='revoked'))return {status:e.kind,externalIdentity:null};throw e;}},
  async listAccounts(credential){const out:GbpAccount[]=[];let pageToken:string|null=null;
   for(let i=0;i<MAX_ACCOUNT_PAGES;i++){
    const body=record(await call({operation:'read',path:'accounts',params:{pageSize:'20',...(pageToken?{pageToken}:{})},credential}));
    for(const a of Array.isArray(body.accounts)?body.accounts:[]){const r=record(a),name=text(r.name);if(name&&/^accounts\/[0-9A-Za-z_-]{1,100}$/.test(name)&&!out.some(x=>x.name===name))out.push({name,accountName:text(r.accountName,200)});}
    pageToken=text(body.nextPageToken,500);if(!pageToken)break;}
   return out;},
  async listLocations(credential,accountName){if(!/^accounts\/[0-9A-Za-z_-]{1,100}$/.test(accountName))throw new ConnectionProviderError('invalid');
   const out:GbpLocation[]=[];let pageToken:string|null=null;
   for(let i=0;i<MAX_LOCATION_PAGES;i++){
    const body=record(await call({operation:'read',path:`${accountName}/locations`,params:{readMask:'name,title',pageSize:'100',...(pageToken?{pageToken}:{})},credential}));
    for(const l of Array.isArray(body.locations)?body.locations:[]){const r=record(l),name=text(r.name);if(name&&/^locations\/[0-9A-Za-z_-]{1,100}$/.test(name))out.push({name,title:text(r.title,200),accountName});}
    pageToken=text(body.nextPageToken,500);if(!pageToken)break;}
   return out;},
 };
}
