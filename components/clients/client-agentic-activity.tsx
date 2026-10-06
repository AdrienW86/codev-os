import { ProjectContext } from "@/components/work/project-context";
import Link from "next/link";
import { Badge, Panel } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format-date";
import type { InternalActionRecord } from "@/lib/actions/types";
import type { AgentRunRecord } from "@/lib/agent-runs/types";
import type { RecommendationRecord } from "@/lib/recommendations/types";

// Publications pipeline codes are stored as run summaries; show a readable label instead of the raw code.
const runSummaryLabels: Record<string, string> = {
  needs_review: "Aucune association sujet/photo fiable : relecture nécessaire.",
  media_required: "Aucune photo client disponible.",
  preparation_failed: "Préparation interrompue, aucun contenu soumis.",
  lease_expired: "Préparation expirée.",
};

export function ClientAgenticActivity({ recommendations, runs, actions }: {
  recommendations: RecommendationRecord[];
  runs: AgentRunRecord[];
  actions: InternalActionRecord[];
}) {
  return <section className="mt-8 border-t border-border pt-8" aria-label="Activité agentique du client">
    <div className="grid items-start gap-5 xl:grid-cols-3">
      <Panel className="p-5"><h2 className="font-semibold">Recommandations <span className="text-sm font-normal text-muted">({recommendations.length})</span></h2>
        {recommendations.length ? <ul className="mt-4 space-y-4">{recommendations.map((item) => <li key={item.id} className="border-t border-border pt-3"><Link href={`/recommendations/${item.id}`} className="text-sm font-medium hover:text-accent hover:underline">{item.title}</Link><ProjectContext projectId={item.project_id} project={item.project}/><div className="mt-2 flex items-center justify-between gap-2"><Badge>{item.status}</Badge><span className="text-xs text-muted">{item.severity}</span></div><time dateTime={item.created_at} className="mt-2 block text-xs text-muted">{formatDate(item.created_at)}</time></li>)}</ul> : <p className="mt-3 text-sm text-muted">Aucune recommandation enregistrée.</p>}
      </Panel>
      <Panel className="p-5"><h2 className="font-semibold">Runs internes <span className="text-sm font-normal text-muted">({runs.length})</span></h2>
        {runs.length ? <ul className="mt-4 space-y-4">{runs.map((run) => <li key={run.id} className="border-t border-border pt-3"><div className="flex justify-between gap-2"><span className="text-sm font-medium">{run.agent?.name ?? "Agent indisponible"}</span><Badge>{run.status}</Badge></div><p className="mt-2 text-xs text-muted">{run.summary ? runSummaryLabels[run.summary] ?? run.summary : "Run en cours"}</p><ProjectContext projectId={run.project_id} project={run.project}/><time dateTime={run.started_at} className="mt-2 block text-xs text-muted">{formatDate(run.started_at)}</time></li>)}</ul> : <p className="mt-3 text-sm text-muted">Aucun run enregistré.</p>}
      </Panel>
      <Panel className="p-5"><h2 className="font-semibold">Actions internes <span className="text-sm font-normal text-muted">({actions.length})</span></h2>
        {actions.length ? <ul className="mt-4 space-y-4">{actions.map((action) => <li key={action.id} className="border-t border-border pt-3"><div className="flex justify-between gap-2"><span className="text-sm font-medium">{action.action_type}</span><Badge>{action.status}</Badge></div><p className="mt-2 text-xs text-muted">{action.requires_approval ? "Approbation requise" : "Action interne"}</p><ProjectContext projectId={action.project_id} project={action.project}/><time dateTime={action.created_at} className="mt-2 block text-xs text-muted">{formatDate(action.created_at)}</time></li>)}</ul> : <p className="mt-3 text-sm text-muted">Aucune action enregistrée.</p>}
      </Panel>
    </div>
  </section>;
}