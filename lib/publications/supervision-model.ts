// Socle Publications, lot 7 — tableau de supervision. Pur et testable : classement des comptes, compteurs de
// publications et de photos, clients à court de photos, prochaines tâches de l'agent, créneaux de reprogrammation.
import {libraryCandidates,MAX_LIBRARY_CANDIDATES,type LibraryAssessment,type LibraryRow,type LibraryUse,type ReuseSettings} from './agent-v2/library-pool';
import {deliveryView} from './delivery/model';
import type {PublicationPlatform} from './types';

const day=86400000;
// En dessous, l'agent risque de préparer sans photo (la publication ne peut alors pas être approuvée).
export const MIN_AVAILABLE_PHOTOS=6;
export const UPCOMING_TASK_DAYS=14;
export const RESCHEDULE_WINDOW_DAYS=28;

export type AccountRow={id:string;client_id:string;platform:PublicationPlatform;display_name:string|null;status:string;enabled:boolean;connection_id:string|null};
export type ConnectionRow={id:string;client_id:string;provider:string;status:string;expires_at:string|null};
export type AccountHealth={id:string;clientId:string;platform:PublicationPlatform;name:string;state:'connected'|'reconnect';reason:string|null};
// Un compte est connecté si le compte et sa connexion sont actifs et non expirés ; sinon il faut le reconnecter.
export function accountHealth(account:AccountRow,connections:readonly ConnectionRow[],now:Date):AccountHealth{
 const connection=connections.find(c=>c.id===account.connection_id&&c.client_id===account.client_id);
 const base={id:account.id,clientId:account.client_id,platform:account.platform,name:account.display_name??'Compte sans nom'};
 if(!connection)return {...base,state:'reconnect',reason:'Aucune connexion'};
 if(connection.status!=='active')return {...base,state:'reconnect',reason:connection.status==='expired'?'Connexion expirée':connection.status==='revoked'?'Accès révoqué':'Connexion inactive'};
 if(connection.expires_at&&Date.parse(connection.expires_at)<=now.getTime())return {...base,state:'reconnect',reason:'Connexion expirée'};
 if(account.status!=='active'||!account.enabled)return {...base,state:'reconnect',reason:account.enabled?'Compte indisponible':'Compte désactivé'};
 return {...base,state:'connected',reason:null};
}

export type PhotoStats={available:number;capped:boolean;rejected:number;toReview:number};
// Disponibles = photos que l'agent peut réellement proposer (mêmes règles que la sélection, plafonnées).
export function photoStats(rows:readonly LibraryRow[],assessments:readonly LibraryAssessment[],uses:readonly LibraryUse[],reuse:ReuseSettings,now:Date):PhotoStats{
 const available=libraryCandidates(rows,assessments,uses,reuse,new Set(),now).length;
 const live=rows.filter(r=>!r.purged_at&&r.media_kind==='image');
 const assessed=new Map(assessments.map(a=>[a.asset_id,a]));
 return {available,capped:available>=MAX_LIBRARY_CANDIDATES,rejected:live.filter(r=>r.library_status==='rejected').length,
  toReview:live.filter(r=>r.library_status==='quarantined'||(r.library_status==='received'&&assessed.get(r.id)?.verdict==='to_review'&&!assessed.get(r.id)?.manual_verdict)).length};
}
export const tooFewPhotos=(s:PhotoStats)=>s.available<MIN_AVAILABLE_PHOTOS;

export type OccurrenceRow={id:string;client_id:string;project_id:string;platform:PublicationPlatform;scheduled_for:string;publication_id:string|null;skipped_at:string|null};
export type UpcomingTask={occurrenceId:string;clientId:string;projectId:string;platform:PublicationPlatform;scheduledFor:string;prepareFrom:string;automatic:boolean};
// Créneaux encore vides des 14 prochains jours. L'agent les prépare à partir de « créneau − avance du client » quand la
// préparation automatique est active ; sinon ils attendent « Générer maintenant ».
export function upcomingTasks(occurrences:readonly OccurrenceRow[],settings:ReadonlyMap<string,{autoPrepare:boolean;leadDays:number}>,now:Date,limit=12):UpcomingTask[]{
 const end=now.getTime()+UPCOMING_TASK_DAYS*day;
 return occurrences.filter(o=>!o.publication_id&&!o.skipped_at&&Date.parse(o.scheduled_for)>now.getTime()&&Date.parse(o.scheduled_for)<=end)
  .sort((a,b)=>a.scheduled_for.localeCompare(b.scheduled_for)||a.id.localeCompare(b.id)).slice(0,limit)
  .map(o=>{const s=settings.get(o.client_id),lead=s?.leadDays??3;
   return {occurrenceId:o.id,clientId:o.client_id,projectId:o.project_id,platform:o.platform,scheduledFor:o.scheduled_for,
    prepareFrom:new Date(Math.max(now.getTime(),Date.parse(o.scheduled_for)-lead*day)).toISOString(),automatic:s?.autoPrepare===true};});
}
// Créneaux proposés pour reprogrammer une publication : même projet et plateforme, libres, à venir, 4 semaines.
export function rescheduleTargets(occurrences:readonly OccurrenceRow[],publication:{project_id:string;platform:PublicationPlatform;occurrence_id:string},now:Date,limit=10):OccurrenceRow[]{
 const end=now.getTime()+RESCHEDULE_WINDOW_DAYS*day;
 return occurrences.filter(o=>o.project_id===publication.project_id&&o.platform===publication.platform&&o.id!==publication.occurrence_id&&!o.publication_id&&!o.skipped_at
  &&Date.parse(o.scheduled_for)>now.getTime()&&Date.parse(o.scheduled_for)<=end).sort((a,b)=>a.scheduled_for.localeCompare(b.scheduled_for)).slice(0,limit);
}

