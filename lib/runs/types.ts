// Contrat des handlers d'exécution (un handler par type d'exécution du registre).
import type { Actor } from "@/lib/core/actor";
import type { JobRow } from "@/lib/supabase/core.types";
import type { AgentRow } from "@/lib/agents/outputs";

export type RunContext = { job: JobRow; agent: AgentRow; actor: Actor; now: Date; signal: AbortSignal; /** Trace agent_runs : uniquement pour un job rattaché à un client (portée vérifiée en base). */ runId: string | null };
export type RunOutcome = { status: "succeeded" | "skipped"; summary: string; data?: Record<string, unknown> };
export type RunHandler = (context: RunContext) => Promise<RunOutcome>;

/** Échec d'exécution ; `retryable` = une nouvelle tentative a du sens (réseau, quota, 5xx). */
export class RunError extends Error {
  constructor(message: string, readonly retryable = true) { super(message); }
}
