import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { crucialCategories } from "@/lib/review/crucial";
import { healthLabels } from "@/lib/harness/health";
import type { ActivityLine, DecisionCard, TeamStatus } from "@/lib/dashboard/overview";

const block = "rounded-2xl border border-border bg-surface p-5 shadow-card";

/** Bloc 1 : décisions cruciales. Chaque élément ouvre directement l'écran où l'on voit l'aperçu et où l'on décide. */
export function DecisionsBlock({ cards }: { cards: DecisionCard[] | null }) {
  return (
    <section aria-labelledby="home-decisions" data-home-block="decisions">
      <h2 id="home-decisions" className="mb-3 text-lg font-semibold">Vos décisions</h2>
      {cards === null ? <p className={`${block} text-sm text-warning`}>Décisions illisibles pour le moment : rien n’est affirmé.</p>
        : cards.length === 0 ? <p className={`${block} text-sm text-muted`}>Rien ne vous attend. Seules les actions cruciales (argent, envoi à un tiers, site d’un client, image générée) vous seront demandées.</p>
        : (
          <ul className="space-y-3">
            {cards.map((card) => (
              <li key={card.id} className={block}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Link href={card.href} className="font-semibold hover:underline">{card.label}</Link>
                  <StatusBadge label={card.status === "unavailable" ? "Illisible" : `${card.manual} à décider`} tone="amber" />
                </div>
                {card.crucial && <p className="mt-1 text-xs text-muted">{crucialCategories[card.crucial].reason}</p>}
                {card.items.length > 0 && (
                  <ul className="mt-3 space-y-2 text-sm">
                    {card.items.map((item) => (
                      <li key={item.id}>
                        <Link href={item.href} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 hover:border-accent/50">
                          <span className="min-w-0 truncate">{item.client ? `${item.client} · ` : ""}{item.title}</span>
                          <span className="shrink-0 text-accent">Décider →</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {card.manual > card.items.length && <p className="mt-2 text-xs"><Link href={card.href} className="text-accent hover:underline">Voir les {card.manual}</Link></p>}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

/** Bloc 2 : ce que l'agence a fait seule ces dernières 24 h. */
export function ActivityBlock({ activity }: { activity: { lines: ActivityLine[]; unreadable: number } | null }) {
  return (
    <section aria-labelledby="home-activity" data-home-block="activity">
      <h2 id="home-activity" className="mb-3 text-lg font-semibold">Ce que l’agence a fait (24 h)</h2>
      <div className={block}>
        {activity === null ? <p className="text-sm text-warning">Activité illisible pour le moment.</p>
          : activity.lines.length === 0 ? <p className="text-sm text-muted">Aucune action terminée ces dernières 24 heures.</p>
          : (
            <ul className="space-y-2 text-sm">
              {activity.lines.map((line) => (
                <li key={line.key} className="flex items-center justify-between gap-3">
                  <span className={line.tone === "red" ? "text-danger" : ""}>{line.text}</span>
                  <Link href={line.href} className="shrink-0 text-xs text-accent hover:underline">Détail</Link>
                </li>
              ))}
            </ul>
          )}
        {activity && activity.unreadable > 0 && <p className="mt-2 text-xs text-warning">{activity.unreadable} source(s) illisible(s), non comptée(s).</p>}
      </div>
    </section>
  );
}

/** Bloc 3 : état des équipes d'agents et accès au lancement manuel. */
export function TeamBlock({ teams, launchHref = "/lancer" }: { teams: TeamStatus[] | null; launchHref?: string }) {
  return (
    <section aria-labelledby="home-team" data-home-block="team">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <h2 id="home-team" className="text-lg font-semibold">État des agents</h2>
        <Link href={launchHref} className="rounded-lg bg-accent-strong px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90">Lancer une action</Link>
      </div>
      <div className={block}>
        {teams === null ? <p className="text-sm text-warning">État des agents illisible pour le moment.</p> : (
          <ul className="divide-y divide-border text-sm">
            {teams.map((team) => (
              <li key={team.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                <span className="min-w-0">
                  <span className="font-medium">{team.name}</span>
                  {team.problems.length > 0 && <span className="block text-xs text-muted">À regarder : {team.problems.join(", ")}</span>}
                </span>
                <StatusBadge label={healthLabels[team.state].label} tone={healthLabels[team.state].tone} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs"><Link href="/agents" className="text-accent hover:underline">Détail par agent et bilans de situation</Link></p>
      </div>
    </section>
  );
}
