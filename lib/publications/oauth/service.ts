import 'server-only';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {credentialKeyring,googleOAuthConfig,metaOAuthConfig,type GoogleOAuthConfig,type MetaOAuthConfig} from '@/lib/integrations/publications-oauth/config';
import {googleAuthorizeUrl,googleTransport,metaAuthorizeUrl,metaTransport} from '@/lib/integrations/publications-oauth/http';
import {isPublicationUuid} from '../validation';
import {isConnectionProvider,normalizeGbpAccounts,normalizeMetaAccounts,syncPayload,type ConnectionProvider,type ExternalPublicationAccount} from '../connections/model';
import {CredentialVaultError,isCredentialReference,type CredentialVault,type ProviderCredential} from '../connections/vault';
import {ConnectionProviderError,type GoogleBusinessProfileConnectionProvider,type MetaConnectionProvider} from '../connections/providers';
import {createMetaConnectionProvider} from '../connections/meta';
import {createGoogleBusinessProfileConnectionProvider} from '../connections/google-business-profile';
import {createEncryptedCredentialVault} from '../connections/encrypted-vault';
import {supabaseSecretStore} from '../connections/secret-store';
import {oauthReturnPath,type OAuthOutcome} from './model';

// Publication OAuth (Lot 4.3 P11-a). Start (Server Action) → provider consent → callback (Route Handler behind the
// Clerk admin proxy) → state consumed BEFORE any code exchange → code exchanged on the server → credential validated →
// stored in the encrypted vault → connection registered with its opaque reference (P9) → accounts discovered and
// synced atomically (P9). Explicit verification refreshes the credential when needed. Nothing is ever published.
// Logs: provider, step and error kind only. Never a token, a code, a state, a reference or a provider response.
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string;message?:string}|null}>;
export type OAuthDb={rpc:Rpc;from(table:string):{select(columns:string):{eq(column:string,value:string):{eq(column:string,value:string):{maybeSingle():PromiseLike<{data:unknown;error:unknown}>};maybeSingle():PromiseLike<{data:unknown;error:unknown}>}}}};
export type OAuthDeps={db:OAuthDb;meta:{config:MetaOAuthConfig;provider:MetaConnectionProvider}|null;google:{config:GoogleOAuthConfig;provider:GoogleBusinessProfileConnectionProvider}|null;
 vault:CredentialVault|null;pkceKey:Uint8Array|null;random?:()=>string;now?:()=>number};
const log=(provider:string,step:string,error?:unknown)=>console.error('[publications-oauth]',{provider,step,kind:error instanceof ConnectionProviderError||error instanceof CredentialVaultError?error.kind:error?'internal':'none'});
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const base64url=(bytes:Uint8Array)=>Buffer.from(bytes).toString('base64url');
const STATE=/^[A-Za-z0-9_-]{43}$/;

// Production dependencies from the server environment; each missing piece disables the matching feature (fail closed).
export function productionOAuthDeps():OAuthDeps{
 const keyring=credentialKeyring(),meta=metaOAuthConfig(),google=googleOAuthConfig();
 return {db:getSupabaseServerClient() as unknown as OAuthDb,
  vault:keyring?createEncryptedCredentialVault(supabaseSecretStore(),keyring):null,
  pkceKey:keyring?createHmac('sha256',keyring.current.key).update('codev:publications-oauth:pkce:v1').digest():null,
  meta:meta?{config:meta,provider:createMetaConnectionProvider(metaTransport(meta),{appId:meta.appId})}:null,
  google:google?{config:google,provider:createGoogleBusinessProfileConnectionProvider(googleTransport(google))}:null};
}
export function oauthReadiness(deps:Pick<OAuthDeps,'meta'|'google'|'vault'|'pkceKey'>):Record<ConnectionProvider,boolean>{
 return {meta:Boolean(deps.meta&&deps.vault),google_business_profile:Boolean(deps.google&&deps.vault&&deps.pkceKey)};
}
// PKCE verifier derived on the server from the state (HMAC with a server key): never stored, never sent to the browser.
function pkceVerifier(pkceKey:Uint8Array,state:string):string{return base64url(createHmac('sha256',pkceKey).update('pkce:'+state).digest());}

