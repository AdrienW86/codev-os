"use client";

import type { DirectorMission } from "@/components/assistant/use-assistant";

const labels: Record<string, string> = {
  "google-ads": "Google Ads", seo: "Référencement SEO", priorities: "Priorités Ads + SEO",
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
      {mission.actions && mission.actions.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <h4 className="mb-2 text-xs font-semibold text-muted">Actions proposées · données vérifiables</h4>
          <ol className="space-y-3">
            {mission.actions.map((action) => (
              <li key={action.href} className="text-sm">
                <a href={action.href} className="font-medium text-accent hover:underline">{action.title}</a>
                {action.detail && <p className="mt-1 text-xs text-muted">{action.detail}</p>}
                {action.evidence && action.evidence.length > 0 && <p className="mt-1 text-xs text-muted">Preuves : {action.evidence.join(" · ")}</p>}
                <p className="mt-1 text-xs text-muted">{action.origin === "diagnostic" ? "Nouveau diagnostic · " : "Recommandation enregistrée · "}{action.source === "seo" ? "SEO" : "Google Ads"} · {action.priority === "unrated" ? "Priorité non évaluée" : action.priority} {action.date ? "· " + action.date.slice(0, 10) : ""}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
