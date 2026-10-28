import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { auditedMutation } from "@/lib/core/audited-mutation";
import { validateAgentContext } from "@/lib/agents/scope";
import type { InternalActionRecord, ActionResult } from "./types";
import { canTransitionAction, isActionUuid, isValidActionParameters, validateCreateActionInput } from "./validation";
import { getActionType } from "./registry";

const columns = "id,recommendation_id,agent_id,client_id,project_id,action_type,parameters,status,requires_approval,approved_at,executed_at,result,error_message,created_at,updated_at,payload_hash,approved_payload_hash,approved_by,execution_mode,agent:agents(id,name),client:clients(id,name),project:projects(id,name),recommendation:recommendations(id,title)";
const genericError = "Impossible de traiter cette action. Rechargez l’état et réessayez.";

function storageFailure(operation: "list" | "detail" | "create" | "transition" | "execute"): never {
  console.error(`[actions] Échec du stockage (${operation}).`);
  throw new Error("Le stockage des actions est indisponible. Réessayez plus tard.");
}


// Colonnes conservées dans le journal d’audit (identifiants, statut, dates ; jamais les paramètres).
const AUDIT_COLUMNS = ["id", "recommendation_id", "agent_id", "client_id", "project_id", "action_type", "status", "requires_approval", "approved_at", "executed_at"] as const;
async function readAction(id: string): Promise<InternalActionRecord | null> {
  const { data, error } = await getSupabaseServerClient().from("actions").select(columns).eq("id", id).maybeSingle();
  if (error) throw new Error();
  return data;
}
/** Mise à jour d'action + journal dans une seule transaction (audit P1-03), seulement si le statut attendu est toujours vrai. */
async function auditedActionUpdate(id: string, expectedStatus: string, values: Record<string, unknown>, audit: Parameters<typeof auditedMutation>[0]["audit"]) {
  const row = await auditedMutation<{ id: string }>({ table: "actions", operation: "update", id, values, expected: { status: expectedStatus }, columns: ["id"], auditColumns: AUDIT_COLUMNS, audit });
  return row ? readAction(id) : null;
}

async function hasValidActionContext(supabase: ReturnType<typeof getSupabaseServerClient>, action: InternalActionRecord) {
  if (!action.recommendation_id || !isValidActionParameters(action.action_type, action.parameters)) return false;
  const [{ data: agent, error: agentError }, { data: client, error: clientError }, { data: recommendation, error: recommendationError }, { data: assignment, error: assignmentError }] = await Promise.all([
    supabase.from("agents").select("id,status,enabled,agent_scope,scope_review_required").eq("id", action.agent_id).maybeSingle(),
    supabase.from("clients").select("id").eq("id", action.client_id).maybeSingle(),
    supabase.from("recommendations").select("id,agent_id,client_id,project_id").eq("id", action.recommendation_id).maybeSingle(),
    supabase.from("agent_client_assignments").select("enabled").eq("agent_id", action.agent_id).eq("client_id", action.client_id).maybeSingle(),
  ]);
  if (agentError || clientError || recommendationError || assignmentError) throw new Error();
  return Boolean(agent?.enabled && agent.status === "Actif" && client && assignment?.enabled && recommendation?.agent_id === action.agent_id && recommendation?.client_id === action.client_id
    && (recommendation?.project_id??null)===(action.project_id??null) && await validateAgentContext(supabase,agent,action.client_id,action.project_id??null));
}

export async function listActions(filters: { status?: string; clientId?: string; agentId?: string; projectId?: string; limit?: number } = {}): Promise<InternalActionRecord[]> {
  await requireAdmin();
  if (filters.clientId && !isActionUuid(filters.clientId)) return [];
  if (filters.agentId && !isActionUuid(filters.agentId)) return [];
  if (filters.projectId && !isActionUuid(filters.projectId)) return [];
  try {
    let query = getSupabaseServerClient().from("actions").select(columns).order("created_at", { ascending: false });
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.clientId) query = query.eq("client_id", filters.clientId);
    if (filters.agentId) query = query.eq("agent_id", filters.agentId);
    if (filters.projectId) query = query.eq("project_id", filters.projectId);
    if (filters.limit) query = query.limit(Math.max(1, Math.min(50, Math.trunc(filters.limit))));
    const { data, error } = await query;
    if (error) throw new Error();
    return data ?? [];
  } catch { storageFailure("list"); }
}

