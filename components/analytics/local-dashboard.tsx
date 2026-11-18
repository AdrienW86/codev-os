import Link from "next/link";
import { Panel } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import type { LocalDashboard } from "@/lib/local-geogrid/dashboard";
import { geogridTone, type GeogridSnapshot } from "@/lib/local-geogrid/model";
import { sourceLabels } from "@/lib/local-competition/model";

const toneClass = { top: "bg-success text-accent-foreground", mid: "bg-warning text-accent-foreground", low: "bg-danger text-accent-foreground", none: "bg-border-strong text-surface", unknown: "bg-surface-sunken text-muted" } as const;
const day = (iso: string) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" }).format(new Date(iso));
const fr = (value: number, digits = 1) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits }).format(value);

function Grid({ grid }: { grid: GeogridSnapshot }) {
  const failed = new Set(grid.failed), mid = Math.floor(grid.size / 2), measured = grid.cells.length - grid.failed.length;
  return (
    <Panel className="p-5">
      <h3 className="text-sm font-semibold">« {grid.keyword} »</h3>
      <p className="mt-1 text-xs text-muted">Relevé du {day(grid.checkedAt)} · {grid.size} × {grid.size} points sur {fr((grid.size - 1) * grid.spacingKm)} km{grid.center.origin === "competitors" ? " · centré sur les concurrents (fiche non localisée)" : ""}</p>
      <div className="mt-4 grid gap-1" style={{ gridTemplateColumns: `repeat(${grid.size}, minmax(0, 1fr))` }} role="img" aria-label={`Top 3 sur ${grid.top3} points sur ${measured}`}>
        {grid.cells.map((rank, i) => {
          const tone = geogridTone(rank, failed.has(i));
          const center = Math.floor(i / grid.size) === mid && i % grid.size === mid;
          return <span key={i} className={`flex aspect-square items-center justify-center rounded-md text-xs font-semibold ${toneClass[tone]} ${center ? "ring-2 ring-foreground ring-offset-1 ring-offset-surface" : ""}`}>{tone === "unknown" ? "?" : rank ?? "20+"}</span>;
        })}
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
        <div><dt className="text-muted">Top 3</dt><dd className="text-base font-semibold">{grid.top3}/{measured}</dd></div>
        <div><dt className="text-muted">Présente</dt><dd className="text-base font-semibold">{grid.found}/{measured}</dd></div>
        <div><dt className="text-muted">Position moy.</dt><dd className="text-base font-semibold">{grid.average === null ? "—" : fr(grid.average)}</dd></div>
      </dl>
    </Panel>
  );
}

export function LocalDashboardView({ state, clients, current }: { state: LocalDashboard; clients: { id: string; name: string; href: string }[]; current: string }) {
  return (
    <div className="space-y-6">
      <nav aria-label="Client" className="flex flex-wrap gap-2">
        {clients.map((client) => <Link key={client.id} href={client.href} aria-current={client.id === current ? "page" : undefined}
          className={`rounded-full border px-3 py-1 text-sm ${client.id === current ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:text-foreground"}`}>{client.name}</Link>)}
      </nav>
      {state.profile && (
        <section id="fiche-google" className="scroll-mt-24">
          <h2 className="mb-3 text-lg font-semibold">Fiche Google</h2>
          {state.profile.facts.length ? (
            <Panel className="p-5">
              <ul className="space-y-1 text-sm">{state.profile.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
              {state.profile.at && <p className="mt-3 text-xs text-muted">Relevé du {day(state.profile.at)}.</p>}
            </Panel>
          ) : (
            <EmptyState icon="analytics" compact title="Fiche Google pas encore relevée" description="Connectez la fiche Google du client dans Publications, puis lancez « Relever la fiche Google »." />
          )}
        </section>
      )}
      {state.grids.length ? (
        <section id="carte-positions" className="scroll-mt-24">
          <h2 className="mb-3 text-lg font-semibold">Carte de positions Google Maps</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{state.grids.map((grid) => <Grid key={grid.keyword} grid={grid} />)}</div>
          <p className="mt-3 text-xs text-muted">Chaque case est une recherche faite depuis ce point : vert = top 3, orange = 4e à 10e, rouge = 11e à 20e, gris = au-delà de la 20e place, « ? » = point non relevé. La case encadrée est la fiche.</p>
        </section>
      ) : (
        <div id="carte-positions" className="scroll-mt-24"><EmptyState icon="analytics" compact title="Aucune carte de positions"
          description={state.dataforseo ? "La première carte arrive après le relevé de concurrence locale DataForSEO (une recherche par passage du planificateur)." : "Ajoutez DATAFORSEO_LOGIN et DATAFORSEO_PASSWORD dans Vercel pour activer la carte de positions Google Maps."} /></div>
      )}
      <section id="concurrence-locale" className="scroll-mt-24">
        <h2 className="mb-3 text-lg font-semibold">Concurrence locale</h2>
        {state.competition.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {state.competition.map((row) => (
              <Panel key={row.source} className="p-5">
                <h3 className="text-sm font-semibold">« {row.keyword} »</h3>
                <p className="mt-1 text-xs text-muted">{sourceLabels[row.source]} · relevé du {day(row.checkedAt)}</p>
                <p className="mt-3 text-2xl font-semibold">{row.rank !== null ? `${row.rank}${row.rank === 1 ? "re" : "e"} place` : `Absente des ${row.depth} premiers`}</p>
                <p className="mt-1 text-sm text-muted">
                  Fiche : {row.client?.rating != null ? `${fr(row.client.rating)}/5` : "note non communiquée"}{row.client?.reviews != null ? ` · ${row.client.reviews} avis` : ""}
                  {row.medianReviews !== null || row.medianRating !== null ? ` — médiane des concurrents : ${row.medianRating !== null ? `${fr(row.medianRating)}/5` : "—"}${row.medianReviews !== null ? ` · ${fr(row.medianReviews, 0)} avis` : ""}` : ""}
                </p>
                {row.competitors.length ? (
                  <ol className="mt-3 space-y-1 text-sm">
                    {row.competitors.map((c) => <li key={`${c.rank}-${c.name}`} className="flex justify-between gap-3"><span className="truncate">{c.rank}. {c.name}</span><span className="shrink-0 text-muted">{c.rating !== null ? `${fr(c.rating)}/5` : "—"}{c.reviews !== null ? ` · ${c.reviews} avis` : ""}</span></li>)}
                  </ol>
                ) : null}
              </Panel>
            ))}
          </div>
        ) : (
          <EmptyState icon="analytics" compact title="Concurrence locale pas encore relevée"
            description={state.places || state.dataforseo ? "Le relevé hebdomadaire « métier ville » arrive au prochain passage de l’Agent SEO (client avec métier et ville renseignés)." : "Ajoutez GOOGLE_PLACES_API_KEY (gratuit) ou les identifiants DataForSEO dans Vercel pour activer le relevé."} />
        )}
      </section>
    </div>
  );
}
