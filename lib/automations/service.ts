import "server-only";
// Automatisations : création validée, pause/reprise/archivage (jamais de suppression), exécution immédiate.
import { randomUUID } from "node:crypto";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import { runTypes, type RunType } from "@/lib/agents/registry";
import { getAgentByType } from "@/lib/agents/outputs";
import { validateAutomation } from "@/lib/automations/definitions";
import { nextRun, type Schedule } from "@/lib/scheduler/recurrence";
import { enqueueJob, processJobs } from "@/lib/scheduler/engine";
import type { Json } from "@/lib/supabase/database.types";
import type { AutomationRow, AutomationStatus, JobRow } from "@/lib/supabase/core.types";

const db = () => getSupabaseServerClient();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Outcome = { ok: true; message?: string } | { ok: false; message: string };

export type AutomationRecord = AutomationRow & { agent: { name: string } | null; client: { name: string } | null };

export async function listAutomations(includeArchived = false): Promise<AutomationRecord[]> {
  let query = db().from("automations").select("*,agent:agents(name),client:clients(name)").order("created_at", { ascending: false }).limit(200);
  if (!includeArchived) query = query.neq("status", "archived");
  const { data, error } = await query;
  if (error) throw new Error("automations list");
  return (data ?? []) as unknown as AutomationRecord[];
}

export type JobRecord = JobRow & { client: { name: string } | null; automation: { name: string } | null };

export async function listJobs(filters: { status?: string; limit?: number } = {}): Promise<JobRecord[]> {
  let query = db().from("jobs").select("*,client:clients(name),automation:automations(name)").order("created_at", { ascending: false }).limit(Math.min(filters.limit ?? 50, 200));
  if (filters.status) query = query.eq("status", filters.status as JobRow["status"]);
  const { data, error } = await query;
  if (error) throw new Error("jobs list");
  return (data ?? []) as unknown as JobRecord[];
}

export async function createAutomation(actor: Actor & { kind: "admin" }, input: unknown, now = new Date()): Promise<Outcome & { id?: string }> {
  const valid = validateAutomation(input, now);
  if (!valid.ok) return valid;
  const value = valid.value;
  const agent = await getAgentByType(runTypes[value.runType].agent);
  if (!agent) return { ok: false, message: "L’agent concerné n’est pas installé (migration du registre à appliquer)." };
  if (value.clientId) {
    const { data: client, error } = await db().from("clients").select("id").eq("id", value.clientId).maybeSingle();
    if (error) throw new Error("client read");
    if (!client) return { ok: false, message: "Client introuvable." };
  }
  const { data, error } = await db().from("automations").insert({
    name: value.name, run_type: value.runType, agent_id: agent.id, client_id: value.clientId, project_id: null,
    timezone: value.timezone, frequency: value.frequency, schedule: value.schedule as Json, next_run_at: value.nextRunAt,
    config: value.config as Json, created_by: actor.userId, autonomy_policy: 0,
  }).select("id").single();
  if (error || !data) throw new Error("automation insert");
  await writeAudit(actor, { action: "automation.created", resource_type: "automation", resource_id: data.id, metadata: { run_type: value.runType, frequency: value.frequency, client_id: value.clientId } });
  const paused = !agent.enabled;
  return { ok: true, id: data.id, message: paused ? `Automatisation créée. ${agent.name} est en pause : les exécutions seront ignorées tant qu’il n’est pas activé.` : "Automatisation créée." };
}

async function getAutomation(id: string) {
  if (!uuid.test(id)) return null;
  const { data, error } = await db().from("automations").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("automation read");
  return data as AutomationRow | null;
}

const transitions: Record<"pause" | "resume" | "archive", AutomationStatus[]> = {
  pause: ["active", "error"], resume: ["paused", "error"], archive: ["active", "paused", "error", "completed"],
};

export async function changeAutomationStatus(actor: Actor & { kind: "admin" }, id: string, operation: keyof typeof transitions, now = new Date()): Promise<Outcome> {
  const automation = await getAutomation(id);
  if (!automation || !transitions[operation].includes(automation.status)) return { ok: false, message: "Cette automatisation ne peut pas changer d’état ainsi." };
  let patch: Partial<Pick<AutomationRow, "status" | "next_run_at" | "consecutive_failures">>;
  if (operation === "resume") {
    const next = nextRun(automation.frequency, automation.schedule as Schedule, automation.timezone, now);
    if (!next) return { ok: false, message: "Aucune prochaine exécution possible : modifiez ou archivez cette automatisation." };
    patch = { status: "active", next_run_at: next.toISOString(), consecutive_failures: 0 };
  } else patch = { status: operation === "pause" ? "paused" : "archived" };
  const { data, error } = await db().from("automations").update(patch).eq("id", id).eq("status", automation.status).select("id");
  if (error) throw new Error("automation update");
  if (!data?.length) return { ok: false, message: "L’automatisation a changé entre-temps : rechargez la page." };
  await writeAudit(actor, { action: `automation.${operation === "resume" ? "resumed" : operation === "pause" ? "paused" : "archived"}`, resource_type: "automation", resource_id: id, before: { status: automation.status }, after: patch });
  return { ok: true };
}

/** « Exécuter maintenant » : un job manuel (dédupliqué à la minute) traité immédiatement. */
export async function runAutomationNow(actor: Actor & { kind: "admin" }, id: string): Promise<Outcome> {
  const automation = await getAutomation(id);
  if (!automation || automation.status === "archived") return { ok: false, message: "Automatisation introuvable ou archivée." };
  return runNow(actor, { runType: automation.run_type as RunType, clientId: automation.client_id, agentId: automation.agent_id, payload: (automation.config ?? {}) as Record<string, unknown>, dedupeKey: `auto-${id}-${new Date().toISOString().slice(0, 16)}` });
}

export async function runNow(actor: Actor, input: { runType: RunType; clientId?: string | null; agentId?: string | null; payload?: Record<string, unknown>; dedupeKey?: string; trigger?: "manual" | "assistant" }): Promise<Outcome> {
  const job = await enqueueJob(actor, { ...input, trigger: input.trigger ?? "manual" });
  if (!job.ok) return job;
  if (job.duplicate) return { ok: true, message: "Exécution déjà demandée il y a moins d’une minute." };
  const summary = await processJobs(actor, `manual-${randomUUID()}`, 3);
  const { data } = await db().from("jobs").select("status,last_error,result").eq("id", job.id!).maybeSingle();
  if (!data) return { ok: true, message: "Exécution planifiée." };
  const result = (data.result ?? {}) as { summary?: string };
  if (data.status === "succeeded") return { ok: true, message: result.summary ?? "Exécution terminée." };
  if (data.status === "skipped") return { ok: false, message: `Exécution ignorée : ${data.last_error ?? "conditions non réunies"}.` };
  if (data.status === "queued") return { ok: false, message: `Échec temporaire, nouvelle tentative programmée : ${data.last_error ?? "erreur"}.` };
  if (data.status === "failed") return { ok: false, message: `Échec : ${data.last_error ?? "erreur"}.` };
  return { ok: true, message: summary.processed ? "Exécution en cours." : "Exécution planifiée : elle sera traitée au prochain passage du planificateur." };
}
