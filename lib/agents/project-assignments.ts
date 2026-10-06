import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAgentUuid } from "./validation";
import type { AgentProjectAssignmentRecord, AssignmentMutationResult } from "./types";

export async function listAgentProjectAssignments(filters: { agentId?: string; clientId?: string; projectId?: string } = {}): Promise<AgentProjectAssignmentRecord[]> {
  await requireAdmin();
  if (Object.values(filters).some((value) => value !== undefined && !isAgentUuid(value))) throw new Error("Périmètre invalide.");
  try {
    const result: AgentProjectAssignmentRecord[] = [];
    for (let offset=0; ; offset+=100) {
      let query = getSupabaseServerClient().from("agent_project_assignments")
        .select("agent_id,client_id,project_id,enabled,created_at,updated_at,project:projects(id,name,type),agent:agents(id,name,agent_scope,scope_review_required)")
        .order("project_id").order("agent_id");
      if (filters.agentId) query=query.eq("agent_id",filters.agentId);
      if (filters.clientId) query=query.eq("client_id",filters.clientId);
      if (filters.projectId) query=query.eq("project_id",filters.projectId);
      const { data,error }=await query.range(offset,offset+99);
      if (error) throw new Error();
      result.push(...(data??[]));
      if (!data || data.length<100) return result;
    }
  } catch { console.error("[agent-scope] Lecture des assignations indisponible."); throw new Error("Les périmètres projet sont indisponibles. Vérifiez les migrations."); }
}
export async function setAgentScope(agentId: string, scope: unknown): Promise<AssignmentMutationResult> {
  const { userId }=await requireAdmin();
  if (!isAgentUuid(agentId) || (scope!=="client" && scope!=="project")) return { ok:false,message:"Portée invalide." };
  try {
    const { error }=await getSupabaseServerClient().rpc("agent_set_scope",{p_agent_id:agentId,p_scope:scope,p_actor_id:userId});
    if (error) throw new Error();
    return {ok:true};
  } catch { console.error("[agent-scope] Portée non confirmée."); return {ok:false,message:"Impossible de confirmer la portée. Résolvez les runs en cours et désactivez les assignations projet avant de changer de niveau."}; }
}
export async function setAgentProjectAssignment(agentId: string, projectId: string, enabled: unknown): Promise<AssignmentMutationResult> {
  const { userId }=await requireAdmin();
  if (!isAgentUuid(agentId) || !isAgentUuid(projectId) || typeof enabled!=="boolean") return {ok:false,message:"Assignation projet invalide."};
  try {
    const { error }=await getSupabaseServerClient().rpc("agent_project_assignment_set",{p_agent_id:agentId,p_project_id:projectId,p_enabled:enabled,p_actor_id:userId});
    if (error) throw new Error();
    return {ok:true};
  } catch { console.error("[agent-scope] Assignation projet non confirmée."); return {ok:false,message:"Vérifiez la portée projet confirmée et le rattachement actif au client de ce projet."}; }
}
