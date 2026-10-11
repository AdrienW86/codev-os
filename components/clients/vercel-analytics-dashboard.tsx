"use client";

import { useMemo, useState, useTransition } from "react";
import type { VercelAnalyticsSummary } from "@/lib/client-health/data";

const nf = new Intl.NumberFormat("fr-FR");
const fmtPct = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : ""}${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
const delta = (now?: number, before?: number) => {
  if (typeof now !== "number" || typeof before !== "number" || before <= 0) return null;
  return ((now - before) / before) * 100;
};
const iso = (date: Date) => date.toISOString().slice(0, 10);
const periodForDays = (days: number) => {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { start: iso(start), end: iso(end) };
};

type Row = { label?: string; pageviews?: number; visitors?: number; count?: number };
type MetricKey = "visitors" | "pageviews";
type LoadRange = (clientId: string, start: string, end: string) => Promise<{ ok: true; data: VercelAnalyticsSummary } | { ok: false; message: string }>;

function Bars({ rows, metric = "visitors", total }: { rows: Row[]; metric?: "visitors" | "pageviews" | "count"; total?: number }) {
  const valid = rows.filter((row) => row.label && typeof row[metric] === "number").slice(0, 8);
  const max = Math.max(1, ...valid.map((row) => Number(row[metric] ?? 0)));
  return <div className="space-y-3">
    {valid.map((row) => {
      const value = Number(row[metric] ?? 0);
      const share = total && total > 0 ? Math.round((value / total) * 100) : null;
      return <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_3.5rem] items-center gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center justify-between gap-2 text-xs">
            <span className="truncate" title={row.label}>{row.label}</span>
            {share !== null && <span className="text-muted">{share} %</span>}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-sky-400/80" style={{ width: `${Math.max(4, (value / max) * 100)}%` }} />
          </div>
        </div>
        <span className="text-right text-xs font-medium tabular-nums">{nf.format(value)}</span>
      </div>;
    })}
    {!valid.length && <p className="text-sm text-muted">Aucune donnée disponible.</p>}
  </div>;
}

