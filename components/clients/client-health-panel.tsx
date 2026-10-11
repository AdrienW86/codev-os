import Link from "next/link";
import { MutationForm } from "@/components/ui/mutation-form";
import { Panel } from "@/components/ui/primitives";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { ClientHealthOverview } from "@/lib/client-health/data";
import { isProviderConfigured } from "@/lib/system/providers";
import { runClientMonitoringNowAction, runClientSeoNowAction } from "@/app/(cockpit)/clients/[id]/health-actions";

const date = (value: string) => new Date(value).toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
const pct = (value: number | undefined) => typeof value === "number" ? `${(value * 100).toFixed(1)} %` : "—";
const number = (value: number | null | undefined, digits = 0) => typeof value === "number" ? value.toLocaleString("fr-FR", { maximumFractionDigits: digits }) : "—";

function runTone(status: string): StatusTone {
  if (status === "completed" || status === "succeeded") return "green";
  if (status === "failed") return "red";
  if (status === "running") return "blue";
  return "amber";
}

export function ClientHealthPanel({ clientId, website, overview, unavailable }: {
  clientId: string;
  website: string | null;
  overview: ClientHealthOverview;
  unavailable: boolean;
}) {
  const searchReady = isProviderConfigured("search-console");
  const speedReady = isProviderConfigured("pagespeed");
  const site = overview.siteCheck;
  const search = overview.searchConsole?.data;
  const speed = overview.pageSpeed?.data;

  if (unavailable) return <Panel className="p-6"><p className="text-sm text-amber-300">Les données SEO et monitoring sont temporairement indisponibles.</p></Panel>;

  return (
    <div className="space-y-8">
      <section className="grid gap-4 lg:grid-cols-2">
        <Panel className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-semibold">SEO</h2><p className="mt-1 text-sm text-muted">Search Console + PageSpeed, en lecture seule.</p></div>
            <StatusBadge label={searchReady ? "Search Console configurée" : "Search Console à configurer"} tone={searchReady ? "green" : "amber"} symbol={searchReady ? "✓" : "!"} />
          </div>
          <MutationForm action={runClientSeoNowAction} fields={{ client_id: clientId }} label="Lancer l’analyse SEO" pendingLabel="Analyse en cours…" className="mt-5" />
          {!searchReady && <p className="mt-3 text-xs text-muted">La partie PageSpeed reste utilisable. Renseignez Search Console dans Agents → Sources de données pour les clics, impressions et requêtes.</p>}
        </Panel>

        <Panel className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-semibold">Monitoring technique</h2><p className="mt-1 text-sm text-muted">Disponibilité HTTP, temps de réponse et sources techniques connectées.</p></div>
            <StatusBadge label={website ? "Site renseigné" : "Site manquant"} tone={website ? "green" : "amber"} symbol={website ? "✓" : "!"} />
          </div>
          <MutationForm action={runClientMonitoringNowAction} fields={{ client_id: clientId }} label="Contrôler le site maintenant" pendingLabel="Contrôle en cours…" className="mt-5" disabled={!website} />
          {!website && <p className="mt-3 text-xs text-muted">Ajoutez l’URL du site dans Informations avant de lancer un contrôle.</p>}
        </Panel>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Panel className="p-5">
          <p className="text-xs uppercase tracking-wide text-muted">Search Console</p>
          {overview.searchConsole && search ? <>
            <p className="mt-3 text-2xl font-semibold">{number(search.clicks)}</p>
            <p className="text-sm text-muted">clics · {number(search.impressions)} impressions</p>
            <div className="mt-4 space-y-1 text-sm"><p>CTR : {pct(search.ctr)}</p><p>Position moyenne : {number(search.position, 1)}</p><p>Précédents clics : {number(search.previous_clicks)}</p></div>
            <p className="mt-4 text-xs text-muted">{overview.searchConsole.periodStart} → {overview.searchConsole.periodEnd} · récupéré {date(overview.searchConsole.fetchedAt)}</p>
          </> : <p className="mt-3 text-sm text-muted">Aucun instantané SEO enregistré.</p>}
        </Panel>

        <Panel className="p-5">
          <p className="text-xs uppercase tracking-wide text-muted">PageSpeed mobile</p>
          {overview.pageSpeed && speed ? <>
            <p className="mt-3 text-2xl font-semibold">{number(speed.performance)}/100</p>
            <div className="mt-4 space-y-1 text-sm"><p>LCP : {typeof speed.lcpMs === "number" ? `${(speed.lcpMs / 1000).toFixed(1)} s` : "—"}</p><p>INP : {typeof speed.inpMs === "number" ? `${Math.round(speed.inpMs)} ms` : "—"}</p><p>CLS : {number(speed.cls, 3)}</p></div>
            <p className="mt-4 text-xs text-muted">Récupéré {date(overview.pageSpeed.fetchedAt)}{!speedReady ? " · quota public PageSpeed" : ""}</p>
          </> : <p className="mt-3 text-sm text-muted">Aucun audit PageSpeed enregistré.</p>}
        </Panel>

        <Panel className="p-5">
          <p className="text-xs uppercase tracking-wide text-muted">Dernier contrôle du site</p>
          {site ? <>
            <div className="mt-3"><StatusBadge label={site.ok ? "En ligne" : "Incident"} tone={site.ok ? "green" : "red"} symbol={site.ok ? "✓" : "!"} /></div>
            <div className="mt-4 space-y-1 text-sm"><p>HTTP : {site.statusCode ?? "—"}</p><p>Réponse : {site.responseMs !== null ? `${site.responseMs} ms` : "—"}</p>{site.errorKind && <p>Erreur : {site.errorKind}</p>}</div>
            <p className="mt-4 truncate text-xs text-muted" title={site.url}>{site.url}</p><p className="mt-1 text-xs text-muted">{date(site.checkedAt)}</p>
          </> : <p className="mt-3 text-sm text-muted">Aucun contrôle technique enregistré.</p>}
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel className="p-5">
          <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Incidents ouverts</h2><Link href="/work" className="text-sm text-accent">Ouvrir Travail</Link></div>
          {overview.incidents.length ? <ul className="mt-3 divide-y divide-border">{overview.incidents.map((item) => <li key={item.id} className="py-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm">{item.title}</span><StatusBadge label={item.severity} tone={item.severity === "critical" || item.severity === "high" ? "red" : "amber"} /></div><p className="mt-1 text-xs text-muted">{item.source} · {date(item.detectedAt)}</p></li>)}</ul> : <p className="mt-3 text-sm text-muted">Aucun incident SEO ou technique ouvert.</p>}
        </Panel>

        <Panel className="p-5">
          <h2 className="font-semibold">Dernières exécutions</h2>
          {overview.runs.length ? <ul className="mt-3 divide-y divide-border">{overview.runs.map((run) => <li key={run.id} className="py-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm">{run.runType === "seo.analyze" ? "Analyse SEO" : "Monitoring technique"}</span><StatusBadge label={run.status} tone={runTone(run.status)} /></div>{run.summary && <p className="mt-1 text-sm text-muted">{run.summary}</p>}<p className="mt-1 text-xs text-muted">{date(run.startedAt)}</p></li>)}</ul> : <p className="mt-3 text-sm text-muted">Aucune exécution SEO ou monitoring enregistrée.</p>}
        </Panel>
      </section>
    </div>
  );
}
