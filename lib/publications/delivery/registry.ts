import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {isAuthorizedAdmin} from '@/lib/admin-policy';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {googleOAuthConfig,metaOAuthConfig,oauthBaseUrl,tiktokOAuthConfig} from '@/lib/integrations/publications-oauth/config';
import {googleTransport,tiktokTransport} from '@/lib/integrations/publications-oauth/http';
import {tiktokPublishTransport} from '@/lib/integrations/publications-tiktok-publish';
import {createTikTokConnectionProvider} from '../connections/tiktok';
import {createTikTokPublisher,createTikTokReconciler} from './tiktok-publisher';
import {publicMediaLink} from '@/lib/integrations/publications-media-link';
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
import {providerOfPlatform} from '../connections/model';

// Server-side publisher registry (Lot 4.3 P11-b). One publisher per platform; a platform whose provider is not
// configured answers "auth / provider_not_configured" (no side effect, delivery blocked). The existing explicit
// admin button and scheduler reuse runOnePublicationJobInProduction; scheduled delivery additionally requires
// PUBLICATIONS_SCHEDULED_DELIVERY=enabled (off by default). The engine re-checks every switch and dispatch marker.
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
 // TikTok : images servies par CODE-V OS (domaine vérifié), jeton rafraîchi en mémoire comme pour Google.
 const tiktok=tiktokOAuthConfig(),base=oauthBaseUrl();
 if(tiktok&&base){const provider=createTikTokConnectionProvider(tiktokTransport(tiktok));
  publishers.tiktok=createTikTokPublisher(tiktokPublishTransport(),{refresh:credential=>provider.refresh(credential),mediaLink:url=>publicMediaLink(url,base)});
  reconcilers.tiktok=createTikTokReconciler();}
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
export type DueRunSummary={ok:boolean;message:string;counts:{published:number;simulated:number;failed:number;uncertain:number;blocked:number;retry:number};reconciled?:AutoReconcileSummary};
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
export const SEND_BUDGET_MS:Readonly<Record<PublicationPlatform,number>>={facebook:60_000,google_business_profile:60_000,instagram:300_000,tiktok:120_000};
export const MAX_SCHEDULED_DUE_WITH_DEADLINE=10;
// reconcile : vérification automatique des posts Google « en cours de relecture » (voir reconcilePendingGoogleDeliveries).
// Par défaut, uniquement sur le chemin de production (deps non fournies) ; jamais d'envoi, seulement une lecture.
export type ScheduledDueOptions={deadline?:number;clock?:()=>number;reconcile?:()=>Promise<AutoReconcileSummary>};
export const SCHEDULED_DELIVERY_FLAG='PUBLICATIONS_SCHEDULED_DELIVERY';
// L'environnement est lu par l'appelant (route du planificateur), jamais dans lib/publications.
export function scheduledDeliveryEnabled(env:Record<string,string|undefined>):boolean{return env[SCHEDULED_DELIVERY_FLAG]==='enabled';}
const scheduledRun=(workerId:string,options:DueRunOptions={})=>runOnePublicationJobInProduction(workerId,{maxLateSeconds:SCHEDULED_LATE_TOLERANCE_SECONDS,...options});
export async function processScheduledDuePublications(env:Record<string,string|undefined>,deps?:DueRunDeps,options:ScheduledDueOptions={}):Promise<DueRunSummary|{disabled:true}>{
 if(!scheduledDeliveryEnabled(env))return {disabled:true};
 const reconcile=options.reconcile??(deps?undefined:()=>reconcilePendingGoogleDeliveries());
 const run=deps??{db:getSupabaseServerClient() as unknown as SettingsDb,run:scheduledRun};
 const deadline=options.deadline,clock=options.clock??Date.now;
 const summary=deadline===undefined||!Number.isFinite(deadline)?await processDue('scheduler',run,MAX_SCHEDULED_DUE_PER_TICK)
  :await processDue('scheduler',run,MAX_SCHEDULED_DUE_WITH_DEADLINE,i=>i===0?undefined:publicationPlatforms.filter(p=>SEND_BUDGET_MS[p]<=deadline-clock()));
 // Après les envois, et seulement s'il reste le temps de son pire cas : un échec de vérification ne change rien aux envois.
 if(!reconcile||(deadline!==undefined&&Number.isFinite(deadline)&&deadline-clock()<AUTO_RECONCILE_BUDGET_MS))return summary;
 try{const r=await reconcile();return r.checked?{...summary,reconciled:r}:summary;}catch{log('auto_reconcile');return summary;}
}
// platformsFor (planificateur avec échéance) : plateformes permises pour le i-ème envoi ; liste vide → fin du passage.
async function processDue(worker:string,deps:DueRunDeps,max=MAX_DUE_PER_RUN,platformsFor?:(i:number)=>readonly PublicationPlatform[]|undefined):Promise<DueRunSummary>{
 const counts={published:0,simulated:0,failed:0,uncertain:0,blocked:0,retry:0};
 let settings;
 try{settings=await deps.db.from('publication_settings').select('emergency_stop,publishing_enabled').limit(1).maybeSingle();}
 catch{return {ok:false,message:'Réglages de publication illisibles : aucun envoi.',counts};}
 const s=settings.data as {emergency_stop?:unknown;publishing_enabled?:unknown}|null;
 if(settings.error||!s)return {ok:false,message:'Réglages de publication illisibles : aucun envoi.',counts};
 if(s.emergency_stop!==false)return {ok:false,message:'Arrêt d’urgence actif : aucun envoi.',counts};
 if(s.publishing_enabled!==true)return {ok:false,message:'Publication désactivée dans les réglages : aucun envoi.',counts};
 let processed=0,interrupted=false;
 for(let i=0;i<max;i++){
  const platforms=platformsFor?.(i);if(platforms&&!platforms.length)break;
  let r:ExecutionResult;try{r=await (platforms?deps.run(worker,{platforms}):deps.run(worker));}catch{log('process_due');interrupted=true;break;}
  if(r.state==='idle')break;processed++;
  if(r.state==='completed'){const o=r.outcome;
   if(o==='published')counts.published++;else if(o==='simulated')counts.simulated++;else if(o==='uncertain')counts.uncertain++;
   else if(o==='retryable'||o==='rate_limit'||o==='provider_unavailable')counts.retry++;else if(o==='auth')counts.blocked++;else counts.failed++;}
  else if(r.state==='blocked')counts.blocked++;else if(r.state==='unconfirmed')counts.uncertain++;else counts.failed++;
  // Planificateur avec échéance : une réservation refusée par la base (« stale ») arrête le passage, sans insister.
  if(platformsFor&&r.state==='stale')break;
 }
 if(interrupted)return {ok:false,message:'Traitement interrompu : résultat non confirmé. Consultez les diffusions avant toute nouvelle tentative.',counts};
 if(!processed)return {ok:true,message:'Aucune publication due pour le moment.',counts};
 return {ok:true,counts,message:`${processed} envoi(s) traité(s) : ${counts.published} publié(s)${counts.simulated?`, ${counts.simulated} simulé(s)`:''}, ${counts.retry} à réessayer, ${counts.blocked} bloqué(s), ${counts.failed} en échec, ${counts.uncertain} à vérifier.`};
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
const checkedReconciliationUnavailable=(error:{code?:string}|null)=>Boolean(error&&['PGRST202','42883','42501'].includes(error.code??''));
const checkedReconciliationRequired='Mise à jour Publications requise en base : vérification sécurisée indisponible. Aucun renvoi autorisé.';
export async function reconcileDelivery(deliveryId:unknown,deps:ReconcileDeps=productionReconcileDeps()):Promise<{ok:boolean;message:string;result?:ReconcileResult['status']}>{
 const {userId}=await requireAdmin();if(!isPublicationUuid(deliveryId))return {ok:false,message:'Diffusion invalide.'};
 return reconcileAs(userId,deliveryId,deps);
}
// recordOnlyExists (vérification automatique) : seul « retrouvée » est enregistré ; sinon rien n'est écrit et la
// diffusion reste à vérifier, sans nouvel événement à chaque passage du planificateur.
async function reconcileAs(userId:string,deliveryId:string,deps:ReconcileDeps,recordOnlyExists=false):Promise<{ok:boolean;message:string;result?:ReconcileResult['status']}>{
 try{
  const ctx=await deps.db.rpc('publication_delivery_reconcile_context_checked',{p_delivery_id:deliveryId});
  if(checkedReconciliationUnavailable(ctx.error))return {ok:false,message:checkedReconciliationRequired};
  if(ctx.error||!ctx.data)return {ok:false,message:'Cette diffusion ou sa tentative courante ne peut pas être vérifiée. Consultez son historique avant toute relance.'};
  const c=ctx.data as {attempt_id?:unknown;platform:PublicationPlatform;remote_id:string|null;connection_id:string|null;account:{external_account_id:string;parent_external_id:string|null};text:string;since:string|null};
  if(!isPublicationUuid(c.attempt_id))return {ok:false,message:checkedReconciliationRequired};
  const reconciler=deps.reconcilers[c.platform];
  if(!reconciler||!deps.vault||!c.connection_id)return {ok:false,message:'Vérification indisponible pour ce compte.'};
  const row=await deps.db.from('client_connections').select('credential_reference,status').eq('id',c.connection_id).maybeSingle();
  const connection=row.data as {credential_reference?:unknown;status?:unknown}|null,ref=connection?.credential_reference;
  if(row.error||connection?.status!=='active'||!isCredentialReference(ref))return {ok:false,message:'Connexion inactive : reconnectez le compte.'};
  const credential=await deps.vault.readCredential(ref,providerOfPlatform(c.platform));
  const r=await reconciler.reconcile({platform:c.platform,remoteId:c.remote_id,idempotencyKey:'',credential,
   account:{externalAccountId:c.account.external_account_id,parentExternalId:c.account.parent_external_id},text:c.text,since:c.since});
  if(recordOnlyExists&&r.status!=='exists')return {ok:true,result:r.status,message:'Pas encore visible chez le fournisseur.'};
  const saved=await deps.db.rpc('publication_delivery_reconcile_checked',{p_delivery_id:deliveryId,p_attempt_id:c.attempt_id,p_status:r.status,p_remote_id:r.status==='exists'?r.remoteId:null,p_actor_id:userId});
  if(checkedReconciliationUnavailable(saved.error))return {ok:false,message:checkedReconciliationRequired};
  if(saved.error||!saved.data)return {ok:false,message:saved.error?.code==='40001'?'La tentative a changé pendant la vérification. Vérifiez à nouveau chez le fournisseur.':'Vérification non enregistrée. Réessayez.'};
  return {ok:true,result:r.status,message:r.status==='exists'?'Publication retrouvée chez le fournisseur : diffusion marquée publiée.'
   :r.status==='missing'?'Aucune publication trouvée. Vous pouvez confirmer qu’elle n’a pas été publiée.':'Impossible de conclure : la diffusion reste à vérifier.'};
 }catch{log('reconcile');return {ok:false,message:'Vérification impossible pour le moment.'};}
}
export async function confirmDeliveryNotPublished(deliveryId:unknown,deps:Pick<ReconcileDeps,'db'>=productionReconcileDeps()):Promise<{ok:boolean;message:string}>{
 const {userId}=await requireAdmin();if(!isPublicationUuid(deliveryId))return {ok:false,message:'Diffusion invalide.'};
 try{const r=await deps.db.rpc('publication_delivery_confirm_not_published_checked',{p_delivery_id:deliveryId,p_actor_id:userId});
  if(checkedReconciliationUnavailable(r.error))return {ok:false,message:checkedReconciliationRequired};
  if(r.error||!r.data)return {ok:false,message:/reconcile first/i.test(r.error?.message??'')?'Vérifiez d’abord chez le fournisseur.':'Décision non enregistrée.'};
  return {ok:true,message:'Diffusion marquée non publiée : vous pouvez la réessayer.'};
 }catch{log('confirm');return {ok:false,message:'Décision non confirmée. Rechargez la diffusion avant de réessayer.'};}
}

// Vérification automatique (planificateur) des posts Google acceptés mais encore en relecture chez Google
// (post_processing / post_visibility_unknown) : ils deviennent visibles quelques minutes plus tard, sans renvoi.
// Lecture seule chez Google, au nom de l'administrateur qui a approuvé la révision (toujours autorisé) ; seul un post
// retrouvé est enregistré (diffusion « publiée »). Bornée : 5 diffusions de moins de 7 jours par passage.
export const AUTO_RECONCILE_CODES=['post_processing','post_visibility_unknown'] as const;
export const MAX_AUTO_RECONCILE_PER_TICK=5;
export const AUTO_RECONCILE_WINDOW_MS=7*24*3600_000;
export const AUTO_RECONCILE_BUDGET_MS=60_000;
export type AutoReconcileSummary={checked:number;published:number;pending:number;skipped:number};
type Rows=PromiseLike<{data:unknown;error:unknown}>;
export type AutoReconcileDeps=ReconcileDeps&{list:(since:string,limit:number)=>Rows;approver:(publicationId:string,revisionId:string)=>Promise<string|null>;isAdmin:(userId:string)=>boolean;now?:()=>number};
const USER_ID=/^user_[a-zA-Z0-9_-]{1,200}$/;
export function productionAutoReconcileDeps():AutoReconcileDeps{
 const db=getSupabaseServerClient();
 return {...productionReconcileDeps(),
  list:(since,limit)=>db.from('publication_deliveries').select('id,publication_id,revision_id').eq('status','uncertain').eq('platform','google_business_profile')
   .in('last_error_code',[...AUTO_RECONCILE_CODES]).gte('updated_at',since).order('updated_at',{ascending:false}).limit(limit),
  approver:async(publicationId,revisionId)=>{
   const r=await db.from('publication_reviews').select('actor_id').eq('publication_id',publicationId).eq('revision_id',revisionId).eq('decision','approved')
    .order('created_at',{ascending:false}).limit(1).maybeSingle();
   const actor=(r.data as {actor_id?:unknown}|null)?.actor_id;return !r.error&&typeof actor==='string'?actor:null;},
  isAdmin:userId=>isAuthorizedAdmin(userId)};
}
export async function reconcilePendingGoogleDeliveries(deps:AutoReconcileDeps=productionAutoReconcileDeps()):Promise<AutoReconcileSummary>{
 const summary:AutoReconcileSummary={checked:0,published:0,pending:0,skipped:0};
 const since=new Date((deps.now??Date.now)()-AUTO_RECONCILE_WINDOW_MS).toISOString();
 const rows=await deps.list(since,MAX_AUTO_RECONCILE_PER_TICK);
 if(rows.error||!Array.isArray(rows.data))return summary;
 for(const d of rows.data as {id?:unknown;publication_id?:unknown;revision_id?:unknown}[]){
  if(!isPublicationUuid(d.id)||!isPublicationUuid(d.publication_id)||!isPublicationUuid(d.revision_id)){summary.skipped++;continue;}
  const actor=await deps.approver(d.publication_id,d.revision_id).catch(()=>null);
  if(!actor||!USER_ID.test(actor)||!deps.isAdmin(actor)){summary.skipped++;continue;}
  summary.checked++;
  const r=await reconcileAs(actor,d.id,deps,true);
  if(r.ok&&r.result==='exists')summary.published++;else summary.pending++;
 }
 return summary;
}
