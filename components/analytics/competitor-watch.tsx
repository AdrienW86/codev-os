import Link from "next/link";
import { Panel } from "@/components/ui/primitives";
import { EmptyState, InlineNotice } from "@/components/ui/states";
import { LaunchButton } from "@/components/launch/launch-button";
import type { CompetitorWatchDashboard } from "@/lib/competitor-watch/dashboard";
import { mapsLine, type WatchCompetitor, type WatchReport } from "@/lib/competitor-watch/model";
import { sourceLabels } from "@/lib/local-competition/model";
import { CompetitorWatchSettingsForm } from "./competitor-watch-settings";

const day = (iso: string) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }).format(new Date(iso));
const rank = (value: number | null) => (value === null ? "au-delà de la 20e" : `${value}${value === 1 ? "re" : "e"}`);
const pages = (row: { pages: WatchCompetitor["pages"] }) => (row.pages.count === null ? row.pages.note ?? "non mesuré" : `${row.pages.count} page(s)`);

function Table({ report }: { report: WatchReport }) {
  const keywords = report.serp.map((row) => row.keyword);
  const rows = [{ ...report.client, origin: "client" as const }, ...report.competitors];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="text-xs text-muted">
          <tr>
            <th className="py-2 pr-3 font-medium">Entreprise</th>
            <th className="py-2 pr-3 font-medium">Google Maps{report.maps ? ` « ${report.maps.keyword} »` : ""}</th>
            {keywords.map((kw) => <th key={kw} className="py-2 pr-3 font-medium">Google « {kw} »</th>)}
            <th className="py-2 pr-3 font-medium">Annonces vues</th>
            <th className="py-2 font-medium">Site (30 jours)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${row.name}-${i}`} className={`border-t border-border ${row.origin === "client" ? "font-semibold" : ""}`}>
              <td className="py-2 pr-3">{row.name}{row.origin === "client" ? " (client)" : row.origin === "manual" ? " · suivi choisi" : ""}{row.domain ? <span className="block text-xs font-normal text-muted">{row.domain}</span> : null}</td>
              <td className="py-2 pr-3">{mapsLine(row, row.origin === "client" ? 20 : 5)}</td>
              {keywords.map((kw) => { const position = row.organic.find((item) => item.keyword === kw); return <td key={kw} className="py-2 pr-3">{!row.domain ? "site inconnu" : position ? rank(position.rank) : "—"}</td>; })}
              <td className="py-2 pr-3">{!row.domain || !report.serp.length ? "—" : row.adsOn.length ? row.adsOn.map((kw) => `« ${kw} »`).join(", ") : "aucune"}</td>
              <td className="py-2">{pages(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CompetitorWatchView({ state, clients, current }: { state: CompetitorWatchDashboard; clients: { id: string; name: string; href: string }[]; current: string }) {
  const { report } = state;
  return (
    <div className="space-y-6">
      <nav aria-label="Client" className="flex flex-wrap gap-2">
        {clients.map((client) => <Link key={client.id} href={client.href} aria-current={client.id === current ? "page" : undefined}
          className={`rounded-full border px-3 py-1 text-sm ${client.id === current ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:text-foreground"}`}>{client.name}</Link>)}
      </nav>
      {state.ineligible && <InlineNotice tone="info" title="Client non suivi">{state.ineligible}</InlineNotice>}
      {!state.dataforseo && <InlineNotice tone="info" title="Positions Google et annonces non relevées">Ajoutez DATAFORSEO_LOGIN et DATAFORSEO_PASSWORD dans Vercel pour mesurer les positions Google et les annonces Google Ads des concurrents. Sans eux, la veille s’appuie sur Google Maps et les sites.</InlineNotice>}
      <section id="rapport" className="scroll-mt-24 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Veille concurrence du mois</h2>
            {report && <p className="text-xs text-muted">Du {day(report.periodStart)} au {day(report.periodEnd)}{report.maps ? ` · Google Maps : ${sourceLabels[report.maps.source]}, relevé du ${day(report.maps.checkedAt)}${report.maps.previousAt ? ` comparé au ${day(report.maps.previousAt)}` : ""}` : ""}</p>}
          </div>
          {!state.ineligible && <LaunchButton task="competitor-watch" clientId={current} label="Préparer la veille maintenant" compact confirm={state.dataforseo ? "Lancer la veille maintenant ? Jusqu’à 3 recherches DataForSEO facturées." : undefined} />}
        </div>
        {report ? (
          <>
            {report.summary ? <Panel className="p-5"><p className="whitespace-pre-line text-sm">{report.summary}</p><p className="mt-2 text-xs text-muted">Synthèse rédigée par l’IA à partir des seules mesures ci-dessous.</p></Panel>
              : report.summaryNote ? <p className="text-xs text-muted">Synthèse IA non disponible : {report.summaryNote}.</p> : null}
            <Panel className="p-5">
              <h3 className="mb-3 text-sm font-semibold">Actions proposées</h3>
              {report.findings.length ? (
                <ol className="space-y-3 text-sm">
                  {report.findings.map((finding) => (
                    <li key={`${finding.code}-${finding.title}`}>
                      <p className="font-medium">{finding.title}</p>
                      <p className="text-muted">{finding.detail}</p>
                      <p className="mt-1">→ {finding.action} <span className="text-xs text-muted">({finding.owner})</span></p>
                    </li>
                  ))}
                </ol>
              ) : <p className="text-sm text-muted">Aucun mouvement concurrent notable mesuré ce mois-ci.</p>}
              {report.findings.length > 0 && <p className="mt-3 text-xs text-muted">Chaque action est aussi proposée dans <Link href={`/recommendations?clientId=${current}`} className="text-accent hover:underline">Recommandations</Link> : rien n’est exécuté sans votre décision.</p>}
            </Panel>
            <Panel className="p-5">
              <h3 className="mb-3 text-sm font-semibold">Concurrents suivis</h3>
              <Table report={report} />
              <p className="mt-3 text-xs text-muted">Google Maps : rang, note et nombre d’avis (évolution sur le mois entre parenthèses). Google : position dans les 20 premiers résultats naturels. Annonces : annonces Google Ads affichées au moment du relevé. Site : pages publiées ou mises à jour sur 30 jours d’après le sitemap public.</p>
            </Panel>
            {report.gaps.length > 0 && <Panel className="p-5"><h3 className="mb-2 text-sm font-semibold">Non relevé</h3><ul className="list-disc space-y-1 pl-5 text-sm text-muted">{report.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul></Panel>}
            {state.previous.length > 0 && <p className="text-xs text-muted">Rapports précédents : {state.previous.map((row) => `${day(row.at)} (${row.findings} constat${row.findings > 1 ? "s" : ""})`).join(" · ")}.</p>}
          </>
        ) : (
          <EmptyState icon="analytics" compact title="Aucun rapport de veille pour ce client"
            description="Le premier rapport arrive après un relevé de concurrence locale de l’Agent SEO (hebdomadaire). Vous pouvez aussi saisir les concurrents à suivre ci-dessous puis lancer la veille." />
        )}
      </section>
      <section id="reglages" className="scroll-mt-24">
        <h2 className="mb-3 text-lg font-semibold">Réglages du client</h2>
        <Panel className="p-5">
          {!state.settingsInstalled && <p className="mb-3 text-sm text-warning">Réglages non installés (migration 20261224300000_competitor_watch à appliquer) : la veille tourne avec les réglages par défaut.</p>}
          <CompetitorWatchSettingsForm clientId={current} enabled={state.settings.enabled} competitors={state.settings.competitors.map((row) => (row.domain ? `${row.name} | ${row.domain}` : row.name)).join("\n")} />
        </Panel>
      </section>
    </div>
  );
}
