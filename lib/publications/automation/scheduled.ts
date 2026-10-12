import 'server-only';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {isAuthorizedAdmin} from '@/lib/admin-policy';
import {writeAudit} from '@/lib/core/audit';
import type {Actor} from '@/lib/core/actor';
import {NO_OPEN_OCCURRENCE,prepareNextPublicationsAs,type AgentV2Result,type PrepareOptions} from '../agent-v2/service';
import {addDays,parisToday} from '../calendar';
import {scheduledDeliveryEnabled} from '../delivery/registry';

// Socle Publications, lot 6 : préparation planifiée par le planificateur (/api/internal/scheduler/tick).
// - Préparation : pour chaque client dont la préparation automatique est activée, l'Agent v2 (seul moteur) prépare les
//   occurrences de l'horizon choisi (fréquences = créneaux des canaux), au nom de l'administrateur qui a activé la
//   préparation automatique (délégation journalisée). Les brouillons complets (photo attachée) passent « À valider »
//   (pending_review) et l'administrateur est notifié. Jamais d'approbation ici.
// - Diffusion : une publication approuvée par un humain reçoit sa diffusion à l'heure de son créneau, au nom de cet
//   humain, uniquement si PUBLICATIONS_SCHEDULED_DELIVERY=enabled. La base re-vérifie approbation et interrupteurs.
export const SCHEDULER_ACTOR:Actor={kind:'system',worker:'publications-scheduler'};
export const MAX_CLIENTS_PER_TICK=10;
export const MAX_PREPARATIONS_PER_TICK=2;
export const MAX_DELIVERY_PREPARATIONS_PER_TICK=10;
// Une publication approuvée dont le créneau est passé depuis plus longtemps n'est pas envoyée en retard sans un humain.
export const LATE_DELIVERY_TOLERANCE_MS=2*3600000;
const USER=/^user_[a-zA-Z0-9_-]{1,200}$/;

type DbError={code?:string;message?:string}|null;
export type ScheduledPreparationSummary={disabled?:'global';clients:number;preparations:number;submitted:number;notified:number;skipped:Record<string,number>};
export type DeliveryPreparationSummary={disabled?:'flag'|'global';prepared:number;blocked:number;late:number};
export type ScheduledPreparationDeps={prepare:(userId:string,projectId:string,options:PrepareOptions)=>Promise<AgentV2Result>;audit:(actor:Actor,entry:Parameters<typeof writeAudit>[1])=>Promise<void>;isAdmin:(userId:string)=>boolean};
const productionDeps:ScheduledPreparationDeps={prepare:prepareNextPublicationsAs,audit:writeAudit,isAdmin:userId=>isAuthorizedAdmin(userId)};
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
// Soumission à validation des brouillons d'une préparation réussie, uniquement quand la photo est attachée
// (une publication sans photo ne peut pas être approuvée : elle reste en brouillon, « Photo manquante » est notifiée).
async function submitPrepared(actor:string,prepared:AgentV2Result):Promise<string[]>{
 if(!prepared.ok||!prepared.withMedia||!prepared.publications.length)return [];
 const rows=await db().from('publications').select('id,status,current_revision_id').in('id',prepared.publications.map(p=>p.id));
 if(rows.error||!rows.data)return [];
 const submitted:string[]=[];
 for(const p of rows.data as {id:string;status:string;current_revision_id:string|null}[]){
  if(p.status!=='draft'||!p.current_revision_id)continue;
  const r=await db().rpc('publication_submit_manual',{p_publication_id:p.id,p_revision_id:p.current_revision_id,p_actor_id:actor});
  if(!r.error)submitted.push(p.id);
 }
 return submitted;
}
// Une notification par préparation soumise, vers la file de validation (aucun texte ni nom de client).
async function notifyReview(runId:string):Promise<boolean>{
 const r=await db().from('admin_notifications').upsert({event_key:`publication-review:${runId}`,category:'publication_review',href:'/publications/review'},{onConflict:'event_key',ignoreDuplicates:true});
 if(r.error)console.error('[publications-scheduler] review notification not recorded');
 return !r.error;
}

