import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {googleOAuthConfig,metaOAuthConfig} from '@/lib/integrations/publications-oauth/config';
import {googleTransport} from '@/lib/integrations/publications-oauth/http';
import {metaPublishTransport} from '@/lib/integrations/publications-meta-publish';
import {gbpPublishTransport} from '@/lib/integrations/publications-gbp-publish';
import {isPublicationUuid} from '../validation';
import {isCredentialReference,type CredentialVault} from '../connections/vault';
import {productionOAuthDeps} from '../oauth/service';
import {createGoogleBusinessProfileConnectionProvider} from '../connections/google-business-profile';
import {createMetaPublisher,createMetaReconciler} from './meta-publisher';
import {createGoogleBusinessProfilePublisher,createGoogleBusinessProfileReconciler} from './gbp-publisher';
import {runOnePublicationJob,type EngineDb,type ExecutionResult} from './engine';
import type {PublicationPublisher,PublicationReconciler,PublishResult,ReconcileResult} from './publisher';
import type {PublicationPlatform} from '../types';

// Server-side publisher registry (Lot 4.3 P11-b). One publisher per platform; a platform whose provider is not
// configured answers "auth / provider_not_configured" (no side effect, delivery blocked). Nothing here is wired to a
// route, a button, a cron or a daemon: runOnePublicationJobInProduction is the single entry point a future worker
// may call explicitly. The P10 engine re-checks the kill switches, the readiness and the dispatch marker anyway.
export type PublisherRegistry=Partial<Record<PublicationPlatform,PublicationPublisher>>;
export type ReconcilerRegistry=Partial<Record<PublicationPlatform,PublicationReconciler>>;
const notConfigured:PublishResult={ok:false,errorClass:'auth',errorCode:'provider_not_configured'};
export function registryPublisher(registry:PublisherRegistry):PublicationPublisher{
 return {async publish(input){const p=registry[input.platform];return p?p.publish(input):notConfigured;}};
}
// Meta when its app is configured (P11-b); Google Business Profile when its OAuth client is configured (P12: the
// expired access token is refreshed in memory through the read-only OAuth transport, never stored again).
export function productionPublisherRegistry():{publishers:PublisherRegistry;reconcilers:ReconcilerRegistry}{
 const publishers:PublisherRegistry={},reconcilers:ReconcilerRegistry={};
 const meta=metaOAuthConfig();
 if(meta){const transport=metaPublishTransport(meta);const publisher=createMetaPublisher(transport),reconciler=createMetaReconciler(transport);
  Object.assign(publishers,{facebook:publisher,instagram:publisher});Object.assign(reconcilers,{facebook:reconciler,instagram:reconciler});}
 const google=googleOAuthConfig();
 if(google){const transport=gbpPublishTransport(),provider=createGoogleBusinessProfileConnectionProvider(googleTransport(google));
  const refresh=(credential:Parameters<typeof provider.refresh>[0])=>provider.refresh(credential);
  publishers.google_business_profile=createGoogleBusinessProfilePublisher(transport,{refresh});
  reconcilers.google_business_profile=createGoogleBusinessProfileReconciler(transport,{refresh});}
 return {publishers,reconcilers};
}
// Lease of a production job: the completion is refused once the lease is over (the delivery then becomes uncertain),
// so it must outlast the slowest provider call. Worst case today: Instagram = Page token + container + 10 status
// checks (20 s timeout each) + 9 waits of 3 s + media_publish ≈ 290 s. 600 s keeps a margin (bound: 900 s).
export const PRODUCTION_LEASE_SECONDS=600;
// Explicit, single-job execution for a future worker. Fail closed: no vault → nothing runs.
export async function runOnePublicationJobInProduction(workerId:string):Promise<ExecutionResult>{
 const deps=productionOAuthDeps();if(!deps.vault)return {state:'idle'};
 return runOnePublicationJob(workerId,{db:getSupabaseServerClient() as unknown as EngineDb,vault:deps.vault,publisher:registryPublisher(productionPublisherRegistry().publishers),leaseSeconds:PRODUCTION_LEASE_SECONDS});
}

