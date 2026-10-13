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
import {publicationPlatforms,type PublicationPlatform} from '../types';

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
// maxLateSeconds: scheduler path only (never more late than the tolerance, see processScheduledDuePublications).
export async function runOnePublicationJobInProduction(workerId:string,options:{maxLateSeconds?:number;platforms?:readonly PublicationPlatform[]}={}):Promise<ExecutionResult>{
 const deps=productionOAuthDeps();if(!deps.vault)return {state:'idle'};
 return runOnePublicationJob(workerId,{db:getSupabaseServerClient() as unknown as EngineDb,vault:deps.vault,publisher:registryPublisher(productionPublisherRegistry().publishers),leaseSeconds:PRODUCTION_LEASE_SECONDS,...options});
}

// Explicit admin trigger (Lot 4.3 P13): send the deliveries that are due now — prepared after the manual approval,
// scheduled time reached — at most MAX_DUE_PER_RUN per click. No cron, no daemon: one click = a bounded number of
// single-job runs of the P10 engine. Fail closed: the kill switches are read first and nothing is claimed while the
// emergency stop is active or publishing is disabled; the engine re-checks every switch and the readiness anyway.
export const MAX_DUE_PER_RUN=5;
type SettingsDb={from(table:string):{select(columns:string):{limit(n:number):{maybeSingle():PromiseLike<{data:unknown;error:unknown}>}}}};
export type DueRunOptions={platforms?:readonly PublicationPlatform[]};
export type DueRunDeps={db:SettingsDb;run:(workerId:string,options?:DueRunOptions)=>Promise<ExecutionResult>};
export type DueRunSummary={ok:boolean;message:string;counts:{published:number;failed:number;uncertain:number;blocked:number;retry:number}};
export async function processDuePublications(deps:DueRunDeps={db:getSupabaseServerClient() as unknown as SettingsDb,run:runOnePublicationJobInProduction}):Promise<DueRunSummary>{
 const {userId}=await requireAdmin();
 return processDue('cockpit-'+userId.replace(/[^a-zA-Z0-9_]/g,'').slice(0,60),deps);
}
// Diffusion à l'heure prévue par le planificateur (socle lot 6). Désactivée tant que PUBLICATIONS_SCHEDULED_DELIVERY
// ne vaut pas exactement « enabled » ; ensuite mêmes garde-fous que le bouton : arrêt d'urgence levé, publication
// activée, et le moteur re-vérifie chaque interrupteur, l'approbation humaine et la disponibilité du canal.
// Un seul envoi par passage : le pire cas Instagram (~290 s) tient dans la durée maximale du tick (300 s).
// Jamais d'envoi planifié plus de SCHEDULED_LATE_TOLERANCE_SECONDS après l'heure due (cron ou drapeau revenu après
// une coupure) : la tâche est bloquée en base (motif late_schedule, notifiée), un humain décide de la relancer.
export const MAX_SCHEDULED_DUE_PER_TICK=1;
export const SCHEDULED_LATE_TOLERANCE_SECONDS=2*3600;
// Capacité (#47) : avec une cadence de 15 min et un seul envoi par passage, au plus 8 diffusions dues au même créneau
// partaient dans la tolérance de 2 h ; les suivantes étaient bloquées « en retard ». Quand l'appelant donne l'échéance du
// passage, le premier envoi reste libre (comme avant) et les suivants ne réservent que les plateformes dont le pire cas
// tient dans le temps restant (délais des transports : 20 s par requête Meta / GBP, 15 s par renouvellement OAuth, marge
// pour le contexte, le coffre et les URL signées). Instagram (~290 s) n'est donc jamais qu'un premier envoi. Plafond fixe.
export const SEND_BUDGET_MS:Readonly<Record<PublicationPlatform,number>>={facebook:60_000,google_business_profile:60_000,instagram:300_000};
export const MAX_SCHEDULED_DUE_WITH_DEADLINE=10;
export type ScheduledDueOptions={deadline?:number;clock?:()=>number};
export const SCHEDULED_DELIVERY_FLAG='PUBLICATIONS_SCHEDULED_DELIVERY';
// L'environnement est lu par l'appelant (route du planificateur), jamais dans lib/publications.
export function scheduledDeliveryEnabled(env:Record<string,string|undefined>):boolean{return env[SCHEDULED_DELIVERY_FLAG]==='enabled';}
const scheduledRun=(workerId:string,options:DueRunOptions={})=>runOnePublicationJobInProduction(workerId,{maxLateSeconds:SCHEDULED_LATE_TOLERANCE_SECONDS,...options});
export async function processScheduledDuePublications(env:Record<string,string|undefined>,deps:DueRunDeps={db:getSupabaseServerClient() as unknown as SettingsDb,run:scheduledRun},options:ScheduledDueOptions={}):Promise<DueRunSummary|{disabled:true}>{
 if(!scheduledDeliveryEnabled(env))return {disabled:true};
 const deadline=options.deadline;
 if(deadline===undefined||!Number.isFinite(deadline))return processDue('scheduler',deps,MAX_SCHEDULED_DUE_PER_TICK);
 const clock=options.clock??Date.now;
 return processDue('scheduler',deps,MAX_SCHEDULED_DUE_WITH_DEADLINE,i=>i===0?undefined:publicationPlatforms.filter(p=>SEND_BUDGET_MS[p]<=deadline-clock()));
}
// platformsFor (planificateur avec échéance) : plateformes permises pour le i-ème envoi ; liste vide → fin du passage.
async function processDue(worker:string,deps:DueRunDeps,max=MAX_DUE_PER_RUN,platformsFor?:(i:number)=>readonly PublicationPlatform[]|undefined):Promise<DueRunSummary>{
 const counts={published:0,failed:0,uncertain:0,blocked:0,retry:0};
 const settings=await deps.db.from('publication_settings').select('emergency_stop,publishing_enabled').limit(1).maybeSingle();
 const s=settings.data as {emergency_stop?:unknown;publishing_enabled?:unknown}|null;
 if(settings.error||!s)return {ok:false,message:'Réglages de publication illisibles : aucun envoi.',counts};
 if(s.emergency_stop!==false)return {ok:false,message:'Arrêt d’urgence actif : aucun envoi.',counts};
 if(s.publishing_enabled!==true)return {ok:false,message:'Publication désactivée dans les réglages : aucun envoi.',counts};
 let processed=0;
 for(let i=0;i<max;i++){
  const platforms=platformsFor?.(i);if(platforms&&!platforms.length)break;
  let r:ExecutionResult;try{r=await (platforms?deps.run(worker,{platforms}):deps.run(worker));}catch{log('process_due');break;}
  if(r.state==='idle')break;processed++;
  if(r.state==='completed'){const o=r.outcome;
   if(o==='published'||o==='simulated')counts.published++;else if(o==='uncertain')counts.uncertain++;
   else if(o==='retryable'||o==='rate_limit'||o==='provider_unavailable')counts.retry++;else if(o==='auth')counts.blocked++;else counts.failed++;}
  else if(r.state==='blocked')counts.blocked++;else if(r.state==='unconfirmed')counts.uncertain++;else counts.failed++;
  // Planificateur avec échéance : une réservation refusée par la base (« stale ») arrête le passage, sans insister.
  if(platformsFor&&r.state==='stale')break;
 }
 if(!processed)return {ok:true,message:'Aucune publication due pour le moment.',counts};
 return {ok:true,counts,message:`${processed} envoi(s) traité(s) : ${counts.published} publié(s), ${counts.retry} à réessayer, ${counts.blocked} bloqué(s), ${counts.failed} en échec, ${counts.uncertain} à vérifier.`};
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
