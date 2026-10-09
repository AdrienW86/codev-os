import 'server-only';
import type {ConnectionProvider} from '@/lib/publications/connections/model';

// Publication OAuth configuration (Lot 4.3 P11-a). Server-only environment, validated on use, fail closed: a
// missing or malformed value disables the provider (generic message in the UI, nothing logged but its name).
// No secret is NEXT_PUBLIC_*. Values are never returned to a component, logged or stored.
// Graph API v26.0 (released 2026-07-29; no change to the Pages / Instagram publishing / Login endpoints used here).
export const META_GRAPH_VERSION='v26.0';
// Official callback paths (the redirect URI is the configured base URL + this path, nothing else).
export const OAUTH_CALLBACK_PATHS:Record<ConnectionProvider,string>={meta:'/api/publications/oauth/meta/callback',google_business_profile:'/api/publications/oauth/google-business-profile/callback'};
// businessManagerRoles: the administrator's role on the client Pages comes from a Business Manager (business
// portfolio). Meta then also requires ads_management + ads_read for Instagram publishing (official content publishing
// guide). Off by default (minimum permissions); META_PAGE_ROLES_VIA_BUSINESS_MANAGER=true turns it on.
// loginConfigId: Facebook Login for Business configuration (Business-type app). When set, the login dialog uses
// config_id INSTEAD of scope (official FLfB docs: scope must not be used); the permissions are those of the
// configuration. Unset: classic Facebook Login with the scope list below.
export type MetaOAuthConfig={appId:string;appSecret:string;redirectUri:string;businessManagerRoles?:boolean;loginConfigId?:string|null};
export type GoogleOAuthConfig={clientId:string;clientSecret:string;redirectUri:string};
export type CredentialKey={id:string;key:Buffer};
export type CredentialKeyring={current:CredentialKey;previous:CredentialKey|null};
type Env=Record<string,string|undefined>;
const opaque=(v:unknown,min:number,max:number):v is string=>typeof v==='string'&&v.length>=min&&v.length<=max&&/^[\x21-\x7e]+$/.test(v);

// Base URL of the deployed cockpit: https only (http only for a loopback development host), no path, no query.
export function oauthBaseUrl(env:Env=process.env):string|null{
 const raw=env.PUBLICATIONS_OAUTH_BASE_URL;if(!raw)return null;
 let url:URL;try{url=new URL(raw);}catch{return null;}
 const loopback=url.hostname==='localhost'||url.hostname==='127.0.0.1';
 if(url.username||url.password||url.search||url.hash||(url.pathname!=='/'&&url.pathname!=='')||(url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback)))return null;
 return url.origin;
}
export function redirectUriFor(provider:ConnectionProvider,env:Env=process.env):string|null{const base=oauthBaseUrl(env);return base?base+OAUTH_CALLBACK_PATHS[provider]:null;}
export function metaOAuthConfig(env:Env=process.env):MetaOAuthConfig|null{
 const appId=env.META_APP_ID,appSecret=env.META_APP_SECRET,redirectUri=redirectUriFor('meta',env);
 if(!appId||!/^[0-9]{5,30}$/.test(appId)||!opaque(appSecret,16,200)||!redirectUri)return null;
 const roles=env.META_PAGE_ROLES_VIA_BUSINESS_MANAGER;if(roles!==undefined&&roles!==''&&roles!=='true'&&roles!=='false')return null;
 const configId=env.META_LOGIN_CONFIG_ID;if(configId!==undefined&&configId!==''&&!/^[0-9]{5,30}$/.test(configId))return null;
 return {appId,appSecret,redirectUri,businessManagerRoles:roles==='true',loginConfigId:configId?configId:null};
}
export function googleOAuthConfig(env:Env=process.env):GoogleOAuthConfig|null{
 const clientId=env.GOOGLE_BUSINESS_PROFILE_CLIENT_ID,clientSecret=env.GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET,redirectUri=redirectUriFor('google_business_profile',env);
 if(!opaque(clientId,20,300)||!clientId.endsWith('.apps.googleusercontent.com')||!opaque(clientSecret,10,200)||!redirectUri)return null;
 return {clientId,clientSecret,redirectUri};
}
// AES-256-GCM keys: 32 random bytes, base64. The key id is stored next to each ciphertext (rotation).
function key(raw:string|undefined,id:string|undefined):CredentialKey|null{
 if(!raw||!id||!/^[a-z0-9_-]{1,40}$/.test(id))return null;
 let bytes:Buffer;try{bytes=Buffer.from(raw,'base64');}catch{return null;}
 return bytes.length===32&&bytes.toString('base64').replace(/=+$/,'')===raw.trim().replace(/=+$/,'')?{id,key:bytes}:null;
}
export function credentialKeyring(env:Env=process.env):CredentialKeyring|null{
 const current=key(env.PUBLICATION_CREDENTIALS_KEY,env.PUBLICATION_CREDENTIALS_KEY_ID);if(!current)return null;
 const previous=env.PUBLICATION_CREDENTIALS_PREVIOUS_KEY?key(env.PUBLICATION_CREDENTIALS_PREVIOUS_KEY,env.PUBLICATION_CREDENTIALS_PREVIOUS_KEY_ID):null;
 if(env.PUBLICATION_CREDENTIALS_PREVIOUS_KEY&&!previous)return null;
 if(previous&&previous.id===current.id)return null;
 return {current,previous};
}
// Names only, for the configuration diagnostic (never values).
export function missingOAuthConfiguration(provider:ConnectionProvider,env:Env=process.env):string[]{
 const missing:string[]=[];
 if(!oauthBaseUrl(env))missing.push('PUBLICATIONS_OAUTH_BASE_URL');
 if(!credentialKeyring(env))missing.push('PUBLICATION_CREDENTIALS_KEY','PUBLICATION_CREDENTIALS_KEY_ID');
 if(provider==='meta'&&!metaOAuthConfig(env))missing.push('META_APP_ID','META_APP_SECRET');
 if(provider==='google_business_profile'&&!googleOAuthConfig(env))missing.push('GOOGLE_BUSINESS_PROFILE_CLIENT_ID','GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET');
 return [...new Set(missing)];
}
