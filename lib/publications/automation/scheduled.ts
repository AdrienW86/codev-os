import 'server-only';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {isAuthorizedAdmin} from '@/lib/admin-policy';
import {writeAudit} from '@/lib/core/audit';
import type {Actor} from '@/lib/core/actor';
import {NO_OPEN_OCCURRENCE,prepareNextPublicationsAs,retryAgentV2MediaAs,type AgentV2Result,type PrepareOptions} from '../agent-v2/service';
import {addDays,parisToday} from '../calendar';
import {SCHEDULED_LATE_TOLERANCE_SECONDS,scheduledDeliveryEnabled} from '../delivery/registry';

// Socle Publications, lot 6 : préparation planifiée par le planificateur (/api/internal/scheduler/tick).
// - Préparation : pour chaque client dont la préparation automatique est activée, l'Agent v2 (seul moteur) prépare les
//   occurrences de l'horizon choisi (fréquences = créneaux des canaux), au nom de l'administrateur qui a activé la
//   préparation automatique (délégation journalisée). Les brouillons complets (photo attachée) passent « À valider »
//   (pending_review) et l'administrateur est notifié. Jamais d'approbation ici.
// - Diffusion : une publication approuvée par un humain reçoit sa diffusion à l'heure de son créneau, au nom de cet
//   humain, uniquement si PUBLICATIONS_SCHEDULED_DELIVERY=enabled. La base re-vérifie approbation et interrupteurs.
// - Reprises : rotation des clients (le moins récemment traité d'abord), pause d'un projet après un échec de l'agent,
//   abandon signalé d'une occurrence qui échoue trop souvent, reprise sans IA de l'étape média des préparations.
export const SCHEDULER_ACTOR:Actor={kind:'system',worker:'publications-scheduler'};
export const MAX_CLIENTS_PER_TICK=10;
export const MAX_PREPARATIONS_PER_TICK=2;
export const MAX_DELIVERY_PREPARATIONS_PER_TICK=10;
export const MAX_DELIVERY_CANDIDATES=50;
// Une publication approuvée dont le créneau est passé depuis plus longtemps n'est pas envoyée en retard sans un humain
// (même tolérance à la préparation de la diffusion et à l'envoi : publication_job_claim_on_time).
export const LATE_DELIVERY_TOLERANCE_MS=SCHEDULED_LATE_TOLERANCE_SECONDS*1000;
// Échecs de l'Agent v2 (refus de contenu, sortie invalide, génération indisponible) : plus aucun appel IA pour ce
// projet pendant PROJECT_FAILURE_BACKOFF_MS ; une occurrence en échec MAX_OCCURRENCE_FAILURES fois sur la fenêtre
// n'est plus tentée et un humain est notifié une fois (budget de l'agent partagé entre tous les clients).
export const PROJECT_FAILURE_BACKOFF_MS=6*3600000;
export const MAX_OCCURRENCE_FAILURES=3;
const FAILURE_WINDOW_MS=14*86400000;
// Étape média d'une préparation planifiée : au plus MAX_MEDIA_ATTEMPTS essais (le premier compris) pendant
// MEDIA_FOLLOW_UP_MS ; au-delà, abandon : réservation de la photo libérée, « Photo manquante » notifiée.
export const MAX_MEDIA_ATTEMPTS=3;
export const MAX_MEDIA_FOLLOW_UPS_PER_TICK=3;
const MEDIA_FOLLOW_UP_MS=3*86400000;
// Échéance du passage (#47, donnée par la route du planificateur) : aucune nouvelle préparation IA ne démarre s'il reste
// moins que son pire cas (génération : délai de 60 s du fournisseur, puis finish et étape média : Drive, adaptation),
// aucune reprise média sans IA s'il reste moins que la sienne. Une étape déjà lancée n'est jamais interrompue ici.
export const PREPARATION_BUDGET_MS=100_000;
export const MEDIA_FOLLOW_UP_BUDGET_MS=45_000;
export type ScheduledPreparationOptions={deadline?:number;clock?:()=>number};
const USER=/^user_[a-zA-Z0-9_-]{1,200}$/;

