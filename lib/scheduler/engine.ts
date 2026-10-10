import "server-only";
// Moteur d'automatisation : AUTOMATION → JOB → RUN → résultat → audit.
// - Mise en file idempotente (clé automation + échéance) et protégée par mise à jour conditionnelle :
//   deux « ticks » simultanés ne créent jamais deux jobs pour la même échéance.
// - Réservation par codev_claim_jobs (SKIP LOCKED + bail) : un job n'est exécuté que par un worker.
// - Fin d'exécution « clôturée » (fencing) par worker_id : un worker dont le bail a expiré ne peut
//   plus écrire le résultat.
// - Échecs réessayables avec backoff exponentiel, puis échec définitif ; 3 échecs consécutifs
//   mettent l'automatisation en erreur.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import { authorize } from "@/lib/permissions/engine";
import { isAgentType, isRunType, runTypes, type RunType } from "@/lib/agents/registry";
import { isProviderConfigured } from "@/lib/system/providers";
import { clientContextDenied, getAgentByType, startRun, finishRun, type AgentRow } from "@/lib/agents/outputs";
import { runHandlers } from "@/lib/runs/handlers";
import { RunError, type RunOutcome } from "@/lib/runs/types";
import { nextRun, scheduleSchema, type Schedule } from "@/lib/scheduler/recurrence";
import type { Json } from "@/lib/supabase/database.types";
import type { AutomationRow, JobRow } from "@/lib/supabase/core.types";

export const LEASE_SECONDS = 300;
export const RUN_TIMEOUT_MS = 60_000;
const DUE_LIMIT = 25;
const FAILURES_BEFORE_ERROR = 3;

const db = () => getSupabaseServerClient();
// Détection structurelle (pas d'instanceof) : robuste aux erreurs venant d'un autre module ou contexte.
const errorText = (error: unknown) => (typeof (error as { message?: unknown })?.message === "string" ? (error as { message: string }).message : "Erreur inconnue").slice(0, 500);
const isRetryable = (error: unknown) => (error as { retryable?: unknown } | null)?.retryable !== false;

export type TickSummary = { enqueued: number; invalid: number; processed: number; succeeded: number; skipped: number; failed: number; retried: number };

