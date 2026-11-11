// Santé de l'équipe d'agents : état réel de chaque agent d'après le dernier passage du planificateur, les derniers
// jobs du registre et les écarts de couverture. Fonction pure : jamais « en forme » sans preuve d'exécution.
import type { HarnessCharter } from "./charter";

export type HealthState = "ok" | "attention" | "failed" | "off" | "manual";
export type StepSnapshot = { status: string; counts?: Record<string, number> };
export type JobSnapshot = { status: string; finishedAt: string | null };
export type AgentHealth = { state: HealthState; lines: string[] };

const stepLabels: Record<string, string> = { ok: "exécutée", failed: "en échec", skipped: "sautée faute de temps", disabled: "désactivée" };
const rank: Record<HealthState, number> = { manual: 0, ok: 1, off: 2, attention: 3, failed: 4 };
const worst = (a: HealthState, b: HealthState) => (rank[b] > rank[a] ? b : a);

export function agentHealth(charter: HarnessCharter, input: { steps: Record<string, StepSnapshot> | null; lastJobs: Record<string, JobSnapshot>; gapRunTypes: ReadonlySet<string>; agentEnabled: boolean | null; now?: Date }): AgentHealth {
  const lines: string[] = [];
  let state: HealthState | null = null;
  const merge = (next: HealthState) => { state = state === null ? next : worst(state, next); };
  if (input.agentEnabled === false) return { state: "off", lines: ["Agent en pause : aucune exécution."] };
  for (const trigger of charter.triggers) {
    if (trigger.kind === "manual") { lines.push("Disponible à la demande."); merge("manual"); continue; }
    if (trigger.kind === "step") {
      const step = input.steps?.[trigger.step];
      if (!step) { lines.push(`Étape ${trigger.step} : aucun passage enregistré.`); merge("attention"); continue; }
      lines.push(`Dernier passage : ${stepLabels[step.status] ?? step.status}.`);
      merge(step.status === "failed" ? "failed" : step.status === "ok" ? "ok" : step.status === "disabled" ? "off" : "attention");
      continue;
    }
    if (input.gapRunTypes.has(trigger.runType)) { lines.push(`${trigger.runType} : aucune exécution planifiée.`); merge("attention"); continue; }
    const job = input.lastJobs[trigger.runType];
    if (!job) { lines.push(`${trigger.runType} : jamais exécuté.`); merge("attention"); continue; }
    const when = job.finishedAt ? new Date(job.finishedAt).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) : "en cours";
    lines.push(`${trigger.runType} : ${job.status === "succeeded" ? "réussi" : job.status === "failed" ? "échec" : job.status} (${when}).`);
    merge(job.status === "failed" ? "failed" : job.status === "succeeded" ? "ok" : "attention");
  }
  return { state: state ?? "manual", lines: [...new Set(lines)] };
}

export const healthLabels: Record<HealthState, { label: string; tone: "green" | "amber" | "red" | "neutral" }> = {
  ok: { label: "Opérationnel", tone: "green" },
  attention: { label: "À vérifier", tone: "amber" },
  failed: { label: "En échec", tone: "red" },
  off: { label: "En pause", tone: "neutral" },
  manual: { label: "À la demande", tone: "neutral" },
};