type DbError={code?:string;message?:string}|null;
export type FollowUpSummary={runs:number;attached:number;submitted:number;gaveUp:number};
export type ScheduledPreparationSummary={disabled?:'global';clients:number;preparations:number;submitted:number;notified:number;skipped:Record<string,number>;followUp:FollowUpSummary;deadline?:boolean};
export type DeliveryPreparationSummary={disabled?:'flag'|'global';prepared:number;blocked:number;late:number;photoBlocked:number;notified:number};
export type ScheduledPreparationDeps={prepare:(userId:string,projectId:string,options:PrepareOptions)=>Promise<AgentV2Result>;audit:(actor:Actor,entry:Parameters<typeof writeAudit>[1])=>Promise<void>;
 isAdmin:(userId:string)=>boolean;retryMedia:(userId:string,runId:string)=>Promise<string>};
export type DeliveryPreparationDeps={isAdmin:(userId:string)=>boolean};
const productionDeps:ScheduledPreparationDeps={prepare:prepareNextPublicationsAs,audit:writeAudit,isAdmin:userId=>isAuthorizedAdmin(userId),retryMedia:(userId,runId)=>retryAgentV2MediaAs(userId,runId)};
const db=()=>getSupabaseServerClient();

async function globalSwitches(){
 const {data,error}=await db().from('publication_settings').select('emergency_stop,generation_enabled,automation_enabled,publishing_enabled').limit(1).maybeSingle();
 return error||!data?null:data as {emergency_stop:boolean;generation_enabled:boolean;automation_enabled:boolean;publishing_enabled:boolean};
}
// L'administrateur qui a enregistré en dernier les réglages du client avec la préparation automatique activée, s'il est
// toujours l'administrateur autorisé. Sinon personne : rien n'est préparé (échec fermé).
export async function delegatedActor(clientId:string,isAdmin:(userId:string)=>boolean):Promise<string|null>{
 const {data,error}=await db().from('publication_events').select('actor_id,after_data').eq('client_id',clientId).eq('action','publication.client_settings_saved')
  .order('created_at',{ascending:false}).limit(1).maybeSingle();
 const row=data as {actor_id?:unknown;after_data?:{auto_prepare_enabled?:unknown}|null}|null;
 if(error||!row||row.after_data?.auto_prepare_enabled!==true||typeof row.actor_id!=='string'||!USER.test(row.actor_id)||!isAdmin(row.actor_id))return null;
 return row.actor_id;
}
// Soumission à validation des brouillons encore en brouillon (révision courante). Jamais d'approbation.
type DraftSubmission={submitted:string[];complete:boolean;reviewRequired:boolean};
async function submitDrafts(actor:string,ids:readonly string[]):Promise<DraftSubmission>{
 if(!ids.length)return {submitted:[],complete:false,reviewRequired:false};
 let rows;
 try{rows=await db().from('publications').select('id,status,current_revision_id').in('id',[...ids]);}
 catch{return {submitted:[],complete:false,reviewRequired:false};}
 if(rows.error||!rows.data)return {submitted:[],complete:false,reviewRequired:false};
 const submitted:string[]=[];
 let complete=new Set(rows.data.map(p=>p.id)).size===new Set(ids).size,reviewRequired=false;
 for(const p of rows.data as {id:string;status:string;current_revision_id:string|null}[]){
  if(p.status==='pending_review'){reviewRequired=true;continue;}
  // A human may already have decided on a previously submitted publication. Never resubmit it.
  if(p.status==='approved'||p.status==='rejected')continue;
  if(p.status!=='draft'||!p.current_revision_id){complete=false;continue;}
  try{const r=await db().rpc('publication_submit_manual',{p_publication_id:p.id,p_revision_id:p.current_revision_id,p_actor_id:actor});
   if(r.error)complete=false;else{submitted.push(p.id);reviewRequired=true;}
  }catch{complete=false;}
 }
 return {submitted,complete,reviewRequired};
}
// Une notification idempotente (clé d'événement) : catégorie et lien autorisés par la base, jamais de texte ni de nom.
async function notify(eventKey:string,category:'publication_review'|'media_missing'|'delivery_failed'|'incident',href:string):Promise<boolean>{
 try{const r=await db().from('admin_notifications').upsert({event_key:eventKey,category,href},{onConflict:'event_key',ignoreDuplicates:true});
  if(!r.error)return true;
 }catch{/* A lost response may follow COMMIT; leave the durable follow-up open for an idempotent retry. */}
 console.error('[publications-scheduler] notification not recorded',{category});return false;
}
// Une notification par préparation soumise, vers la file de validation.
const notifyReview=(runId:string)=>notify(`publication-review:${runId}`,'publication_review','/publications/review');

