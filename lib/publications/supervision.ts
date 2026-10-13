import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {isPublicationUuid} from './validation';
import {accountHealth,agentRunView,deliveryErrorReason,deliveryState,latestLiveDelivery,missedSlot,MISSED_SLOT_REASON,rescheduleTargets,upcomingTasks,ERROR_DELIVERY_STATUSES,
 type AccountHealth,type AccountRow,type AgentRunView,type ConnectionRow,type DeliveryDetailRow,type DeliveryState,type OccurrenceRow,type PhotoStats,type UpcomingTask} from './supervision-model';
import {loadClientPhotoCoverage} from './supervision-photos';
import type {PublicationPlatform,PublicationStatus} from './types';

// Socle Publications, lot 7 : lecture du tableau de supervision (admin uniquement). Aucune écriture ici ; les actions
// passent par les fonctions existantes (validation, agent, diffusion) ou par publication_reschedule.
const unavailable='Supervision indisponible.';
export type SupervisedPublication={id:string;clientId:string;projectId:string;platform:PublicationPlatform;subject:string;status:PublicationStatus;
 revisionId:string;occurrenceId:string|null;scheduledFor:string|null;delivery:DeliveryState;cancellable:string[];targets:{id:string;scheduledFor:string}[];
 /** Raison sûre (lignes « En erreur » uniquement) : classe d'erreur, motif de blocage ou créneau manqué. */
 errorReason:string|null};
export type ClientSupervision={id:string;name:string;autoPrepare:boolean;generation:boolean;leadDays:number;
 /** null : photothèque illisible (jamais « trop peu » par défaut). */
 photos:PhotoStats|null;tooFewPhotos:boolean;
 agentProjects:string[];accounts:AccountHealth[];
 /** Un projet du client, pour relancer la connexion OAuth existante (startOAuth résout le client depuis le projet). */
 projectId:string|null;
 /** Dernière préparation Agent v2 du client (null : aucune, ou lecture impossible). */
 lastRun:AgentRunView|null};
export type Supervision={settings:{emergencyStop:boolean;automation:boolean;generation:boolean;publishing:boolean}|null;
 /** Diffusion à l'heure prévue par le planificateur (PUBLICATIONS_SCHEDULED_DELIVERY, lu par la page et passé ici). */
 scheduledDelivery:boolean;clients:ClientSupervision[];
 counts:{pendingReview:number;scheduled:number;published:number;errors:number;connected:number;reconnect:number};
 scheduled:SupervisedPublication[];errors:SupervisedPublication[];published:SupervisedPublication[];tasks:UpcomingTask[]};

