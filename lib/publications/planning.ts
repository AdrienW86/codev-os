import "server-only";
import {requireAdmin} from "@/lib/require-admin";
import {getSupabaseServerClient} from "@/lib/supabase/server";
import {safeSupabaseReadError} from "@/lib/supabase/read-error";
import {isPublicationUuid} from "./validation";
import {getPublicationCapabilitiesForProjects,legacyCalendarBlock} from "./project-channels";
import {legacyProductionBlock} from "./channels";
import {buildEditorialCalendar,calendarStatusLabels,editorialMonday,entryStatus,filterCalendar,validateCadence,type CalendarEntry} from "./calendar";
import {reviewDecisions} from "./review-decisions";
import {listPublications} from "./data";
import {listProjects} from "@/lib/projects/data";
import type {CalendarSlot,PublicationCadence,PublicationDelivery,PublicationRevision,PublicationReview,PublicationEvent,PublicationVariant,PlanningJob} from "./types";

const unavailable="Planification indisponible. Vérifiez que la migration du calendrier a été appliquée avant d’utiliser le Lot 3.";
export async function planningRows<T>(query:()=>{range:(start:number,end:number)=>PromiseLike<{data:T[]|null;error:unknown}>}):Promise<T[]>{await requireAdmin();const result:T[]=[];for(let offset=0;;offset+=100){const {data,error}=await query().range(offset,offset+99);if(error){console.error("[publications] Planification",safeSupabaseReadError(error));throw Error(unavailable);}result.push(...data??[]);if(!data||data.length<100)return result;}}
export async function getProjectCadence(projectId:string):Promise<PublicationCadence|null>{await requireAdmin();if(!isPublicationUuid(projectId))throw Error("Projet invalide.");const {data,error}=await getSupabaseServerClient().from("publication_cadences").select("*").eq("project_id",projectId).maybeSingle();if(error){console.error("[publications] Cadence",safeSupabaseReadError(error));throw Error(unavailable);}return data;}
export async function saveCadence(projectId:string,config:unknown):Promise<{message:string;ok:boolean}>{const {userId}=await requireAdmin();const c=validateCadence(config);if(!isPublicationUuid(projectId)||!c)return {ok:false,message:"Cadence invalide : 1 ou 2 créneaux distincts, horizon 1–12 semaines et validation obligatoire."};const {error}=await getSupabaseServerClient().rpc("publication_save_cadence",{p_project_id:projectId,p_config:c,p_actor_id:userId});if(error){console.error("[publications] Configuration",safeSupabaseReadError(error));return {ok:false,message:unavailable};}return {ok:true,message:"Cadence enregistrée. Les créneaux déjà réservés conservent leur date."};}
export async function ensureCalendar(projectId:string,startWeek:string,placeholders:boolean):Promise<{message:string;ok:boolean}>{const {userId}=await requireAdmin();if(!isPublicationUuid(projectId)||typeof placeholders!=="boolean")return {ok:false,message:"Projet invalide."};try{if(editorialMonday(startWeek)!==startWeek)throw Error();}catch{return {ok:false,message:"Choisissez un lundi valide."};}const blocked=await legacyCalendarBlock(projectId);if(blocked)return {ok:false,message:blocked};const {data,error}=await getSupabaseServerClient().rpc("publication_ensure_calendar",{p_project_id:projectId,p_start_week:startWeek,p_placeholders:placeholders,p_actor_id:userId});if(error){console.error("[publications] Réservation",safeSupabaseReadError(error));return {ok:false,message:"Créneaux non confirmés. Activez la cadence et la réservation, puis vérifiez la migration."};}const result=data as {slots_created:number;placeholders_created:number;conflicts:number};return {ok:true,message:`${result.slots_created} créneau(x) réservé(s), ${result.placeholders_created} brouillon(s) vide(s). ${result.conflicts} conflit(s) à examiner. Aucune publication externe.`};}

