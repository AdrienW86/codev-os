import 'server-only';
import {createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
import {CredentialVaultError,isCredentialReference,isProviderCredential,newCredentialReference,type CredentialVault,type ProviderCredential} from './vault';

// Real credential vault (Lot 4.3 P11-a): AES-256-GCM, one random 96-bit IV per secret, the reference and the
// provider bound as additional authenticated data (a ciphertext moved to another reference or read for another
// provider fails authentication). The key only exists in the server environment; the database (table
// publication_credential_secrets, server role only) never sees a plaintext or a key. Rows are immutable: a rotation
// stores a new reference and deletes the old one. Errors carry a kind only, never data.
export type CredentialProvider='meta'|'google_business_profile';
export type SecretRow={reference:string;provider:CredentialProvider;key_id:string;iv:Uint8Array;ciphertext:Uint8Array;auth_tag:Uint8Array};
export interface SecretStore{
 insert(row:SecretRow):Promise<void>;
 get(reference:string):Promise<SecretRow|null>;
 remove(reference:string):Promise<void>;
}
export type VaultKey={id:string;key:Uint8Array};
export type VaultKeyring={current:VaultKey;previous:VaultKey|null};
const aad=(reference:string,provider:CredentialProvider)=>Buffer.from(`codev:publication-credential:v1:${provider}:${reference}`,'utf8');

export function createEncryptedCredentialVault(store:SecretStore,keyring:VaultKeyring,ids:()=>string=randomUUID):CredentialVault{
 if(keyring.current.key.length!==32||(keyring.previous&&keyring.previous.key.length!==32))throw new CredentialVaultError('unconfigured');
 const keyFor=(id:string)=>id===keyring.current.id?keyring.current.key:keyring.previous&&id===keyring.previous.id?keyring.previous.key:null;
 const providerOf=(secret:ProviderCredential):CredentialProvider=>{if(secret.provider!=='meta'&&secret.provider!=='google_business_profile')throw new CredentialVaultError('invalid_secret');return secret.provider;};
 async function store_(secret:ProviderCredential):Promise<string>{
  if(!isProviderCredential(secret))throw new CredentialVaultError('invalid_secret');
  const provider=providerOf(secret),reference=newCredentialReference(ids),iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',keyring.current.key,iv);cipher.setAAD(aad(reference,provider));
  const plaintext=Buffer.from(JSON.stringify({accessToken:secret.accessToken,refreshToken:secret.refreshToken,expiresAt:secret.expiresAt,scopes:secret.scopes,provider,subject:secret.subject??null}),'utf8');
  const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);plaintext.fill(0);
  try{await store.insert({reference,provider,key_id:keyring.current.id,iv,ciphertext,auth_tag:cipher.getAuthTag()});}catch{throw new CredentialVaultError('unavailable');}
  return reference;
 }
 async function read(reference:string,expectedProvider?:CredentialProvider):Promise<ProviderCredential>{
  if(!isCredentialReference(reference))throw new CredentialVaultError('invalid_reference');
  let row:SecretRow|null;try{row=await store.get(reference);}catch{throw new CredentialVaultError('unavailable');}
  if(!row)throw new CredentialVaultError('not_found');
  if(expectedProvider&&row.provider!==expectedProvider)throw new CredentialVaultError('wrong_provider');
  const key=keyFor(row.key_id);if(!key)throw new CredentialVaultError('unconfigured');
  let value:unknown;
  try{const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(row.iv));decipher.setAAD(aad(reference,row.provider));decipher.setAuthTag(Buffer.from(row.auth_tag));
   const plain=Buffer.concat([decipher.update(Buffer.from(row.ciphertext)),decipher.final()]);value=JSON.parse(plain.toString('utf8'));plain.fill(0);}
  catch{throw new CredentialVaultError('corrupted');}
  if(!isProviderCredential(value)||value.provider!==row.provider)throw new CredentialVaultError('corrupted');
  return value;
 }
 return {
  storeCredential:store_,
  readCredential:read,
  async rotateCredential(reference,secret){await read(reference,providerOf(secret));const next=await store_(secret);
   try{await store.remove(reference);}catch{/* the new reference is the live one; the old row is removed at the next rotation / disconnect */}
   return next;},
  async deleteCredential(reference){if(!isCredentialReference(reference))throw new CredentialVaultError('invalid_reference');
   try{await store.remove(reference);}catch{throw new CredentialVaultError('unavailable');}},
 };
}
