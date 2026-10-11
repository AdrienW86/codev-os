"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { loadClientVercelAnalyticsRangeAction } from "@/app/(cockpit)/clients/[id]/health-actions";
import { Donut, Sparkline, TrafficChart } from "@/components/analytics/charts";
import { BarTable, Card, GhostButton, IconBadge, WidgetHeader, fmtShare, type BarRow } from "@/components/analytics/widgets";
import { actionClass } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import type { AnalyticsDashboardState } from "@/lib/analytics/dashboard";
import {
  analyticsCsv, availableGranularities, buildKpis, channelLabels, channelOf, countryFlag, countryLabel, deviceLabel, eventLabel,
  classifyEvent, osLabel, periodDays, periodLabel, previousTrendSeries, share, topWithOthers, trafficChannels, trendSeries,
  type AnalyticsData, type AnalyticsPeriod, type ChannelKey, type CompareMode, type Granularity, type Kpi, type TrendMetric,
} from "@/lib/analytics/view-model";

const nf = new Intl.NumberFormat("fr-FR");
const dateTime = (value: string) => new Date(value).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });
const shortDay = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

type ClientOption = { id: string; name: string; connected: boolean };

const kpiStyle: Record<Kpi["key"], { icon: IconName; tone: string; color: string }> = {
  visitors: { icon: "users", tone: "bg-chart-1/15 text-chart-7", color: "var(--chart-1)" },
  pageviews: { icon: "file", tone: "bg-chart-2/15 text-chart-2", color: "var(--chart-2)" },
  pagesPerVisitor: { icon: "activity", tone: "bg-chart-3/15 text-chart-3", color: "var(--chart-3)" },
  forms: { icon: "mail", tone: "bg-chart-4/15 text-success", color: "var(--chart-4)" },
  cta: { icon: "pointer", tone: "bg-chart-5/15 text-chart-5", color: "var(--chart-5)" },
  conversions: { icon: "target", tone: "bg-chart-6/15 text-chart-6", color: "var(--chart-6)" },
};

const deviceColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-7)", "var(--chart-muted)"];
const metricLabels: Record<TrendMetric, string> = { visitors: "Visiteurs uniques", pageviews: "Vues de pages", conversions: "Conversions" };
// Le graphique « Conversions » trace la série quotidienne de tous les événements suivis.
const metricUnits: Record<TrendMetric, string> = { visitors: "visiteurs", pageviews: "vues", conversions: "événements" };
const granularityLabels: Record<Granularity, string> = { day: "Par jour", week: "Par semaine", month: "Par mois" };
const channelIcons: Record<Exclude<ChannelKey, "all">, IconName> = { search: "seo", direct: "link", referral: "share", social: "users" };

