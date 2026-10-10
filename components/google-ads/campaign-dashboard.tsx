"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { change, createRequestTracker, describeScope, filterCampaigns, groupByType, parseFilters, periodKey, reconcile, statusLabels, sumCampaigns, typeLabel, writeFilters, type CampaignRow, type DashboardData, type DashboardFilters, type StatusFilter } from "@/lib/integrations/google-ads/dashboard";
import { PERIOD_PRESETS, describeDates, presetLabels, type PeriodPreset } from "@/lib/integrations/google-ads/periods";
import type { AdsMetrics } from "@/lib/integrations/google-ads/types";

export type DashboardResult = { ok: true; data: DashboardData } | { ok: false; message: string };
export type ScopeActionState = { ok?: boolean; message?: string; href?: string };
export type DashboardScope = { start: string; end: string; status: StatusFilter; types: string[]; campaignIds: string[] };
type ScopeAction = (clientId: string, scope: DashboardScope) => Promise<ScopeActionState>;

type View = { status: "ready" | "loading" | "error"; data: DashboardData | null; message?: string };

const field = "mt-1 block min-h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground";
const chip = (active: boolean) => `min-h-9 rounded-full border px-3 text-sm ${active ? "border-accent/60 bg-accent/10 text-accent" : "border-border text-muted hover:text-foreground"}`;

/**
 * Tableau de bord des campagnes Google Ads (lecture seule).
 * - Les filtres vivent dans l'URL (partage, retour arrière) ; changer de période recharge les données
 *   SUR PLACE (action serveur), sans navigation : l'onglet et le client sont conservés.
 * - Une réponse arrivée après une demande plus récente est ignorée (compteur de requêtes).
 * - Pendant un chargement ou après une erreur, aucun ancien chiffre n'est présenté comme celui de la nouvelle période.
 */
