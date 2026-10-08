import 'server-only';
import {randomUUID} from 'node:crypto';

// Credential vault (Lot 4.3 P9). The business database only stores the opaque reference returned here
// (vault:connection/<random uuid>); the secret itself lives in the vault. Injectable: a future implementation
// can sit on Supabase Vault or another secret store. In P9 nothing is written remotely: production uses the
// unconfigured vault below (every operation refuses), tests use the deterministic in-memory fake (fakes.ts).
export type ProviderCredential={accessToken:string;refreshToken:string|null;expiresAt:string|null;scopes:string[]};
export interface CredentialVault{
 storeCredential(secret:ProviderCredential):Promise<string>;
 readCredential(reference:string):Promise<ProviderCredential>;
 // Stores the new secret under a NEW reference and deletes the previous one.
 rotateCredential(reference:string,secret:ProviderCredential):Promise<string>;
 deleteCredential(reference:string):Promise<void>;
}
export class CredentialVaultError extends Error{constructor(readonly kind:'unconfigured'|'invalid_reference'|'not_found'|'invalid_secret'){super(`Credential vault: ${kind}`);}}

const REFERENCE=/^vault:connection\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Same rule as publications_private.valid_credential_reference: fixed prefix + UUID, nothing else.
export function isCredentialReference(value:unknown):value is string{return typeof value==='string'&&REFERENCE.test(value);}
export function newCredentialReference(id:()=>string=randomUUID):string{const ref=`vault:connection/${id()}`;if(!isCredentialReference(ref))throw new CredentialVaultError('invalid_reference');return ref;}
const opaque=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length>=1&&v.length<=max&&/^[\x21-\x7e]+$/.test(v);
export function isProviderCredential(value:unknown):value is ProviderCredential{
 if(!value||typeof value!=='object')return false;const c=value as Record<string,unknown>;
 return opaque(c.accessToken,8192)&&(c.refreshToken===null||opaque(c.refreshToken,8192))&&(c.expiresAt===null||(typeof c.expiresAt==='string'&&!Number.isNaN(Date.parse(c.expiresAt))))
  &&Array.isArray(c.scopes)&&c.scopes.every(s=>typeof s==='string'&&s.length<=300);
}
// Production default for P9: no secret store is wired yet, so nothing can be stored or read (fail closed).
export function unconfiguredCredentialVault():CredentialVault{
 const refuse=async():Promise<never>=>{throw new CredentialVaultError('unconfigured');};
 return {storeCredential:refuse,readCredential:refuse,rotateCredential:refuse,deleteCredential:refuse};
}