async function projectOf(db:OAuthDb,projectId:unknown):Promise<{id:string;client_id:string}|null>{
 if(!isPublicationUuid(projectId))return null;
 const {data,error}=await db.from('projects').select('id,client_id').eq('id',projectId).maybeSingle();
 if(error)throw Error('project');return data as {id:string;client_id:string}|null;
}

// 1. Start: admin, project → client resolved on the server, single-use state stored (hash only), official URL.
export async function startOAuth(provider:unknown,projectId:unknown,deps:OAuthDeps=productionOAuthDeps()):Promise<{ok:true;url:string}|{ok:false;message:string}>{
 const {userId}=await requireAdmin();
 if(!isConnectionProvider(provider))return {ok:false,message:'Connexion invalide.'};
 if(!oauthReadiness(deps)[provider])return {ok:false,message:'Connexion indisponible : configuration OAuth incomplète côté serveur.'};
 try{
  const project=await projectOf(deps.db,projectId);if(!project)return {ok:false,message:'Projet invalide.'};
  const state=deps.random?deps.random():base64url(randomBytes(32));if(!STATE.test(state))throw Error('state');
  const created=await deps.db.rpc('publication_oauth_state_create',{p_provider:provider,p_client_id:project.client_id,p_project_id:project.id,p_state_hash:hash(state),p_actor_id:userId});
  if(created.error)throw Error('state');
  if(provider==='meta')return {ok:true,url:metaAuthorizeUrl(deps.meta!.config,state)};
  const challenge=base64url(createHash('sha256').update(pkceVerifier(deps.pkceKey!,state)).digest());
  return {ok:true,url:googleAuthorizeUrl(deps.google!.config,state,challenge)};
 }catch(error){log(provider,'start',error);return {ok:false,message:'Connexion impossible pour le moment'};}
}

// Account discovery for one credential (official APIs only), normalized for publication_accounts_sync.
export async function discoverAccounts(provider:ConnectionProvider,credential:ProviderCredential,deps:OAuthDeps):Promise<ExternalPublicationAccount[]>{
 if(provider==='meta'){const meta=deps.meta!.provider;return normalizeMetaAccounts(await meta.listFacebookPages(credential),await meta.listInstagramAccounts(credential));}
 const gbp=deps.google!.provider;const locations=[];for(const account of await gbp.listAccounts(credential))locations.push(...await gbp.listLocations(credential,account.name));
 return normalizeGbpAccounts(locations);
}
const counts=(accounts:ExternalPublicationAccount[])=>({accounts:accounts.length,facebook:accounts.filter(a=>a.platform==='facebook').length,instagram:accounts.filter(a=>a.platform==='instagram').length,
 google_business_profile:accounts.filter(a=>a.platform==='google_business_profile').length});
async function record(deps:OAuthDeps,clientId:string,provider:ConnectionProvider,outcome:'oauth_completed'|'oauth_failed'|'connection_refreshed',code:string|null,actor:string,c:Record<string,number>|null=null){
 const r=await deps.db.rpc('publication_oauth_record',{p_client_id:clientId,p_provider:provider,p_outcome:outcome,p_code:code,p_counts:c,p_actor_id:actor});if(r.error)log(provider,'audit');
}
function outcomeOfError(error:unknown,during:'exchange'|'discovery'):OAuthOutcome{
 if(error instanceof ConnectionProviderError){
  if(error.kind==='permission')return 'inaccessible';
  if(error.kind==='revoked'||error.kind==='expired'||error.kind==='invalid')return during==='exchange'?'expired':'inaccessible';
 }
 return 'unavailable';
}
const providerCode=(error:unknown)=>error instanceof ConnectionProviderError||error instanceof CredentialVaultError?error.kind:'internal';

