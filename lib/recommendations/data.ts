import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit-logs";
import { validateAgentContext } from "@/lib/agents/scope";
import type { RecommendationRecord, RecommendationResult, RecommendationStatus, RecommendationStatusResult } from "./types";
import { canTransitionRecommendation, isRecommendationUuid, recommendationStatuses, validateRecommendationInput } from "./validation";

const columns = "id,agent_id,client_id,project_id,title,reason,severity,status,payload,created_at,updated_at,agent:agents(id,name),client:clients(id,name),project:projects(id,name)";
const genericError = "Impossible de traiter cette recommandation. Actualisez l’état et réessayez.";

function auditSnapshot(item: RecommendationRecord) {
  return { id: item.id, agent_id: item.agent_id, client_id: item.client_id, project_id: item.project_id, title: item.title, severity: item.severity, status: item.status, created_at: item.created_at, updated_at: item.updated_at };
}

function storageFailure(operation: "list" | "detail" | "create" | "status"): never {
  console.error(`[recommendations] Échec du stockage (${operation}).`);
  throw new Error("Le stockage des recommandations est indisponible. Réessayez plus tard.");
}

export async function listRecommendations(filters: { status?: string; clientId?: string; agentId?: string; projectId?: string; limit?: number } = {}): Promise<RecommendationRecord[]> {
  await requireAdmin();
  if (filters.clientId && !isRecommendationUuid(filters.clientId)) return [];
  if (filters.agentId && !isRecommendationUuid(filters.agentId)) return [];
  if (filters.projectId && !isRecommendationUuid(filters.projectId)) return [];
  if (filters.status && !recommendationStatuses.includes(filters.status as RecommendationStatus)) return [];
  try {
    let query = getSupabaseServerClient().from("recommendations").select(columns).order("created_at", { ascending: false });
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

export async function getRecommendationById(id: string): Promise<RecommendationRecord | null> {
  await requireAdmin();
  if (!isRecommendationUuid(id)) return null;
  try {
    const { data, error } = await getSupabaseServerClient().from("recommendations").select(columns).eq("id", id).maybeSingle();
    if (error) throw new Error();
    return data;
  } catch { storageFailure("detail"); }
}

export async function listRecommendationsByClient(clientId: string, limit?: number): Promise<RecommendationRecord[]> {
  return listRecommendations({ clientId, limit });
}

export async function listRecommendationsByAgent(agentId: string, limit = 5): Promise<RecommendationRecord[]> {
  return listRecommendations({ agentId, limit });
}

export async function createRecommendation(input: unknown): Promise<RecommendationResult> {
  const { userId } = await requireAdmin();
  const validInput = validateRecommendationInput(input);
  if (!validInput) return { ok: false, message: genericError };
  try {
    const supabase = getSupabaseServerClient();
    const [{ data: agent, error: agentError }, { data: client, error: clientError }] = await Promise.all([
      supabase.from("agents").select("id,status,enabled,agent_scope,scope_review_required").eq("id", validInput.agent_id).maybeSingle(),
      supabase.from("clients").select("id").eq("id", validInput.client_id).maybeSingle(),
    ]);
    if (agentError || clientError) throw new Error();
    if (!agent || !client) return { ok: false, message: genericError };
    if (!agent.enabled || agent.status!=="Actif" || !await validateAgentContext(supabase,agent,validInput.client_id,validInput.project_id??null)) return {ok:false,message:genericError};
    const { data, error } = await supabase.from("recommendations").insert(validInput).select(columns).single();
    if (error || !data) throw new Error();
    const internalTest = !Array.isArray(validInput.payload) && typeof validInput.payload === "object" && validInput.payload !== null && validInput.payload.internal_test === true;
    await writeAuditLog({
      action: "recommendation.created",
      actor_type: internalTest ? "system" : "admin",
      actor_id: internalTest ? null : userId,
      resource_type: "recommendation",
      resource_id: data.id,
      before_data: null,
      after_data: auditSnapshot(data),
      metadata: {},
    });
    return { ok: true, recommendation: data };
  } catch { storageFailure("create"); }
}

export async function updateRecommendationStatus(id: string, status: unknown): Promise<RecommendationStatusResult> {
  const { userId } = await requireAdmin();
  if (!isRecommendationUuid(id) || typeof status !== "string" || !recommendationStatuses.includes(status as RecommendationStatus)) {
    return { ok: false, message: genericError };
  }
  try {
    const supabase = getSupabaseServerClient();
    const { data: before, error: readError } = await supabase.from("recommendations").select(columns).eq("id", id).maybeSingle();
    if (readError) throw new Error();
    if (!before || !canTransitionRecommendation(before.status, status as RecommendationStatus)) return { ok: false, message: genericError };
    const { data: after, error: updateError } = await supabase.from("recommendations").update({ status }).eq("id", id).eq("status", before.status).select(columns).maybeSingle();
    if (updateError) throw new Error();
    if (!after) return { ok: false, message: genericError };
    await writeAuditLog({
      action: "recommendation.status_changed",
      actor_type: "admin",
      actor_id: userId,
      resource_type: "recommendation",
      resource_id: id,
      before_data: auditSnapshot(before),
      after_data: auditSnapshot(after),
      metadata: { from_status: before.status, to_status: status },
    });
    return { ok: true, recommendation: after };
  } catch { storageFailure("status"); }
}