const MAX_ROWS=500;
export async function getSupervision(now=new Date(),options:{scheduledDelivery?:boolean}={}):Promise<Supervision>{
 await requireAdmin();const db=getSupabaseServerClient();
 const horizon=new Date(now.getTime()+28*86400000).toISOString(),since=new Date(now.getTime()-30*86400000).toISOString();
 const [settings,clients,clientSettings,agents,accounts,connections,pubs,occurrences,runs]=await Promise.all([
  db.from('publication_settings').select('emergency_stop,automation_enabled,generation_enabled,publishing_enabled').limit(1).maybeSingle(),
  db.from('clients').select('id,name').order('name').limit(MAX_ROWS),
  db.from('publication_client_settings').select('client_id,auto_prepare_enabled,generation_enabled,prepare_lead_days,media_reuse_allowed,media_reuse_after_days').limit(MAX_ROWS),
  db.from('publication_agent_projects').select('project_id,client_id,enabled,rights_confirmed').limit(MAX_ROWS),
  db.from('publication_accounts').select('id,client_id,platform,display_name,status,enabled,connection_id').not('connection_id','is',null).limit(MAX_ROWS),
  db.from('client_connections').select('id,client_id,provider,status,expires_at').in('provider',['meta','google_business_profile']).limit(MAX_ROWS),
  db.from('publications').select('id,client_id,project_id,platform,subject,status,current_revision_id,occurrence_id').is('archived_at',null)
   .not('occurrence_id','is',null).in('status',['draft','pending_review','approved']).order('updated_at',{ascending:false}).limit(MAX_ROWS),
  db.from('publication_channel_occurrences').select('id,client_id,project_id,platform,scheduled_for,publication_id,skipped_at').gte('scheduled_for',since).lte('scheduled_for',horizon).order('scheduled_for').limit(2000),
  // État de l'agent par client : dernière préparation (statut et code d'erreur uniquement, jamais de texte généré).
  db.from('publication_agent_v2_runs').select('client_id,status,error_code,created_at,completed_at').order('created_at',{ascending:false}).limit(MAX_ROWS)]);
 if(clients.error||clientSettings.error||agents.error||pubs.error||occurrences.error)throw Error(unavailable);
 const occ=(occurrences.data??[]) as OccurrenceRow[];
 const publications=(pubs.data??[]).filter(p=>p.current_revision_id&&p.project_id&&p.platform) as {id:string;client_id:string;project_id:string;platform:PublicationPlatform;subject:string;status:PublicationStatus;current_revision_id:string;occurrence_id:string|null}[];
 const deliveries=publications.length?await db.from('publication_deliveries').select('id,publication_id,revision_id,status,scheduled_for,updated_at,platform,remote_id,blocked_reason,last_error_class,last_error_code').in('publication_id',publications.map(p=>p.id)):{data:[],error:null};
 // Publiées : diffusions confirmées des 30 derniers jours (y compris de publications archivées depuis).
 const publishedRows=await db.from('publication_deliveries').select('id,publication_id,revision_id,status,scheduled_for,updated_at').in('status',['published']).gte('updated_at',since).order('updated_at',{ascending:false}).limit(20);
 if(deliveries.error||publishedRows.error)throw Error(unavailable);
 const delivered=(deliveries.data??[]) as DeliveryDetailRow[];

 const view=(p:typeof publications[number]):SupervisedPublication=>{const o=occ.find(x=>x.id===p.occurrence_id),d=deliveryState(delivered,p.id,p.current_revision_id);
  return {id:p.id,clientId:p.client_id,projectId:p.project_id,platform:p.platform,subject:p.subject,status:p.status,revisionId:p.current_revision_id,occurrenceId:p.occurrence_id,
   scheduledFor:o?.scheduled_for??null,delivery:d.state,cancellable:d.cancellable,
   errorReason:d.state==='error'?deliveryErrorReason(latestLiveDelivery(delivered,p.id,p.current_revision_id)):null,
   targets:p.occurrence_id&&p.status!=='rejected'&&d.state!=='published'?rescheduleTargets(occ,{project_id:p.project_id,platform:p.platform,occurrence_id:p.occurrence_id},now).map(t=>({id:t.id,scheduledFor:t.scheduled_for})):[]};};
 const views=publications.map(view);
 const future=(v:SupervisedPublication)=>v.scheduledFor!==null&&Date.parse(v.scheduledFor)>now.getTime();
 const scheduled=views.filter(v=>future(v)&&v.delivery!=='published'&&v.delivery!=='error').sort((a,b)=>(a.scheduledFor??'').localeCompare(b.scheduledFor??''));
 // En erreur : diffusions en échec, bloquées, à réessayer ou à vérifier, et publications approuvées dont le créneau est
 // passé sans aucune diffusion (rien ne partira plus).
 const errors=views.filter(v=>v.delivery==='error'||missedSlot(v,now)).map(v=>v.delivery==='error'?v:{...v,errorReason:MISSED_SLOT_REASON})
  .sort((a,b)=>(a.scheduledFor??'').localeCompare(b.scheduledFor??''));
 const publishedIds=new Set((publishedRows.data??[]).map(d=>d.publication_id));
 const published=views.filter(v=>publishedIds.has(v.id));

 const settingsByClient=new Map((clientSettings.data??[]).map(s=>[s.client_id as string,s as {auto_prepare_enabled:boolean;generation_enabled:boolean;prepare_lead_days:number;media_reuse_allowed:boolean;media_reuse_after_days:number}]));
 const health=((accounts.data??[]) as AccountRow[]).map(a=>accountHealth(a,(connections.data??[]) as ConnectionRow[],now));
 const runRows=runs.error?[]:(runs.data??[]) as {client_id:string;status:string;error_code:string|null;created_at:string;completed_at:string|null}[];
 const projectOf=(clientId:string)=>(agents.data??[]).find(a=>a.client_id===clientId)?.project_id as string|undefined??publications.find(p=>p.client_id===clientId)?.project_id??occ.find(o=>o.client_id===clientId)?.project_id??null;
 const concerned=(clients.data??[]).map(c=>{const s=settingsByClient.get(c.id);
  const agentProjects=(agents.data??[]).filter(a=>a.client_id===c.id&&a.enabled&&a.rights_confirmed).map(a=>a.project_id as string);
  const run=runRows.find(r=>r.client_id===c.id);
  return {id:c.id,name:c.name,autoPrepare:s?.auto_prepare_enabled===true,generation:s?.generation_enabled===true,leadDays:s?.prepare_lead_days??3,
   reuse:{allowed:s?.media_reuse_allowed===true,afterDays:s?.media_reuse_after_days??180},
   agentProjects,accounts:health.filter(h=>h.clientId===c.id),projectId:projectOf(c.id),lastRun:run?agentRunView(run):null};})
  // Seuls les clients concernés par les Publications : agent, comptes, préparation automatique ou publications.
  .filter(c=>c.agentProjects.length||c.accounts.length||c.autoPrepare||publications.some(p=>p.client_id===c.id));
 // Photothèque : un seul point de lecture (remplaçable par les modèles de lecture #42 / #43).
 const coverage=await loadClientPhotoCoverage(db as unknown as Parameters<typeof loadClientPhotoCoverage>[0],concerned,now);
 const supervised:ClientSupervision[]=concerned.map(c=>{const cov=coverage?.get(c.id);
  return {id:c.id,name:c.name,autoPrepare:c.autoPrepare,generation:c.generation,leadDays:c.leadDays,agentProjects:c.agentProjects,accounts:c.accounts,projectId:c.projectId,lastRun:c.lastRun,
   photos:cov?.photos??null,tooFewPhotos:cov?.tooFewPhotos===true};});
 const tasks=upcomingTasks(occ.filter(o=>supervised.some(c=>c.agentProjects.includes(o.project_id))),
  new Map(supervised.map(c=>[c.id,{autoPrepare:c.autoPrepare&&c.generation,leadDays:c.leadDays}])),now);
 const s=settings.data as {emergency_stop:boolean;automation_enabled:boolean;generation_enabled:boolean;publishing_enabled:boolean}|null;
 return {settings:s?{emergencyStop:s.emergency_stop,automation:s.automation_enabled,generation:s.generation_enabled,publishing:s.publishing_enabled}:null,
  scheduledDelivery:options.scheduledDelivery===true,
  clients:supervised,scheduled,errors,published,tasks,
  counts:{pendingReview:views.filter(v=>v.status==='pending_review').length,scheduled:scheduled.length,published:(publishedRows.data??[]).length,errors:errors.length,
   connected:health.filter(h=>h.state==='connected').length,reconnect:health.filter(h=>h.state==='reconnect').length}};
}
export const isErrorDeliveryStatus=(status:string)=>(ERROR_DELIVERY_STATUSES as readonly string[]).includes(status);

