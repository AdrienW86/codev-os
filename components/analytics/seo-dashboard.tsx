"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { syncSearchConsoleNowAction } from "@/app/(cockpit)/analytics/search-console-actions";
import { Select, StatePanel, download } from "@/components/analytics/analytics-dashboard";
import { Donut, Sparkline, TrafficChart } from "@/components/analytics/charts";
import { BarTable, Card, GhostButton, IconBadge, WidgetHeader, fmtShare, type BarRow } from "@/components/analytics/widgets";
import { actionClass } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import type { SeoDashboardState } from "@/lib/integrations/search-console/dashboard";
import { availableGranularities, countryFlag, periodDays, type AnalyticsPeriod, type CompareMode } from "@/lib/analytics/view-model";
import {
  buildSeoKpis, dayCount, pagePath, propertyLabel, searchConsoleCsv, searchCountry, searchDevice, seoSeries,
  type DimensionRow, type SeoGranularity, type SeoKpi, type SeoMetric,
} from "@/lib/integrations/search-console/model";

const nf = new Intl.NumberFormat("fr-FR");
const dateTime = (value: string) => new Date(value).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });
const shortDay = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const pct = (value: number | null) => value === null ? "—" : `${(value * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
const position = (value: number | null) => value === null ? "—" : value.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export type SeoClientChoice = { id: string; name: string; property: string | null };

const kpiStyle: Record<SeoKpi["key"], { icon: IconName; tone: string; color: string }> = {
  clicks: { icon: "pointer", tone: "bg-chart-1/15 text-chart-7", color: "var(--chart-1)" },
  impressions: { icon: "seo", tone: "bg-chart-2/15 text-chart-2", color: "var(--chart-2)" },
  ctr: { icon: "target", tone: "bg-chart-4/15 text-success", color: "var(--chart-4)" },
  position: { icon: "business", tone: "bg-chart-6/15 text-chart-6", color: "var(--chart-6)" },
};
const metricLabels: Record<SeoMetric, string> = { clicks: "Clics", impressions: "Impressions", ctr: "CTR", position: "Position moyenne" };
const metricUnits: Record<SeoMetric, string> = { clicks: "clics", impressions: "impressions", ctr: "% de CTR", position: "position" };
const granularityLabels: Record<SeoGranularity, string> = { day: "Par jour", week: "Par semaine", month: "Par mois" };
const deviceColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-7)", "var(--chart-muted)"];
const linkButton = actionClass("secondary", "min-h-10");

function formatKpi(kpi: SeoKpi) {
  if (kpi.value === null) return "—";
  if (kpi.key === "ctr") return `${kpi.value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
  if (kpi.key === "position") return kpi.value.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return nf.format(kpi.value);
}