function TrendChart({ points, metric }: { points: NonNullable<VercelAnalyticsSummary["trend"]>; metric: MetricKey }) {
  const rows = points.filter((point) => point.timestamp && typeof point[metric] === "number");
  const width = 1000, height = 260, padX = 42, padY = 28;
  const max = Math.max(1, ...rows.map((row) => Number(row[metric] ?? 0)));
  const coords = rows.map((row, index) => {
    const x = rows.length <= 1 ? width / 2 : padX + (index / (rows.length - 1)) * (width - padX * 2);
    const y = height - padY - (Number(row[metric] ?? 0) / max) * (height - padY * 2);
    return { x, y, row };
  });
  const line = coords.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  const area = coords.length ? `${line} L ${coords[coords.length - 1].x} ${height - padY} L ${coords[0].x} ${height - padY} Z` : "";

  return <div className="relative">
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[260px] w-full" role="img" aria-label="Évolution du trafic">
      <defs>
        <linearGradient id="traffic-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(56 189 248)" stopOpacity="0.24" />
          <stop offset="100%" stopColor="rgb(56 189 248)" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      {[0.25,0.5,0.75,1].map((ratio) => <line key={ratio} x1={padX} x2={width-padX} y1={padY + (height-padY*2)*ratio} y2={padY + (height-padY*2)*ratio} stroke="currentColor" className="text-white/8" />)}
      {area && <path d={area} fill="url(#traffic-area)" />}
      {line && <path d={line} fill="none" stroke="rgb(56 189 248)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
      {coords.map((point) => <circle key={point.row.timestamp} cx={point.x} cy={point.y} r="4" fill="rgb(125 211 252)" stroke="rgb(8 47 73)" strokeWidth="2" />)}
      {coords.filter((_, i) => i === 0 || i === coords.length - 1 || i % Math.max(1, Math.ceil(coords.length / 6)) === 0).map((point) => (
        <text key={`label-${point.row.timestamp}`} x={point.x} y={height - 7} textAnchor="middle" className="fill-white/45 text-[11px]">
          {new Date(point.row.timestamp ?? "").toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
        </text>
      ))}
    </svg>
    {!rows.length && <div className="absolute inset-0 grid place-items-center text-sm text-muted">Aucune série temporelle pour cette période.</div>}
  </div>;
}

function MetricCard({ label, value, change, hint }: { label: string; value: string; change?: number | null; hint: string }) {
  return <div className="rounded-xl border border-border bg-surface p-4">
    <p className="text-xs font-medium text-muted">{label}</p>
    <div className="mt-2 flex items-end justify-between gap-3">
      <p className="text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      {typeof change === "number" && <span className={`rounded-md px-2 py-1 text-xs font-medium ${change >= 0 ? "bg-emerald-400/10 text-emerald-300" : "bg-red-400/10 text-red-300"}`}>{fmtPct(change)}</span>}
    </div>
    <p className="mt-2 text-xs text-muted">{hint}</p>
  </div>;
}

export function VercelAnalyticsDashboard({ clientId, data: initialData, periodStart, periodEnd, fetchedAt, loadRange }: {
  clientId: string;
  data: VercelAnalyticsSummary;
  periodStart: string;
  periodEnd: string;
  fetchedAt: string;
  loadRange: LoadRange;
}) {
  const [data, setData] = useState(initialData);
  const [period, setPeriod] = useState({ start: periodStart, end: periodEnd });
  const [customStart, setCustomStart] = useState(periodStart);
  const [customEnd, setCustomEnd] = useState(periodEnd);
  const [metric, setMetric] = useState<MetricKey>("visitors");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const visitors = data.visitors ?? 0;
  const pageviews = data.pageviews ?? 0;
  const events = (data.events ?? []).reduce((sum, item) => sum + (item.count ?? 0), 0);
  const visitorDelta = delta(data.visitors, data.previous?.visitors);
  const pageviewDelta = delta(data.pageviews, data.previous?.pageviews);
  const pagesPerVisitor = visitors > 0 ? pageviews / visitors : 0;
  const conversionRate = visitors > 0 && events > 0 ? (events / visitors) * 100 : null;
  const deviceTotal = useMemo(() => (data.devices ?? []).reduce((sum, row) => sum + (row.visitors ?? 0), 0), [data.devices]);

  const apply = (start: string, end: string) => {
    setError(null);
    startTransition(async () => {
      const result = await loadRange(clientId, start, end);
      if (!result.ok) { setError(result.message); return; }
      setData(result.data);
      setPeriod({ start, end });
      setCustomStart(start);
      setCustomEnd(end);
    });
  };

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Web Analytics</p>
        <h2 className="mt-1 text-xl font-semibold">Audience, acquisition & conversions</h2>
        <p className="mt-1 text-sm text-muted">Données Vercel agrégées · {period.start} → {period.end}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {[7,30,90].map((days) => <button key={days} type="button" onClick={() => { const next=periodForDays(days); apply(next.start,next.end); }} disabled={isPending} className="rounded-lg border border-border bg-background px-3 py-2 text-xs hover:border-white/20 disabled:opacity-50">{days} jours</button>)}
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background p-1.5">
          <input type="date" value={customStart} onChange={(e)=>setCustomStart(e.target.value)} className="bg-transparent px-1 text-xs outline-none" />
          <span className="text-muted">→</span>
          <input type="date" value={customEnd} onChange={(e)=>setCustomEnd(e.target.value)} className="bg-transparent px-1 text-xs outline-none" />
          <button type="button" onClick={()=>apply(customStart,customEnd)} disabled={isPending} className="rounded-md bg-white/8 px-2.5 py-1.5 text-xs font-medium hover:bg-white/12 disabled:opacity-50">{isPending ? "Chargement…" : "Appliquer"}</button>
        </div>
      </div>
    </div>

    {error && <div className="rounded-lg border border-red-400/20 bg-red-400/5 px-4 py-3 text-sm text-red-300">{error}</div>}

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <MetricCard label="Visiteurs" value={nf.format(visitors)} change={visitorDelta} hint="vs période précédente" />
      <MetricCard label="Pages vues" value={nf.format(pageviews)} change={pageviewDelta} hint="vs période précédente" />
      <MetricCard label="Pages / visiteur" value={pagesPerVisitor.toLocaleString("fr-FR",{maximumFractionDigits:2})} hint="Exploration moyenne du site" />
      <MetricCard label="Interactions suivies" value={nf.format(events)} hint={data.events?.length ? `${data.events.length} type(s) d’événement` : "Événements métier non instrumentés"} />
      <MetricCard label="Taux d’interaction" value={conversionRate === null ? "—" : `${conversionRate.toLocaleString("fr-FR",{maximumFractionDigits:1})} %`} hint="Interactions / visiteurs, pas leads confirmés" />
    </div>

    <div className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div><h3 className="font-semibold">Évolution du trafic</h3><p className="mt-1 text-xs text-muted">Série quotidienne de la période sélectionnée.</p></div>
        <div className="flex rounded-lg border border-border bg-background p-1">
          <button type="button" onClick={()=>setMetric("visitors")} className={`rounded-md px-3 py-1.5 text-xs ${metric==="visitors" ? "bg-white/10 text-foreground" : "text-muted"}`}>Visiteurs</button>
          <button type="button" onClick={()=>setMetric("pageviews")} className={`rounded-md px-3 py-1.5 text-xs ${metric==="pageviews" ? "bg-white/10 text-foreground" : "text-muted"}`}>Pages vues</button>
        </div>
      </div>
      <div className="px-3 pt-3"><TrendChart points={data.trend ?? []} metric={metric} /></div>
    </div>

    <div className="grid gap-4 xl:grid-cols-3">
      <div className="rounded-xl border border-border bg-surface p-5"><h3 className="mb-4 font-medium">Pages les plus visitées</h3><Bars rows={data.topPages ?? []} metric="pageviews" total={pageviews} /></div>
      <div className="rounded-xl border border-border bg-surface p-5"><h3 className="mb-4 font-medium">Sources de trafic</h3><Bars rows={data.topReferrers ?? []} metric="visitors" total={visitors} /></div>
      <div className="rounded-xl border border-border bg-surface p-5"><h3 className="mb-4 font-medium">Pays des visiteurs</h3><Bars rows={data.countries ?? []} metric="visitors" total={visitors} /></div>
    </div>

    <div className="grid gap-4 lg:grid-cols-3">
      <div className="rounded-xl border border-border bg-surface p-5">
        <h3 className="font-medium">Appareils</h3>
        <div className="mt-5 flex items-center gap-6">
          <div className="grid h-28 w-28 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(rgb(56 189 248) 0 ${deviceTotal ? ((data.devices?.[0]?.visitors ?? 0)/deviceTotal)*100 : 0}%, rgb(139 92 246) 0 99%, rgba(255,255,255,.08) 0)` }}><div className="grid h-20 w-20 place-items-center rounded-full bg-surface text-center"><div><div className="text-xl font-semibold">{nf.format(visitors)}</div><div className="text-[10px] text-muted">visiteurs</div></div></div></div>
          <div className="min-w-0 flex-1"><Bars rows={data.devices ?? []} metric="visitors" total={visitors} /></div>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-surface p-5"><h3 className="mb-4 font-medium">Systèmes d’exploitation</h3><Bars rows={data.operatingSystems ?? []} metric="visitors" total={visitors} /></div>
      <div className="rounded-xl border border-border bg-surface p-5"><h3 className="mb-4 font-medium">Navigateurs</h3><Bars rows={data.browsers ?? []} metric="visitors" total={visitors} /></div>
    </div>

    <div className="grid gap-4 xl:grid-cols-[1fr_.8fr]">
      <div className="rounded-xl border border-border bg-surface p-5"><h3 className="mb-4 font-medium">Événements suivis</h3><Bars rows={data.events ?? []} metric="count" total={events} /></div>
      <div className="rounded-xl border border-border bg-surface p-5">
        <h3 className="font-medium">Lecture automatique</h3>
        <div className="mt-4 space-y-3">
          {(data.insights ?? []).map((item,index)=><div key={index} className="rounded-lg border border-border bg-background/50 p-3"><p className="text-sm font-medium">{item.title}</p><p className="mt-1 text-xs leading-5 text-muted">{item.detail}</p></div>)}
          {!data.insights?.length && <p className="text-sm text-muted">Aucun signal notable détecté sur cette période.</p>}
        </div>
      </div>
    </div>

    <p className="text-xs text-muted">Dernière synchronisation affichée : {new Date(fetchedAt).toLocaleString("fr-FR",{timeZone:"Europe/Paris"})}. Les visiteurs Vercel sont anonymisés et agrégés.</p>
  </div>;
}
