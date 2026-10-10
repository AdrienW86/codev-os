import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit-logs";
import type { AgentAssignmentRecord, AgentFormState, AgentMutationResult, AgentRecord, AssignmentMutationResult, ClientAgentAssignmentRecord } from "./types";
import { isAgentUuid, validateAgentForm, validateAssignmentIds } from "./validation";

const agentColumns = "id,name,description,status,instructions,model,schedule,autonomy_level,enabled,max_monthly_budget_eur,created_at,updated_at,agent_scope,scope_review_required,agent_type";
const assignmentColumns = `agent_id,client_id,enabled,client_instructions,created_at,agent:agents(${agentColumns})`;
const genericAssignmentError = "Impossible de mettre à jour cette assignation. Vérifiez les informations et réessayez.";

function agentAuditSnapshot(agent: AgentRecord) {
  return {
    id: agent.id,
    agent_scope: agent.agent_scope,
    scope_review_required: agent.scope_review_required,
    status: agent.status,
    autonomy_level: agent.autonomy_level,
    enabled: agent.enabled,
    max_monthly_budget_eur: agent.max_monthly_budget_eur,
  };
}

function assignmentAuditSnapshot(assignment: { agent_id: string; client_id: string; enabled: boolean }) {
  return { agent_id: assignment.agent_id, client_id: assignment.client_id, enabled: assignment.enabled };
}

function storageFailure(operation: "list" | "detail" | "create" | "update" | "assignment"): never {
  console.error(`[agents] Échec du stockage (${operation}).`);
  throw new Error("Le stockage des agents est indisponible. Réessayez plus tard.");
}

export async function listAgents(): Promise<AgentRecord[]> {
  await requireAdmin();
  try {
    const { data, error } = await getSupabaseServerClient().from("agents").select(agentColumns).order("name");
    if (error) throw new Error();
    return data ?? [];
  } catch { storageFailure("list"); }
}

export async function getAgentById(id: string): Promise<AgentRecord | null> {
  await requireAdmin();
  if (!isAgentUuid(id)) return null;
  try {
    const { data, error } = await getSupabaseServerClient().from("agents").select(agentColumns).eq("id", id).maybeSingle();
    if (error) throw new Error();
    return data;
  } catch { storageFailure("detail"); }
}

