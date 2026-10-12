// Publication OAuth (Lot 4.3 P11-a): callback outcomes and their safe messages. Pure and client-safe: an outcome
// is a closed vocabulary carried in the internal redirect; no provider text, code or token ever reaches the UI.
import {PROVIDER_LABELS,isConnectionProvider,type ConnectionProvider} from '../connections/model';

export const OAUTH_OUTCOMES=['success','partial','refused','expired','inaccessible','unavailable','invalid'] as const;
export type OAuthOutcome=typeof OAUTH_OUTCOMES[number];
export function isOAuthOutcome(value:unknown):value is OAuthOutcome{return typeof value==='string'&&(OAUTH_OUTCOMES as readonly string[]).includes(value);}
export function oauthOutcomeMessage(provider:ConnectionProvider,outcome:OAuthOutcome):string{
 switch(outcome){
  case 'success':return `Connexion ${PROVIDER_LABELS[provider]} réussie`;
  case 'partial':return `Connexion ${PROVIDER_LABELS[provider]} établie, mais les comptes n’ont pas pu être synchronisés. Utilisez « Vérifier la connexion ».`;
  case 'refused':return 'Connexion refusée';
  case 'expired':return 'Autorisation expirée';
  case 'inaccessible':return 'Compte inaccessible';
  case 'invalid':return 'Lien de connexion invalide ou déjà utilisé';
  default:return 'Connexion impossible pour le moment';
 }
}
// Banner of the configuration page from the callback redirect (?oauth=…&provider=…); anything else is ignored.
export function oauthBanner(params:{oauth?:unknown;provider?:unknown}):{ok:boolean;message:string}|null{
 if(!isOAuthOutcome(params.oauth)||!isConnectionProvider(params.provider))return null;
 return {ok:params.oauth==='success',message:oauthOutcomeMessage(params.provider,params.oauth)};
}
// Internal path the callback redirects to: the project configuration tab, or the projects list. Never external.
// Socle lot 1: when the connection was started from the client page, the callback returns to its « Publications »
// tab instead (client and project taken from the consumed state, never from the request).
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const OAUTH_VIEW_COOKIE='publications_oauth_view';
export type OAuthReturnView='project'|'client';
export function oauthReturnPath(projectId:string|null,provider:ConnectionProvider,outcome:OAuthOutcome,client:{view:OAuthReturnView;clientId:string|null}={view:'project',clientId:null}):string{
 const project=projectId&&UUID.test(projectId)?projectId:null;
 if(client.view==='client'&&client.clientId&&UUID.test(client.clientId))return `/clients/${client.clientId}?tab=publications${project?`&project=${project}`:''}&oauth=${outcome}&provider=${provider}`;
 const base=project?`/projects/${project}/configuration`:'/projects';
 return `${base}?oauth=${outcome}&provider=${provider}`;
}
