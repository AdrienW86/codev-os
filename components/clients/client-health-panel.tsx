import Link from "next/link";
import { MutationForm } from "@/components/ui/mutation-form";
import { Panel } from "@/components/ui/primitives";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { ClientHealthOverview } from "@/lib/client-health/data";
import { isProviderConfigured } from "@/lib/system/providers";
import { loadClientVercelAnalyticsRangeAction, runClientMonitoringNowAction, runClientSeoNowAction } from "@/app/(cockpit)/clients/[id]/health-actions";
import { VercelAnalyticsDashboard } from "@/components/clients/vercel-analytics-dashboard";

const date = (value: string) => new Date(value).toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
const pct = (value: number | undefined) => typeof value === "number" ? `${(value * 100).toFixed(1)} %` : "—";
const number = (value: number | null | undefined, digits = 0) => typeof value === "number" ? value.toLocaleString("fr-FR", { maximumFractionDigits: digits }) : "—";

function runTone(status: string): StatusTone {
  if (status === "completed" || status === "succeeded") return "green";
  if (status === "failed") return "red";
  if (status === "running") return "blue";
  return "amber";
}

const opportunityLabel = (kind: string) => kind === "page_drop" ? "Page en baisse" : kind === "emerging_query" ? "Requête à potentiel" : kind === "low_ctr" ? "CTR à améliorer" : "Progression";
const opportunityTone = (severity: string): StatusTone => severity === "high" ? "red" : severity === "medium" ? "amber" : "blue";
const providerLabel = (provider: string) => provider === "search-console" ? "Search Console" : provider === "vercel" ? "Vercel" : provider === "github" ? "GitHub" : provider;
const sourceTone = (status: string, error: string | null): StatusTone => error ? "red" : ["connected","configured"].includes(status) ? "green" : "amber";

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
  const analytics = overview.vercelAnalytics?.data;
  const sourceMap = new Map(overview.sources.map((item) => [item.provider, item]));

  if (unavailable) return <Panel className="p-6"><p className="text-sm text-amber-300">Le centre de données est temporairement indisponible.</p></Panel>;

  const sourceCards = ["search-console","vercel","github"].map((provider) => {
    const source = sourceMap.get(provider);
    return {
      provider,
      label: providerLabel(provider),
      source,
      ready: source ? ["connected","configured"].includes(source.status) && !source.lastError : false,
    };
  });

  return (
    <div className="space-y-8">
      <Panel className="overflow-hidden">
        <div className="border-b border-border bg-gradient-to-br from-white/[0.055] to-transparent p-6">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-2xl">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Centre de données client</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">Tout ce que CODE-V sait du site, au même endroit</h2>
              <p className="mt-2 text-sm leading-6 text-muted">Audience, acquisition, SEO, conversions, performance, disponibilité et activité du dépôt. Les données restent séparées par source pour éviter les conclusions trompeuses.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <MutationForm action={runClientMonitoringNowAction} fields={{ client_id: clientId }} label="Actualiser les données" pendingLabel="Collecte en cours…" disabled={!website} />
              <MutationForm action={runClientSeoNowAction} fields={{ client_id: clientId }} label="Analyser le SEO" pendingLabel="Analyse en cours…" />
            </div>
          </div>
        </div>

        <div className="grid gap-px bg-border md:grid-cols-3 xl:grid-cols-5">
          {sourceCards.map(({ provider, label, source, ready }) => (
            <div key={provider} className="min-w-0 bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{label}</p>
                <StatusBadge label={ready ? "Opérationnel" : source?.lastError ? "Erreur" : "À configurer"} tone={sourceTone(source?.status ?? "", source?.lastError ?? null)} />
              </div>
              <p className="mt-2 truncate text-xs text-muted" title={source?.identifier ?? undefined}>{source?.identifier ?? "Aucun identifiant client"}</p>
              <p className="mt-2 text-[11px] text-muted">{source?.lastSyncAt ? `Synchronisé ${date(source.lastSyncAt)}` : source?.lastError ? source.lastError : "Pas encore synchronisé"}</p>
            </div>
          ))}
          <div className="min-w-0 bg-surface p-4">
            <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">PageSpeed</p><StatusBadge label={speed ? "Mesuré" : speedReady ? "Prêt" : "Quota public"} tone={speed ? "green" : "amber"} /></div>
            <p className="mt-2 text-2xl font-semibold">{speed?.performance ?? "—"}{typeof speed?.performance === "number" ? "/100" : ""}</p>
            <p className="mt-2 text-[11px] text-muted">{overview.pageSpeed ? `Mesuré ${date(overview.pageSpeed.fetchedAt)}` : "Aucun audit enregistré"}</p>
          </div>
          <div className="min-w-0 bg-surface p-4">
            <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">Site HTTP</p><StatusBadge label={site ? site.ok ? "En ligne" : "Incident" : website ? "Prêt" : "À configurer"} tone={site ? site.ok ? "green" : "red" : "amber"} /></div>
            <p className="mt-2 text-2xl font-semibold">{site?.responseMs !== null && site?.responseMs !== undefined ? `${site.responseMs} ms` : "—"}</p>
            <p className="mt-2 truncate text-[11px] text-muted" title={site?.url}>{site?.url ?? website ?? "Aucune URL"}</p>
          </div>
        </div>
      </Panel>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Panel className="p-5">
          <p className="text-xs uppercase tracking-wide text-muted">Audience</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums">{number(analytics?.visitors)}</p>
          <p className="mt-1 text-sm text-muted">{number(analytics?.pageviews)} pages vues sur le dernier instantané</p>
        </Panel>
        <Panel className="p-5">
          <p className="text-xs uppercase tracking-wide text-muted">Visibilité organique</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums">{number(search?.clicks)}</p>
          <p className="mt-1 text-sm text-muted">{number(search?.impressions)} impressions · CTR {pct(search?.ctr)}</p>
        </Panel>
        <Panel className="p-5">
          <p className="text-xs uppercase tracking-wide text-muted">Conversions suivies</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums">{number((analytics?.events ?? []).reduce((sum, item) => sum + (item.count ?? 0), 0))}</p>
          <p className="mt-1 text-sm text-muted">{analytics?.events?.length ? `${analytics.events.length} type(s) d’événement` : "Tracking métier à instrumenter"}</p>
        </Panel>
        <Panel className="p-5">
          <p className="text-xs uppercase tracking-wide text-muted">Signaux à traiter</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums">{overview.incidents.length + (overview.opportunities?.findings.filter((item) => item.kind !== "page_growth").length ?? 0)}</p>
          <p className="mt-1 text-sm text-muted">{overview.incidents.length} incident(s) · {overview.opportunities?.findings.filter((item) => item.kind !== "page_growth").length ?? 0} opportunité(s)</p>
        </Panel>
      </section>

      <Panel className="p-5">
        {overview.vercelAnalytics && analytics ? (
          <VercelAnalyticsDashboard clientId={clientId} data={analytics} periodStart={overview.vercelAnalytics.periodStart} periodEnd={overview.vercelAnalytics.periodEnd} fetchedAt={overview.vercelAnalytics.fetchedAt} loadRange={loadClientVercelAnalyticsRangeAction} />
        ) : (
          <div>
            <h2 className="font-semibold">Audience, acquisition & conversions</h2>
            <p className="mt-1 text-sm text-muted">Vercel Web Analytics : trafic, pages, acquisition, audience et événements personnalisés.</p>
            <p className="mt-4 text-sm text-muted">Aucun instantané Vercel Analytics. Renseignez le projet Vercel du client puis actualisez les données.</p>
          </div>
        )}
      </Panel>

      <section className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <Panel className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="font-semibold">SEO & visibilité</h2><p className="mt-1 text-sm text-muted">Search Console et PageSpeed, sans mélange avec les métriques d’audience.</p></div>
            <StatusBadge label={searchReady ? "Source prête" : "À configurer"} tone={searchReady ? "green" : "amber"} />
          </div>
          {overview.searchConsole && search ? <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Clics</p><p className="mt-1 text-xl font-semibold">{number(search.clicks)}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Impressions</p><p className="mt-1 text-xl font-semibold">{number(search.impressions)}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">CTR</p><p className="mt-1 text-xl font-semibold">{pct(search.ctr)}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Position moy.</p><p className="mt-1 text-xl font-semibold">{number(search.position, 1)}</p></div>
          </div> : <p className="mt-4 text-sm text-muted">Aucun instantané Search Console enregistré.</p>}
          {overview.pageSpeed && speed && <div className="mt-5 border-t border-border pt-4 text-sm">
            <div className="flex flex-wrap gap-x-5 gap-y-2"><span>Performance mobile <strong>{number(speed.performance)}/100</strong></span><span>LCP <strong>{typeof speed.lcpMs === "number" ? `${(speed.lcpMs / 1000).toFixed(1)} s` : "—"}</strong></span><span>CLS <strong>{number(speed.cls, 3)}</strong></span></div>
          </div>}
        </Panel>

        <Panel className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="font-semibold">Opportunités détectées</h2><p className="mt-1 text-sm text-muted">Signaux factuels à examiner avant toute modification du site.</p></div>
            {overview.opportunities && <p className="text-xs text-muted">{overview.opportunities.periodStart} → {overview.opportunities.periodEnd}</p>}
          </div>
          {overview.opportunities?.findings.length ? (
            <ul className="mt-4 grid gap-3 lg:grid-cols-2">
              {overview.opportunities.findings.filter((item) => item.kind !== "page_growth").slice(0, 8).map((item) => (
                <li key={`${item.kind}:${item.key}`} className="rounded-lg border border-border bg-background/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <StatusBadge label={opportunityLabel(item.kind)} tone={opportunityTone(item.severity)} />
                    {item.recommendationId && <Link href={`/recommendations/${item.recommendationId}`} className="text-xs text-accent hover:underline">Ouvrir</Link>}
                  </div>
                  <p className="mt-3 break-words text-sm font-medium">{item.key}</p>
                  <p className="mt-2 text-xs leading-5 text-muted">{item.detail}</p>
                  {item.suggestedAction && <p className="mt-3 border-t border-border pt-3 text-xs leading-5"><span className="font-medium">Piste :</span> <span className="text-muted">{item.suggestedAction}</span></p>}
                </li>
              ))}
            </ul>
          ) : <p className="mt-4 text-sm text-muted">Aucune opportunité enregistrée pour le moment.</p>}
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel className="p-5">
          <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Technique & disponibilité</h2><p className="mt-1 text-sm text-muted">État du site et incidents à traiter.</p></div><Link href="/work" className="text-sm text-accent">Ouvrir Travail</Link></div>
          {site ? <div className="mt-4 rounded-lg border border-border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><StatusBadge label={site.ok ? "Site en ligne" : "Incident"} tone={site.ok ? "green" : "red"} /><span className="text-sm tabular-nums">{site.statusCode ?? "—"} · {site.responseMs !== null ? `${site.responseMs} ms` : "—"}</span></div><p className="mt-2 truncate text-xs text-muted">{site.url}</p></div> : <p className="mt-4 text-sm text-muted">Aucun contrôle technique enregistré.</p>}
          {overview.incidents.length ? <ul className="mt-4 divide-y divide-border">{overview.incidents.map((item) => <li key={item.id} className="py-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm">{item.title}</span><StatusBadge label={item.severity} tone={item.severity === "critical" || item.severity === "high" ? "red" : "amber"} /></div><p className="mt-1 text-xs text-muted">{item.source} · {date(item.detectedAt)}</p></li>)}</ul> : <p className="mt-4 text-sm text-muted">Aucun incident ouvert.</p>}
        </Panel>

        <Panel className="p-5">
          <div><h2 className="font-semibold">Code & déploiement</h2><p className="mt-1 text-sm text-muted">Activité récente du dépôt GitHub connecté.</p></div>
          {overview.github?.commits.length ? <ul className="mt-4 divide-y divide-border">{overview.github.commits.slice(0, 6).map((commit) => <li key={commit.sha} className="py-3"><p className="text-sm font-medium">{commit.message ?? "Commit"}</p><p className="mt-1 text-xs text-muted">{commit.sha?.slice(0, 7)}{commit.author ? ` · ${commit.author}` : ""}{commit.date ? ` · ${date(commit.date)}` : ""}</p></li>)}</ul> : <p className="mt-4 text-sm text-muted">Aucune activité GitHub synchronisée.</p>}
          {overview.github && <p className="mt-3 text-xs text-muted">Dernière lecture du dépôt : {date(overview.github.fetchedAt)}</p>}
        </Panel>
      </section>

      <Panel className="p-5">
        <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Historique des collectes</h2><p className="mt-1 text-sm text-muted">Dernières exécutions des agents SEO et Monitoring.</p></div></div>
        {overview.runs.length ? <ul className="mt-3 divide-y divide-border">{overview.runs.map((run) => <li key={run.id} className="py-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm">{run.runType === "seo.analyze" ? "Analyse SEO" : "Collecte & monitoring"}</span><StatusBadge label={run.status} tone={runTone(run.status)} /></div>{run.summary && <p className="mt-1 text-sm text-muted">{run.summary}</p>}<p className="mt-1 text-xs text-muted">{date(run.startedAt)}</p></li>)}</ul> : <p className="mt-3 text-sm text-muted">Aucune collecte enregistrée.</p>}
      </Panel>
    </div>
  );
}