export function CampaignDashboard({ clientId, initial, initialFilters, load, prepareReport, runAnalysis, analysisNote }: {
  clientId: string; initial: DashboardResult; initialFilters: DashboardFilters;
  load: (clientId: string, query: string) => Promise<DashboardResult>;
  prepareReport?: ScopeAction; runAnalysis?: ScopeAction; analysisNote?: string;
}) {
  // Filtres analysés côté serveur depuis la même URL : rendu serveur et navigateur identiques.
  const [filters, setFilters] = useState<DashboardFilters>(initialFilters);
  const [view, setView] = useState<View>(initial.ok ? { status: "ready", data: initial.data } : { status: "error", data: null, message: initial.message });
  const [tracker] = useState(createRequestTracker);
  // Dernière période DEMANDÉE (mise à jour dans les gestionnaires d'événements, jamais pendant le rendu).
  const requested = useRef(periodKey(initialFilters));

  const fetchPeriod = useCallback(async (next: DashboardFilters) => {
    const id = tracker.start();
    requested.current = periodKey(next);
    setView({ status: "loading", data: null });
    let result: DashboardResult;
    try { result = await load(clientId, writeFilters(new URLSearchParams(), next).toString()); } catch { result = { ok: false, message: "Chargement impossible. Vérifiez la connexion, puis réessayez." }; }
    if (!tracker.isLatest(id)) return; // Réponse périmée : une demande plus récente est en cours ou terminée.
    setView(result.ok ? { status: "ready", data: result.data } : { status: "error", data: null, message: result.message });
  }, [clientId, load, tracker]);

  const commit = useCallback((next: DashboardFilters) => {
    const reload = periodKey(next) !== requested.current;
    const params = writeFilters(new URLSearchParams(window.location.search), next);
    window.history.pushState(null, "", `${window.location.pathname}?${params.toString()}`);
    setFilters(next);
    if (reload) void fetchPeriod(next);
  }, [fetchPeriod]);

  useEffect(() => {
    const onPop = () => {
      const next = parseFilters(new URLSearchParams(window.location.search));
      const reload = periodKey(next) !== requested.current;
      setFilters(next);
      if (reload) void fetchPeriod(next);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [fetchPeriod]);

  const data = view.status === "ready" ? view.data : null;
  const selected = useMemo(() => (data ? filterCampaigns(data.campaigns, filters) : []), [data, filters]);

  return (
    <section aria-labelledby="ads-dashboard-title" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="ads-dashboard-title" className="text-lg font-semibold">Campagnes Google Ads</h2>
        <span className="rounded-md bg-white/5 px-2 py-1 text-xs text-muted">Lecture seule · aucune modification Google Ads</span>
      </div>
      <PeriodControls filters={filters} onChange={commit} busy={view.status === "loading"} />
      {view.status === "loading" && <p role="status" aria-live="polite" className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">Chargement de la période sélectionnée… les chiffres précédents sont masqués.</p>}
      {view.status === "error" && (
        <div role="alert" className="rounded-xl border border-amber-300/30 bg-amber-400/10 p-4 text-sm text-amber-100">
          <p>{view.message}</p>
          <button type="button" onClick={() => void fetchPeriod(filters)} className="mt-3 min-h-10 rounded-lg border border-border px-3 text-sm text-foreground">Réessayer</button>
        </div>
      )}
      {data && <DashboardBody data={data} filters={filters} selected={selected} onChange={commit} clientId={clientId} prepareReport={prepareReport} runAnalysis={runAnalysis} analysisNote={analysisNote} />}
    </section>
  );
}

function PeriodControls({ filters, onChange, busy }: { filters: DashboardFilters; onChange: (next: DashboardFilters) => void; busy: boolean }) {
  const [draft, setDraft] = useState({ date: filters.period.date ?? "", start: filters.period.start ?? "", end: filters.period.end ?? "" });
  const preset = filters.period.preset;
  const setPreset = (value: PeriodPreset) => {
    if (value === "day" || value === "custom") { onChange({ ...filters, period: { preset: value, ...(value === "day" ? { date: draft.date } : { start: draft.start, end: draft.end }) } }); return; }
    onChange({ ...filters, period: { preset: value } });
  };
  return (
    <div className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_auto] sm:items-end" aria-busy={busy}>
      <label className="text-xs text-muted">Période
        <select value={preset} onChange={(event) => setPreset(event.target.value as PeriodPreset)} className={field}>
          {PERIOD_PRESETS.map((value) => <option key={value} value={value}>{presetLabels[value]}</option>)}
        </select>
      </label>
      {preset === "day" && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); onChange({ ...filters, period: { preset: "day", date: draft.date } }); }}>
          <label className="text-xs text-muted">Date<input type="date" required value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} className={field} /></label>
          <button className="min-h-10 rounded-lg border border-border px-3 text-sm">Appliquer</button>
        </form>
      )}
      {preset === "custom" && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); onChange({ ...filters, period: { preset: "custom", start: draft.start, end: draft.end } }); }}>
          <label className="text-xs text-muted">Début<input type="date" required value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} className={field} /></label>
          <label className="text-xs text-muted">Fin<input type="date" required value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} className={field} /></label>
          <button className="min-h-10 rounded-lg border border-border px-3 text-sm">Appliquer</button>
        </form>
      )}
      {preset !== "day" && preset !== "custom" && <span className="hidden sm:block" />}
      <label className="inline-flex min-h-10 items-center gap-2 text-sm">
        <input type="checkbox" checked={filters.compare} onChange={(event) => onChange({ ...filters, compare: event.target.checked })} />
        Comparer à la période précédente
      </label>
    </div>
  );
}

