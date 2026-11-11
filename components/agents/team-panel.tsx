import { StatusBadge } from "@/components/ui/status-badge";
import { healthLabels } from "@/lib/harness/health";
import { formatDateTime } from "@/lib/format-date";
import type { TeamView } from "@/lib/harness/team-service";

/** L'équipe par métier : mission, niveau d'expertise attendu, interdits et état réel de chaque agent. */
export function TeamPanel({ team }: { team: TeamView }) {
  return (
    <section aria-labelledby="team-title" className="mb-12">
      <div className="mb-4">
        <h2 id="team-title" className="text-lg font-semibold">Équipe</h2>
        <p className="mt-1 text-sm text-muted">
          Chaque agent a une mission, un périmètre et des interdits rappelés à chaque appel IA. État réel d’après le dernier passage du planificateur{team.heartbeatAt ? ` (${formatDateTime(team.heartbeatAt)})` : ""} et les dernières exécutions.
        </p>
      </div>
      <div className="space-y-8">
        {team.teams.map((group) => (
          <div key={group.id}>
            <h3 className="text-sm font-semibold">{group.name} <span className="font-normal text-muted">· {group.role}</span></h3>
            <ul className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {group.members.map(({ charter, health }) => {
                const badge = healthLabels[health.state];
                return (
                  <li key={charter.id} className="rounded-xl border border-border bg-surface p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{charter.name}</p>
                        <p className="text-xs text-muted">{charter.expertise}</p>
                      </div>
                      <StatusBadge label={badge.label} tone={badge.tone} />
                    </div>
                    <p className="mt-3 text-sm">{charter.mission}</p>
                    <ul className="mt-2 space-y-0.5 text-xs text-muted">{health.lines.map((line) => <li key={line}>{line}</li>)}</ul>
                    <details className="mt-3 text-xs">
                      <summary className="cursor-pointer text-accent">Périmètre et interdits</summary>
                      <p className="mt-2"><span className="font-semibold">Fait :</span> {charter.does.join(" · ")}</p>
                      <p className="mt-1"><span className="font-semibold">Ne fait jamais :</span> {charter.never.join(" · ")}</p>
                      <p className="mt-1 text-muted">Réglages par client : {charter.clientSettings}</p>
                    </details>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
