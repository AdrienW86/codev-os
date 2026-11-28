// Supervision du harness : un agent actif doit avoir ses exécutions planifiées, sinon il ne travaille jamais.
// Fonctions pures (testables) : aucune lecture ni écriture ici, voir coverage-service.ts.

export type CoverageRunType = "report.generate" | "news.fetch" | "monitoring.check_sites" | "seo.analyze" | "ads.monitor";

/** Exécutions récurrentes attendues pour chaque type d'agent actif. */
export type ExpectedSchedule = { runType: CoverageRunType; scope: "global" | "client"; presetId?: string; label: string;
  /** Variante attendue (config.kind) : les rapports hebdomadaires ne couvrent pas les mensuels, et inversement. */
  kind?: string };

export const expectedSchedules: Readonly<Record<string, readonly ExpectedSchedule[]>> = {
  report: [
    { runType: "report.generate", scope: "global", presetId: "weekly-reports", label: "Rapports hebdomadaires", kind: "weekly" },
    // Rapport mensuel = bilan du mois de l'Agent Bilan client (préparé le 1er, envoyé après validation).
    { runType: "report.generate", scope: "global", presetId: "monthly-reports", label: "Rapports mensuels et bilans clients", kind: "monthly" },
  ],
  veille: [{ runType: "news.fetch", scope: "global", presetId: "tech-watch", label: "Veille quotidienne" }],
  monitoring: [{ runType: "monitoring.check_sites", scope: "global", presetId: "site-checks", label: "Contrôle quotidien des sites" }],
  seo: [{ runType: "seo.analyze", scope: "client", label: "Analyses SEO du client" }],
  "google-ads": [{ runType: "ads.monitor", scope: "client", label: "Veille quotidienne des campagnes" }],
};

export type CoverageAgent = { id: string; name: string; agent_type?: string | null; enabled: boolean; status: string };
export type CoverageAutomation = { run_type: string; client_id: string | null; status: string; config?: unknown };
/** Variante d'une automatisation de rapports : sans config.kind, le handler produit un rapport hebdomadaire. */
export const automationKind = (automation: Pick<CoverageAutomation, "config">) => {
  const kind = automation.config && typeof automation.config === "object" ? (automation.config as Record<string, unknown>).kind : undefined;
  return kind === "monthly" ? "monthly" : "weekly";
};
export type CoverageAssignment = { agent_id: string; client_id: string; enabled: boolean };

export type CoverageGapKind =
  | "missing_automation" // agent actif, aucune automatisation : il ne tournera jamais
  | "paused_automation" // agent actif, automatisations toutes en pause ou en erreur
  | "agent_paused"; // automatisations prévues, mais l'agent est en pause : elles seront ignorées

export type CoverageGap = {
  agentId: string; agentName: string; agentType: string; runType: CoverageRunType; label: string;
  clientId: string | null; kind: CoverageGapKind; presetId?: string;
};

const runnable = (agent: CoverageAgent) => agent.enabled && agent.status === "Actif";
const live = (automation: CoverageAutomation) => automation.status !== "archived" && automation.status !== "completed";

export function computeAgentCoverage(input: { agents: readonly CoverageAgent[]; automations: readonly CoverageAutomation[]; assignments: readonly CoverageAssignment[] }): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  const automations = input.automations.filter(live);
  for (const agent of input.agents) {
    const expected = agent.agent_type ? expectedSchedules[agent.agent_type] : undefined;
    if (!expected) continue;
    for (const schedule of expected) {
      const targets: (string | null)[] = schedule.scope === "global"
        ? [null]
        : [...new Set(input.assignments.filter((link) => link.agent_id === agent.id && link.enabled).map((link) => link.client_id))].sort();
      for (const clientId of targets) {
        const planned = automations.filter((item) => item.run_type === schedule.runType && (schedule.scope === "global" || item.client_id === clientId) && (!schedule.kind || automationKind(item) === schedule.kind));
        const base = { agentId: agent.id, agentName: agent.name, agentType: agent.agent_type as string, runType: schedule.runType, label: schedule.label, clientId, presetId: schedule.presetId };
        if (!runnable(agent)) {
          // Un agent mis en pause volontairement sans rien de planifié n'est pas une anomalie.
          if (planned.some((item) => item.status === "active")) gaps.push({ ...base, kind: "agent_paused" });
          continue;
        }
        if (!planned.length) gaps.push({ ...base, kind: "missing_automation" });
        else if (!planned.some((item) => item.status === "active")) gaps.push({ ...base, kind: "paused_automation" });
      }
    }
  }
  return gaps;
}

/** Écarts qu'un clic peut combler sans décision humaine supplémentaire : créer les automatisations manquantes. */
export const fixableGaps = (gaps: readonly CoverageGap[]) => gaps.filter((gap) => gap.kind === "missing_automation");

export const coverageGapMessages: Record<CoverageGapKind, string> = {
  missing_automation: "Aucune exécution planifiée : l’agent ne travaille jamais.",
  paused_automation: "Exécutions planifiées en pause ou en erreur.",
  agent_paused: "Exécutions planifiées, mais l’agent est en pause : elles sont ignorées.",
};