// Journal : une ligne par tentative, sans texte généré. Un échec du journal n'interrompt pas le passage.
async function audit(deps:ScheduledPreparationDeps,projectId:string,metadata:Record<string,unknown>){
 try{await deps.audit(SCHEDULER_ACTOR,{action:'publications.scheduled_preparation',resource_type:'project',resource_id:projectId,metadata});}
 catch{console.error('[publications-scheduler] audit not recorded');}
}

// Échecs récents de l'Agent v2 sur un projet (tous déclencheurs) : pause du projet, occurrences abandonnées.
type RecentRun={status:string;occurrence_ids:string[]|null;created_at:string;agent_id:string|null};
async function recentFailures(projectId:string,now:Date):Promise<{backoff:boolean;exhausted:string[];agentId:string|null}|null>{
 const r=await db().from('publication_agent_v2_runs').select('status,occurrence_ids,created_at,agent_id').eq('project_id',projectId)
  .gte('created_at',new Date(now.getTime()-FAILURE_WINDOW_MS).toISOString()).order('created_at',{ascending:false}).limit(50);
 if(r.error||!r.data)return null;
 const rows=r.data as RecentRun[],latest=rows[0];
 const backoff=latest?.status==='failed'&&Date.parse(latest.created_at)>now.getTime()-PROJECT_FAILURE_BACKOFF_MS;
 const failures=new Map<string,number>();
 for(const row of rows)if(row.status==='failed')for(const id of row.occurrence_ids??[])failures.set(id,(failures.get(id)??0)+1);
 return {backoff,exhausted:[...failures].filter(([,n])=>n>=MAX_OCCURRENCE_FAILURES).map(([id])=>id),agentId:rows.find(x=>x.agent_id)?.agent_id??null};
}
// Occurrences abandonnées encore ouvertes : un humain est prévenu une fois par occurrence (page de l'agent).
async function notifyExhausted(exhausted:string[],agentId:string|null,now:Date):Promise<number>{
 if(!exhausted.length||!agentId)return 0;
 const open=await db().from('publication_channel_occurrences').select('id').in('id',exhausted).is('publication_id',null).is('skipped_at',null).gte('scheduled_for',now.toISOString());
 if(open.error||!open.data)return 0;
 let n=0;for(const o of open.data as {id:string}[])if(await notify(`publication-preparation-failed:${o.id}`,'incident',`/agents/${agentId}`))n++;
 return n;
}

