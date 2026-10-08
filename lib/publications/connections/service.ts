import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {isPublicationUuid} from '../validation';
import {platformLabels} from '../editor';
import {publicationPlatforms,type PublicationPlatform} from '../types';
import {ACCOUNT_STATUSES,ACCOUNT_STATUS_LABELS,CONNECTION_PROVIDERS,PUBLISHABILITY_LABELS,PROVIDER_PLATFORMS,connectFirstMessage,connectionSummary,getChannelPublishability as computeChannelPublishability,PROVIDER_LABELS,
 isConnectionProvider,normalizeGbpAccounts,normalizeMetaAccounts,providerOfPlatform,syncPayload,
 type AccountOption,type AccountStatus,type ChannelAccountView,type ChannelPublishability,type ConnectionProvider,type ConnectionSummary,type ExternalPublicationAccount} from './model';
import {unconfiguredCredentialVault,isCredentialReference,type CredentialVault} from './vault';
import {ConnectionProviderError,type GoogleBusinessProfileConnectionProvider,type MetaConnectionProvider} from './providers';
import {oauthReadiness,productionOAuthDeps} from '../oauth/service';

// Publication connections services (Lot 4.3 P9). Admin only, fail closed, every write through the P9 RPCs.
// Nothing returned here ever contains a credential reference, a token, provider metadata or an external id.
// The client and the project are always resolved on the server; ids sent by a browser are never trusted.
export type ConnectionDeps={vault:CredentialVault;meta:MetaConnectionProvider|null;gbp:GoogleBusinessProfileConnectionProvider|null};
// P11-a: real encrypted vault and providers when the server configuration is complete; otherwise every piece stays
// unconfigured (fail closed: nothing can be connected, read or synced).
export function productionConnectionDeps():ConnectionDeps{
 const d=productionOAuthDeps();
 return {vault:d.vault??unconfiguredCredentialVault(),meta:d.meta?.provider??null,gbp:d.google?.provider??null};
}
export const OAUTH_PENDING_MESSAGE='Connexion OAuth non configurée sur le serveur.';
const unavailable='Connexions indisponibles.';
type Result={ok:boolean;message:string};
type ListedConnection={id:string;provider:string;status:string;connected_at:string|null;expires_at:string|null;has_credential:boolean;accounts:Record<string,unknown>};
// Whether each provider can be connected from this server (configuration complete). Booleans only, never values.
function readiness():Record<ConnectionProvider,boolean>{try{return oauthReadiness(productionOAuthDeps());}catch{return {meta:false,google_business_profile:false};}}
type ListedAccount={id:string;platform:string;display_name:string|null;status:string;enabled:boolean;connection_status:string;assignable:boolean};
const isPlatform=(v:unknown):v is PublicationPlatform=>typeof v==='string'&&(publicationPlatforms as readonly string[]).includes(v);
// Generic server log: operation and error kind only, never a provider message (it may echo a token).
const logFailure=(operation:string,error:unknown)=>console.error('[publications-connections]',{operation,kind:error instanceof ConnectionProviderError?error.kind:'internal'});

async function projectRef(projectId:unknown):Promise<{id:string;client_id:string}|null>{
 if(!isPublicationUuid(projectId))return null;
 const {data,error}=await getSupabaseServerClient().from('projects').select('id,client_id').eq('id',projectId).maybeSingle();
 if(error)throw Error(unavailable);return data;
}
async function listConnections(clientId:string):Promise<ListedConnection[]>{
 const {data,error}=await getSupabaseServerClient().rpc('publication_connections_list',{p_client_id:clientId});
 if(error||!Array.isArray(data))throw Error(unavailable);return data as unknown as ListedConnection[];
}
async function listAccounts(clientId:string):Promise<ListedAccount[]>{
 const {data,error}=await getSupabaseServerClient().rpc('publication_accounts_available',{p_client_id:clientId});
 if(error||!Array.isArray(data))throw Error(unavailable);return data as unknown as ListedAccount[];
}
const toOption=(a:ListedAccount):AccountOption[]=>isPlatform(a.platform)&&(ACCOUNT_STATUSES as readonly string[]).includes(a.status)&&typeof a.display_name==='string'&&isPublicationUuid(a.id)
 ?[{id:a.id,platform:a.platform,name:a.display_name,status:a.status as AccountStatus,statusLabel:ACCOUNT_STATUS_LABELS[a.status as AccountStatus],assignable:a.assignable===true}]:[];

export async function getClientConnections(clientId:string):Promise<ConnectionSummary[]>{
 await requireAdmin();if(!isPublicationUuid(clientId))throw Error(unavailable);
 const rows=await listConnections(clientId);
 return CONNECTION_PROVIDERS.map(p=>connectionSummary(p,rows.find(r=>r.provider===p)??null));
}
export async function getAvailablePublicationAccounts(clientId:string):Promise<AccountOption[]>{
 await requireAdmin();if(!isPublicationUuid(clientId))throw Error(unavailable);
 return (await listAccounts(clientId)).flatMap(toOption);
}

