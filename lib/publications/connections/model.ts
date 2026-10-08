// Publication connections (Lot 4.3 P9): providers, statuses, normalized external accounts and publishability.
// Pure and client-safe: no secret, no credential reference, no provider payload ever goes through these types.
import {platformLabels} from '../editor';
import type {PublicationPlatform} from '../types';

// One provider per OAuth grant: Meta covers Facebook pages and Instagram business accounts.
export const CONNECTION_PROVIDERS=['meta','google_business_profile'] as const;
export type ConnectionProvider=typeof CONNECTION_PROVIDERS[number];
export const CONNECTION_STATUSES=['pending','active','expired','revoked','error','disabled'] as const;
export type ConnectionStatus=typeof CONNECTION_STATUSES[number];
export const ACCOUNT_STATUSES=['active','unavailable','revoked','disabled'] as const;
export type AccountStatus=typeof ACCOUNT_STATUSES[number];
export const PROVIDER_PLATFORMS:Readonly<Record<ConnectionProvider,readonly PublicationPlatform[]>>={meta:['facebook','instagram'],google_business_profile:['google_business_profile']};
export const PROVIDER_LABELS:Record<ConnectionProvider,string>={meta:'Meta',google_business_profile:'Google Business Profile'};
export const CONNECTION_STATUS_LABELS:Record<ConnectionStatus|'none',string>={none:'Non connecté',pending:'En attente',active:'Connecté',expired:'Expiré',revoked:'Révoqué',error:'En erreur',disabled:'Déconnecté'};
export const ACCOUNT_STATUS_LABELS:Record<AccountStatus|'legacy',string>={active:'Actif',unavailable:'Indisponible',revoked:'Révoqué',disabled:'Désactivé',legacy:'Compte historique'};

export function isConnectionProvider(value:unknown):value is ConnectionProvider{return typeof value==='string'&&(CONNECTION_PROVIDERS as readonly string[]).includes(value);}
export function providerOfPlatform(platform:PublicationPlatform):ConnectionProvider{return platform==='google_business_profile'?'google_business_profile':'meta';}
export function connectFirstMessage(platform:PublicationPlatform):string{return `Connectez d’abord ${PROVIDER_LABELS[providerOfPlatform(platform)]}`;}

