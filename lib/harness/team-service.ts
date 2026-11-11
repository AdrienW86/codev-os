import "server-only";
// Lecture de l'état réel de l'équipe d'agents (lecture seule) : battement du planificateur, derniers jobs, couverture.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSchedulerHeartbeat } from "@/lib/scheduler/heartbeat";
import { loadAgentCoverage } from "@/lib/agents/coverage-service";
import { harnessCharters, harnessTeams, type HarnessCharter, type HarnessTeam } from "./charter";
import { agentHealth, type AgentHealth, type JobSnapshot } from "./health";

export type TeamMember = { charter: HarnessCharter; health: AgentHealth };
export type TeamView = { teams: { id: HarnessTeam; name: string; role: string; members: TeamMember[] }[]; heartbeatAt: string | null };

export async function loadTeam(): Promise<TeamView> {
  const db = getSupabaseServerClient();
  const [heartbeat, jobs, agents, coverage] = await Promise.all([
    getSchedulerHeartbeat().catch(() => null),
    db.from("jobs").select("run_type,status,finished_at,created_at").order("created_at", { ascending: false }).limit(300),
    db.from("agents").select("agent_type,enabled,status"),
    loadAgentCoverage().catch(() => null),
  ]);
  const lastJobs: Record<string, JobSnapshot> = {};
  for (const job of jobs.data ?? []) if (!lastJobs[job.run_type]) lastJobs[job.run_type] = { status: job.status, finishedAt: job.finished_at };
  const enabledByType = new Map<string, boolean>();
  for (const agent of agents.data ?? []) if (agent.agent_type) enabledByType.set(agent.agent_type, (enabledByType.get(agent.agent_type) ?? false) || (agent.enabled && agent.status === "Actif"));
  const gapRunTypes = new Set((coverage?.gaps ?? []).filter((gap) => gap.kind !== "agent_paused").map((gap) => gap.runType as string));
  const members = harnessCharters.map((charter) => ({
    charter,
    health: agentHealth(charter, {
      steps: heartbeat?.steps ?? null, lastJobs, gapRunTypes,
      agentEnabled: charter.registryType ? (enabledByType.get(charter.registryType) ?? null) : null,
    }),
  }));
  return {
    teams: harnessTeams.map((team) => ({ ...team, members: members.filter((member) => member.charter.team === team.id) })),
    heartbeatAt: heartbeat?.startedAt ?? null,
  };
}