// Reprise sans IA des préparations planifiées dont l'étape média ou la soumission n'est pas allée au bout (bail
// expiré, échec média, coupure entre l'attache et la soumission). Bornée par passage et dans le temps.
type FollowRun={id:string;client_id:string;status:string;media_status:string;media_attempts:number;media_lease_until:string|null;publication_ids:string[];created_at:string};
async function closeFollowUp(runId:string,state:'done'|'gave_up'){
 const r=await db().from('publication_scheduled_runs').update({state,updated_at:new Date().toISOString()}).eq('run_id',runId).eq('state','open');
 if(r.error)console.error('[publications-scheduler] follow-up not closed');
}
async function followUpRuns(now:Date,deps:ScheduledPreparationDeps,summary:ScheduledPreparationSummary,skip:(reason:string)=>void,left:()=>number){
 const open=await db().from('publication_scheduled_runs').select('run_id,client_id,created_at').eq('state','open').order('created_at').limit(MAX_MEDIA_FOLLOW_UPS_PER_TICK);
 if(open.error||!open.data?.length)return;
 const ids=(open.data as {run_id:string}[]).map(r=>r.run_id);
 const runs=await db().from('publication_agent_v2_runs').select('id,client_id,status,media_status,media_attempts,media_lease_until,publication_ids,created_at').in('id',ids);
 if(runs.error||!runs.data){skip('follow_up_unavailable');return;}
 const actors=new Map<string,string|null>();
 for(const id of ids){
  const run=(runs.data as FollowRun[]).find(r=>r.id===id);
  summary.followUp.runs++;
  // A lost finish response may have left a durable processing run. Wait for its confirmed outcome instead of
  // closing the only recovery record while the database is still committing. Missing rows also fail closed.
  if(!run||run.status==='processing'){skip('follow_up_preparation_unconfirmed');continue;}
  if(run.status==='failed'){await closeFollowUp(id,'gave_up');summary.followUp.gaveUp++;continue;}
  if(run.status!=='completed'){skip('follow_up_preparation_unconfirmed');continue;}
  if(run.media_status==='none'){
   if(await notify(`media-missing:run:${run.id}`,'media_missing',`/clients/${run.client_id}?tab=media`)){
    summary.notified++;await closeFollowUp(id,'done');
   }
   continue;
  }
  if(!actors.has(run.client_id))actors.set(run.client_id,await delegatedActor(run.client_id,deps.isAdmin));
  const actor=actors.get(run.client_id);
  if(!actor){skip('follow_up_no_delegated_admin');continue;}
  let state=run.media_status;
  if(state==='pending'&&run.media_lease_until&&Date.parse(run.media_lease_until)>now.getTime())continue;
  if(state!=='attached'){
   if(run.media_attempts>=MAX_MEDIA_ATTEMPTS||now.getTime()-Date.parse(run.created_at)>MEDIA_FOLLOW_UP_MS){
    // Abandon : un essai resté « pending » (bail expiré) garde la photo réservée ; l'échec explicite la libère.
    if(state==='pending'){
     const released=await db().rpc('publication_agent_v2_media_fail',{p_run_id:run.id,p_attempt:run.media_attempts,p_error_code:'media_unavailable',p_actor_id:actor});
     if(released.error){skip('follow_up_release_failed');continue;}
     if((released.data as {media_status?:unknown}|null)?.media_status==='attached')continue;
    }
    if(await notify(`media-missing:run:${run.id}`,'media_missing',`/clients/${run.client_id}?tab=media`))summary.notified++;
    await closeFollowUp(run.id,'gave_up');summary.followUp.gaveUp++;continue;
   }
   // Plus assez de temps pour une reprise média : elle attend le passage suivant (rien n'est abandonné pour autant).
   if(left()<MEDIA_FOLLOW_UP_BUDGET_MS){skip('deadline');summary.deadline=true;break;}
   try{state=await deps.retryMedia(actor,run.id);}catch{state='unconfirmed';}
   if(state!=='attached')continue;
   summary.followUp.attached++;
  }
  const submission=await submitDrafts(actor,run.publication_ids??[]);
  summary.followUp.submitted+=submission.submitted.length;summary.submitted+=submission.submitted.length;
  // A process can stop after submitting but before notifying. Pending revisions also need the idempotent
  // notification; a failed read/RPC/notification keeps this follow-up open for the next tick.
  const notified=!submission.reviewRequired||await notifyReview(run.id);
  if(submission.reviewRequired&&notified)summary.notified++;
  if(submission.complete&&notified)await closeFollowUp(run.id,'done');
  else skip('follow_up_submission_unconfirmed');
 }
}

