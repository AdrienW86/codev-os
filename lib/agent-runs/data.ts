import "server-only";
import { isStoredScope } from "@/lib/integrations/google-ads/scope";
import { validInstructionSnapshot } from "@/lib/integrations/google-ads/business-context";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit-logs";
import { createRecommendation } from "@/lib/recommendations/data";
import type { Json } from "@/lib/supabase/database.types";
import type { AgentRunRecord, AgentRunResult, InternalTestRunResult } from "./types";
import { isAgentUuid } from "@/lib/agents/validation";
import { validateAgentContext } from "@/lib/agents/scope";

const columns = "id,agent_id,client_id,project_id,status,started_at,completed_at,summary,input_tokens,output_tokens,estimated_cost_eur,metadata,agent:agents(id,name),client:clients(id,name),project:projects(id,name)";
const genericError = "Impossible de traiter cette exécution. Rechargez l’état et réessayez.";

function storageFailure(operation: "list" | "detail" | "create" | "complete" | "fail"): never {
  console.error(`[agent-runs] Échec du stockage (${operation}).`);
  throw new Error("Le stockage des exécutions est indisponible. Réessayez plus tard.");
}

function runSnapshot(run: AgentRunRecord) {
  return {
    id: run.id,
    agent_id: run.agent_id,
    client_id: run.client_id,
    project_id: run.project_id,
    status: run.status,
    started_at: run.started_at,
    completed_at: run.completed_at,
    summary: run.summary,
    input_tokens: run.input_tokens,
    output_tokens: run.output_tokens,
    estimated_cost_eur: run.estimated_cost_eur,
  };
}

export async function listAgentRuns(filters: { agentId?: string; clientId?: string; projectId?: string; limit?: number } = {}): Promise<AgentRunRecord[]> {
  await requireAdmin();
  if (filters.agentId && !isAgentUuid(filters.agentId)) return [];
  if (filters.clientId && !isAgentUuid(filters.clientId)) return [];
  if (filters.projectId && !isAgentUuid(filters.projectId)) return [];
  try {
    let query = getSupabaseServerClient().from("agent_runs").select(columns).order("started_at", { ascending: false });
    if (filters.agentId) query = query.eq("agent_id", filters.agentId);
    if (filters.clientId) query = query.eq("client_id", filters.clientId);
    if (filters.projectId) query = query.eq("project_id", filters.projectId);
    if (filters.limit) query = query.limit(Math.max(1, Math.min(50, Math.trunc(filters.limit))));
    const { data, error } = await query;
    if (error) throw new Error();
    return data ?? [];
  } catch { storageFailure("list"); }
}

export async function getAgentRun(id: string): Promise<AgentRunRecord | null> {
  await requireAdmin();
  if (!isAgentUuid(id)) return null;
  try {
    const { data, error } = await getSupabaseServerClient().from("agent_runs").select(columns).eq("id", id).maybeSingle();
    if (error) throw new Error();
    return data;
  } catch { storageFailure("detail"); }
}

export async function listRunsByAgent(agentId: string, limit = 5): Promise<AgentRunRecord[]> {
  return listAgentRuns({ agentId, limit });
}

export async function listRunsByClient(clientId: string, limit = 5): Promise<AgentRunRecord[]> {
  return listAgentRuns({ clientId, limit });
}

export async function createAgentRun(input: unknown): Promise<AgentRunResult> {
  const { userId } = await requireAdmin();
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, message: genericError };
  const value = input as Record<string, unknown>;
  if (typeof value.agent_id !== "string" || !isAgentUuid(value.agent_id)) return { ok: false, message: genericError };
  const clientId = value.client_id === null || typeof value.client_id === "undefined" ? null : value.client_id;
  if (clientId !== null && (typeof clientId !== "string" || !isAgentUuid(clientId))) return { ok: false, message: genericError };
  const projectId = value.project_id ?? null;
  if (projectId!==null && (typeof projectId!=="string" || !isAgentUuid(projectId))) return {ok:false,message:genericError};
  const metadata = value.metadata ?? {};
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return { ok: false, message: genericError };
  const metadataRecord = metadata as Record<string, unknown>;
  const internalMetadata = Object.keys(metadataRecord).every((key) => key === "internal_test") && (!("internal_test" in metadataRecord) || metadataRecord.internal_test === true);
  // Analyse Google Ads : type d'exécution, moteur et périmètre explicite (revalidé) uniquement.
  const adsKeys = Object.keys(metadataRecord);
  const adsMetadata = metadataRecord.run_type === "google_ads_read_only" && adsKeys.every((key) => ["run_type", "engine", "scope", "requested_mode", "provider", "model", "instruction_snapshot"].includes(key))
    && (metadataRecord.engine === undefined || metadataRecord.engine === "deterministic" || metadataRecord.engine === "ai")
    && (metadataRecord.scope === undefined || isStoredScope(metadataRecord.scope))
    && (metadataRecord.requested_mode === undefined || metadataRecord.requested_mode === "deterministic" || metadataRecord.requested_mode === "ai")
    && (metadataRecord.provider === undefined || metadataRecord.provider === null || metadataRecord.provider === "openai" || metadataRecord.provider === "anthropic")
    && (metadataRecord.model === undefined || metadataRecord.model === null || typeof metadataRecord.model === "string" && /^[a-zA-Z0-9._:-]{1,128}$/.test(metadataRecord.model))
    && (metadataRecord.instruction_snapshot === undefined || validInstructionSnapshot(metadataRecord.instruction_snapshot));
  if (!internalMetadata && !adsMetadata) return { ok: false, message: genericError };

  try {
    const supabase = getSupabaseServerClient();
    const { data: agent, error: agentError } = await supabase.from("agents").select("id,status,enabled,agent_scope,scope_review_required").eq("id", value.agent_id).maybeSingle();
    if (agentError) throw new Error();
    if (!agent?.enabled || agent.status !== "Actif") return { ok: false, message: genericError };
    if (!await validateAgentContext(supabase,agent,clientId,projectId)) return {ok:false,message:genericError};
    if (clientId) {
      const [{ data: client, error: clientError }, { data: assignment, error: assignmentError }] = await Promise.all([
        supabase.from("clients").select("id").eq("id", clientId).maybeSingle(),
        supabase.from("agent_client_assignments").select("enabled").eq("agent_id", value.agent_id).eq("client_id", clientId).maybeSingle(),
      ]);
      if (clientError || assignmentError) throw new Error();
      if (!client || !assignment?.enabled) return { ok: false, message: genericError };
    }
    const { data, error } = await supabase.from("agent_runs").insert({
      agent_id: value.agent_id,
      client_id: clientId,
      project_id: projectId,
      status: "running",
      started_at: new Date().toISOString(),
      completed_at: null,
      summary: null,
      input_tokens: null,
      output_tokens: null,
      estimated_cost_eur: null,
      metadata: metadata as Json,
    }).select(columns).single();
    if (error || !data) throw new Error();
    await writeAuditLog({
      action: "agent_run.started",
      actor_type: "admin",
      actor_id: userId,
      resource_type: "agent_run",
      resource_id: data.id,
      before_data: null,
      after_data: runSnapshot(data),
      metadata: { internal_test: value.internal_test === true },
    });
    return { ok: true, run: data };
  } catch { storageFailure("create"); }
}