// 2. Callback. Returns the internal path to redirect to (never external, never carrying a provider value).
export async function completeOAuthCallback(provider:ConnectionProvider,query:URLSearchParams,deps:OAuthDeps=productionOAuthDeps()):Promise<string>{
 const {userId}=await requireAdmin();
 const state=query.get('state');
 if(!state||!STATE.test(state))return oauthReturnPath(null,provider,'invalid');
 // State first: single use, provider and admin bound, TTL. Nothing is exchanged before this succeeds.
 let consumed;
 try{consumed=await deps.db.rpc('publication_oauth_state_consume',{p_provider:provider,p_state_hash:hash(state),p_actor_id:userId});}catch{consumed={data:null,error:{code:'network'}};}
 if(consumed.error||!consumed.data){log(provider,'state');return oauthReturnPath(null,provider,'invalid');}
 const s=consumed.data as {status:string;client_id:string;project_id:string|null};
 if(!isPublicationUuid(s.client_id))return oauthReturnPath(null,provider,'invalid');
 const back=(outcome:OAuthOutcome)=>oauthReturnPath(s.project_id,provider,outcome);
 if(s.status==='expired')return back('expired');
 const providerError=query.get('error');
 if(providerError){await record(deps,s.client_id,provider,'oauth_failed',providerError==='access_denied'?'access_denied':'provider_error',userId);return back(providerError==='access_denied'?'refused':'unavailable');}
 const code=query.get('code');
 if(!code||code.length>4096||!/^[\x21-\x7e]+$/.test(code)){await record(deps,s.client_id,provider,'oauth_failed','missing_code',userId);return back('invalid');}
 if(!oauthReadiness(deps)[provider]||!deps.vault){await record(deps,s.client_id,provider,'oauth_failed','not_configured',userId);return back('unavailable');}
 // Code exchange (single attempt: an OAuth code is consumable) and credential validation.
 let credential:ProviderCredential;
 try{credential=provider==='meta'?await deps.meta!.provider.exchangeCode(code,deps.meta!.config.redirectUri)
   :await deps.google!.provider.exchangeCode(code,deps.google!.config.redirectUri,pkceVerifier(deps.pkceKey!,state));}
 catch(error){log(provider,'exchange',error);await record(deps,s.client_id,provider,'oauth_failed','exchange_'+providerCode(error),userId);return back(outcomeOfError(error,'exchange'));}
 let reference:string;
 try{reference=await deps.vault.storeCredential({...credential,provider});}
 catch(error){log(provider,'vault',error);await record(deps,s.client_id,provider,'oauth_failed','vault_unavailable',userId);return back('unavailable');}
 const registered=await deps.db.rpc('publication_connection_register',{p_client_id:s.client_id,p_provider:provider,p_credential_reference:reference,
  p_external_identity:credential.subject??null,p_expires_at:credential.expiresAt,p_metadata:{},p_actor_id:userId});
 if(registered.error||!registered.data){log(provider,'register');await deps.vault.deleteCredential(reference).catch(()=>log(provider,'vault_cleanup'));
  await record(deps,s.client_id,provider,'oauth_failed','register_failed',userId);return back('unavailable');}
 const r=registered.data as {connection_id:string;replaced_reference?:unknown};
 if(isCredentialReference(r.replaced_reference))await deps.vault.deleteCredential(r.replaced_reference).catch(()=>log(provider,'vault_cleanup'));
 let accounts:ExternalPublicationAccount[];
 try{accounts=await discoverAccounts(provider,credential,deps);}
 catch(error){log(provider,'discovery',error);await record(deps,s.client_id,provider,'oauth_completed','discovery_'+providerCode(error),userId);return back('partial');}
 const synced=await deps.db.rpc('publication_accounts_sync',{p_client_id:s.client_id,p_connection_id:r.connection_id,p_accounts:syncPayload(accounts),p_actor_id:userId});
 if(synced.error){log(provider,'sync');await record(deps,s.client_id,provider,'oauth_completed','sync_failed',userId);return back('partial');}
 await record(deps,s.client_id,provider,'oauth_completed',null,userId,counts(accounts));
 return back('success');
}

