import 'server-only';
import {ConnectionProviderError,type ConnectionValidation,type ProviderTransport,type SnapchatConnectionProvider} from './providers';
import type {ProviderCredential} from './vault';
import type {SnapchatPublicProfile} from './model';

// Snapchat connection provider (Snap OAuth 2.0 + Public Profile API). Jeton d'accès Bearer court (environ 1 h), jeton de
// rafraîchissement long, scope snapchat-profile-api exigé (sinon aucune publication possible). Les comptes publiables
// sont les profils publics (Public Profiles) de l'organisation de la personne connectée. Aucune réponse du fournisseur
// n'est journalisée ni renvoyée à l'interface.
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const text=(v:unknown,max=300):string|null=>typeof v==='string'&&v.trim().length>=1&&v.length<=max?v.trim():null;
const opaque=(v:unknown):v is string=>typeof v==='string'&&v.length>=8&&v.length<=8192&&/^[\x21-\x7e]+$/.test(v);
const SNAP_ID=/^[A-Za-z0-9_-]{1,100}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SNAPCHAT_REQUIRED_SCOPES=['snapchat-profile-api'] as const;
function failure(status:number,body:unknown):ConnectionProviderError{
 const b=record(body),error=typeof b.error==='string'?b.error:null;
 if(error==='invalid_grant')return new ConnectionProviderError('revoked');
 if(status===401||error==='invalid_token')return new ConnectionProviderError('expired');
 if(status===429)return new ConnectionProviderError('rate_limited');
 if(status===403||error==='insufficient_scope'||error==='unauthorized_client')return new ConnectionProviderError('permission');
 return new ConnectionProviderError(status===400||error?'invalid':'unavailable');
}
export function snapchatCredentialOf(body:unknown,previous:ProviderCredential|null,now=Date.now()):ProviderCredential{
 const b=record(body);
 if(typeof b.error==='string'&&b.error)throw failure(400,b);
 if(!opaque(b.access_token)||typeof b.expires_in!=='number'||!Number.isFinite(b.expires_in)||b.expires_in<=120
  ||(typeof b.token_type==='string'&&b.token_type.toLowerCase()!=='bearer'))throw new ConnectionProviderError('invalid');
 const scopes=typeof b.scope==='string'?b.scope.split(/[ ,]+/).filter(Boolean).slice(0,50):previous?.scopes??[];
 if(!SNAPCHAT_REQUIRED_SCOPES.every(s=>scopes.includes(s)))throw new ConnectionProviderError('permission');
 const refresh=opaque(b.refresh_token)?b.refresh_token:previous?.refreshToken??null;
 return {accessToken:b.access_token,refreshToken:refresh,expiresAt:new Date(now+(b.expires_in-120)*1000).toISOString(),scopes,provider:'snapchat',subject:previous?.subject??null};
}
// Réponses Snap : enveloppe { request_status, <collection>: [ { sub_request_status, <objet>: {...} } ] } ; l'objet seul est aussi accepté.
function unwrap(list:unknown,key:string):Record<string,unknown>[]{
 return Array.isArray(list)?list.slice(0,200).map(item=>{const r=record(item);return Object.keys(record(r[key])).length?record(r[key]):r;}):[];
}
export function snapchatProfilesOf(body:unknown):SnapchatPublicProfile[]{
 return unwrap(record(body).public_profiles,'public_profile').flatMap(p=>{const id=text(p.id,100);
  return id&&SNAP_ID.test(id)?[{id,displayName:text(p.display_name,200),username:text(p.snap_user_name,100)??text(p.username,100)}]:[];});
}
export function createSnapchatConnectionProvider(transport:ProviderTransport):SnapchatConnectionProvider{
 const call=async(request:Parameters<ProviderTransport['request']>[0])=>{let r;try{r=await transport.request(request);}catch{throw new ConnectionProviderError('unavailable');}
  const body=record(r.body);
  if(r.status!==200||!r.body||typeof r.body!=='object'||(typeof body.error==='string'&&body.error)||(typeof body.request_status==='string'&&body.request_status.toUpperCase()==='ERROR'))
   throw r.status===200&&!body.error?new ConnectionProviderError('invalid'):failure(r.status,r.body);
  return r.body;};
 const me=async(credential:ProviderCredential)=>{const m=record(record(await call({operation:'read',path:'me',params:{},credential})).me);
  const id=text(m.id,100),organization=text(m.organization_id,100);
  if(!id||!SNAP_ID.test(id))throw new ConnectionProviderError('invalid');return {id,organization:organization&&UUID.test(organization)?organization:null};};
 const provider:SnapchatConnectionProvider={
  async exchangeCode(code,redirectUri){
   if(!opaque(code)||!text(redirectUri,500))throw new ConnectionProviderError('invalid');
   const credential=snapchatCredentialOf(await call({operation:'token',path:'token',params:{grant_type:'authorization_code',code}}),null);
   return {...credential,subject:(await me(credential)).id};},
  async refresh(credential){if(!credential.refreshToken)throw new ConnectionProviderError('revoked');
   return snapchatCredentialOf(await call({operation:'token',path:'token',params:{grant_type:'refresh_token'},credential}),credential);},
  async validateConnection(credential):Promise<ConnectionValidation>{
   try{const user=await me(credential);return {status:'active',externalIdentity:user.id};}
   catch(e){if(e instanceof ConnectionProviderError&&(e.kind==='expired'||e.kind==='revoked'))return {status:e.kind,externalIdentity:null};throw e;}},
  async listPublicProfiles(credential){
   const user=await me(credential);if(!user.organization)return [];
   return snapchatProfilesOf(await call({operation:'read',path:`organizations/${user.organization}/public_profiles`,params:{},credential}));},
 };
 return provider;
}
