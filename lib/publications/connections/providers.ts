import 'server-only';
import type {ProviderCredential} from './vault';
import type {GbpAccount,GbpLocation,MetaInstagramAccount,MetaPage} from './model';

// Provider contracts (Lot 4.3 P9). No network code here and no real implementation is wired in P9: providers
// are injected (deterministic fakes in tests). A real provider must only be built on an explicit server-side
// transport (meta.ts / google-business-profile.ts) once OAuth is configured. Errors never carry provider text.
export class ConnectionProviderError extends Error{constructor(readonly kind:'revoked'|'expired'|'invalid'|'unavailable'){super(`Connection provider: ${kind}`);}}
export type ConnectionValidation={status:'active'|'expired'|'revoked';externalIdentity:string|null};
export interface MetaConnectionProvider{
 exchangeCode(code:string,redirectUri:string):Promise<ProviderCredential>;
 refresh(credential:ProviderCredential):Promise<ProviderCredential>;
 validateConnection(credential:ProviderCredential):Promise<ConnectionValidation>;
 listFacebookPages(credential:ProviderCredential):Promise<MetaPage[]>;
 listInstagramAccounts(credential:ProviderCredential):Promise<MetaInstagramAccount[]>;
}
export interface GoogleBusinessProfileConnectionProvider{
 exchangeCode(code:string,redirectUri:string):Promise<ProviderCredential>;
 refresh(credential:ProviderCredential):Promise<ProviderCredential>;
 validateConnection(credential:ProviderCredential):Promise<ConnectionValidation>;
 listAccounts(credential:ProviderCredential):Promise<GbpAccount[]>;
 listLocations(credential:ProviderCredential,accountName:string):Promise<GbpLocation[]>;
}
// Server-side HTTP transport a real provider is built on (not implemented in P9: no OAuth configured yet).
// Returns the HTTP status and the parsed JSON body; never logs the request (it carries the access token).
export type ProviderRequest={operation:'token'|'read';path:string;params:Record<string,string>;credential?:ProviderCredential};
export interface ProviderTransport{request(request:ProviderRequest):Promise<{status:number;body:unknown}>}
