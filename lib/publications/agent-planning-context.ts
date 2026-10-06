import "server-only";
import {requireAdmin} from "@/lib/require-admin";
import {getSupabaseServerClient} from "@/lib/supabase/server";
import {validateAgentContext} from "@/lib/agents/scope";
import {isPublicationUuid} from "./validation";
import {getProjectCadence,planningRows,projectPlanningJobs} from "./planning";
import {listPublications} from "./data";
import {buildEditorialCalendar} from "./calendar";
import type {PublicationAsset,CalendarSlot,PublicationReview,PublicationRevision,PublicationVariant} from "./types";

// Context preparation only. This function does not create agents, runs or text.
export async function buildPublicationsAgentContext(agentId:string,projectId:string,startWeek:string){
 await requireAdmin();if(!isPublicationUuid(agentId)||!isPublicationUuid(projectId))throw Error("Périmètre invalide.");const db=getSupabaseServerClient();
 const [agent,project]=await Promise.all([db.from("agents").select("id,agent_scope,scope_review_required,enabled,status").eq("id",agentId).maybeSingle(),db.from("projects").select("id,client_id,name,type").eq("id",projectId).maybeSingle()]);
 if(agent.error||project.error||!agent.data||!project.data||!agent.data.enabled||!await validateAgentContext(db,agent.data,project.data.client_id,projectId))throw Error("Agent projet confirmé et assignations actives requis.");
 const clientId=project.data.client_id;
 const [client,rules,cadence,publications,reservations,photos,reviews,jobs,revisions,variants]=await Promise.all([
  db.from("clients").select("id,name").eq("id",clientId).single(),db.from("publication_client_settings").select("editorial_brief,timezone").eq("client_id",clientId).maybeSingle(),getProjectCadence(projectId),listPublications(clientId,projectId),
  planningRows<CalendarSlot>(()=>db.from("publication_calendar_slots").select("*").eq("client_id",clientId).eq("project_id",projectId).order("id")),
  planningRows<PublicationAsset>(()=>db.from("publication_assets").select("*").eq("client_id",clientId).eq("rights_confirmed",true).order("id")),
  planningRows<PublicationReview>(()=>db.from("publication_reviews").select("*").eq("client_id",clientId).order("id")),projectPlanningJobs(projectId),
  planningRows<PublicationRevision>(()=>db.from("publication_revisions").select("*").eq("client_id",clientId).eq("project_id",projectId).order("id")),
  planningRows<PublicationVariant>(()=>db.from("publication_variants").select("*").eq("client_id",clientId).order("id"))]);
 if(client.error||rules.error)throw Error("Contexte indisponible.");
 const projectReviews=reviews.filter(r=>revisions.some(revision=>revision.id===r.revision_id));
 return {client:client.data,project:project.data,rules:rules.data,cadence,calendar:reservations,publications,revisions,variants:variants.filter(v=>revisions.some(r=>r.id===v.revision_id)),photos:photos.map(({id,provenance,mime_type,width,height})=>({id,provenance,mime_type,width,height})),reviews:projectReviews,jobs,slots_to_fill:cadence?buildEditorialCalendar({id:clientId},project.data,cadence,{start_week:startWeek},publications,reservations).filter(s=>!s.publication_id||publications.find(p=>p.id===s.publication_id)?.current_revision_id===null):[],manual_approval_required:true as const,execution_enabled:false as const};
}
