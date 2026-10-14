"use client";

import type { DirectorMission } from "@/components/assistant/use-assistant";

const labels: Record<string, string> = {
  "google-ads": "Google Ads", seo: "Référencement SEO",
  get_priorities: "Priorités", clients_attention: "Clients à surveiller", list_pending_actions: "Validations",
};
const statuses: Record<DirectorMission["steps"][number]["status"], string> = {
  completed: "Terminé", failed: "Indisponible", awaiting_approval: "À confirmer", launched: "Lancé",
};

/** Compact, accessible mission status; never implies a pending SEO run has completed. */
export function MissionSummary({ mission }: { mission: DirectorMission }) {
  return (
    <section aria-label="Étapes de la mission" className="mb-4 rounded-xl border border-border bg-surface p-3">
      <h3 className="mb-2 text-sm font-semibold">Mission</h3>
      <ol className="space-y-2">
        {mission.steps.map((step, index) => (
          <li key={step.agent + index} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-foreground">{labels[step.agent] ?? step.agent}</span>
            <span className="text-xs text-muted">{statuses[step.status]}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