export async function getCalendar(filter:{from:string;to:string;client?:string;project?:string;platform?:string;status?:string}):Promise<CalendarEntry[]>{
 await requireAdmin();const db=getSupabaseServerClient();
 const [publications,projects,cadences,slots,revisions,reviews,events,variants,deliveries]=await Promise.all([
  listPublications(),listProjects(),
  planningRows<PublicationCadence>(()=>db.from("publication_cadences").select("*").order("id")),
  planningRows<CalendarSlot>(()=>db.from("publication_calendar_slots").select("*").order("id")),
  planningRows<PublicationRevision>(()=>db.from("publication_revisions").select("*").order("id")),
  planningRows<PublicationReview>(()=>db.from("publication_reviews").select("*").order("id")),
  planningRows<PublicationEvent>(()=>db.from("publication_events").select("*").eq("action","publication.reviewed").order("id")),
  planningRows<PublicationVariant>(()=>db.from("publication_variants").select("*").order("id")),
  planningRows<PublicationDelivery>(()=>db.from("publication_deliveries").select("*").order("id"))]);
 const capabilities=await getPublicationCapabilitiesForProjects(projects),platformsOf=(projectId:string|null|undefined)=>(projectId?capabilities.get(projectId)?.platforms:undefined)??[];
 // Projections of the legacy cadence only for legacy projects; configured projects use channel occurrences (P3).
 // Existing legacy slots and publications stay listed as history.
 const projectable=(projectId:string)=>{const c=capabilities.get(projectId);return Boolean(c&&c.source==="legacy"&&!legacyProductionBlock(c,"calendar"));};
 const decisions=reviewDecisions(reviews,events,variants);const entries:CalendarEntry[]=[];const covered=new Set<string>();
 const make=(s:{key:string;local_date:string;local_time:string|null;timezone:string;client_id:string;project_id:string|null;platforms:CalendarEntry["platforms"];publication_id:string|null},conflict=false)=>{
  const p=publications.find(p=>p.id===s.publication_id),project=projects.find(p=>p.id===s.project_id),revision=revisions.find(r=>r.id===p?.current_revision_id),decision=decisions.find(r=>r.revision_id===p?.current_revision_id);
  if(p)covered.add(p.id);entries.push({key:s.key,date:s.local_date,time:s.local_time?.slice(0,5)??null,timezone:s.timezone,client_id:s.client_id,project_id:s.project_id,client_name:p?.client?.name??project?.client?.name??"Client",project_name:project?.name??"Historique sans projet",subject:p?.subject??"Contenu à préparer",platforms:s.platforms,status:entryStatus(p,deliveries),revision:revision?.revision_number??null,validation:decision?`${calendarStatusLabels[decision.decision]}${decision.reason?` · ${decision.reason}`:""}`:p?.status==="pending_review"?"Validation admin attendue":"Validation obligatoire",publication_id:p?.id??null,origin:p?.creation_origin??null,conflict});
 };
 for(const s of slots)make({...s,key:s.id});
 for(const c of cadences){const project=projects.find(p=>p.id===c.project_id);if(!project||!projectable(project.id))continue;
  const week=editorialMonday(filter.from);for(const s of buildEditorialCalendar({id:c.client_id},project,platformsOf(project.id),c,{start_week:week},publications,slots))if(!s.reservation_id){
   if(s.state==="conflict")make({...s,publication_id:null},true);
   else make({...s,local_time:s.publication_id?null:s.local_time});
  }
 }
 for(const p of publications){if(covered.has(p.id))continue;const project=projects.find(pr=>pr.id===p.project_id);make({key:p.id,local_date:p.target_date??p.editorial_week,local_time:null,timezone:"Europe/Paris",client_id:p.client_id,project_id:p.project_id,platforms:variants.filter(v=>v.revision_id===p.current_revision_id).map(v=>v.platform).length?variants.filter(v=>v.revision_id===p.current_revision_id).map(v=>v.platform):platformsOf(project?.id),publication_id:p.id});}
 return filterCalendar(entries,filter);
}
export async function projectPlanningJobs(projectId:string):Promise<PlanningJob[]>{await requireAdmin();if(!isPublicationUuid(projectId))throw Error("Projet invalide.");const db=getSupabaseServerClient();return planningRows<PlanningJob>(()=>db.from("publication_planning_jobs").select("*").eq("project_id",projectId).order("created_at").order("id"));}