async function existingAgentWithName(name: string, excludingId?: string) {
  let query = getSupabaseServerClient().from("agents").select("id").eq("name", name);
  if (excludingId) query = query.neq("id", excludingId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error();
  return data;
}

function duplicateNameState(values: AgentFormState["values"]): AgentFormState {
  return { errors: { name: "Un agent porte déjà ce nom." }, values };
}

export async function createAgent(formData: FormData): Promise<AgentMutationResult> {
  const { userId } = await requireAdmin();
  const validation = validateAgentForm(formData);
  if (!validation.ok) return { ok: false, state: validation.state };
  try {
    if (await existingAgentWithName(validation.data.name)) return { ok: false, state: duplicateNameState(validation.values) };
    const { data, error } = await getSupabaseServerClient().from("agents").insert(validation.data).select(agentColumns).single();
    if (error?.code === "23505") return { ok: false, state: duplicateNameState(validation.values) };
    if (error || !data) throw new Error();
    await writeAuditLog({ action: "agent.created", actor_type: "admin", actor_id: userId, resource_type: "agent", resource_id: data.id, before_data: null, after_data: agentAuditSnapshot(data), metadata: {} });
    return { ok: true, id: data.id };
  } catch { storageFailure("create"); }
}

export async function updateAgent(formData: FormData): Promise<AgentMutationResult> {
  const { userId } = await requireAdmin();
  const validation = validateAgentForm(formData, true);
  if (!validation.ok) return { ok: false, state: validation.state };
  const id = validation.id as string;
  try {
    const supabase = getSupabaseServerClient();
    const { data: before, error: readError } = await supabase.from("agents").select(agentColumns).eq("id", id).maybeSingle();
    if (readError) throw new Error();
    if (!before) return { ok: false, state: { errors: { id: "Agent indisponible." }, values: validation.values } };
    if (await existingAgentWithName(validation.data.name, id)) return { ok: false, state: duplicateNameState(validation.values) };
    const { data, error } = await supabase.from("agents").update(validation.data).eq("id", id).select(agentColumns).maybeSingle();
    if (error?.code === "23505") return { ok: false, state: duplicateNameState(validation.values) };
    if (error) throw new Error();
    if (!data) return { ok: false, state: { errors: { id: "Agent indisponible." }, values: validation.values } };
    await writeAuditLog({ action: "agent.updated", actor_type: "admin", actor_id: userId, resource_type: "agent", resource_id: id, before_data: agentAuditSnapshot(before), after_data: agentAuditSnapshot(data), metadata: {} });
    return { ok: true, id: data.id };
  } catch {
    console.error("[agents] Échec de la modification ou de son audit.");
    return { ok: false, state: { message: "Impossible de confirmer la modification. Rechargez la page pour vérifier l’état de l’agent avant de réessayer.", values: validation.values } };
  }
}

export async function deleteAgent(formData: FormData): Promise<AgentMutationResult> {
  const { userId } = await requireAdmin();
  const ids = formData.getAll("id");
  const confirmations = formData.getAll("confirmed");
  if (ids.length !== 1 || typeof ids[0] !== "string" || !isAgentUuid(ids[0]) || confirmations.length !== 1 || confirmations[0] !== "true") {
    return { ok: false, state: { message: "Confirmez explicitement la suppression de cet agent." } };
  }
  const id = ids[0];
  try {
    const supabase = getSupabaseServerClient();
    const { data: before, error: readError } = await supabase.from("agents").select(agentColumns).eq("id", id).maybeSingle();
    if (readError) throw new Error();
    if (!before) return { ok: false, state: { message: "Cet agent n’est plus disponible." } };
    const { data, error } = await supabase.from("agents").delete().eq("id", id).select("id").maybeSingle();
    if (error?.code === "23503") return { ok: false, state: { message: "Suppression impossible : cet agent est encore lié à d’autres éléments. Vérifiez ses relations avant de réessayer." } };
    if (error) throw new Error();
    if (!data) return { ok: false, state: { message: "Cet agent n’est plus disponible." } };
    await writeAuditLog({ action: "agent.deleted", actor_type: "admin", actor_id: userId, resource_type: "agent", resource_id: id, before_data: agentAuditSnapshot(before), after_data: null, metadata: {} });
    return { ok: true, id };
  } catch {
    console.error("[agents] Échec de la suppression ou de son audit.");
    return { ok: false, state: { message: "Impossible de confirmer la suppression. Rechargez la liste des agents pour vérifier son état avant de réessayer." } };
  }
}

export async function listAgentsForClient(clientId: string): Promise<AgentAssignmentRecord[]> {
  await requireAdmin();
  try {
    const { data, error } = await getSupabaseServerClient().from("agent_client_assignments").select(assignmentColumns).eq("client_id", clientId).order("created_at");
    if (error) throw new Error();
    return data ?? [];
  } catch { storageFailure("assignment"); }
}

export async function listClientsForAgent(agentId: string): Promise<ClientAgentAssignmentRecord[]> {
  await requireAdmin();
  try {
    const { data, error } = await getSupabaseServerClient().from("agent_client_assignments").select("agent_id,client_id,enabled,client_instructions,created_at,client:clients(id,name)").eq("agent_id", agentId).order("created_at");
    if (error) throw new Error();
    return data ?? [];
  } catch { storageFailure("assignment"); }
}

export async function assignAgentToClient(agentId: string, clientId: string, clientInstructions?: string): Promise<AssignmentMutationResult> {
  const { userId } = await requireAdmin();
  if (!validateAssignmentIds(agentId, clientId) || typeof clientInstructions !== "undefined" && (typeof clientInstructions !== "string" || clientInstructions.length > 3000)) {
    return { ok: false, message: genericAssignmentError };
  }
  const instructions = clientInstructions?.trim() || null;
  try {
    const supabase = getSupabaseServerClient();
    const [{ data: agent, error: agentError }, { data: client, error: clientError }, { data: existing, error: assignmentError }] = await Promise.all([
      supabase.from("agents").select("id").eq("id", agentId).maybeSingle(),
      supabase.from("clients").select("id").eq("id", clientId).maybeSingle(),
      supabase.from("agent_client_assignments").select("agent_id").eq("agent_id", agentId).eq("client_id", clientId).maybeSingle(),
    ]);
    if (agentError || clientError || assignmentError) throw new Error();
    if (!agent || !client) return { ok: false, message: genericAssignmentError };
    if (existing) return { ok: false, message: "Cet agent est déjà assigné à ce client." };
    const { error } = await supabase.from("agent_client_assignments").insert({ agent_id: agentId, client_id: clientId, enabled: true, client_instructions: instructions });
    if (error?.code === "23505") return { ok: false, message: "Cet agent est déjà assigné à ce client." };
    if (error) throw new Error();
    await writeAuditLog({
      action: "agent.assignment_created",
      actor_type: "admin",
      actor_id: userId,
      resource_type: "agent_assignment",
      resource_id: null,
      before_data: null,
      after_data: { agent_id: agentId, client_id: clientId, enabled: true },
      metadata: { client_instructions_present: Boolean(instructions) },
    });
    return { ok: true };
  } catch { storageFailure("assignment"); }
}

export async function updateAgentClientAssignment(agentId: string, clientId: string, enabled: boolean, clientInstructions: string): Promise<AssignmentMutationResult> {
  const { userId } = await requireAdmin();
  if (!validateAssignmentIds(agentId, clientId) || typeof enabled !== "boolean" || typeof clientInstructions !== "string" || clientInstructions.length > 3000) {
    return { ok: false, message: genericAssignmentError };
  }
  const instructions = clientInstructions.trim() || null;
  try {
    const supabase = getSupabaseServerClient();
    const { data: existing, error: lookupError } = await supabase.from("agent_client_assignments").select("agent_id,client_id,enabled,client_instructions").eq("agent_id", agentId).eq("client_id", clientId).maybeSingle();
    if (lookupError) throw new Error();
    if (!existing) return { ok: false, message: genericAssignmentError };
    const { data, error } = await supabase.from("agent_client_assignments").update({ enabled, client_instructions: instructions }).eq("agent_id", agentId).eq("client_id", clientId).select("agent_id,client_id,enabled,client_instructions").maybeSingle();
    if (error || !data) throw new Error();
    await writeAuditLog({
      action: "agent.assignment_updated",
      actor_type: "admin",
      actor_id: userId,
      resource_type: "agent_assignment",
      resource_id: null,
      before_data: assignmentAuditSnapshot(existing),
      after_data: assignmentAuditSnapshot(data),
      metadata: { client_instructions_changed: (existing.client_instructions ?? null) !== instructions },
    });
    return { ok: true };
  } catch { storageFailure("assignment"); }
}

export async function removeAgentFromClient(agentId: string, clientId: string): Promise<AssignmentMutationResult> {
  const { userId } = await requireAdmin();
  if (!validateAssignmentIds(agentId, clientId)) return { ok: false, message: genericAssignmentError };
  try {
    const supabase = getSupabaseServerClient();
    const { data: existing, error: lookupError } = await supabase.from("agent_client_assignments").select("agent_id,client_id,enabled,client_instructions").eq("agent_id", agentId).eq("client_id", clientId).maybeSingle();
    if (lookupError) throw new Error();
    if (!existing) return { ok: false, message: genericAssignmentError };
    const { error } = await supabase.from("agent_client_assignments").delete().eq("agent_id", agentId).eq("client_id", clientId);
    if (error) throw new Error();
    await writeAuditLog({
      action: "agent.assignment_removed",
      actor_type: "admin",
      actor_id: userId,
      resource_type: "agent_assignment",
      resource_id: null,
      before_data: assignmentAuditSnapshot(existing),
      after_data: null,
      metadata: { client_instructions_present: Boolean(existing.client_instructions) },
    });
    return { ok: true };
  } catch { storageFailure("assignment"); }
}
