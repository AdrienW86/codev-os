import 'server-only';
import {CredentialVaultError,isCredentialReference,isProviderCredential,newCredentialReference,type CredentialVault,type ProviderCredential} from './vault';
import {ConnectionProviderError,type GoogleBusinessProfileConnectionProvider,type MetaConnectionProvider} from './providers';
import type {GbpAccount,GbpLocation,MetaInstagramAccount,MetaPage} from './model';

// TEST / LOCAL DEVELOPMENT ONLY (Lot 4.3 P9). Deterministic doubles of the vault and of the two providers.
// Never imported by an application module (asserted by the tests): production has no fake connection.
export function createMemoryCredentialVault(ids:()=>string=sequence()):CredentialVault&{size():number}{
 const store=new Map<string,ProviderCredential>();
 const read=(reference:string)=>{if(!isCredentialReference(reference))throw new CredentialVaultError('invalid_reference');const s=store.get(reference);if(!s)throw new CredentialVaultError('not_found');return s;};
 const put=(secret:ProviderCredential)=>{if(!isProviderCredential(secret))throw new CredentialVaultError('invalid_secret');const ref=newCredentialReference(ids);store.set(ref,{...secret,scopes:[...secret.scopes]});return ref;};
 return {
  async storeCredential(secret){return put(secret);},
  async readCredential(reference){const s=read(reference);return {...s,scopes:[...s.scopes]};},
  async rotateCredential(reference,secret){read(reference);const ref=put(secret);store.delete(reference);return ref;},
  async deleteCredential(reference){read(reference);store.delete(reference);},
  size:()=>store.size};
}
// Deterministic UUID sequence (00000000-0000-4000-8000-000000000001, …).
export function sequence():()=>string{let n=0;return ()=>`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`;}

export type FakeProviderState='active'|'expired'|'revoked';
const guard=(state:()=>FakeProviderState)=>{const s=state();if(s!=='active')throw new ConnectionProviderError(s);};
const credential=(n:number):ProviderCredential=>({accessToken:`fake-access-${n}`,refreshToken:`fake-refresh-${n}`,expiresAt:'2030-01-01T00:00:00.000Z',scopes:['fake']});
export function createFakeMetaProvider(data:{pages:MetaPage[];instagram:MetaInstagramAccount[]},state:()=>FakeProviderState=()=>'active'):MetaConnectionProvider&{calls:string[]}{
 const calls:string[]=[];let n=0;
 return {calls,
  async exchangeCode(){calls.push('exchangeCode');guard(state);return credential(++n);},
  async refresh(){calls.push('refresh');guard(state);return credential(++n);},
  async validateConnection(){calls.push('validateConnection');const s=state();return {status:s,externalIdentity:s==='active'?'fake-meta-user':null};},
  async listFacebookPages(){calls.push('listFacebookPages');guard(state);return data.pages.map(p=>({...p}));},
  async listInstagramAccounts(){calls.push('listInstagramAccounts');guard(state);return data.instagram.map(i=>({...i}));}};
}
export function createFakeGbpProvider(data:{accounts:GbpAccount[];locations:Record<string,Omit<GbpLocation,'accountName'>[]>},state:()=>FakeProviderState=()=>'active'):GoogleBusinessProfileConnectionProvider&{calls:string[]}{
 const calls:string[]=[];let n=0;
 return {calls,
  async exchangeCode(){calls.push('exchangeCode');guard(state);return credential(++n);},
  async refresh(){calls.push('refresh');guard(state);return credential(++n);},
  async validateConnection(){calls.push('validateConnection');return {status:state(),externalIdentity:null};},
  async listAccounts(){calls.push('listAccounts');guard(state);return data.accounts.map(a=>({...a}));},
  async listLocations(_c,accountName){calls.push('listLocations');guard(state);return (data.locations[accountName]??[]).map(l=>({...l,accountName}));}};
}
