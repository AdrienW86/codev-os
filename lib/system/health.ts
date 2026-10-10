import "server-only";
// Observabilité : jobs, exécutions d'agents, erreurs et synchronisations. Lecture seule.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { JobStatus } from "@/lib/supabase/core.types";

const db = () => getSupabaseServerClient();

export type SystemHealth = {
  jobCounts: Record<JobStatus, number>;
  lastScheduledJobAt: string | null;
  /** Aucun job planifié depuis 36 h : cron probablement inactif. */
  schedulerStale: boolean;
  failedRuns: { id: string; agent: string; summary: string | null; started_at: string }[];
  openIncidents: { id: string; title: string; severity: string; client: string | null; detected_at: string }[];
  connectionErrors: { provider: string; last_error: string; last_sync_at: string | null }[];
};

export async function getSystemHealth(now = new Date()): Promise<SystemHealth> {
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const [jobs, lastScheduled, runs, incidents, connections] = await Promise.all([
    db().from("jobs").select("status").gte("created_at", since).limit(5000),
    db().from("jobs").select("created_at").eq("trigger", "schedule").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db().from("agent_runs").select("id,summary,started_at,agent:agents(name)").eq("status", "failed").gte("started_at", since).order("started_at", { ascending: false }).limit(20),
    db().from("incidents").select("id,title,severity,detected_at,client:clients(name)").neq("status", "resolved").order("detected_at", { ascending: false }).limit(20),
    db().from("client_connections").select("provider,last_error,last_sync_at").not("last_error", "is", null).limit(50),
  ]);
  for (const result of [jobs, lastScheduled, runs, incidents, connections]) if (result.error) throw new Error("health read");
  const jobCounts: Record<JobStatus, number> = { queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0, skipped: 0 };
  for (const job of jobs.data ?? []) jobCounts[job.status as JobStatus] = (jobCounts[job.status as JobStatus] ?? 0) + 1;
  return {
    jobCounts,
    lastScheduledJobAt: lastScheduled.data?.created_at ?? null,
    schedulerStale: !lastScheduled.data || now.getTime() - new Date(lastScheduled.data.created_at).getTime() > 36 * 3_600_000,
    failedRuns: (runs.data ?? []).map((run) => ({ id: run.id, agent: (run.agent as { name?: string } | null)?.name ?? "Agent", summary: run.summary, started_at: run.started_at })),
    openIncidents: (incidents.data ?? []).map((item) => ({ id: item.id, title: item.title, severity: item.severity, client: (item.client as { name?: string } | null)?.name ?? null, detected_at: item.detected_at })),
    connectionErrors: (connections.data ?? []).map((item) => ({ provider: item.provider, last_error: (item.last_error ?? "").slice(0, 200), last_sync_at: item.last_sync_at ?? null })),
  };
}