export async function runScheduledPreparation(now=new Date(),deps:ScheduledPreparationDeps=productionDeps,options:ScheduledPreparationOptions={}):Promise<ScheduledPreparationSummary>{
 const summary:ScheduledPreparationSummary={clients:0,preparations:0,submitted:0,notified:0,skipped:{},followUp:{runs:0,attached:0,submitted:0,gaveUp:0}};
 const skip=(reason:string)=>{summary.skipped[reason]=(summary.skipped[reason]??0)+1;};
 const clock=options.clock??Date.now,deadline=options.deadline;
 const left=()=>deadline===undefined||!Number.isFinite(deadline)?Infinity:deadline-clock();
 const s=await globalSwitches();
 if(!s||s.emergency_stop!==false||s.automation_enabled!==true||s.generation_enabled!==true)return {...summary,disabled:'global'};
 // D'abord les reprises sans IA (photo, soumission), puis les nouvelles préparations.
 await followUpRuns(now,deps,summary,skip,left);
 // Rotation : le client le moins récemment traité d'abord (jamais traité en tête), pour qu'aucun ne soit oublié.
 const clients=await db().from('publication_client_settings').select('client_id,prepare_lead_days,last_auto_prepared_at').eq('auto_prepare_enabled',true).eq('generation_enabled',true)
  .order('last_auto_prepared_at',{ascending:true,nullsFirst:true}).order('client_id').limit(MAX_CLIENTS_PER_TICK);
 if(clients.error||!clients.data)return {...summary,skipped:{...summary.skipped,settings_unavailable:1}};
 for(const client of clients.data as {client_id:string;prepare_lead_days:number;last_auto_prepared_at?:string|null}[]){
  if(summary.preparations>=MAX_PREPARATIONS_PER_TICK)break;
  // Plus le temps de lancer une préparation : le client garde sa place en tête de rotation (non horodaté).
  if(left()<PREPARATION_BUDGET_MS){skip('deadline');summary.deadline=true;break;}
  // Rotation réservée AVANT de préparer (#47), par compare-and-set sur l'horodatage lu : deux passages simultanés ne
  // préparent jamais le même client, et un client dont la préparation plante (processus coupé) ne reste pas en tête
  // de rotation à chaque passage au détriment des autres ; il repasse à son tour.
  const claim=db().from('publication_client_settings').update({last_auto_prepared_at:now.toISOString()}).eq('client_id',client.client_id);
  const previous=client.last_auto_prepared_at??null;
  const stamped=await (previous===null?claim.is('last_auto_prepared_at',null):claim.eq('last_auto_prepared_at',previous)).select('client_id');
  if(stamped.error){console.error('[publications-scheduler] rotation not recorded');skip('rotation_unavailable');continue;}
  if(!stamped.data?.length){skip('client_busy');continue;}
  summary.clients++;
  await prepareClient(client,now,deps,summary,skip,left);
 }
 return summary;
}
async function prepareClient(client:{client_id:string;prepare_lead_days:number},now:Date,deps:ScheduledPreparationDeps,summary:ScheduledPreparationSummary,skip:(reason:string)=>void,left:()=>number){
 const actor=await delegatedActor(client.client_id,deps.isAdmin);
 if(!actor){skip('no_delegated_admin');return;}
 const projects=await db().from('publication_agent_projects').select('project_id').eq('client_id',client.client_id).eq('enabled',true).eq('rights_confirmed',true).order('project_id');
 if(projects.error||!projects.data?.length){skip('no_agent_project');return;}
 const leadDays=Math.min(Math.max(Math.trunc(client.prepare_lead_days)||3,1),14),today=parisToday(now);
 for(const {project_id:projectId} of projects.data as {project_id:string}[]){
  if(summary.preparations>=MAX_PREPARATIONS_PER_TICK)break;
  if(left()<PREPARATION_BUDGET_MS){skip('deadline');summary.deadline=true;break;}
  // Échec récent de l'agent sur ce projet : pas de nouvel appel IA avant la fin de la pause (échec fermé si illisible).
  const failures=await recentFailures(projectId,now);
  if(!failures){skip('failures_unavailable');continue;}
  if(failures.backoff){skip('failure_backoff');continue;}
  summary.notified+=await notifyExhausted(failures.exhausted,failures.agentId,now);
  // Créneaux de l'horizon (idempotent) : la fréquence configurée par canal décide seule des occurrences.
  const ensured=await db().rpc('publication_channel_occurrences_ensure',{p_project_id:projectId,p_start_date:today,p_end_date:addDays(today,leadDays),p_actor_id:actor});
  if(ensured.error){skip((ensured.error as DbError)?.code==='23514'?'channels_not_configured':'occurrences_unavailable');continue;}
  let prepared:AgentV2Result;
  try{prepared=await deps.prepare(actor,projectId,{allowRealAI:true,leadDays,now,...(failures.exhausted.length?{excludeOccurrenceIds:failures.exhausted}:{})});}
  // Une exception (délai, base ou Drive indisponible) a pu survenir après l'appel IA : elle compte comme une tentative
  // (#47), sinon une panne en série déclencherait un appel IA par projet de chaque client visité.
  catch{console.error('[publications-scheduler] preparation failed');summary.preparations++;skip('preparation_failed');continue;}
  if(!prepared.ok&&prepared.message===NO_OPEN_OCCURRENCE){skip('nothing_to_prepare');continue;}
  // Toute tentative compte (un refus de contenu a pu consommer un appel IA) : au plus MAX_PREPARATIONS_PER_TICK.
  summary.preparations++;
  if(!prepared.runId){skip('preparation_refused');await audit(deps,projectId,{delegated_actor:actor,ok:false});continue;}
  // Persist the recovery record BEFORE any submission/notification. Their response can be lost after COMMIT, or
  // the process may stop between them: the next tick must find this run without generating another batch.
  const needsTracking=prepared.recoverable||prepared.ok&&!prepared.mediaMissing;
  if(needsTracking){
   let tracked=false;
   try{const r=await db().from('publication_scheduled_runs').upsert({run_id:prepared.runId,client_id:client.client_id,state:'open'},{onConflict:'run_id',ignoreDuplicates:true});tracked=!r.error;}
   catch{/* No submission while durable tracking is unconfirmed. */}
   if(!tracked){console.error('[publications-scheduler] follow-up not recorded');skip('follow_up_tracking_unconfirmed');
    await audit(deps,projectId,{delegated_actor:actor,run_id:prepared.runId,ok:false,follow_up_unconfirmed:true});continue;}
  }
  // Brouillons complets (photo attachée) soumis ; sinon le suivi reste ouvert pour une reprise sans IA.
  const submission=prepared.ok&&prepared.withMedia?await submitDrafts(actor,prepared.publications.map(p=>p.id)):null;
  const submitted=submission?.submitted??[];
  summary.submitted+=submitted.length;
  const notified=!submission?.reviewRequired||await notifyReview(prepared.runId);
  if(submission?.reviewRequired&&notified)summary.notified++;
  if(needsTracking&&submission?.complete&&notified)await closeFollowUp(prepared.runId,'done');
  await audit(deps,projectId,{delegated_actor:actor,run_id:prepared.runId,ok:prepared.ok,publications:prepared.publications.map(p=>p.id),submitted,media_missing:prepared.mediaMissing===true});
 }
}

