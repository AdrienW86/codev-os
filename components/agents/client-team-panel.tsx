import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { seatLabels, type ClientPlan } from "@/lib/harness/client-plan";

/** Chef de projet : l'équipe d'agents de ce client, ce qui travaille et ce qui attend l'administrateur. */
export function ClientTeamPanel({ plan }: { plan: ClientPlan }) {
  return (
    <section aria-labelledby="client-team-title" className="mb-8 rounded-xl border border-border bg-surface p-5">
      <h2 id="client-team-title" className="text-base font-semibold">Équipe du client</h2>
      <p className="mt-1 text-sm text-muted">Vue du chef de projet : chaque agent attendu pour les services souscrits, d’après l’état réel en base.</p>
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
            <li key={seat.agent} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <div><Link href={seat.href} className="font-semibold hover:underline">{seat.name}</Link><p className="text-xs text-muted">{seat.detail}</p></div>
              <StatusBadge label={badge.label} tone={badge.tone} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