export async function getAction(id: string): Promise<InternalActionRecord | null> {
  await requireAdmin();
  if (!isActionUuid(id)) return null;
  try {
    const { data, error } = await getSupabaseServerClient().from("actions").select(columns).eq("id", id).maybeSingle();
    if (error) throw new Error();
    return data;
  } catch { storageFailure("detail"); }
}

export async function listActionsByRecommendation(recommendationId: string): Promise<InternalActionRecord[]> {
  await requireAdmin();
  if (!isActionUuid(recommendationId)) return [];
  try {
    const { data, error } = await getSupabaseServerClient().from("actions").select(columns).eq("recommendation_id", recommendationId).order("created_at", { ascending: false });
    if (error) throw new Error();
    return data ?? [];
  } catch { storageFailure("list"); }
}

export async function listActionsByAgent(agentId: string, limit = 5): Promise<InternalActionRecord[]> {
  return listActions({ agentId, limit });
}

export async function createAction(input: unknown): Promise<ActionResult> {
  const { userId } = await requireAdmin();
  const validInput = validateCreateActionInput(input);
  if (!validInput) return { ok: false, message: genericError };
  try {
    const supabase = getSupabaseServerClient();
    const { data: recommendation, error: recommendationError } = await supabase.from("recommendations").select("id,agent_id,client_id,project_id").eq("id", validInput.recommendation_id).maybeSingle();
    if (recommendationError) throw new Error();
    if (!recommendation) return { ok: false, message: genericError };
    const [{ data: agent, error: agentError }, { data: client, error: clientError }] = await Promise.all([
      supabase.from("agents").select("id,status,enabled,agent_scope,scope_review_required").eq("id", recommendation.agent_id).maybeSingle(),
      supabase.from("clients").select("id").eq("id", recommendation.client_id).maybeSingle(),
    ]);
    if (agentError || clientError) throw new Error();
    if (!agent?.enabled || agent.status !== "Actif" || !client) return { ok: false, message: genericError };
    const { data: assignment, error: assignmentError } = await supabase.from("agent_client_assignments").select("enabled").eq("agent_id", recommendation.agent_id).eq("client_id", recommendation.client_id).maybeSingle();
    if (assignmentError) throw new Error();
    if (!assignment?.enabled) return { ok: false, message: genericError };
    if (!await validateAgentContext(supabase,agent,recommendation.client_id,recommendation.project_id??null)) return {ok:false,message:genericError};
    const { data: existingActions, error: existingError } = await supabase.from("actions").select("id,status").eq("recommendation_id", recommendation.id).eq("action_type", validInput.action_type);
    if (existingError) throw new Error();
    if ((existingActions ?? []).some((item) => item.status !== "cancelled")) return { ok: false, message: genericError };
    // Création + journal dans une transaction (P1-03) ; l'unicité SQL (P1-04) refuse un doublon concurrent.
    let created: { id: string } | null;
    try {
      created = await auditedMutation<{ id: string }>({ table: "actions", operation: "insert", columns: ["id"], auditColumns: AUDIT_COLUMNS,
        values: { recommendation_id: recommendation.id, agent_id: recommendation.agent_id, client_id: recommendation.client_id, project_id: recommendation.project_id ?? null,
          action_type: validInput.action_type, parameters: validInput.parameters, status: "pending_approval", requires_approval: true },
        audit: { action: "action.created", resource_type: "action", actor_type: "admin", actor_id: userId, metadata: { action_type: validInput.action_type } } });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return { ok: false, message: genericError };
      throw error;
    }
    const data = created ? await readAction(created.id) : null;
    if (!data) throw new Error();
    return { ok: true, action: data };
  } catch { storageFailure("create"); }
}

export async function approveAction(id: string): Promise<ActionResult> {
  return transitionAction(id, "approved");
}

export async function cancelAction(id: string): Promise<ActionResult> {
  return transitionAction(id, "cancelled");
}

/** Refus explicite d'une action en attente de validation (historique conservé). */
export async function rejectAction(id: string): Promise<ActionResult> {
  return transitionAction(id, "rejected");
}