// Diffusions des publications approuvées par un humain, au nom de cet humain (dernier avis « approved » de la révision
// courante), s'il est toujours l'administrateur autorisé. Une modification après approbation repasse la publication en
// brouillon (publication_save_draft) : elle n'est plus candidate ; un refus n'est jamais candidat. Les candidates sont
// filtrées en base (publication_scheduled_delivery_candidates) : créneau à venir, aucune diffusion pour la révision
// courante (même annulée par un humain). Créneau manqué ou photo de la photothèque devenue non publiable : rien n'est
// préparé, un humain est notifié une fois. Le moteur P10 re-vérifie tout au moment d'envoyer.
export async function prepareApprovedDeliveries(env:Record<string,string|undefined>,now=new Date(),deps:DeliveryPreparationDeps={isAdmin:userId=>isAuthorizedAdmin(userId)}):Promise<DeliveryPreparationSummary>{
 const summary:DeliveryPreparationSummary={prepared:0,blocked:0,late:0,photoBlocked:0,notified:0};
 if(!scheduledDeliveryEnabled(env))return {...summary,disabled:'flag'};
 const s=await globalSwitches();
 if(!s||s.emergency_stop!==false||s.publishing_enabled!==true)return {...summary,disabled:'global'};
 const candidates=await db().rpc('publication_scheduled_delivery_candidates',{p_late_before:new Date(now.getTime()-LATE_DELIVERY_TOLERANCE_MS).toISOString(),p_limit:MAX_DELIVERY_CANDIDATES});
 if(candidates.error||!Array.isArray(candidates.data))return summary;
 for(const c of candidates.data as {publication_id:string;revision_id:string;state:string}[]){
  if(c.state==='missed'){
   summary.late++;
   if(await notify(`publication-missed:${c.publication_id}:${c.revision_id}`,'delivery_failed',`/publications/${c.publication_id}`))summary.notified++;
   continue;}
  if(c.state==='photo_unpublishable'){
   summary.photoBlocked++;
   if(await notify(`publication-photo-unpublishable:${c.publication_id}:${c.revision_id}`,'delivery_failed',`/publications/${c.publication_id}`))summary.notified++;
   continue;}
  // Plafond sur les diffusions préparées seulement (#47) : des candidates bloquées (approbateur parti, refus serveur)
  // ne consomment plus le budget du passage au détriment des suivantes ; leur nombre reste borné par MAX_DELIVERY_CANDIDATES.
  if(c.state!=='ready'||summary.prepared>=MAX_DELIVERY_PREPARATIONS_PER_TICK)continue;
  const review=await db().from('publication_reviews').select('actor_id').eq('publication_id',c.publication_id).eq('revision_id',c.revision_id).eq('decision','approved')
   .order('created_at',{ascending:false}).limit(1).maybeSingle();
  const approver=(review.data as {actor_id?:unknown}|null)?.actor_id;
  // Approbateur toujours administrateur autorisé (même règle que la délégation) ; sinon rien n'est préparé.
  if(review.error||typeof approver!=='string'||!USER.test(approver)||!deps.isAdmin(approver)){
   summary.blocked++;
   // Approbation inutilisable (approbateur qui n'est plus l'administrateur, révision sans approbation) : un humain est
   // prévenu une fois par révision ; il approuve à nouveau depuis la fiche. Jamais sur une simple erreur de lecture.
   if(!review.error){
    const n=await db().from('admin_notifications').upsert({event_key:`publication-approval-stale:${c.publication_id}:${c.revision_id}`,category:'delivery_failed',href:`/publications/${c.publication_id}`},{onConflict:'event_key',ignoreDuplicates:true}).select('event_key');
    if(n.error)console.error('[publications-scheduler] notification not recorded',{category:'delivery_failed'});else if(n.data?.length)summary.notified++;
   }
   continue;}
  const r=await db().rpc('publication_prepare_delivery',{p_publication_id:c.publication_id,p_actor_id:approver});
  if(r.error)summary.blocked++;else summary.prepared++;
 }
 return summary;
}