// --- Actions (admin, une RPC chacune, re-vérifiées en base) ---
type Result={ok:boolean;message:string;publicationId?:string};
function rescheduleRefusal(error:{code?:string;message?:string}):string{
 const m=error.message??'';
 if(error.code==='40001')return 'La publication a changé entre-temps : rechargez la page.';
 if(/Resolve deliveries/i.test(m))return 'Une diffusion est en cours, envoyée ou à vérifier : reprogrammation impossible.';
 if(/cannot be rescheduled/i.test(m))return 'Une publication refusée ne peut pas être reprogrammée : modifiez-la d’abord.';
 if(/already has a publication/i.test(m))return 'Ce créneau est déjà pris : choisissez-en un autre.';
 if(/in the past/i.test(m))return 'Ce créneau est passé : choisissez-en un autre.';
 if(/Archived/i.test(m))return 'Publication archivée.';
 if(/Library photo no longer publishable/i.test(m))return 'Une photo de la photothèque n’est plus publiable (rejetée, archivée, confidentielle ou hors sujet) : remplacez-la avant de reprogrammer.';
 return 'Reprogrammation non confirmée. Rechargez la page.';
}
export async function reschedulePublication(publicationId:unknown,revisionId:unknown,occurrenceId:unknown):Promise<Result>{
 const {userId}=await requireAdmin();
 if(!isPublicationUuid(publicationId)||!isPublicationUuid(revisionId)||!isPublicationUuid(occurrenceId))return {ok:false,message:'Choisissez un nouveau créneau.'};
 const {data,error}=await getSupabaseServerClient().rpc('publication_reschedule',{p_publication_id:publicationId,p_expected_revision_id:revisionId,p_occurrence_id:occurrenceId,p_actor_id:userId});
 if(error||!data)return {ok:false,message:error?rescheduleRefusal(error):'Reprogrammation non confirmée. Rechargez la page.'};
 const r=data as {publication_id?:string;status?:string};
 return {ok:true,publicationId:r.publication_id,message:r.status==='draft'?'Publication reprogrammée (brouillon).':'Publication reprogrammée : nouvelle validation nécessaire avant diffusion.'};
}
// « Suspendre » une publication programmée : ses diffusions pas encore envoyées sont annulées. Le planificateur ne les
// recrée jamais pour cette révision ; pour reprendre, la modifier ou la reprogrammer.
export async function suspendPublicationDelivery(publicationId:unknown):Promise<Result>{
 const {userId}=await requireAdmin();if(!isPublicationUuid(publicationId))return {ok:false,message:'Publication invalide.'};
 const db=getSupabaseServerClient();
 const rows=await db.from('publication_deliveries').select('id').eq('publication_id',publicationId).in('status',['scheduled','retryable_error','blocked']);
 if(rows.error)return {ok:false,message:'Suspension non confirmée.'};
 if(!rows.data?.length)return {ok:false,message:'Aucune diffusion à suspendre pour cette publication.'};
 for(const d of rows.data){const r=await db.rpc('publication_delivery_cancel',{p_delivery_id:d.id,p_actor_id:userId});if(r.error)return {ok:false,message:'Suspension partielle : rechargez la page.'};}
 return {ok:true,message:'Diffusion suspendue. Modifiez ou reprogrammez la publication pour la relancer.'};
}
// « Suspendre » la préparation automatique d'un client (les autres réglages sont inchangés). Reprise depuis la fiche client.
export async function suspendClientAutomation(clientId:unknown):Promise<Result>{
 const {userId}=await requireAdmin();if(!isPublicationUuid(clientId))return {ok:false,message:'Client invalide.'};
 const {error}=await getSupabaseServerClient().rpc('publication_client_settings_save',{p_client_id:clientId,p_settings:{auto_prepare_enabled:false},p_actor_id:userId});
 return error?{ok:false,message:'Suspension non confirmée.'}:{ok:true,message:'Préparation automatique suspendue pour ce client.'};
}