// 3. Explicit verification: refresh when needed (rotation to a new reference), validation, resync. No cron.
// Network / rate-limit errors never change the status; a provider revocation or expiry is recorded as such;
// an ambiguous provider answer (permission, invalid) is recorded as error.
const REFRESH_MARGIN_MS:Record<ConnectionProvider,number>={meta:10*86400_000,google_business_profile:5*60_000};
export async function verifyConnection(projectId:unknown,provider:unknown,deps:OAuthDeps=productionOAuthDeps()):Promise<{ok:boolean;message:string}>{
 const {userId}=await requireAdmin();
 if(!isConnectionProvider(provider))return {ok:false,message:'Connexion invalide.'};
 if(!oauthReadiness(deps)[provider]||!deps.vault)return {ok:false,message:'Connexion indisponible : configuration OAuth incomplète côté serveur.'};
 const now=deps.now??Date.now;
 try{
  const project=await projectOf(deps.db,projectId);if(!project)return {ok:false,message:'Projet invalide.'};
  const row=await deps.db.from('client_connections').select('id,status,credential_reference,expires_at').eq('client_id',project.client_id).eq('provider',provider).maybeSingle();
  const c=row.data as {id:string;status:string;credential_reference:string|null;expires_at:string|null}|null;
  if(row.error)throw Error('connection');
  if(!c||c.status==='disabled'||!isCredentialReference(c.credential_reference))return {ok:false,message:'Aucune connexion active : connectez d’abord le compte.'};
  let credential=await deps.vault.readCredential(c.credential_reference,provider);
  const source=provider==='meta'?deps.meta!.provider:deps.google!.provider;
  const setStatus=(status:'active'|'expired'|'revoked'|'error',reference:string|null=null,expiresAt:string|null=null)=>
   deps.db.rpc('publication_connection_set_status',{p_connection_id:c.id,p_status:status,p_credential_reference:reference,p_expires_at:expiresAt,p_actor_id:userId});
  try{
   if(credential.expiresAt&&Date.parse(credential.expiresAt)-now()<=REFRESH_MARGIN_MS[provider]){
    const refreshed=await source.refresh(credential);
    const reference=await deps.vault.rotateCredential(c.credential_reference,{...refreshed,provider});
    const updated=await setStatus('active',reference,refreshed.expiresAt);if(updated.error)throw Error('status');
    credential=refreshed;await record(deps,project.client_id,provider,'connection_refreshed',null,userId);
   }
   const validation=await source.validateConnection(credential);
   if(validation.status!=='active'){await setStatus(validation.status);return {ok:false,message:validation.status==='revoked'?'Accès révoqué : reconnectez le compte.':'Connexion expirée : reconnectez le compte.'};}
   if(c.status!=='active'){const restored=await setStatus('active',null,credential.expiresAt);if(restored.error)throw Error('status');}
   const accounts=await discoverAccounts(provider,credential,deps);
   const synced=await deps.db.rpc('publication_accounts_sync',{p_client_id:project.client_id,p_connection_id:c.id,p_accounts:syncPayload(accounts),p_actor_id:userId});
   if(synced.error)throw Error('sync');
   return {ok:true,message:`Connexion vérifiée : ${accounts.length} compte(s) disponible(s).`};
  }catch(error){
   log(provider,'verify',error);
   if(error instanceof ConnectionProviderError){
    if(error.kind==='revoked'||error.kind==='expired'){await setStatus(error.kind);return {ok:false,message:error.kind==='revoked'?'Accès révoqué : reconnectez le compte.':'Connexion expirée : reconnectez le compte.'};}
    if(error.kind==='permission'||error.kind==='invalid'){await setStatus('error');return {ok:false,message:'Compte inaccessible'};}
   }
   return {ok:false,message:'Connexion impossible pour le moment'};
  }
 }catch(error){log(provider,'verify_setup',error);return {ok:false,message:'Connexion impossible pour le moment'};}
}