export type ProjectConnectionConfiguration={connections:ConnectionSummary[];channels:ChannelAccountView[];oauthMessage:string;oauthReady:Record<ConnectionProvider,boolean>};
// Everything the "Connexions" section and the per-channel account selectors display. Read only.
export async function getProjectConnectionConfiguration(projectId:string,now=new Date()):Promise<ProjectConnectionConfiguration>{
 await requireAdmin();const project=await projectRef(projectId);if(!project)throw Error(unavailable);
 const db=getSupabaseServerClient();
 const [connections,accounts,channels,settings,clientSettings]=await Promise.all([listConnections(project.client_id),listAccounts(project.client_id),
  db.from('publication_project_channels').select('platform,enabled,publication_account_id').eq('project_id',project.id).eq('client_id',project.client_id),
  db.from('publication_settings').select('emergency_stop,publishing_enabled').limit(1).maybeSingle(),
  db.from('publication_client_settings').select('publishing_enabled').eq('client_id',project.client_id).maybeSingle()]);
 if(channels.error||!channels.data||settings.error||clientSettings.error)throw Error(unavailable);
 // Accounts currently linked but outside the listing (legacy rows): status only, never their credential.
 const listedIds=new Set(accounts.map(a=>a.id));
 const missing=channels.data.flatMap(c=>c.publication_account_id&&!listedIds.has(c.publication_account_id)?[c.publication_account_id]:[]);
 const legacy=missing.length?await db.from('publication_accounts').select('id,platform,status,enabled,display_name').in('id',missing).eq('client_id',project.client_id):{data:[],error:null};
 if(legacy.error)throw Error(unavailable);
 const options=accounts.flatMap(toOption);
 const views=publicationPlatforms.map((platform):ChannelAccountView=>{
  const channel=channels.data.find(c=>c.platform===platform)??null,accountId=channel?.publication_account_id??null;
  const listed=accountId?accounts.find(a=>a.id===accountId)??null:null,old=accountId&&!listed?(legacy.data??[]).find(a=>a.id===accountId)??null:null;
  const provider=providerOfPlatform(platform),conn=connections.find(c=>c.provider===provider)??null;
  const publishability:ChannelPublishability=computeChannelPublishability({emergencyStop:settings.data?.emergency_stop!==false,publishingEnabled:settings.data?.publishing_enabled===true,
   clientPublishingEnabled:clientSettings.data?.publishing_enabled===true,platform,channel:channel?{enabled:channel.enabled,accountId}:null,
   account:listed?{status:listed.status,enabled:listed.enabled,platform:listed.platform,connectionBacked:true}:old?{status:old.status,enabled:old.enabled,platform:old.platform,connectionBacked:false}:null,
   connection:listed&&conn?{provider:conn.provider,status:conn.status,hasCredential:conn.has_credential===true,expiresAt:conn.expires_at}:null,now});
  const own=options.filter(o=>o.platform===platform);
  return {platform,platformLabel:platformLabels[platform],currentAccountId:accountId,
   currentLabel:listed?`${listed.display_name??'Compte'} — ${ACCOUNT_STATUS_LABELS[(listed.status as AccountStatus)]??listed.status}`:old?`${old.display_name??'Compte'} — ${ACCOUNT_STATUS_LABELS.legacy}`:null,
   options:own,emptyMessage:own.length||accountId?null:connectFirstMessage(platform),publishability,publishabilityLabel:PUBLISHABILITY_LABELS[publishability]};});
 return {connections:CONNECTION_PROVIDERS.map(p=>connectionSummary(p,connections.find(r=>r.provider===p)??null)),channels:views,oauthMessage:OAUTH_PENDING_MESSAGE,oauthReady:readiness()};
}
export async function getChannelPublishability(projectId:string,platform:PublicationPlatform):Promise<ChannelPublishability>{
 const configuration=await getProjectConnectionConfiguration(projectId);
 return configuration.channels.find(c=>c.platform===platform)?.publishability??'channel_disabled';
}

