import "server-only";
// Sorties des agents, utilisables par le planificateur et l'assistant (acteur explicite) :
// exécutions (agent_runs), recommandations, actions préparées, incidents.
// Rien ici ne produit d'effet externe : une action n'est qu'une proposition à valider.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import { authorize } from "@/lib/permissions/engine";
import { isAgentType } from "@/lib/agents/registry";
import { getActionType, parseActionParameters } from "@/lib/actions/registry";
import type { Json } from "@/lib/supabase/database.types";

export type AgentRow = { id: string; name: string; agent_type: string | null; enabled: boolean; status: string; autonomy_level: number };

export async function getAgentByType(type: string): Promise<AgentRow | null> {
  const { data, error } = await getSupabaseServerClient().from("agents").select("id,name,agent_type,enabled,status,autonomy_level").eq("agent_type", type).order("created_at");
  if (error) throw new Error("agent read");
  const rows = (data ?? []) as AgentRow[];
  return rows.find((row) => row.enabled && row.status === "Actif") ?? rows[0] ?? null;
}

export async function startRun(input: { agentId: string; clientId: string | null; projectId?: string | null; runType: string; jobId?: string | null }) {
  const { data, error } = await getSupabaseServerClient().from("agent_runs").insert({
    agent_id: input.agentId, client_id: input.clientId, project_id: input.projectId ?? null, status: "running",
    metadata: { run_type: input.runType, job_id: input.jobId ?? null },
  }).select("id").single();
  if (error || !data) throw new Error("run start");
  return data.id as string;
}

export async function finishRun(runId: string, outcome: "completed" | "failed", summary: string) {
  const { error } = await getSupabaseServerClient().from("agent_runs").update({ status: outcome, completed_at: new Date().toISOString(), summary: summary.slice(0, 2000) }).eq("id", runId).eq("status", "running");
  if (error) throw new Error("run finish");
}

/** Recommandation d'un agent ; une recommandation identique encore en attente n'est pas dupliquée. */
export async function recordRecommendation(actor: Actor, input: {
  agentId: string; clientId: string; projectId?: string | null; title: string; reason: string;
  severity: "info" | "low" | "medium" | "high" | "critical"; payload?: Record<string, unknown>;
}) {
  const supabase = getSupabaseServerClient();
  const title = input.title.trim().slice(0, 200);
  const { data: existing, error: readError } = await supabase.from("recommendations").select("id").eq("agent_id", input.agentId).eq("client_id", input.clientId).eq("title", title).eq("status", "pending").limit(1);
  if (readError) throw new Error("recommendation read");
  if (existing?.length) return { id: existing[0].id as string, created: false };
  const { data, error } = await supabase.from("recommendations").insert({
    agent_id: input.agentId, client_id: input.clientId, project_id: input.projectId ?? null, title,
    reason: input.reason.slice(0, 4000), severity: input.severity, status: "pending", payload: (input.payload ?? {}) as Json,
  }).select("id").single();
  if (error || !data) throw new Error("recommendation insert");
  await writeAudit(actor, { action: "recommendation.created", resource_type: "recommendation", resource_id: data.id, metadata: { agent_id: input.agentId, client_id: input.clientId, severity: input.severity } });
  return { id: data.id as string, created: true };
}

export type PrepareActionResult = { ok: true; id: string; created: boolean } | { ok: false; message: string };

/**
 * Prépare une action à valider à partir d'une recommandation. Le payload est validé par le schéma
 * de son type puis gelé à l'approbation (hash en base). Jamais exécutée ici.
 */