export async function completeAgentRun(id: string, summary: unknown): Promise<AgentRunResult> {
  return finishAgentRun(id, summary, "completed");
}

export async function failAgentRun(id: string, summary: unknown = "Échec de l’exécution interne."): Promise<AgentRunResult> {
  return finishAgentRun(id, summary, "failed");
}

async function finishAgentRun(id: string, summaryValue: unknown, status: "completed" | "failed"): Promise<AgentRunResult> {
  await requireAdmin();
  if (!isAgentUuid(id) || typeof summaryValue !== "string" || !summaryValue.trim() || summaryValue.trim().length > 2000) return { ok: false, message: genericError };
  try {
    const supabase = getSupabaseServerClient();
    const { data: before, error: readError } = await supabase.from("agent_runs").select(columns).eq("id", id).maybeSingle();
    if (readError) throw new Error();
    if (!before || before.status !== "running") return { ok: false, message: genericError };
    const { data: after, error: updateError } = await supabase.from("agent_runs").update({ status, completed_at: new Date().toISOString(), summary: summaryValue.trim() }).eq("id", id).eq("status", "running").select(columns).maybeSingle();
    if (updateError) throw new Error();
    if (!after) return { ok: false, message: genericError };
    await writeAuditLog({
      action: status === "completed" ? "agent_run.completed" : "agent_run.failed",
      actor_type: "system",
      actor_id: null,
      resource_type: "agent_run",
      resource_id: id,
      before_data: runSnapshot(before),
      after_data: runSnapshot(after),
      metadata: {},
    });
    return { ok: true, run: after };
  } catch { storageFailure(status === "completed" ? "complete" : "fail"); }
}

export async function createInternalTestRun(agentId: string, clientId: string, projectId: string | null = null): Promise<InternalTestRunResult> {
  await requireAdmin();
  if (!isAgentUuid(agentId) || !isAgentUuid(clientId)) return { ok: false, message: genericError };
  let runId: string | null = null;
  try {
    const supabase = getSupabaseServerClient();
    const [{ data: agent, error: agentError }, { data: client, error: clientError }, { data: assignment, error: assignmentError }] = await Promise.all([
      supabase.from("agents").select("id,status,enabled,agent_scope,scope_review_required").eq("id", agentId).maybeSingle(),
      supabase.from("clients").select("id").eq("id", clientId).maybeSingle(),
      supabase.from("agent_client_assignments").select("enabled").eq("agent_id", agentId).eq("client_id", clientId).maybeSingle(),
    ]);
    if (agentError || clientError || assignmentError) throw new Error();
    if (!agent?.enabled || agent.status !== "Actif" || !client || !assignment?.enabled) return { ok: false, message: genericError };

    if (projectId!==null && !isAgentUuid(projectId)) return {ok:false,message:genericError};
    if (!await validateAgentContext(supabase,agent,clientId,projectId)) return {ok:false,message:genericError};
    const started = await createAgentRun({ agent_id: agentId, client_id: clientId, project_id: projectId, metadata: { internal_test: true }, internal_test: true });
    if (!started.ok) return { ok: false, message: started.message };
    runId = started.run.id;
    const recommendation = await createRecommendation({
      agent_id: agentId,
      client_id: clientId,
      project_id: started.run.project_id ?? null,
      title: "Recommandation de test interne",
      reason: "Élément déterministe créé par le run de test interne.",
      severity: "info",
      status: "pending",
      payload: { internal_test: true },
    });
    if (!recommendation.ok) {
      await failAgentRun(started.run.id, "Échec du run de test interne.");
      return { ok: false, message: genericError };
    }
    const completed = await completeAgentRun(started.run.id, "Run de test interne");
    if (!completed.ok) {
      await failAgentRun(started.run.id, "Échec du run de test interne.");
      return { ok: false, message: genericError };
    }
    return { ok: true, runId: started.run.id, recommendationId: recommendation.recommendation.id };
  } catch {
    if (runId) {
      try { await failAgentRun(runId, "Échec du run de test interne."); } catch { /* L’état reste à recharger manuellement. */ }
    }
    console.error("[agent-runs] Échec du run de test interne.");
    return { ok: false, message: genericError };
  }
}