function formatKpi(kpi: Kpi) {
  if (kpi.value === null) return "—";
  if (kpi.format === "decimal") return kpi.value.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  return nf.format(kpi.value);
}

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[11px] text-subtle">—</span>;
  const up = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums ${up ? "text-success" : "text-danger"}`}>
      <span aria-hidden="true">{up ? "↑" : "↓"}</span>
      <span className="sr-only">{up ? "en hausse de" : "en baisse de"}</span>
      {up ? "+" : ""}{value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %
    </span>
  );
}

function KpiCard({ kpi, compare, days }: { kpi: Kpi; compare: boolean; days: number }) {
  const style = kpiStyle[kpi.key];
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-center gap-3">
        <IconBadge name={style.icon} tone={style.tone} />
        <p className="text-[13px] font-medium leading-tight text-muted">{kpi.label}</p>
      </div>
      <div className="flex items-end justify-between gap-2">
        <p className="text-[28px] font-semibold leading-none tracking-tight tabular-nums text-foreground">{formatKpi(kpi)}</p>
        {compare && <Delta value={kpi.delta} />}
      </div>
      <div className="flex items-end justify-between gap-2">
        <Sparkline values={kpi.spark} color={style.color} />
        <p className="shrink-0 text-right text-[10.5px] leading-tight text-subtle">{compare ? `vs ${days} jours précédents` : kpi.hint}</p>
      </div>
    </Card>
  );
}

function Select({ icon, label, value, onChange, children, disabled }: { icon: IconName; label: string; value: string; onChange: (value: string) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className="relative inline-flex min-h-10 min-w-0 items-center">
      <span className="sr-only">{label}</span>
      <Icon name={icon} width={15} height={15} className="pointer-events-none absolute left-3 text-muted" />
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="min-h-10 w-full min-w-0 appearance-none truncate rounded-lg border border-border-strong bg-surface-sunken py-2 pl-9 pr-8 text-[13px] text-foreground outline-none transition-colors hover:border-accent/40 focus-visible:border-accent disabled:opacity-60">
        {children}
      </select>
      <Icon name="chevron" width={14} height={14} className="pointer-events-none absolute right-2.5 text-muted" />
    </label>
  );
}

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function StatePanel({ icon, title, tone, children, action }: { icon: IconName; title: string; tone: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card className="px-6 py-14 text-center">
      <span className={`mx-auto flex h-12 w-12 items-center justify-center rounded-2xl ${tone}`}><Icon name={icon} width={22} height={22} /></span>
      <h2 className="mt-4 text-lg font-semibold text-foreground">{title}</h2>
      <div className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">{children}</div>
      {action && <div className="mt-6 flex flex-wrap justify-center gap-3">{action}</div>}
    </Card>
  );
}

const linkButton = actionClass("secondary", "min-h-10");

export function AnalyticsDashboard({ clients, client, period, initialCompare, initialChannel, today, state }: {
  clients: ClientOption[];
  client: { id: string; name: string };
  period: AnalyticsPeriod;
  initialCompare: CompareMode;
  initialChannel: ChannelKey;
  today: string;
  state: AnalyticsDashboardState;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [compare, setCompare] = useState<CompareMode>(initialCompare);
  const [channel, setChannel] = useState<ChannelKey>(initialChannel);
  const [metric, setMetric] = useState<TrendMetric>("visitors");
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [customOpen, setCustomOpen] = useState(period.preset === "custom");
  const [customStart, setCustomStart] = useState(period.start);
  const [customEnd, setCustomEnd] = useState(period.end);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const days = periodDays(period);
  const granularities = availableGranularities(days);
  const activeGranularity = granularities.includes(granularity) ? granularity : "day";
  const data: AnalyticsData | null = state.status === "ready" ? state.data : null;

  // Client et période : rechargement serveur (données différentes). Comparaison et canal : état local reflété dans l'URL.
  const navigate = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) params.delete(key); else params.set(key, value);
    }
    startTransition(() => router.push(`/analytics?${params.toString()}`, { scroll: false }));
  };
  const reflect = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === null) params.delete(key); else params.set(key, value);
    window.history.replaceState(null, "", `?${params.toString()}`);
  };

  const onPeriod = (value: string) => {
    if (value === "custom") { setCustomOpen(true); return; }
    setCustomOpen(false);
    navigate({ period: value, start: null, end: null });
  };
  const applyCustom = () => {
    if (!customStart || !customEnd || customStart > customEnd) return;
    navigate({ period: "custom", start: customStart, end: customEnd });
  };
  const refresh = () => {
    setRefreshError(null);
    startTransition(async () => {
      const result = await loadClientVercelAnalyticsRangeAction(client.id, period.start, period.end);
      if (!result.ok) { setRefreshError(result.message); return; }
      router.refresh();
    });
  };

  const kpis = useMemo(() => data ? buildKpis(data) : [], [data]);
  const series = useMemo(() => data ? trendSeries(data, metric, activeGranularity) : [], [data, metric, activeGranularity]);
  const previousSeries = useMemo(() => data && compare === "previous" ? previousTrendSeries(data, metric, activeGranularity) : [], [data, compare, metric, activeGranularity]);
  const channels = useMemo(() => data ? trafficChannels(data) : [], [data]);
  const conversionsAvailable = Boolean(data?.eventTrend?.length);

  const exportData = (format: "csv" | "json") => {
    if (!data) return;
    const base = `analytics-${client.name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${period.start}_${period.end}`;
    if (format === "csv") download(`${base}.csv`, `﻿${analyticsCsv(data, { client: client.name, period })}`, "text/csv;charset=utf-8");
    else download(`${base}.json`, JSON.stringify({ client: client.name, period: { start: period.start, end: period.end }, kpis: buildKpis(data), channels, data }, null, 2), "application/json");
  };

  const visitors = data?.visitors ?? 0;
  const isExpanded = (key: string) => Boolean(expanded[key]);
  const toggle = (key: string) => setExpanded((current) => ({ ...current, [key]: !current[key] }));

  const pageRows: BarRow[] = data ? (data.topPages ?? []).filter((row) => row.label).slice(0, isExpanded("pages") ? 30 : 7).map((row) => ({
    key: row.label ?? "", label: <span className="truncate font-mono text-[12.5px]">{row.label}</span>, title: row.label, value: row.visitors ?? 0, share: share(row.visitors ?? 0, visitors),
  })) : [];

  const sourceRows: BarRow[] = isExpanded("sources")
    ? (data?.topReferrers ?? []).filter((row) => row.label && (channel === "all" || channel === channelOf(row.label))).map((row) => ({
      key: row.label ?? "", label: <><Icon name={channelIcons[channelOf(row.label ?? "")]} width={14} height={14} className="shrink-0 text-muted" /><span className="truncate">{row.label}</span></>, title: `${row.label} · ${channelLabels[channelOf(row.label ?? "")]}`, value: row.visitors ?? 0, share: share(row.visitors ?? 0, visitors),
    }))
    : channels.map((row) => ({
      key: row.key,
      label: <><Icon name={channelIcons[row.key]} width={14} height={14} className="shrink-0 text-muted" /><span className="truncate">{row.label}{row.estimated && <span className="ml-1 text-subtle">(estim.)</span>}</span></>,
      title: row.estimated ? "Visiteurs sans référent identifié par Vercel (total − référents)" : undefined,
      value: row.visitors, share: row.share, highlight: channel === row.key, muted: channel !== "all" && channel !== row.key,
    }));

  const countryRows: BarRow[] = topWithOthers(data?.countries, "visitors", visitors, isExpanded("countries") ? 30 : 6, countryLabel).map((row) => ({
    key: row.raw || "others", value: row.value, share: row.share, title: row.raw || undefined,
    label: <><span aria-hidden="true" className="w-5 shrink-0 text-center text-base leading-none">{row.raw ? countryFlag(row.raw) ?? "🌐" : "…"}</span><span className="truncate">{row.label}</span></>,
  }));

  const osRows: BarRow[] = topWithOthers(data?.operatingSystems, "visitors", visitors, 5, osLabel).map((row) => ({ key: row.raw || "others", label: row.label, value: row.value, share: row.share }));

  const devices = (data?.devices ?? []).filter((row) => row.label && typeof row.visitors === "number").slice(0, 4);
  const deviceTotal = devices.reduce((sum, row) => sum + (row.visitors ?? 0), 0);
  const events = [...(data?.events ?? [])].filter((row) => row.label).sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  const shownEvents = isExpanded("events") ? events : events.slice(0, 5);
  const browsers = topWithOthers(data?.browsers, "visitors", visitors, 5).map((row) => ({ key: row.raw || "others", label: row.label, value: row.value, share: row.share }));

  return (
    <div className="relative">
      {/* Ambiance bleu nuit propre à cette page. */}

      <nav aria-label="Fil d’Ariane" className="mb-3 flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
        <Link href="/clients" className="hover:text-foreground">Clients</Link>
        <span aria-hidden="true">›</span>
        <Link href={`/clients/${client.id}`} className="hover:text-foreground">{client.name}</Link>
        <span aria-hidden="true">›</span>
        <span className="font-medium text-foreground" aria-current="page">Analytics</span>
      </nav>

      <header className="mb-6 flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-foreground sm:text-[30px]">Analytics — {client.name}</h1>
          <p className="mt-1.5 text-sm text-muted">Centre de collecte d’informations sur les performances de votre site web.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center 2xl:justify-end">
          <div className="col-span-2 sm:w-52">
            <Select icon="clients" label="Client" value={client.id} onChange={(id) => navigate({ client: id })}>
              {clients.map((option) => <option key={option.id} value={option.id}>{option.name}{option.connected ? "" : " (non connecté)"}</option>)}
            </Select>
          </div>
          <Select icon="calendar" label="Période" value={customOpen ? "custom" : period.preset} onChange={onPeriod}>
            <option value="7">7 derniers jours</option>
            <option value="30">30 derniers jours</option>
            <option value="90">90 derniers jours</option>
            <option value="custom">Personnalisée…</option>
          </Select>
          <Select icon="compare" label="Comparaison" value={compare} onChange={(value) => { const next = value === "none" ? "none" : "previous"; setCompare(next); reflect("compare", next === "none" ? "none" : null); }}>
            <option value="previous">Comparer : période préc.</option>
            <option value="none">Sans comparaison</option>
          </Select>
          <Select icon="filter" label="Canal" value={channel} onChange={(value) => { const next = value as ChannelKey; setChannel(next); reflect("channel", next === "all" ? null : next); }}>
            {(Object.keys(channelLabels) as ChannelKey[]).map((key) => <option key={key} value={key}>{channelLabels[key]}</option>)}
          </Select>
          <details className="relative">
            <summary className={`flex min-h-10 cursor-pointer list-none items-center justify-center gap-2 rounded-lg bg-accent-strong px-4 text-[13px] font-semibold text-accent-foreground transition-colors hover:bg-accent ${data ? "" : "pointer-events-none opacity-50"}`}>
              <Icon name="download" width={15} height={15} /> Exporter
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-48 overflow-hidden rounded-xl border border-border-strong bg-surface-raised p-1 shadow-popover">
              <button type="button" onClick={(event) => { exportData("csv"); event.currentTarget.closest("details")?.removeAttribute("open"); }} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-accent/10">CSV (Excel)</button>
              <button type="button" onClick={(event) => { exportData("json"); event.currentTarget.closest("details")?.removeAttribute("open"); }} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-accent/10">JSON (données brutes)</button>
            </div>
          </details>
        </div>
      </header>

      {customOpen && (
        <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-3">
          <label className="text-xs text-muted">Du
            <input type="date" value={customStart} max={customEnd || today} onChange={(event) => setCustomStart(event.target.value)} className="mt-1 block min-h-10 rounded-lg border border-border-strong bg-surface-sunken px-3 text-sm text-foreground [color-scheme:dark]" />
          </label>
          <label className="text-xs text-muted">Au
            <input type="date" value={customEnd} min={customStart} max={today} onChange={(event) => setCustomEnd(event.target.value)} className="mt-1 block min-h-10 rounded-lg border border-border-strong bg-surface-sunken px-3 text-sm text-foreground [color-scheme:dark]" />
          </label>
          <button type="button" onClick={applyCustom} disabled={!customStart || !customEnd || customStart > customEnd || isPending} className={actionClass("primary", "min-h-10")}>Appliquer</button>
          <button type="button" onClick={() => setCustomOpen(false)} className="min-h-10 rounded-lg px-3 text-sm text-muted hover:text-foreground">Annuler</button>
          <p className="w-full text-[11px] text-subtle">366 jours maximum.</p>
        </div>
      )}

      <div aria-busy={isPending} className={`transition-opacity ${isPending ? "pointer-events-none opacity-50" : ""}`}>
        {isPending && <p role="status" className="sr-only">Chargement des données…</p>}

        {state.status === "not_connected" && (
          <StatePanel icon="link" title="Source non connectée" tone="bg-warning/10 text-warning" action={state.reason === "project"
            ? <Link href={`/clients/${client.id}?tab=agents`} className={linkButton}>Connecter le projet Vercel</Link>
            : <Link href="/settings" className={linkButton}>Voir les intégrations</Link>}>
            {state.reason === "project"
              ? <p>{client.name} n’a pas encore de projet Vercel Web Analytics associé. Aucune statistique n’est affichée tant que la source n’est pas connectée.</p>
              : <p>L’intégration Vercel n’est pas configurée sur le serveur (jeton manquant) et aucun instantané n’existe pour cette période.</p>}
          </StatePanel>
        )}

        {state.status === "unavailable" && (
          <StatePanel icon="alert" title="Données momentanément indisponibles" tone="bg-danger/10 text-danger" action={<button type="button" onClick={refresh} className={linkButton}><Icon name="refresh" width={15} height={15} /> Réessayer</button>}>
            <p>Vercel n’a pas répondu et aucun instantané n’est encore enregistré pour {client.name}.</p>
            {state.lastError && <p className="mt-1 text-xs text-subtle">Dernière erreur : {state.lastError}</p>}
            {refreshError && <p className="mt-2 text-danger">{refreshError}</p>}
          </StatePanel>
        )}

        {state.status === "ready" && data && <div className="space-y-5">
          {(state.stale || refreshError) && (
            <div role="note" className="rounded-xl border border-warning/25 bg-warning/10 px-4 py-3 text-sm text-warning">
              {refreshError ?? (state.periodStart !== period.start || state.periodEnd !== period.end
                ? `Vercel est indisponible pour la période demandée : affichage du dernier instantané connu (${shortDay(state.periodStart)} → ${shortDay(state.periodEnd)}).`
                : "Vercel est indisponible : affichage du dernier instantané enregistré pour cette période.")}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 2xl:grid-cols-6">
            {kpis.map((kpi) => <KpiCard key={kpi.key} kpi={kpi} compare={compare === "previous"} days={days} />)}
          </div>

          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
              <div className="flex min-w-0 items-center gap-3">
                <IconBadge name="analytics" tone="bg-accent/10 text-accent-hover" />
                <div>
                  <h2 className="text-[15px] font-semibold text-foreground">Évolution du trafic</h2>
                  <p className="text-xs text-muted">{metricLabels[metric]} {granularityLabels[activeGranularity].toLowerCase()} sur {period.preset === "custom" ? "la période" : `les ${periodLabel(period)}`}{compare === "previous" && metric !== "conversions" ? " · pointillés : période précédente" : ""}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div role="group" aria-label="Métrique du graphique" className="flex rounded-xl border border-border-strong bg-surface-sunken p-1">
                  {(["visitors", "pageviews", "conversions"] as TrendMetric[]).map((key) => {
                    const disabled = key === "conversions" && !conversionsAvailable;
                    return <button key={key} type="button" disabled={disabled} aria-pressed={metric === key} onClick={() => setMetric(key)} title={disabled ? "Aucune série quotidienne d’événements fournie par Vercel pour cette période" : undefined} className={`rounded-lg px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${metric === key ? "bg-accent-strong font-medium text-accent-foreground" : "text-muted hover:text-foreground"}`}>{metricLabels[key]}</button>;
                  })}
                </div>
                <div className="w-36">
                  <Select icon="clock" label="Granularité" value={activeGranularity} onChange={(value) => setGranularity(value as Granularity)} disabled={granularities.length < 2}>
                    {granularities.map((key) => <option key={key} value={key}>{granularityLabels[key]}</option>)}
                  </Select>
                </div>
              </div>
            </div>
            <div className="px-3 pb-3 pt-4 sm:px-4">
              <TrafficChart points={series} previous={compare === "previous" ? previousSeries : undefined} partialLast={activeGranularity === "day" && period.end === today} label={`${metricLabels[metric]} — ${periodLabel(period)}`} metricLabel={metricUnits[metric]} />
            </div>
          </Card>

          {channel !== "all" && (
            <p role="note" className="text-xs text-muted">
              Filtre « {channelLabels[channel]} » : {nf.format(channels.find((row) => row.key === channel)?.visitors ?? 0)} visiteurs ({fmtShare(channels.find((row) => row.key === channel)?.share ?? null)}). Vercel ne segmente pas les autres widgets par canal ; le filtre s’applique aux sources de trafic.
            </p>
          )}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Card>
              <WidgetHeader icon="file" title="Pages les plus visitées" action={(data.topPages?.length ?? 0) > 7 ? <GhostButton onClick={() => toggle("pages")} pressed={isExpanded("pages")}>{isExpanded("pages") ? "Réduire" : "Toutes les pages"} <Icon name="arrow" width={13} height={13} /></GhostButton> : undefined} />
              <BarTable head="Page" rows={pageRows} empty="Aucune page vue sur la période." />
            </Card>
            <Card>
              <WidgetHeader icon="link" title="Sources de trafic" action={(data.topReferrers?.length ?? 0) > 0 ? <GhostButton onClick={() => toggle("sources")} pressed={isExpanded("sources")}>{isExpanded("sources") ? "Par canal" : "Toutes les sources"} <Icon name="arrow" width={13} height={13} /></GhostButton> : undefined} />
              <BarTable head={isExpanded("sources") ? "Domaine référent" : "Source"} rows={sourceRows} empty={isExpanded("sources") ? "Aucun référent pour ce canal." : "Aucune source identifiée."} />
            </Card>
            <Card>
              <WidgetHeader icon="globe" title="Pays des visiteurs" action={(data.countries?.length ?? 0) > 6 ? <GhostButton onClick={() => toggle("countries")} pressed={isExpanded("countries")}>{isExpanded("countries") ? "Réduire" : "Tous les pays"} <Icon name="arrow" width={13} height={13} /></GhostButton> : undefined} />
              <BarTable head="Pays" rows={countryRows} empty="Pays non fournis par Vercel pour cette période." />
            </Card>

            <Card>
              <WidgetHeader icon="tablet" title="Appareils" />
              {devices.length ? (
                <div className="flex flex-wrap items-center gap-6 px-5 pb-6 pt-5">
                  <Donut total={visitors} caption="visiteurs" segments={devices.map((row, index) => ({ label: deviceLabel(row.label ?? ""), value: row.visitors ?? 0, color: deviceColors[index % deviceColors.length] }))} />
                  <ul className="min-w-0 flex-1 space-y-3">
                    {devices.map((row, index) => (
                      <li key={row.label} className="flex items-center justify-between gap-3 text-[13px]">
                        <span className="flex items-center gap-2.5 text-foreground"><span className="h-3 w-3 rounded-[4px]" style={{ background: deviceColors[index % deviceColors.length] }} aria-hidden="true" />{deviceLabel(row.label ?? "")}</span>
                        <span className="font-semibold tabular-nums text-foreground">{fmtShare(share(row.visitors ?? 0, deviceTotal))}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : <p className="px-5 pb-6 pt-4 text-sm text-muted">Appareils non fournis par Vercel pour cette période.</p>}
            </Card>
            <Card>
              <WidgetHeader icon="monitor" title="Systèmes d’exploitation" />
              <BarTable head="Système" rows={osRows} empty="Systèmes non fournis par Vercel pour cette période." compact />
            </Card>
            <Card>
              <WidgetHeader icon="activity" title="Événements récents" action={events.length > 5 ? <GhostButton onClick={() => toggle("events")} pressed={isExpanded("events")}>{isExpanded("events") ? "Réduire" : "Tous les événements"} <Icon name="arrow" width={13} height={13} /></GhostButton> : undefined} />
              {events.length ? (
                <div className="px-5 pb-5 pt-4">
                  <div className="grid grid-cols-[minmax(0,1fr)_4rem_3.5rem] gap-3 border-b border-border pb-2 text-[10px] font-medium uppercase tracking-wider text-subtle"><span>Événement</span><span className="text-right">Visiteurs</span><span className="text-right">Total</span></div>
                  <ul className="mt-1.5">
                    {shownEvents.map((row) => {
                      const kind = classifyEvent(row.label ?? "");
                      return (
                        <li key={row.label} className="grid grid-cols-[minmax(0,1fr)_4rem_3.5rem] items-center gap-3 py-1.5 text-[13px]">
                          <span className="flex min-w-0 items-center gap-2.5 text-foreground" title={row.label}>
                            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${kind === "form" ? "bg-chart-1/15 text-chart-7" : kind === "cta" ? "bg-chart-4/15 text-success" : "bg-chart-6/15 text-chart-6"}`}><Icon name={kind === "form" ? "mail" : kind === "cta" ? "pointer" : "activity"} width={12} height={12} /></span>
                            <span className="truncate">{eventLabel(row.label ?? "")}</span>
                          </span>
                          <span className="text-right tabular-nums text-muted">{nf.format(row.visitors ?? 0)}</span>
                          <span className="text-right font-semibold tabular-nums text-foreground">{nf.format(row.count ?? 0)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : <p className="px-5 pb-6 pt-4 text-sm leading-6 text-muted">Aucun événement personnalisé remonté. Les clics (téléphone, email, CTA) et formulaires doivent être instrumentés avec <code className="text-muted">track()</code> de Vercel Analytics.</p>}
            </Card>
          </div>

          {(browsers.length > 0 || (data.insights?.length ?? 0) > 0) && (
            <div className="grid gap-4 xl:grid-cols-[1fr_1.4fr]">
              <Card>
                <WidgetHeader icon="globe" title="Navigateurs" />
                <BarTable head="Navigateur" rows={browsers} empty="Navigateurs non fournis par Vercel pour cette période." compact />
              </Card>
              <Card>
                <WidgetHeader icon="recommendations" title="Lecture automatique" />
                <ul className="space-y-2.5 px-5 pb-5 pt-4">
                  {(data.insights ?? []).map((item, index) => (
                    <li key={index} className="rounded-xl border border-border bg-surface-raised/60 p-3">
                      <p className={`text-sm font-medium ${item.kind === "positive" ? "text-success" : item.kind === "warning" ? "text-warning" : "text-foreground"}`}>{item.title}</p>
                      <p className="mt-1 text-xs leading-5 text-muted">{item.detail}</p>
                    </li>
                  ))}
                  {!data.insights?.length && <li className="text-sm text-muted">Aucun signal notable sur cette période.</li>}
                </ul>
              </Card>
            </div>
          )}

          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
            <span>Source : Vercel Web Analytics · {shortDay(state.periodStart)} → {shortDay(state.periodEnd)} · synchronisé le {dateTime(state.fetchedAt)}.</span>
            <button type="button" onClick={refresh} disabled={isPending} className="inline-flex items-center gap-1 text-accent-hover hover:text-foreground disabled:opacity-50"><Icon name="refresh" width={12} height={12} />{isPending ? "Actualisation…" : "Actualiser"}</button>
          </p>
        </div>}
      </div>
    </div>
  );
}