export async function prepareAction(actor: Actor, input: { recommendationId: string; type: string; parameters: unknown; incidentId?: string | null }): Promise<PrepareActionResult> {
  const definition = getActionType(input.type);
  const parameters = parseActionParameters(input.type, input.parameters);
  if (!definition || !parameters || !definition.capability) return { ok: false, message: "Action ou paramètres invalides." };
  const supabase = getSupabaseServerClient();
  const { data: recommendation, error: recError } = await supabase.from("recommendations").select("id,agent_id,client_id,project_id,status").eq("id", input.recommendationId).maybeSingle();
  if (recError) throw new Error("recommendation read");
  if (!recommendation || ["rejected", "archived"].includes(recommendation.status)) return { ok: false, message: "Recommandation introuvable ou close." };
  const { data: agent, error: agentError } = await supabase.from("agents").select("id,name,agent_type,enabled,status,autonomy_level").eq("id", recommendation.agent_id).maybeSingle();
  if (agentError) throw new Error("agent read");
  if (!agent || !isAgentType(agent.agent_type)) return { ok: false, message: "Agent inconnu du registre." };
  const decision = authorize({ agent: { type: agent.agent_type, enabled: agent.enabled, status: agent.status, autonomy: agent.autonomy_level }, capability: definition.capability });
  if (decision.outcome === "deny") return { ok: false, message: decision.message };

  const { data: existing, error: existingError } = await supabase.from("actions").select("id,status").eq("recommendation_id", recommendation.id).eq("action_type", definition.id);
  if (existingError) throw new Error("action read");
  const open = (existing ?? []).find((item) => !["cancelled", "rejected", "failed"].includes(item.status));
  if (open) return { ok: true, id: open.id, created: false };

  const { data, error } = await supabase.from("actions").insert({
    recommendation_id: recommendation.id, agent_id: recommendation.agent_id, client_id: recommendation.client_id, project_id: recommendation.project_id ?? null,
    action_type: definition.id, parameters: parameters as Json, status: "pending_approval", requires_approval: true,
    execution_mode: definition.executionMode, prepared_by: actor.kind === "system" ? `system:${actor.worker}` : actor.userId, incident_id: input.incidentId ?? null,
  }).select("id,payload_hash").single();
  if (error || !data) throw new Error("action insert");
  await writeAudit(actor, { action: "action.prepared", resource_type: "action", resource_id: data.id, metadata: { action_type: definition.id, payload_hash: data.payload_hash ?? null, recommendation_id: recommendation.id } });
  return { ok: true, id: data.id, created: true };
}

/** Ouvre un incident ; un incident déjà ouvert avec la même empreinte est réutilisé. */
export async function openIncident(actor: Actor, input: {
  clientId: string; agentId?: string | null; projectId?: string | null; source: "monitoring" | "seo" | "ads" | "publications" | "system";
  severity: "info" | "low" | "medium" | "high" | "critical"; title: string; fingerprint: string; details?: Record<string, unknown>;
}) {
  const supabase = getSupabaseServerClient();
  const { data: existing, error: readError } = await supabase.from("incidents").select("id").eq("fingerprint", input.fingerprint).neq("status", "resolved").limit(1);
  if (readError) throw new Error("incident read");
  if (existing?.length) return { id: existing[0].id as string, created: false };
  const { data, error } = await supabase.from("incidents").insert({
    client_id: input.clientId, agent_id: input.agentId ?? null, project_id: input.projectId ?? null, source: input.source, severity: input.severity,
    title: input.title.slice(0, 200), fingerprint: input.fingerprint.slice(0, 200), details: (input.details ?? {}) as Json,
  }).select("id").single();
  if (error?.code === "23505") {
    // Course entre deux exécutions : l'incident a été ouvert entre-temps.
    const { data: raced } = await supabase.from("incidents").select("id").eq("fingerprint", input.fingerprint).neq("status", "resolved").limit(1);
    if (raced?.length) return { id: raced[0].id as string, created: false };
  }
  if (error || !data) throw new Error("incident insert");
  await writeAudit(actor, { action: "incident.opened", resource_type: "incident", resource_id: data.id, metadata: { client_id: input.clientId, source: input.source, severity: input.severity } });
  return { id: data.id as string, created: true };
}

/** Résout l'incident ouvert d'une empreinte, s'il existe (retour à la normale). */
export async function resolveIncident(actor: Actor, fingerprint: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("incidents").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("fingerprint", fingerprint).neq("status", "resolved").select("id");
  if (error) throw new Error("incident update");
  for (const row of data ?? []) await writeAudit(actor, { action: "incident.resolved", resource_type: "incident", resource_id: row.id, metadata: { automatic: true } });
  return (data ?? []).length;
}
