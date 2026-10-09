import Link from "next/link";
import { Badge, Panel } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format-date";
import { runStatusLabel } from "@/lib/presentation/labels";
import type { AgentRunRecord } from "@/lib/agent-runs/types";

export function RecentActivity({ runs }: { runs: AgentRunRecord[] }) {
  return (
    <Panel className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Activité récente</h2>
        <Link href="/agents" className="text-sm text-accent hover:underline">Voir les agents</Link>
      </div>
      {runs.length ? (
        <ul className="mt-4 divide-y divide-border">
          {runs.map((run) => {
            const status = runStatusLabel(run.status);
            return (
              <li key={run.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {run.agent?.name ?? "Agent"}
                    {run.client && <> · <Link href={`/clients/${run.client.id}`} className="text-accent hover:underline">{run.client.name}</Link></>}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted">{run.summary ?? "Analyse en cours…"}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={status.tone}>{status.label}</Badge>
                  <time className="text-xs text-muted" dateTime={run.started_at}>{formatDate(run.started_at)}</time>
                </div>
              </li>
            );
          })}
        </ul>
      ) : <p className="mt-3 text-sm text-muted">Aucune activité récente des agents.</p>}
    </Panel>
  );
}
