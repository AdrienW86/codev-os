import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentRow, Database } from "@/lib/supabase/database.types";

type ScopeAgent = Pick<AgentRow, "id"> & Partial<Pick<AgentRow, "agent_scope" | "scope_review_required" | "enabled" | "status">>;
export function scopeMatches(agent: ScopeAgent, projectId: string | null): boolean {
  const scope = agent.agent_scope;
  return scope === "client" ? projectId === null : scope === "project" && agent.scope_review_required === false && projectId !== null;
}
export async function validateAgentContext(supabase: SupabaseClient<Database>, agent: ScopeAgent, clientId: string | null, projectId: string | null): Promise<boolean> {
  await requireAdmin();
  if (!clientId || agent.enabled !== true || agent.status !== "Actif" || !scopeMatches(agent, projectId)) return false;
  const { data: assignment, error } = await supabase.from("agent_client_assignments").select("enabled")
    .eq("agent_id", agent.id).eq("client_id", clientId).maybeSingle();
  if (error) throw new Error("Périmètre indisponible.");
  if (!assignment?.enabled) return false;
  if (!projectId) return true;
  const [{ data: project, error: projectError }, { data: projectAssignment, error: projectAssignmentError }] = await Promise.all([
    supabase.from("projects").select("id,client_id").eq("id", projectId).eq("client_id", clientId).maybeSingle(),
    supabase.from("agent_project_assignments").select("enabled").eq("agent_id", agent.id).eq("client_id", clientId).eq("project_id", projectId).maybeSingle(),
  ]);
  if (projectError || projectAssignmentError) throw new Error("Périmètre indisponible.");
  return Boolean(project && projectAssignment?.enabled);
}