/** Met en file les automatisations dues. Les échéances manquées sont regroupées en une seule exécution. */
export async function enqueueDueAutomations(actor: Actor, now: Date) {
  const { data, error } = await db().from("automations").select("*").eq("status", "active").lte("next_run_at", now.toISOString()).order("next_run_at").limit(DUE_LIMIT);
  if (error) throw new Error("automations read");
  let enqueued = 0, invalid = 0;
  for (const automation of (data ?? []) as AutomationRow[]) {
    const parsed = scheduleSchema.safeParse({ frequency: automation.frequency, timezone: automation.timezone, schedule: automation.schedule });
    if (!parsed.success || !isRunType(automation.run_type)) {
      invalid++;
      await db().from("automations").update({ status: "error" }).eq("id", automation.id).eq("status", "active");
      await writeAudit(actor, { action: "automation.invalid", resource_type: "automation", resource_id: automation.id, metadata: { run_type: automation.run_type } });
      continue;
    }
    const next = nextRun(automation.frequency, automation.schedule as Schedule, automation.timezone, now);
    // Réservation de l'échéance : seule la mise à jour qui voit encore l'ancienne date gagne.
    const { data: claimed, error: claimError } = await db().from("automations")
      .update({ next_run_at: next?.toISOString() ?? null, last_run_at: now.toISOString(), status: next ? "active" : "completed" })
      .eq("id", automation.id).eq("next_run_at", automation.next_run_at as string).eq("status", "active").select("id");
    if (claimError) throw new Error("automation claim");
    if (!claimed?.length) continue;
    const { error: jobError } = await db().from("jobs").upsert({
      automation_id: automation.id, run_type: automation.run_type, agent_id: automation.agent_id, client_id: automation.client_id, project_id: automation.project_id,
      payload: automation.config, scheduled_for: automation.next_run_at as string, idempotency_key: `auto:${automation.id}:${automation.next_run_at}`, trigger: "schedule",
    }, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (jobError) throw new Error("job enqueue");
    enqueued++;
  }
  return { enqueued, invalid };
}

/** Job manuel (bouton, assistant). Un double clic dans la même minute ne crée qu'un job. */
export async function enqueueJob(actor: Actor, input: { runType: RunType; clientId?: string | null; projectId?: string | null; agentId?: string | null; payload?: Record<string, unknown>; trigger: "manual" | "assistant" | "system"; dedupeKey?: string }) {
  if (!isRunType(input.runType)) return { ok: false as const, message: "Type d’exécution inconnu." };
  const bucket = new Date().toISOString().slice(0, 16);
  const key = `${input.trigger}:${input.runType}:${input.clientId ?? "all"}:${input.dedupeKey ?? bucket}`.slice(0, 200);
  const { data, error } = await db().from("jobs").upsert({
    run_type: input.runType, client_id: input.clientId ?? null, project_id: input.projectId ?? null, agent_id: input.agentId ?? null,
    payload: (input.payload ?? {}) as Json, idempotency_key: key, trigger: input.trigger,
  }, { onConflict: "idempotency_key", ignoreDuplicates: true }).select("id");
  if (error) throw new Error("job enqueue");
  await writeAudit(actor, { action: "job.enqueued", resource_type: "job", resource_id: data?.[0]?.id ?? null, metadata: { run_type: input.runType, client_id: input.clientId ?? null, trigger: input.trigger, duplicate: !data?.length } });
  return { ok: true as const, id: data?.[0]?.id ?? null, duplicate: !data?.length };
}

async function complete(job: JobRow, worker: string, patch: Partial<Omit<JobRow, "id" | "idempotency_key" | "created_at">>) {
  const { data, error } = await db().from("jobs").update({ ...patch, lease_expires_at: null }).eq("id", job.id).eq("worker_id", worker).eq("status", "running").select("id");
  if (error) throw new Error("job complete");
  return Boolean(data?.length); // false : bail perdu, un autre worker a repris le job.
}

async function noteAutomation(job: JobRow, success: boolean) {
  if (!job.automation_id) return;
  const { data } = await db().from("automations").select("consecutive_failures,status").eq("id", job.automation_id).maybeSingle();
  if (!data) return;
  const failures = success ? 0 : data.consecutive_failures + 1;
  await db().from("automations").update({ consecutive_failures: failures, ...(failures >= FAILURES_BEFORE_ERROR && data.status === "active" ? { status: "error" as const } : {}) }).eq("id", job.automation_id);
}

async function resolveAgent(job: JobRow, runType: RunType): Promise<AgentRow | null> {
  if (job.agent_id) {
    const { data, error } = await db().from("agents").select("id,name,agent_type,enabled,status,autonomy_level,agent_scope").eq("id", job.agent_id).maybeSingle();
    if (error) throw new Error("agent read");
    return (data as AgentRow | null) ?? null;
  }
  return getAgentByType(runTypes[runType].agent);
}

function withTimeout<T>(promise: Promise<T>, controller: AbortController, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new RunError("Délai d’exécution dépassé.")); }, ms); }),
  ]).finally(() => clearTimeout(timer));
}