export type DeliveryRow={id:string;publication_id:string;revision_id:string|null;status:string;scheduled_for:string;updated_at:string};
export type DeliveryState='scheduled'|'published'|'error'|'none';
export const ERROR_DELIVERY_STATUSES=['failed','uncertain','blocked','retryable_error'] as const;
// État de diffusion de la révision courante : la diffusion la plus récente non annulée décide.
export function latestLiveDelivery<T extends DeliveryRow>(deliveries:readonly T[],publicationId:string,revisionId:string|null):T|undefined{
 return deliveries.filter(d=>d.publication_id===publicationId&&d.revision_id===revisionId&&d.status!=='cancelled').sort((a,b)=>b.updated_at.localeCompare(a.updated_at))[0];
}
export function deliveryState(deliveries:readonly DeliveryRow[],publicationId:string,revisionId:string|null):{state:DeliveryState;cancellable:string[]}{
 const own=deliveries.filter(d=>d.publication_id===publicationId&&d.revision_id===revisionId);
 const live=latestLiveDelivery(own,publicationId,revisionId);
 const cancellable=own.filter(d=>d.status==='scheduled'||d.status==='retryable_error'||d.status==='blocked').map(d=>d.id);
 if(!live)return {state:'none',cancellable};
 if(live.status==='published'||live.status==='simulated')return {state:'published',cancellable};
 if((ERROR_DELIVERY_STATUSES as readonly string[]).includes(live.status))return {state:'error',cancellable};
 return {state:'scheduled',cancellable};
}
// Raison sûre d'une diffusion en erreur : celle de la fiche (classe d'erreur et code court, motif de blocage), jamais un
// message du fournisseur. Une publication approuvée dont le créneau est passé sans diffusion a sa propre raison.
export type DeliveryDetailRow=DeliveryRow&{platform?:PublicationPlatform;remote_id?:string|null;blocked_reason?:string|null;last_error_class?:string|null;last_error_code?:string|null};
export const MISSED_SLOT_REASON='Créneau passé sans diffusion : approuvée mais jamais préparée. Reprogrammez-la.';
export function deliveryErrorReason(row:DeliveryDetailRow|undefined):string|null{
 if(!row)return null;
 const v=deliveryView({id:row.id,platform:row.platform as PublicationPlatform,status:row.status,remote_id:row.remote_id??null,blocked_reason:row.blocked_reason??null,
  last_error_class:row.last_error_class??null,last_error_code:row.last_error_code??null},{accountName:null,attempts:0,nextRetryAt:null});
 return v?v.blockedReason??v.lastError??v.statusLabel:null;
}
// Approuvée, créneau passé, aucune diffusion pour la version actuelle : rien ne partira, à signaler.
export const missedSlot=(p:{status:string;scheduledFor:string|null;delivery:DeliveryState},now:Date)=>
 p.status==='approved'&&p.delivery==='none'&&p.scheduledFor!==null&&Date.parse(p.scheduledFor)<=now.getTime();
// Date et heure d'un créneau, heure de Paris (affichage).
export function formatSlot(iso:string|null):string{
 if(!iso||Number.isNaN(Date.parse(iso)))return 'Créneau inconnu';
 return new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(iso));
}

// État de l'agent pour un client (lot 7 mobile) : dernière préparation Agent v2, en libellés sûrs (jamais de texte généré).
export type AgentRunView={state:'running'|'completed'|'failed';label:string;reason:string|null;at:string};
const AGENT_RUN_ERRORS:Record<string,string>={invalid_output:'Contenu généré invalide',unsupported_claim:'Affirmation absente du contexte',occurrence_unavailable:'Créneau devenu indisponible',
 generation_failed:'Génération en échec',context_unavailable:'Contexte du client indisponible',lease_expired:'Préparation interrompue (délai dépassé)'};
export function agentRunView(run:{status:string;error_code:string|null;created_at:string;completed_at:string|null}):AgentRunView{
 const at=run.completed_at??run.created_at;
 if(run.status==='completed')return {state:'completed',label:'Dernière préparation terminée',reason:null,at};
 if(run.status==='failed')return {state:'failed',label:'Dernière préparation en échec',reason:run.error_code?AGENT_RUN_ERRORS[run.error_code]??'Échec non identifié':null,at};
 return {state:'running',label:'Préparation en cours',reason:null,at:run.created_at};
}
// Plateforme → fournisseur de connexion (reconnexion OAuth existante).
export const providerOfPlatform=(platform:PublicationPlatform):'meta'|'google_business_profile'|'tiktok'=>platform==='google_business_profile'?'google_business_profile':platform==='tiktok'?'tiktok':'meta';