/** Variation colorée selon le sens favorable : une position qui baisse est une progression. */
function SeoDelta({ kpi }: { kpi: SeoKpi }) {
  if (kpi.delta === null) return <span className="text-[11px] text-subtle">—</span>;
  const good = kpi.delta === 0 ? null : (kpi.delta > 0) === (kpi.better === "up");
  const unit = kpi.deltaUnit === "%" ? " %" : kpi.deltaUnit === "pt" ? " pt" : "";
  const text = `${kpi.delta > 0 ? "+" : ""}${kpi.delta.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}${unit}`;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums ${good === null ? "text-muted" : good ? "text-success" : "text-danger"}`}>
      <span aria-hidden="true">{kpi.delta === 0 ? "=" : kpi.delta > 0 ? "↑" : "↓"}</span>
      <span className="sr-only">{good === null ? "stable" : good ? "en progression" : "en recul"}</span>{text}
    </span>
  );
}

function KpiCard({ kpi, compare, days }: { kpi: SeoKpi; compare: boolean; days: number }) {
  const style = kpiStyle[kpi.key];
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-center gap-3"><IconBadge name={style.icon} tone={style.tone} /><p className="text-[13.5px] font-medium leading-snug text-foreground">{kpi.label}</p></div>
      <div className="flex items-end justify-between gap-2">
        <p className="text-[28px] font-semibold leading-none tracking-tight tabular-nums text-foreground">{formatKpi(kpi)}</p>
        {compare && kpi.value !== null && <SeoDelta kpi={kpi} />}
      </div>
      <div className="flex items-end justify-between gap-2">
        <Sparkline values={kpi.spark} color={style.color} />
        <p className="text-right text-[11px] leading-tight text-muted">{compare && kpi.previous !== null ? `vs ${days} jours précédents` : kpi.hint}</p>
      </div>
    </Card>
  );
}

function DimensionTable({ rows, head, format, compare, empty }: { rows: DimensionRow[]; head: string; format: (key: string) => string; compare: boolean; empty: string }) {
  if (!rows.length) return <p className="px-5 pb-6 pt-4 text-sm text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto px-5 pb-5 pt-3">
      <table className="w-full min-w-[34rem] text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[10px] font-medium uppercase tracking-wider text-subtle">
            <th scope="col" className="pb-2 pr-3 font-medium">{head}</th>
            <th scope="col" className="pb-2 pr-3 text-right font-medium">Clics</th>
            {compare && <th scope="col" className="pb-2 pr-3 text-right font-medium">Évol.</th>}
            <th scope="col" className="pb-2 pr-3 text-right font-medium">Impr.</th>
            <th scope="col" className="pb-2 pr-3 text-right font-medium">CTR</th>
            <th scope="col" className="pb-2 text-right font-medium">Position</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const delta = row.previous ? row.clicks - row.previous.clicks : null;
            return (
              <tr key={row.key} className="border-b border-border/60 last:border-0">
                <td className="max-w-[18rem] truncate py-2 pr-3 text-foreground" title={row.key}>{format(row.key)}</td>
                <td className="py-2 pr-3 text-right font-semibold tabular-nums text-foreground">{nf.format(row.clicks)}</td>
                {compare && <td className={`py-2 pr-3 text-right tabular-nums ${delta === null || delta === 0 ? "text-muted" : delta > 0 ? "text-success" : "text-danger"}`}>{delta === null ? "—" : `${delta > 0 ? "+" : ""}${nf.format(delta)}`}</td>}
                <td className="py-2 pr-3 text-right tabular-nums text-muted">{nf.format(row.impressions)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-muted">{pct(row.ctr)}</td>
                <td className="py-2 text-right tabular-nums text-muted">{position(row.position)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SeoDashboard({ clients, client, property, period, initialCompare, today, state }: {
  clients: SeoClientChoice[]; client: { id: string; name: string }; property: string | null; period: AnalyticsPeriod; initialCompare: CompareMode; today: string; state: SeoDashboardState;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [compare, setCompare] = useState<CompareMode>(initialCompare);
  const [metric, setMetric] = useState<SeoMetric>("clicks");
  const [granularity, setGranularity] = useState<SeoGranularity>("day");
  const [customOpen, setCustomOpen] = useState(period.preset === "custom");
  const [customStart, setCustomStart] = useState(period.start);
  const [customEnd, setCustomEnd] = useState(period.end);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const snapshot = state.status === "ready" ? state.snapshot : null;
  const days = snapshot ? dayCount(snapshot.period) : periodDays(period);
  const granularities = availableGranularities(days);
  const activeGranularity = granularities.includes(granularity) ? granularity : "day";

  const navigate = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) { if (value === null) params.delete(key); else params.set(key, value); }
    startTransition(() => router.push(`/analytics?${params.toString()}`, { scroll: false }));
  };
  const reflect = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === null) params.delete(key); else params.set(key, value);
    window.history.replaceState(null, "", `?${params.toString()}`);
  };
  const refresh = () => {
    setFeedback(null);
    startTransition(async () => {
      const result = await syncSearchConsoleNowAction(client.id, period.start, period.end);
      setFeedback(result);
      if (result.ok) router.refresh();
    });
  };

  const kpis = useMemo(() => snapshot ? buildSeoKpis(snapshot) : [], [snapshot]);
  const series = useMemo(() => snapshot ? seoSeries(snapshot.daily, metric, activeGranularity) : [], [snapshot, metric, activeGranularity]);
  const previousSeries = useMemo(() => snapshot && compare === "previous" ? seoSeries(snapshot.previousDaily, metric, activeGranularity) : [], [snapshot, compare, metric, activeGranularity]);
  const comparable = Boolean(snapshot?.previousTotals && snapshot.previousTotals.impressions > 0);
  const failed = snapshot ? Object.entries(snapshot.sections).filter(([, status]) => status && !status.ok).map(([key, status]) => `${({ previousDaily: "période précédente", queries: "requêtes", pages: "pages", countries: "pays", devices: "appareils", daily: "série quotidienne" } as Record<string, string>)[key] ?? key} : ${status?.error ?? "indisponible"}`) : [];
  const isExpanded = (key: string) => Boolean(expanded[key]);
  const toggle = (key: string) => setExpanded((current) => ({ ...current, [key]: !current[key] }));
  const totalClicks = snapshot?.totals.clicks ?? 0;
  const countryRows: BarRow[] = (snapshot?.countries ?? []).slice(0, isExpanded("countries") ? 50 : 6).map((row) => {
    const country = searchCountry(row.key);
    return { key: row.key, value: row.clicks, share: totalClicks > 0 ? Math.round((row.clicks / totalClicks) * 1000) / 10 : null, title: row.key.toUpperCase(),
      label: <><span aria-hidden="true" className="w-5 shrink-0 text-center text-base leading-none">{country.alpha2 ? countryFlag(country.alpha2) ?? "🌐" : "🌐"}</span><span className="truncate">{country.label}</span></> };
  });
  const devices = (snapshot?.devices ?? []).filter((row) => row.clicks > 0 || row.impressions > 0).slice(0, 4);
  const deviceClicks = devices.reduce((sum, row) => sum + row.clicks, 0);
  const exportCsv = () => {
    if (!snapshot) return;
    const base = `search-console-${client.name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${snapshot.period.start}_${snapshot.period.end}`;
    download(`${base}.csv`, `﻿${searchConsoleCsv(snapshot, client.name)}`, "text/csv;charset=utf-8");
  };

  return (
    <div>
      <header className="mb-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-foreground sm:text-[30px]">Référencement naturel — {client.name}</h1>
            <p className="mt-1.5 text-sm text-muted">{property ? <>Google Search Console · propriété <span className="break-all text-foreground">{propertyLabel(property)}</span></> : "Google Search Console · aucune propriété associée"}</p>
          </div>
          <button type="button" onClick={exportCsv} disabled={!snapshot} className={actionClass("primary", "min-h-10 shrink-0")}><Icon name="download" width={15} height={15} /> Exporter</button>
        </div>
        <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center">
          <div className="col-span-2 md:w-72">
            <Select icon="clients" label="Client" value={client.id} onChange={(id) => navigate({ client: id })}>
              {clients.map((option) => <option key={option.id} value={option.id}>{option.name}{option.property ? "" : " (sans propriété)"}</option>)}
            </Select>
          </div>
          <div className="md:w-48">
            <Select icon="calendar" label="Période" value={customOpen ? "custom" : period.preset} onChange={(value) => { if (value === "custom") { setCustomOpen(true); return; } setCustomOpen(false); navigate({ period: value, start: null, end: null }); }}>
              <option value="7">7 derniers jours</option><option value="30">30 derniers jours</option><option value="90">90 derniers jours</option><option value="custom">Personnalisée…</option>
            </Select>
          </div>
          <div className="md:w-72">
            <Select icon="compare" label="Comparaison" value={compare} onChange={(value) => { const next = value === "none" ? "none" : "previous"; setCompare(next); reflect("compare", next === "none" ? "none" : null); }}>
              <option value="previous">Comparer : période précédente</option><option value="none">Sans comparaison</option>
            </Select>
          </div>
        </div>
      </header>

      {customOpen && (
        <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-3">
          <label className="text-xs text-muted">Du<input type="date" value={customStart} max={customEnd || today} onChange={(event) => setCustomStart(event.target.value)} className="mt-1 block min-h-10 rounded-lg border border-border-strong bg-surface-sunken px-3 text-sm text-foreground [color-scheme:dark]" /></label>
          <label className="text-xs text-muted">Au<input type="date" value={customEnd} min={customStart} max={today} onChange={(event) => setCustomEnd(event.target.value)} className="mt-1 block min-h-10 rounded-lg border border-border-strong bg-surface-sunken px-3 text-sm text-foreground [color-scheme:dark]" /></label>
          <button type="button" onClick={() => customStart && customEnd && customStart <= customEnd && navigate({ period: "custom", start: customStart, end: customEnd })} disabled={!customStart || !customEnd || customStart > customEnd || isPending} className={actionClass("primary", "min-h-10")}>Appliquer</button>
          <button type="button" onClick={() => setCustomOpen(false)} className="min-h-10 rounded-lg px-3 text-sm text-muted hover:text-foreground">Annuler</button>
          <p className="w-full text-[11px] text-subtle">366 jours maximum ; Google conserve 16 mois de données.</p>
        </div>
      )}

      <div aria-busy={isPending} className={`transition-opacity ${isPending ? "pointer-events-none opacity-50" : ""}`}>
        {state.status === "not_connected" && (
          <StatePanel icon="link" title={state.reason === "property" ? "Aucune propriété Search Console associée" : state.reason === "revoked" ? "Accès Google révoqué" : "Google Search Console non connecté"} tone="bg-warning/10 text-warning"
            action={state.reason === "property" ? <Link href={`/clients/${client.id}?tab=agents`} className={linkButton}>Associer une propriété</Link> : <Link href="/settings?tab=connections#search-console" className={linkButton}>{state.reason === "revoked" ? "Reconnecter Search Console" : "Connecter Google Search Console"}</Link>}>
            {state.reason === "property"
              ? <p>{client.name} n’a pas encore de propriété Search Console. Choisissez-la sur la fiche client{state.properties ? ` parmi les ${state.properties} propriétés du compte Google connecté` : ""}. Aucune statistique n’est affichée sans propriété.</p>
              : state.reason === "revoked" ? <p>Google a refusé le jeton de CODE-V OS (accès retiré ou expiré). Reconnectez le compte depuis les paramètres.</p>
              : <p>Connectez le compte Google qui a accès aux propriétés des clients depuis Paramètres → Connexions.</p>}
          </StatePanel>
        )}
        {state.status === "unavailable" && (
          <StatePanel icon="alert" title="Données Search Console indisponibles" tone="bg-danger/10 text-danger" action={<button type="button" onClick={refresh} className={linkButton}><Icon name="refresh" width={15} height={15} /> Réessayer</button>}>
            <p>La synchronisation a échoué pour la période du {shortDay(period.start)} au {shortDay(period.end)} et aucun instantané n’existe pour cette période. Aucune donnée d’une autre période n’est affichée à la place.</p>
            {state.error && <p className="mt-2 break-words text-xs text-muted">Cause : {state.error}</p>}
            {feedback && <p className={`mt-2 ${feedback.ok ? "text-success" : "text-danger"}`}>{feedback.message}</p>}
          </StatePanel>
        )}

        {snapshot && state.status === "ready" && <div className="space-y-5">
          <div role="note" className="rounded-xl border border-border-strong bg-surface-sunken px-4 py-3 text-xs leading-5 text-muted">
            <p><span className="font-medium text-foreground">Clics organiques ≠ visiteurs.</span> Search Console compte les clics depuis les résultats de recherche Google ; Vercel Web Analytics compte les visiteurs du site, toutes sources confondues. Les deux ne s’additionnent pas et ne se comparent pas directement.</p>
            <p className="mt-1">Période mesurée : du {shortDay(snapshot.period.start)} au {shortDay(snapshot.period.end)}{snapshot.period.end !== snapshot.requested.end ? ` (données consolidées par Google jusqu’au ${shortDay(snapshot.lastAvailableDate ?? snapshot.period.end)} ; les ${dayCount({ start: snapshot.period.end, end: snapshot.requested.end }) - 1} derniers jours sont encore incomplets)` : ""}. Comparaison : du {shortDay(snapshot.previousPeriod.start)} au {shortDay(snapshot.previousPeriod.end)}. Jours selon le fuseau de Google (heure du Pacifique).</p>
          </div>
          {(state.stale || feedback) && (
            <div role="note" className={`rounded-xl border px-4 py-3 text-sm ${feedback?.ok ? "border-success/25 bg-success/10 text-success" : "border-warning/25 bg-warning/10 text-warning"}`}>
              {feedback ? feedback.message : `Données anciennes : instantané de cette période récupéré le ${dateTime(state.fetchedAt)}. La synchronisation a échoué, les chiffres ne sont pas à jour.`}
              {!feedback && state.syncError && <p className="mt-1 break-words text-xs">Cause : {state.syncError}</p>}
            </div>
          )}
          {failed.length > 0 && (
            <div role="note" className="rounded-xl border border-border-strong bg-surface-sunken px-4 py-3 text-xs leading-5 text-muted">
              <p className="font-medium text-foreground">Certaines données n’ont pas pu être récupérées auprès de Google :</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">{failed.map((line) => <li key={line} className="break-words">{line}</li>)}</ul>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
            {kpis.map((kpi) => <KpiCard key={kpi.key} kpi={kpi} compare={compare === "previous" && comparable} days={days} />)}
          </div>

          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
              <div className="flex min-w-0 items-center gap-3">
                <IconBadge name="seo" tone="bg-accent/10 text-accent-hover" />
                <div>
                  <h2 className="text-[15px] font-semibold text-foreground">Évolution dans Google</h2>
                  <p className="text-xs text-muted">{metricLabels[metric]} {granularityLabels[activeGranularity].toLowerCase()}{metric === "position" ? " · plus la valeur est basse, mieux c’est" : ""}{compare === "previous" && previousSeries.length > 0 ? " · pointillés : période précédente" : ""}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div role="group" aria-label="Métrique du graphique" className="flex flex-wrap rounded-xl border border-border-strong bg-surface-sunken p-1">
                  {(Object.keys(metricLabels) as SeoMetric[]).map((key) => <button key={key} type="button" aria-pressed={metric === key} onClick={() => setMetric(key)} className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${metric === key ? "bg-accent-strong font-medium text-accent-foreground" : "text-muted hover:text-foreground"}`}>{key === "position" ? "Position" : metricLabels[key]}</button>)}
                </div>
                <div className="w-36"><Select icon="clock" label="Granularité" value={activeGranularity} onChange={(value) => setGranularity(value as SeoGranularity)} disabled={granularities.length < 2}>{granularities.map((key) => <option key={key} value={key}>{granularityLabels[key]}</option>)}</Select></div>
              </div>
            </div>
            <div className="px-3 pb-3 pt-4 sm:px-4">
              {series.length ? <TrafficChart points={series} previous={compare === "previous" ? previousSeries : undefined} label={`${metricLabels[metric]} Search Console`} metricLabel={metricUnits[metric]} />
                : <p className="flex min-h-48 items-center justify-center px-6 text-center text-sm text-muted">Aucune impression enregistrée par Google sur cette période.</p>}
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <WidgetHeader icon="seo" title="Requêtes de recherche" action={snapshot.queries.length > 10 ? <GhostButton onClick={() => toggle("queries")} pressed={isExpanded("queries")}>{isExpanded("queries") ? "Réduire" : "Toutes les requêtes"} <Icon name="arrow" width={13} height={13} /></GhostButton> : undefined}>
                <p className="text-xs text-muted">Les requêtes anonymisées par Google ne sont pas listées : leur total peut être inférieur aux clics.</p>
              </WidgetHeader>
              <DimensionTable rows={snapshot.queries.slice(0, isExpanded("queries") ? 100 : 10)} head="Requête" format={(key) => key} compare={compare === "previous" && comparable}
                empty={snapshot.sections.queries?.ok === false ? `Requêtes indisponibles : ${snapshot.sections.queries.error}` : "Aucune requête enregistrée sur la période."} />
            </Card>
            <Card>
              <WidgetHeader icon="file" title="Pages les plus performantes" action={snapshot.pages.length > 10 ? <GhostButton onClick={() => toggle("pages")} pressed={isExpanded("pages")}>{isExpanded("pages") ? "Réduire" : "Toutes les pages"} <Icon name="arrow" width={13} height={13} /></GhostButton> : undefined} />
              <DimensionTable rows={snapshot.pages.slice(0, isExpanded("pages") ? 100 : 10)} head="Page" format={pagePath} compare={compare === "previous" && comparable}
                empty={snapshot.sections.pages?.ok === false ? `Pages indisponibles : ${snapshot.sections.pages.error}` : "Aucune page affichée dans Google sur la période."} />
            </Card>
            <Card>
              <WidgetHeader icon="globe" title="Pays" action={snapshot.countries.length > 6 ? <GhostButton onClick={() => toggle("countries")} pressed={isExpanded("countries")}>{isExpanded("countries") ? "Réduire" : "Tous les pays"} <Icon name="arrow" width={13} height={13} /></GhostButton> : undefined} />
              <BarTable head="Pays" valueLabel="Clics" rows={countryRows} empty={snapshot.sections.countries?.ok === false ? `Pays indisponibles : ${snapshot.sections.countries.error}` : "Aucun clic par pays sur la période."} />
            </Card>
            <Card>
              <WidgetHeader icon="tablet" title="Appareils" />
              {devices.length && deviceClicks > 0 ? (
                <div className="flex flex-wrap items-center gap-6 px-5 pb-6 pt-5">
                  <Donut total={deviceClicks} caption="clics" segments={devices.map((row, index) => ({ label: searchDevice(row.key), value: row.clicks, color: deviceColors[index % deviceColors.length] }))} />
                  <ul className="min-w-0 flex-1 space-y-3">
                    {devices.map((row, index) => (
                      <li key={row.key} className="flex items-center justify-between gap-3 text-[13px]">
                        <span className="flex items-center gap-2.5 text-foreground"><span className="h-3 w-3 rounded-[4px]" style={{ background: deviceColors[index % deviceColors.length] }} aria-hidden="true" />{searchDevice(row.key)}</span>
                        <span className="text-right tabular-nums"><span className="font-semibold text-foreground">{fmtShare(Math.round((row.clicks / deviceClicks) * 1000) / 10)}</span><span className="ml-2 text-xs text-muted">CTR {pct(row.ctr)} · pos. {position(row.position)}</span></span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : <p className="px-5 pb-6 pt-4 text-sm text-muted">{snapshot.sections.devices?.ok === false ? `Appareils indisponibles : ${snapshot.sections.devices.error}` : "Aucun clic par appareil sur la période."}</p>}
            </Card>
          </div>

          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
            <span>Source : Google Search Console (données consolidées) · synchronisé le {dateTime(state.fetchedAt)}.</span>
            <button type="button" onClick={refresh} disabled={isPending} className="inline-flex items-center gap-1 text-accent-hover hover:text-foreground disabled:opacity-50"><Icon name="refresh" width={12} height={12} />{isPending ? "Synchronisation…" : "Synchroniser maintenant"}</button>
          </p>
        </div>}
      </div>
    </div>
  );
}