export async function runJob(actor: Actor, worker: string, job: JobRow, now = new Date(), timeoutMs = RUN_TIMEOUT_MS): Promise<"succeeded" | "skipped" | "failed" | "retried" | "lost"> {
  if (!isRunType(job.run_type)) {
    return (await complete(job, worker, { status: "failed", last_error: "Type d’exécution inconnu.", finished_at: now.toISOString() })) ? "failed" : "lost";
  }
  const definition = runTypes[job.run_type];
  const agent = await resolveAgent(job, job.run_type);
  if (!agent || !isAgentType(agent.agent_type) || agent.agent_type !== definition.agent) {
    return (await complete(job, worker, { status: "failed", last_error: "Agent introuvable ou incompatible.", finished_at: now.toISOString() })) ? "failed" : "lost";
  }
  const decision = authorize({ agent: { type: agent.agent_type, enabled: agent.enabled, status: agent.status, autonomy: agent.autonomy_level }, capability: definition.capability, isProviderConfigured: definition.deferProviderCheck ? undefined : isProviderConfigured });
  if (decision.outcome === "deny") {
    // Configuration manquante ou agent en pause : exécution ignorée (pas un échec), raison conservée.
    const ok = await complete(job, worker, { status: "skipped", last_error: decision.message.slice(0, 2000), finished_at: now.toISOString(), result: { reason: decision.reason } });
    if (ok) await writeAudit(actor, { action: "job.skipped", resource_type: "job", resource_id: job.id, metadata: { run_type: job.run_type, reason: decision.reason } });
    return ok ? "skipped" : "lost";
  }

  if (job.client_id) {
    const denied = await clientContextDenied(agent, job.client_id);
    if (denied) {
      const ok = await complete(job, worker, { status: "skipped", last_error: denied.slice(0, 2000), finished_at: now.toISOString(), result: { reason: "not_assigned" } });
      if (ok) await writeAudit(actor, { action: "job.skipped", resource_type: "job", resource_id: job.id, metadata: { run_type: job.run_type, reason: "not_assigned" } });
      return ok ? "skipped" : "lost";
    }
  }
  // Job global (sans client) : tracé par le job lui-même ; agent_runs exige un contexte client.
  const runId = job.client_id ? await startRun({ agentId: agent.id, clientId: job.client_id, projectId: job.project_id, runType: job.run_type, jobId: job.id }) : null;
  const controller = new AbortController();
  try {
    const handler = await runHandlers[job.run_type]();
    const outcome: RunOutcome = await withTimeout(handler({ job, agent, actor, now, signal: controller.signal, runId }), controller, timeoutMs);
    if (runId) await finishRun(runId, "completed", outcome.summary);
    const ok = await complete(job, worker, { status: outcome.status, result: { summary: outcome.summary, ...(outcome.data ?? {}) } as Json, agent_run_id: runId, finished_at: new Date().toISOString(), last_error: null });
    if (ok) {
      await noteAutomation(job, true);
      await writeAudit(actor, { action: `job.${outcome.status}`, resource_type: "job", resource_id: job.id, metadata: { run_type: job.run_type, agent_run_id: runId } });
    }
    return ok ? outcome.status : "lost";
  } catch (error) {
    const message = errorText(error);
    if (runId) await finishRun(runId, "failed", message).catch(() => undefined);
    const retryable = isRetryable(error);
    const retry = retryable && job.attempts < job.max_attempts;
    const backoffMinutes = Math.min(60, 2 ** job.attempts);
    const ok = await complete(job, worker, retry
      ? { status: "queued", worker_id: null, last_error: message, scheduled_for: new Date(Date.now() + backoffMinutes * 60_000).toISOString(), agent_run_id: runId }
      : { status: "failed", last_error: message, finished_at: new Date().toISOString(), agent_run_id: runId });
    if (ok) {
      if (!retry) await noteAutomation(job, false);
      await writeAudit(actor, { action: retry ? "job.retry_scheduled" : "job.failed", resource_type: "job", resource_id: job.id, metadata: { run_type: job.run_type, attempts: job.attempts, error: message } });
    }
    return ok ? (retry ? "retried" : "failed") : "lost";
  }
}

export async function processJobs(actor: Actor, worker: string, limit = 5, timeoutMs = RUN_TIMEOUT_MS) {
  const { data, error } = await db().rpc("codev_claim_jobs", { p_worker: worker, p_limit: limit, p_lease_seconds: LEASE_SECONDS });
  if (error) throw new Error("job claim");
  const summary = { processed: 0, succeeded: 0, skipped: 0, failed: 0, retried: 0 };
  for (const job of (data ?? []) as JobRow[]) {
    const result = await runJob(actor, worker, job, new Date(), timeoutMs);
    summary.processed++;
    if (result !== "lost") summary[result]++;
  }
  return summary;
}

/** Un « tick » du planificateur : agents globaux, mise en file, exécution bornée. */
export async function runTick(worker: string, now = new Date(), options: { jobLimit?: number; ensureGlobal?: (actor: Actor) => Promise<unknown> } = {}): Promise<TickSummary> {
  const actor: Actor = { kind: "system", worker };
  if (options.ensureGlobal) { try { await options.ensureGlobal(actor); } catch { console.error("[scheduler] Rattachement des agents globaux différé."); } }
  const { enqueueDueAdsReports } = await import("@/lib/reports/recurring/service");
  const recurring = await enqueueDueAdsReports(actor, now);
  const { enqueued, invalid } = await enqueueDueAutomations(actor, now);
  const processed = await processJobs(actor, worker, options.jobLimit ?? 5);
  return { enqueued: enqueued + recurring, invalid, ...processed };
}