// Explicit (future) sync: secret read from the vault on the server, accounts listed by the provider, normalized,
// then ONE atomic RPC. Provider revocation / expiry is recorded on the connection. Unavailable in P9 production.
export async function syncPublicationAccounts(projectId:unknown,provider:unknown,deps:ConnectionDeps=productionConnectionDeps()):Promise<Result&{counts?:{inserted:number;updated:number;unavailable:number}}>{
 const {userId}=await requireAdmin();if(!isConnectionProvider(provider))return {ok:false,message:'Connexion invalide.'};
 const source=provider==='meta'?deps.meta:deps.gbp;if(!source)return {ok:false,message:OAUTH_PENDING_MESSAGE};
 try{
  const project=await projectRef(projectId);if(!project)return {ok:false,message:'Projet invalide.'};
  const db=getSupabaseServerClient();
  const row=await db.from('client_connections').select('id,status,credential_reference').eq('client_id',project.client_id).eq('provider',provider).maybeSingle();
  if(row.error)throw Error(unavailable);
  if(!row.data||row.data.status!=='active'||!isCredentialReference(row.data.credential_reference))return {ok:false,message:'Connexion inactive : reconnectez le compte.'};
  const credential=await deps.vault.readCredential(row.data.credential_reference);
  let accounts:ExternalPublicationAccount[];
  try{
   if(provider==='meta'){const meta=source as MetaConnectionProvider;accounts=normalizeMetaAccounts(await meta.listFacebookPages(credential),await meta.listInstagramAccounts(credential));}
   else{const gbp=source as GoogleBusinessProfileConnectionProvider;const locations=[];for(const a of await gbp.listAccounts(credential))locations.push(...await gbp.listLocations(credential,a.name));accounts=normalizeGbpAccounts(locations);}
  }catch(error){
   if(error instanceof ConnectionProviderError&&(error.kind==='revoked'||error.kind==='expired')){
    const marked=await db.rpc('publication_connection_set_status',{p_connection_id:row.data.id,p_status:error.kind,p_credential_reference:null,p_expires_at:null,p_actor_id:userId});
    if(marked.error)logFailure('mark_connection',null);
    return {ok:false,message:error.kind==='revoked'?'Accès révoqué par le fournisseur : reconnectez le compte.':'Connexion expirée : reconnectez le compte.'};}
   throw error;}
  if(accounts.some(a=>!PROVIDER_PLATFORMS[provider].includes(a.platform)))throw Error(unavailable);
  const synced=await db.rpc('publication_accounts_sync',{p_client_id:project.client_id,p_connection_id:row.data.id,p_accounts:syncPayload(accounts),p_actor_id:userId});
  if(synced.error||!synced.data)throw Error(unavailable);
  const r=synced.data as {inserted?:number;updated?:number;unavailable?:number};
  return {ok:true,message:`${accounts.length} compte(s) synchronisé(s).`,counts:{inserted:r.inserted??0,updated:r.updated??0,unavailable:r.unavailable??0}};
 }catch(error){logFailure('sync',error);return {ok:false,message:'Synchronisation impossible. Réessayez plus tard.'};}
}

export async function assignPublicationAccountToChannel(projectId:unknown,platform:unknown,accountId:unknown):Promise<Result>{
 const {userId}=await requireAdmin();
 if(!isPlatform(platform)||(accountId!==null&&!isPublicationUuid(accountId)))return {ok:false,message:'Compte invalide.'};
 try{
  const project=await projectRef(projectId);if(!project)return {ok:false,message:'Projet invalide.'};
  const {error}=await getSupabaseServerClient().rpc('publication_channel_assign_account',{p_project_id:project.id,p_platform:platform,p_account_id:accountId,p_actor_id:userId});
  if(error)return {ok:false,message:error.code==='23514'?'Ce compte ne peut pas être utilisé pour ce canal (client, plateforme ou statut).':'Compte non enregistré. Réessayez.'};
  return {ok:true,message:accountId?'Compte de publication enregistré.':'Compte de publication retiré.'};
 }catch(error){logFailure('assign',error);return {ok:false,message:unavailable};}
}

// Explicit disconnect. 1) RPC (connection disabled, reference cleared, accounts unavailable) 2) the previous
// reference, kept on the server only, is deleted from the vault. If the vault refuses, the connection stays
// disabled (never restored), a generic server log is written and the admin gets the same generic message.
export async function disconnectConnection(projectId:unknown,provider:unknown,deps:Pick<ConnectionDeps,'vault'>=productionConnectionDeps()):Promise<Result>{
 const {userId}=await requireAdmin();if(!isConnectionProvider(provider))return {ok:false,message:'Connexion invalide.'};
 try{
  const project=await projectRef(projectId);if(!project)return {ok:false,message:'Projet invalide.'};
  const connection=(await listConnections(project.client_id)).find(c=>c.provider===provider);
  if(!connection||!isPublicationUuid(connection.id))return {ok:false,message:'Aucune connexion à déconnecter.'};
  const {data,error}=await getSupabaseServerClient().rpc('publication_connection_disconnect',{p_client_id:project.client_id,p_connection_id:connection.id,p_actor_id:userId});
  if(error||!data)return {ok:false,message:'Déconnexion non confirmée. Réessayez.'};
  const previous=(data as {previous_reference?:unknown}).previous_reference;
  if(isCredentialReference(previous)){try{await deps.vault.deleteCredential(previous);}catch(e){logFailure('purge_credential',e);}}
  return {ok:true,message:`${PROVIDER_LABELS[provider]} déconnecté. Les comptes associés ne sont plus utilisables pour publier.`};
 }catch(error){logFailure('disconnect',error);return {ok:false,message:unavailable};}
}