// Normalized account exposed by a provider. Only non-sensitive fields; anything else is dropped.
export type ExternalPublicationAccount={provider:ConnectionProvider;platform:PublicationPlatform;externalAccountId:string;displayName:string;parentExternalId:string|null;metadata:Record<string,string>};
const externalId=(v:unknown):v is string=>typeof v==='string'&&v.length>=1&&v.length<=300&&!/(:\/\/|[\s{}"])/.test(v);
const displayName=(v:unknown):string|null=>typeof v==='string'&&v.trim().length>=1&&v.trim().length<=200&&!/[\x00-\x1f]/.test(v)?v.trim():null;
export type MetaPage={id:string;name:string;category?:string|null};
export type MetaInstagramAccount={id:string;username:string|null;name:string|null;pageId:string};
export type GbpAccount={name:string;accountName:string|null};
export type GbpLocation={name:string;title:string|null;accountName:string};
// Facebook pages and Instagram business accounts (linked to their page). Page tokens are never kept.
export function normalizeMetaAccounts(pages:readonly MetaPage[],instagram:readonly MetaInstagramAccount[]):ExternalPublicationAccount[]{
 const result:ExternalPublicationAccount[]=[];
 for(const p of pages){const name=displayName(p?.name);if(externalId(p?.id)&&name)result.push({provider:'meta',platform:'facebook',externalAccountId:p.id,displayName:name,parentExternalId:null,metadata:{}});}
 for(const ig of instagram){const name=displayName(ig?.username?`@${ig.username}`:ig?.name);
  if(externalId(ig?.id)&&externalId(ig?.pageId)&&name)result.push({provider:'meta',platform:'instagram',externalAccountId:ig.id,displayName:name,parentExternalId:ig.pageId,metadata:{}});}
 return dedupe(result);
}
// Google Business Profile: one publishable account per location, attached to its business account.
export function normalizeGbpAccounts(locations:readonly GbpLocation[]):ExternalPublicationAccount[]{
 const result:ExternalPublicationAccount[]=[];
 for(const l of locations){const id=typeof l?.name==='string'&&typeof l?.accountName==='string'?`${l.accountName}/${l.name}`:null;const name=displayName(l?.title);
  if(externalId(id)&&externalId(l.accountName)&&name&&/^accounts\/[^/]+\/locations\/[^/]+$/.test(id))result.push({provider:'google_business_profile',platform:'google_business_profile',externalAccountId:id,displayName:name,parentExternalId:l.accountName,metadata:{}});}
 return dedupe(result);
}
function dedupe(accounts:ExternalPublicationAccount[]):ExternalPublicationAccount[]{const seen=new Set<string>();return accounts.filter(a=>{const k=`${a.platform}|${a.externalAccountId}`;if(seen.has(k))return false;seen.add(k);return true;});}
// Payload of publication_accounts_sync (exact keys expected by the RPC).
export function syncPayload(accounts:readonly ExternalPublicationAccount[]){
 return accounts.map(a=>({platform:a.platform,external_account_id:a.externalAccountId,display_name:a.displayName,parent_external_id:a.parentExternalId,metadata:{}}));
}

// Publishability of a project channel — same order as publications_private.channel_publishability (SQL).
export const PUBLISHABILITY_REASONS=['publishable','emergency_stop','publishing_disabled','channel_disabled','no_account','connection_inactive','account_inactive'] as const;
export type ChannelPublishability=typeof PUBLISHABILITY_REASONS[number];
export const PUBLISHABILITY_LABELS:Record<ChannelPublishability,string>={publishable:'Prêt pour la publication',emergency_stop:'Arrêt d’urgence actif',publishing_disabled:'Publication désactivée',
 channel_disabled:'Canal inactif',no_account:'Aucun compte de publication',connection_inactive:'Connexion inactive',account_inactive:'Compte inactif'};
export type PublishabilityInput={emergencyStop:boolean;publishingEnabled:boolean;clientPublishingEnabled:boolean;platform:PublicationPlatform;
 channel:{enabled:boolean;accountId:string|null}|null;account:{status:string;enabled:boolean;platform:string;connectionBacked:boolean}|null;
 connection:{provider:string;status:string;hasCredential:boolean;expiresAt:string|null}|null;now:Date};
export function getChannelPublishability(i:PublishabilityInput):ChannelPublishability{
 if(i.emergencyStop)return 'emergency_stop';
 if(!i.publishingEnabled||!i.clientPublishingEnabled)return 'publishing_disabled';
 if(!i.channel?.enabled)return 'channel_disabled';
 if(!i.channel.accountId)return 'no_account';
 const c=i.connection;
 if(!i.account?.connectionBacked||!c||c.status!=='active'||!c.hasCredential||(c.expiresAt!==null&&Date.parse(c.expiresAt)<=i.now.getTime())
  ||!isConnectionProvider(c.provider)||!PROVIDER_PLATFORMS[c.provider].includes(i.platform))return 'connection_inactive';
 if(i.account.status!=='active'||!i.account.enabled||i.account.platform!==i.platform)return 'account_inactive';
 return 'publishable';
}

// View models of the "Connexions" section and of the account selector of each channel card.
export type ConnectionSummary={provider:ConnectionProvider;label:string;status:ConnectionStatus|'none';statusLabel:string;connected:boolean;
 counts:{facebook:number;instagram:number;google_business_profile:number};canDisconnect:boolean;expiresLabel:string|null;connectedLabel:string|null};
export type AccountOption={id:string;platform:PublicationPlatform;name:string;status:AccountStatus;statusLabel:string;assignable:boolean};
export type ChannelAccountView={platform:PublicationPlatform;platformLabel:string;currentAccountId:string|null;currentLabel:string|null;options:AccountOption[];
 emptyMessage:string|null;publishability:ChannelPublishability;publishabilityLabel:string};
const day=new Intl.DateTimeFormat('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'Europe/Paris'});
export function connectionSummary(provider:ConnectionProvider,row:{status:string;has_credential?:boolean;expires_at?:string|null;connected_at?:string|null;accounts?:Record<string,unknown>}|null):ConnectionSummary{
 const status=row&&(CONNECTION_STATUSES as readonly string[]).includes(row.status)?row.status as ConnectionStatus:'none';
 const n=(k:string)=>{const v=row?.accounts?.[k];return typeof v==='number'&&Number.isInteger(v)&&v>=0?v:0;};
 return {provider,label:PROVIDER_LABELS[provider],status,statusLabel:CONNECTION_STATUS_LABELS[status],connected:status==='active',
  counts:{facebook:n('facebook'),instagram:n('instagram'),google_business_profile:n('google_business_profile')},canDisconnect:status!=='none'&&status!=='disabled',
  expiresLabel:status==='active'&&typeof row?.expires_at==='string'&&!Number.isNaN(Date.parse(row.expires_at))?`Expire le ${day.format(new Date(row.expires_at))}`:null,
  connectedLabel:status!=='none'&&typeof row?.connected_at==='string'&&!Number.isNaN(Date.parse(row.connected_at))?`Connecté le ${day.format(new Date(row.connected_at))}`:null};
}
export function accountOptionLabel(o:AccountOption):string{return `${o.name} — ${platformLabels[o.platform]} — ${o.statusLabel}`;}
