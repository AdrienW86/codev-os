import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { seatLabels, type ClientPlan } from "@/lib/harness/client-plan";
import type { WeekPlan } from "@/lib/harness/week-plan";

/** Chef de projet : l'équipe d'agents de ce client, ses réglages propres, sa semaine et ce qui attend l'administrateur. */
export function ClientTeamPanel({ plan }: { plan: ClientPlan & { week?: WeekPlan } }) {
  const week = plan.week;
  return (
    <section aria-labelledby="client-team-title" className="mb-8 rounded-xl border border-border bg-surface p-5">
      <h2 id="client-team-title" className="text-base font-semibold">Équipe du client</h2>
      <p className="mt-1 text-sm text-muted">Vue du chef de projet : chaque agent attendu pour les services souscrits, ses réglages pour ce client et l’état réel en base. Contrôle automatique chaque matin.</p>
      {plan.todo.length > 0 && (
        <div className="mt-4 rounded-lg border border-warning/25 bg-warning/10 p-3 text-sm">
          <p className="font-semibold text-warning">À faire</p>
          <ul className="mt-1 space-y-1">{plan.todo.map((item) => <li key={item.label}><Link href={item.href} className="text-accent hover:underline">{item.label}</Link></li>)}</ul>
        </div>
      )}
      <ul className="mt-4 divide-y divide-border">
        {plan.seats.map((seat) => {
          const badge = seatLabels[seat.state];
          return (
            <li key={seat.agent} className="flex flex-wrap items-start justify-between gap-2 py-2.5 text-sm">
              <div className="min-w-0">
                <Link href={seat.href} className="font-semibold hover:underline">{seat.name}</Link>
                <p className="text-xs text-muted">{seat.detail}</p>
                {seat.settings.length > 0 && <p className="mt-0.5 text-xs text-muted">Réglages : {seat.settings.join(" · ")}</p>}
              </div>
              <StatusBadge label={badge.label} tone={badge.tone} />
            </li>
          );
        })}
      </ul>
      {week && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold">Semaine du client</h3>
          <p className="mt-1 text-xs text-muted">Échéances réellement programmées sur les 7 prochains jours ({week.total}).</p>
          <ol className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {week.days.map((day) => (
              <li key={day.date} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-semibold first-letter:uppercase">{day.label}</p>
                {day.items.length === 0 ? <p className="mt-1 text-xs text-muted">Rien de programmé.</p> : (
                  <ul className="mt-1 space-y-1">
                    {day.items.map((item) => (
                      <li key={`${item.agent}-${item.text}`} className="text-xs">
                        <span className="tabular-nums text-muted">{item.time}</span> {item.text}{item.count > 1 ? ` (×${item.count})` : ""}
                        <span className="text-muted"> · {item.name}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
          {week.cadence.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-muted">{week.cadence.map((item) => <li key={item.agent}>{item.name} : {item.text}.</li>)}</ul>
          )}
        </div>
      )}
    </section>
  );
}