// Reconciliation of an uncertain delivery (admin action). The provider is only READ; the outcome is recorded by
// RPC: exists → published (provider id), missing / unknown → stays uncertain (no automatic resend).
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string;message?:string}|null}>;
export type ReconcileDeps={db:{rpc:Rpc;from(table:string):{select(columns:string):{eq(column:string,value:string):{maybeSingle():PromiseLike<{data:unknown;error:unknown}>}}}};
 vault:CredentialVault|null;reconcilers:ReconcilerRegistry};
export function productionReconcileDeps():ReconcileDeps{
 return {db:getSupabaseServerClient() as unknown as ReconcileDeps['db'],vault:productionOAuthDeps().vault,reconcilers:productionPublisherRegistry().reconcilers};
}
const log=(step:string)=>console.error('[publications-reconcile]',{step});
export async function reconcileDelivery(deliveryId:unknown,deps:ReconcileDeps=productionReconcileDeps()):Promise<{ok:boolean;message:string;result?:ReconcileResult['status']}>{
 const {userId}=await requireAdmin();if(!isPublicationUuid(deliveryId))return {ok:false,message:'Diffusion invalide.'};
 try{
  const ctx=await deps.db.rpc('publication_delivery_reconcile_context',{p_delivery_id:deliveryId});
  if(ctx.error||!ctx.data)return {ok:false,message:'Cette diffusion n’est pas à vérifier.'};
  const c=ctx.data as {platform:PublicationPlatform;remote_id:string|null;connection_id:string|null;account:{external_account_id:string;parent_external_id:string|null};text:string;since:string|null};
  const reconciler=deps.reconcilers[c.platform];
  if(!reconciler||!deps.vault||!c.connection_id)return {ok:false,message:'Vérification indisponible pour ce compte.'};
  const row=await deps.db.from('client_connections').select('credential_reference,status').eq('id',c.connection_id).maybeSingle();
  const ref=(row.data as {credential_reference?:unknown}|null)?.credential_reference;
  if(row.error||!isCredentialReference(ref))return {ok:false,message:'Connexion inactive : reconnectez le compte.'};
  const credential=await deps.vault.readCredential(ref);
  const r=await reconciler.reconcile({platform:c.platform,remoteId:c.remote_id,idempotencyKey:'',credential,
   account:{externalAccountId:c.account.external_account_id,parentExternalId:c.account.parent_external_id},text:c.text,since:c.since});
  const saved=await deps.db.rpc('publication_delivery_reconcile',{p_delivery_id:deliveryId,p_status:r.status,p_remote_id:r.status==='exists'?r.remoteId:null,p_actor_id:userId});
  if(saved.error)return {ok:false,message:'Vérification non enregistrée. Réessayez.'};
  return {ok:true,result:r.status,message:r.status==='exists'?'Publication retrouvée chez le fournisseur : diffusion marquée publiée.'
   :r.status==='missing'?'Aucune publication trouvée. Vous pouvez confirmer qu’elle n’a pas été publiée.':'Impossible de conclure : la diffusion reste à vérifier.'};
 }catch{log('reconcile');return {ok:false,message:'Vérification impossible pour le moment.'};}
}
export async function confirmDeliveryNotPublished(deliveryId:unknown,deps:Pick<ReconcileDeps,'db'>=productionReconcileDeps()):Promise<{ok:boolean;message:string}>{
 const {userId}=await requireAdmin();if(!isPublicationUuid(deliveryId))return {ok:false,message:'Diffusion invalide.'};
 const r=await deps.db.rpc('publication_delivery_confirm_not_published',{p_delivery_id:deliveryId,p_actor_id:userId});
 if(r.error)return {ok:false,message:/reconcile first/i.test(r.error.message??'')?'Vérifiez d’abord chez le fournisseur.':'Décision non enregistrée.'};
 return {ok:true,message:'Diffusion marquée non publiée : vous pouvez la réessayer.'};
}