function DashboardBody({ data, filters, selected, onChange, clientId, prepareReport, runAnalysis, analysisNote }: {
  data: DashboardData; filters: DashboardFilters; selected: CampaignRow[]; onChange: (next: DashboardFilters) => void; clientId: string;
  prepareReport?: ScopeAction; runAnalysis?: ScopeAction; analysisNote?: string;
}) {
  const money = useMemo(() => new Intl.NumberFormat("fr-FR", { style: "currency", currency: data.account.currency }), [data.account.currency]);
  const fmt = useMemo(() => formatters(money), [money]);
  const totals = sumCampaigns(selected);
  const previousTotals = data.previousPeriod ? sumCampaigns(selected, (row) => row.previous) : null;
  const allRows = sumCampaigns(data.campaigns);
  const gaps = reconcile(data.accountTotals, allRows.metrics);
  const types = [...new Set(data.campaigns.map((row) => row.type))];
  const scope = `${describeScope(selected, filters)} · ${describeDates(data.period)}`;
  const scopeForServer: DashboardScope = { start: data.period.start, end: data.period.end, status: filters.status, types: filters.types, campaignIds: selected.map((row) => row.id) };

  return (
    <>
      <div className="space-y-1">
        <p className="font-medium">{scope}</p>
        <p className="text-xs text-muted">Fuseau du compte : {data.account.timezone} · devise {data.account.currency}{data.period.includesToday ? " · les données du jour peuvent être incomplètes" : " · aujourd’hui exclu"}{data.previousPeriod ? ` · comparé à ${describeDates(data.previousPeriod)}` : ""}</p>
      </div>

      <fieldset className="space-y-3">
        <legend className="sr-only">Filtres des campagnes</legend>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Statut actuel">
          {(["enabled", "paused", "all"] as const).map((status) => <button key={status} type="button" aria-pressed={filters.status === status} onClick={() => onChange({ ...filters, status })} className={chip(filters.status === status)}>{status === "enabled" ? "Actives" : status === "paused" ? "En pause" : "Toutes"}</button>)}
        </div>
        <p className="text-xs text-muted">« Active » désigne le statut actuel : une campagne aujourd’hui en pause peut avoir des dépenses sur la période.</p>
        {types.length > 1 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Types de campagnes">
            <button type="button" aria-pressed={!filters.types.length} onClick={() => onChange({ ...filters, types: [] })} className={chip(!filters.types.length)}>Tous les types</button>
            {types.map((type) => {
              const active = filters.types.includes(type);
              return <button key={type} type="button" aria-pressed={active} onClick={() => onChange({ ...filters, types: active ? filters.types.filter((item) => item !== type) : [...filters.types, type] })} className={chip(active)}>{typeLabel(type)}</button>;
            })}
          </div>
        )}
        <details className="rounded-xl border border-border bg-surface p-3">
          <summary className="cursor-pointer text-sm">Sélection de campagnes {filters.campaigns.length ? `(${filters.campaigns.length})` : "(toutes celles du filtre)"}</summary>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {data.campaigns.map((row) => {
              const checked = filters.campaigns.includes(row.id);
              return (
                <li key={row.id}>
                  <label className="flex min-h-10 items-center gap-2 text-sm">
                    <input type="checkbox" checked={checked} onChange={() => onChange({ ...filters, campaigns: checked ? filters.campaigns.filter((id) => id !== row.id) : [...filters.campaigns, row.id] })} />
                    <span className="min-w-0 truncate">{row.name}</span><span className="text-xs text-muted">{typeLabel(row.type)} · {statusLabels[row.status] ?? row.status}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          {filters.campaigns.length > 0 && <button type="button" onClick={() => onChange({ ...filters, campaigns: [] })} className="mt-2 text-sm text-accent hover:underline">Effacer la sélection</button>}
        </details>
      </fieldset>

      <section aria-label="Totaux du périmètre filtré">
        <h3 className="mb-2 text-sm font-semibold">Total filtré <span className="font-normal text-muted">({selected.length} campagne{selected.length > 1 ? "s" : ""})</span></h3>
        <MetricGrid metrics={totals.metrics} previous={previousTotals?.metrics ?? null} fmt={fmt} incomplete={totals.incomplete} />
      </section>

      <details className="rounded-xl border border-border bg-surface p-4">
        <summary className="cursor-pointer text-sm font-medium">Total du compte (toutes campagnes, y compris supprimées)</summary>
        <div className="mt-3"><MetricGrid metrics={data.accountTotals} previous={data.accountPrevious} fmt={fmt} incomplete={[]} /></div>
        {gaps.length ? (
          <p className="mt-3 text-xs text-amber-200">Écart entre le total du compte et la somme des campagnes renvoyées : {gaps.map((gap) => `${metricLabels[gap.metric]} ${gap.metric === "cost" ? money.format(gap.difference) : fmt.number(gap.difference)}`).join(" · ")}. Les deux mesures ne sont pas interchangeables (campagnes Local Services, supprimées ou métriques non attribuées).</p>
        ) : <p className="mt-3 text-xs text-muted">Le total du compte correspond à la somme des campagnes renvoyées pour les métriques comparables.</p>}
      </details>

      {groupByType(selected).map((group) => (
        <section key={group.type} aria-labelledby={`ads-type-${group.type}`}>
          <h3 id={`ads-type-${group.type}`} className="mb-2 font-semibold">{group.label} <span className="text-sm font-normal text-muted">· {group.rows.length} campagne{group.rows.length > 1 ? "s" : ""}</span></h3>
          {group.type === "LOCAL_SERVICES" && <LocalServicesNote leads={data.leads} />}
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {group.rows.map((row) => <CampaignItem key={row.id} row={row} fmt={fmt} compare={Boolean(data.previousPeriod)} />)}
          </ul>
        </section>
      ))}
      {!selected.length && <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">Aucune campagne ne correspond à ces filtres sur cette période.</p>}

      <p className="text-xs text-muted">Conversions : selon le suivi configuré dans Google Ads, parfois retardées. « Valeur des conversions » est la valeur attribuée aux conversions, distincte du chiffre d’affaires réel.</p>

      {(prepareReport || runAnalysis) && (
        <div className="grid gap-4 md:grid-cols-2">
          {prepareReport && <ScopeButton title="Rapport Google Ads" description={`Enregistre un rapport pour ce périmètre exact (${selected.length} campagne${selected.length > 1 ? "s" : ""}, ${describeDates(data.period)}). Il n’évoluera plus avec les filtres.`} label="Préparer le rapport" disabled={!selected.length} run={() => prepareReport(clientId, scopeForServer)} />}
          {runAnalysis && <ScopeButton title="Analyse réelle de l’Agent Ads" description={analysisNote ?? "Données Google Ads réelles, règles déterministes (sans IA)."} label="Lancer l’analyse sur ce périmètre" disabled={!selected.length} run={() => runAnalysis(clientId, scopeForServer)} />}
        </div>
      )}
    </>
  );
}

const metricLabels: Record<keyof AdsMetrics, string> = { cost: "Dépenses", impressions: "Impressions", clicks: "Clics", ctr: "CTR", averageCpc: "CPC moyen", conversions: "Conversions", costPerConversion: "Coût / conversion", conversionValue: "Valeur des conversions" };
const metricOrder: (keyof AdsMetrics)[] = ["cost", "clicks", "impressions", "ctr", "averageCpc", "conversions", "costPerConversion", "conversionValue"];

function formatters(money: Intl.NumberFormat) {
  const number = (value: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);
  const value = (metric: keyof AdsMetrics, input: number | null) => {
    if (input === null) return "Indisponible";
    if (metric === "cost" || metric === "averageCpc" || metric === "costPerConversion" || metric === "conversionValue") return money.format(input);
    if (metric === "ctr") return `${number(input * 100)} %`;
    return number(input);
  };
  return { number, value };
}

function MetricGrid({ metrics, previous, fmt, incomplete }: { metrics: AdsMetrics; previous: AdsMetrics | null; fmt: ReturnType<typeof formatters>; incomplete: (keyof AdsMetrics)[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {metricOrder.map((metric) => {
        const delta = previous ? change(metrics[metric], previous[metric]) : null;
        return (
          <div key={metric} className="rounded-lg border border-border p-3">
            <dt className="text-xs text-muted">{metricLabels[metric]}</dt>
            <dd className="mt-1 font-semibold">{fmt.value(metric, metrics[metric])}{incomplete.includes(metric) && <span className="ml-1 text-xs font-normal text-amber-200" title="Certaines campagnes ne renvoient pas cette métrique">partiel</span>}</dd>
            {previous && <dd className="mt-1 text-xs text-muted">{delta === null ? "Comparaison indisponible" : `${delta >= 0 ? "+" : ""}${fmt.number(delta * 100)} % vs ${fmt.value(metric, previous[metric])}`}</dd>}
          </div>
        );
      })}
    </dl>
  );
}

function CampaignItem({ row, fmt, compare }: { row: CampaignRow; fmt: ReturnType<typeof formatters>; compare: boolean }) {
  const budget = row.budget.amount === null ? "Budget indisponible" : `Budget ${fmt.value("cost", row.budget.amount)}${row.budget.period === "DAILY" ? " / jour" : ""}`;
  return (
    <li className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium break-words">{row.name}</p>
          <p className="text-xs text-muted">ID {row.id} · {typeLabel(row.type)}{row.subType && row.subType !== "UNSPECIFIED" ? ` (${row.subType.toLowerCase().replaceAll("_", " ")})` : ""} · {budget}{row.budget.shared ? " · budget partagé" : ""}</p>
        </div>
        <span className="rounded-md bg-white/5 px-2 py-1 text-xs">{statusLabels[row.status] ?? row.status}</span>
      </div>
      {!row.hasActivity && <p className="mt-2 text-xs text-muted">{row.localServices ? "Métriques de campagne non renvoyées par l’API pour cette période." : "Aucune activité sur la période."}</p>}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        {metricOrder.map((metric) => <Cell key={metric} label={metricLabels[metric]}>{fmt.value(metric, row.metrics[metric])}{compare && row.previous && <span className="block text-xs text-muted">avant : {fmt.value(metric, row.previous[metric])}</span>}</Cell>)}
      </dl>
    </li>
  );
}

const Cell = ({ label, children }: { label: string; children: ReactNode }) => <div className="min-w-0"><dt className="text-xs text-muted">{label}</dt><dd className="break-words">{children}</dd></div>;

const leadTypeLabels: Record<string, string> = { PHONE_CALL: "Appels", MESSAGE: "Messages", BOOKING: "Réservations" };

function LocalServicesNote({ leads }: { leads: DashboardData["leads"] }) {
  return (
    <div className="mb-3 rounded-xl border border-border bg-white/[0.02] p-3 text-sm">
      <p className="font-medium">Leads Local Services</p>
      {!leads ? <p className="text-muted">Indisponible.</p>
        : !leads.available ? <p className="text-muted">Indisponible : {leads.reason}</p>
        : <p>{leads.total} lead{leads.total > 1 ? "s" : ""}{Object.keys(leads.byType).length ? ` (${Object.entries(leads.byType).map(([type, count]) => `${leadTypeLabels[type] ?? type.toLowerCase()} : ${count}`).join(", ")})` : ""} · facturés : {leads.charged === null ? "indisponible" : leads.charged}</p>}
      <p className="mt-1 text-xs text-muted">Source : ressource API « local_services_lead » (lecture seule, sans coordonnées). Les leads ne sont ni des clics ni des conversions : ils ne sont pas additionnés aux métriques ci-dessous.</p>
    </div>
  );
}

function ScopeButton({ title, description, label, run, disabled }: { title: string; description: string; label: string; run: () => Promise<ScopeActionState>; disabled: boolean }) {
  const [state, setState] = useState<ScopeActionState & { pending?: boolean }>({});
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted">{description}</p>
      <button type="button" disabled={disabled || state.pending} onClick={async () => { setState({ pending: true }); try { setState(await run()); } catch { setState({ ok: false, message: "Opération impossible. Réessayez." }); } }} className="mt-3 min-h-10 rounded-lg border border-border px-4 text-sm disabled:opacity-50">{state.pending ? "En cours…" : label}</button>
      {state.message && <p role="status" className={`mt-2 text-sm ${state.ok ? "text-accent" : "text-amber-200"}`}>{state.message}{state.href && <> · <a href={state.href} className="underline">Ouvrir</a></>}</p>}
    </div>
  );
}