async function transitionAction(id: string, target: "approved" | "cancelled" | "rejected"): Promise<ActionResult> {
  const { userId } = await requireAdmin();
  if (!isActionUuid(id)) return { ok: false, message: genericError };
  try {
    const supabase = getSupabaseServerClient();
    const { data: before, error: readError } = await supabase.from("actions").select(columns).eq("id", id).maybeSingle();
    if (readError) throw new Error();
    if (!before || !canTransitionAction(before.status, target)) return { ok: false, message: genericError };
    if (target === "approved" && (!before.requires_approval || !await hasValidActionContext(supabase, before))) return { ok: false, message: genericError };
    const patch = target === "approved" ? { status: target, approved_at: new Date().toISOString(), approved_by: userId } : { status: target };
    const after = await auditedActionUpdate(id, before.status, patch, {
      action: target === "approved" ? "action.approved" : target === "rejected" ? "action.rejected" : "action.cancelled",
      resource_type: "action", resource_id: id, actor_type: "admin", actor_id: userId, metadata: { payload_hash: before.payload_hash ?? null } });
    if (!after) return { ok: false, message: genericError };
    return { ok: true, action: after };
  } catch { storageFailure("transition"); }
}

async function setExecutionFailed(id: string) {
  await auditedActionUpdate(id, "executing", { status: "failed", error_message: "Échec de l’exécution simulée." },
    { action: "action.failed", resource_type: "action", resource_id: id, actor_type: "system" }).catch(() => null);
}

export async function executeAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  if (!isActionUuid(id)) return { ok: false, message: genericError };
  try {
    const supabase = getSupabaseServerClient();
    const { data: current, error: readError } = await supabase.from("actions").select(columns).eq("id", id).maybeSingle();
    if (readError) throw new Error();
    if (!current || current.status !== "approved" || !current.requires_approval || getActionType(current.action_type)?.executionMode !== "internal"
      || (current.approved_payload_hash !== undefined && current.approved_payload_hash !== current.payload_hash) || !await hasValidActionContext(supabase, current)) {
      return { ok: false, message: genericError };
    }
    // Démarrage + journal dans une transaction : si le journal échoue, l'action reste « approuvée ».
    const executing = await auditedActionUpdate(id, "approved", { status: "executing" },
      { action: "action.execution_started", resource_type: "action", resource_id: id, actor_type: "system", metadata: { action_type: "internal.test" } });
    if (!executing) return { ok: false, message: genericError };
    const result = { success: true, message: "Action de test exécutée" };
    let executed: InternalActionRecord | null;
    try {
      executed = await auditedActionUpdate(id, "executing", { status: "executed", executed_at: new Date().toISOString(), result, error_message: null },
        { action: "action.executed", resource_type: "action", resource_id: id, actor_type: "system", metadata: { action_type: "internal.test" } });
    } catch {
      await setExecutionFailed(id);
      return { ok: false, message: genericError };
    }
    if (!executed) return { ok: false, message: genericError };
    return { ok: true, action: executed };
  } catch { storageFailure("execute"); }
}


/**
 * Action « manuelle » approuvée, réalisée par un humain hors de CODE-V OS : confirmation explicite.
 * Le payload reste celui qui a été approuvé (vérifié par le hash en base).
 */
export async function completeManualAction(id: string): Promise<ActionResult> {
  const { userId } = await requireAdmin();
  if (!isActionUuid(id)) return { ok: false, message: genericError };
  try {
    const supabase = getSupabaseServerClient();
    const { data: current, error: readError } = await supabase.from("actions").select(columns).eq("id", id).maybeSingle();
    if (readError) throw new Error();
    if (!current || current.status !== "approved" || getActionType(current.action_type)?.executionMode !== "manual"
      || (current.approved_payload_hash ?? null) !== (current.payload_hash ?? null)) return { ok: false, message: genericError };
    const done = await auditedActionUpdate(id, "approved", { status: "executed", executed_at: new Date().toISOString(), result: { manual: true, confirmed_by: userId } },
      { action: "action.completed_manually", resource_type: "action", resource_id: id, actor_type: "admin", actor_id: userId, metadata: { payload_hash: current.payload_hash ?? null } });
    if (!done) return { ok: false, message: genericError };
    return { ok: true, action: done };
  } catch { storageFailure("execute"); }
}