// Journal : une ligne par tentative, sans texte généré. Un échec du journal n'interrompt pas le passage.
async function audit(deps:ScheduledPreparationDeps,projectId:string,metadata:Record<string,unknown>){
 try{await deps.audit(SCHEDULER_ACTOR,{action:'publications.scheduled_preparation',resource_type:'project',resource_id:projectId,metadata});}
 catch{console.error('[publications-scheduler] audit not recorded');}
}
export async function runScheduledPreparation(now=new Date(),deps:ScheduledPreparationDeps=productionDeps):Promise<ScheduledPreparationSummary>{
 const summary:ScheduledPreparationSummary={clients:0,preparations:0,submitted:0,notified:0,skipped:{}};
 const skip=(reason:string)=>{summary.skipped[reason]=(summary.skipped[reason]??0)+1;};
 const s=await globalSwitches();
 if(!s||s.emergency_stop!==false||s.automation_enabled!==true||s.generation_enabled!==true)return {...summary,disabled:'global'};
 const clients=await db().from('publication_client_settings').select('client_id,prepare_lead_days').eq('auto_prepare_enabled',true).eq('generation_enabled',true)
  .order('client_id').limit(MAX_CLIENTS_PER_TICK);
 if(clients.error||!clients.data)return {...summary,skipped:{settings_unavailable:1}};
 for(const client of clients.data as {client_id:string;prepare_lead_days:number}[]){
  if(summary.preparations>=MAX_PREPARATIONS_PER_TICK)break;
  summary.clients++;
  const actor=await delegatedActor(client.client_id,deps.isAdmin);
  if(!actor){skip('no_delegated_admin');continue;}
  const projects=await db().from('publication_agent_projects').select('project_id').eq('client_id',client.client_id).eq('enabled',true).eq('rights_confirmed',true).order('project_id');
  if(projects.error||!projects.data?.length){skip('no_agent_project');continue;}
  const leadDays=Math.min(Math.max(Math.trunc(client.prepare_lead_days)||3,1),14),today=parisToday(now);
  for(const {project_id:projectId} of projects.data as {project_id:string}[]){
   if(summary.preparations>=MAX_PREPARATIONS_PER_TICK)break;
   // Créneaux de l'horizon (idempotent) : la fréquence configurée par canal décide seule des occurrences.
   const ensured=await db().rpc('publication_channel_occurrences_ensure',{p_project_id:projectId,p_start_date:today,p_end_date:addDays(today,leadDays),p_actor_id:actor});
   if(ensured.error){skip((ensured.error as DbError)?.code==='23514'?'channels_not_configured':'occurrences_unavailable');continue;}
   let prepared:AgentV2Result;
   try{prepared=await deps.prepare(actor,projectId,{allowRealAI:true,leadDays,now});}
   catch{console.error('[publications-scheduler] preparation failed');skip('preparation_failed');continue;}
   if(!prepared.ok&&prepared.message===NO_OPEN_OCCURRENCE){skip('nothing_to_prepare');continue;}
   // Toute tentative compte (un refus de contenu a pu consommer un appel IA) : au plus MAX_PREPARATIONS_PER_TICK.
   summary.preparations++;
   if(!prepared.runId){skip('preparation_refused');await audit(deps,projectId,{delegated_actor:actor,ok:false});continue;}
   const submitted=await submitPrepared(actor,prepared);
   summary.submitted+=submitted.length;
   if(submitted.length&&await notifyReview(prepared.runId))summary.notified++;
   await audit(deps,projectId,{delegated_actor:actor,run_id:prepared.runId,ok:prepared.ok,publications:prepared.publications.map(p=>p.id),submitted,media_missing:prepared.mediaMissing===true});
  }
 }
 return summary;
}

// Diffusions des publications approuvées par un humain, au nom de cet humain (dernier avis « approved » de la révision
// courante). Une modification après approbation repasse la publication en brouillon (publication_save_draft) : elle
// n'est plus candidate ; un refus n'est jamais candidat. Le moteur P10 re-vérifie tout au moment d'envoyer.
export async function prepareApprovedDeliveries(env:Record<string,string|undefined>,now=new Date()):Promise<DeliveryPreparationSummary>{
 const summary:DeliveryPreparationSummary={prepared:0,blocked:0,late:0};
 if(!scheduledDeliveryEnabled(env))return {...summary,disabled:'flag'};
 const s=await globalSwitches();
 if(!s||s.emergency_stop!==false||s.publishing_enabled!==true)return {...summary,disabled:'global'};
 const pubs=await db().from('publications').select('id,current_revision_id,occurrence_id').eq('status','approved').is('archived_at',null).not('occurrence_id','is',null)
  .order('updated_at').limit(50);
 if(pubs.error||!pubs.data?.length)return summary;
 const rows=pubs.data as {id:string;current_revision_id:string|null;occurrence_id:string}[];
 const [live,occurrences]=await Promise.all([db().from('publication_deliveries').select('publication_id,revision_id,status').in('publication_id',rows.map(p=>p.id)).neq('status','cancelled'),
  db().from('publication_channel_occurrences').select('id,scheduled_for').in('id',rows.map(p=>p.occurrence_id))]);
 if(live.error||occurrences.error)return summary;
 for(const p of rows){
  if(summary.prepared+summary.blocked>=MAX_DELIVERY_PREPARATIONS_PER_TICK)break;
  if(!p.current_revision_id||(live.data??[]).some(d=>d.publication_id===p.id&&d.revision_id===p.current_revision_id))continue;
  const at=(occurrences.data??[]).find(o=>o.id===p.occurrence_id)?.scheduled_for;
  if(!at||Date.parse(at)<now.getTime()-LATE_DELIVERY_TOLERANCE_MS){summary.late++;continue;}
  const review=await db().from('publication_reviews').select('actor_id').eq('publication_id',p.id).eq('revision_id',p.current_revision_id).eq('decision','approved')
   .order('created_at',{ascending:false}).limit(1).maybeSingle();
  const approver=(review.data as {actor_id?:unknown}|null)?.actor_id;
  if(review.error||typeof approver!=='string'||!USER.test(approver)){summary.blocked++;continue;}
  const r=await db().rpc('publication_prepare_delivery',{p_publication_id:p.id,p_actor_id:approver});
  if(r.error)summary.blocked++;else summary.prepared++;
 }
 return summary;
}
