"use client";

import { useMemo, useState } from "react";
import type { VercelAnalyticsSummary } from "@/lib/client-health/data";

const nf = new Intl.NumberFormat("fr-FR");
const pct = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : ""}${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
const delta = (now?: number, before?: number) => {
  if (typeof now !== "number" || typeof before !== "number" || before <= 0) return null;
  return ((now - before) / before) * 100;
};

type Row = { label?: string; pageviews?: number; visitors?: number; count?: number };
type Tab = "overview" | "pages" | "acquisition" | "audience" | "conversions";

function MiniBars({ rows, metric = "visitors" }: { rows: Row[]; metric?: "visitors" | "pageviews" | "count" }) {
  const valid = rows.filter((row) => row.label && typeof row[metric] === "number").slice(0, 10);
  const max = Math.max(1, ...valid.map((row) => Number(row[metric] ?? 0)));
  return <div className="space-y-3">
    {valid.map((row) => {
      const value = Number(row[metric] ?? 0);
      return <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_3.25rem] items-center gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center justify-between gap-2 text-xs"><span className="truncate" title={row.label}>{row.label}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-white/7"><div className="h-full rounded-full bg-white/45" style={{ width: `${Math.max(4, (value / max) * 100)}%` }} /></div>
        </div>
        <span className="text-right text-xs font-medium tabular-nums">{nf.format(value)}</span>
      </div>;
    })}
    {!valid.length && <p className="text-sm text-muted">Aucune donnée disponible.</p>}
  </div>;
}

function Metric({ label, value, sub, change }: { label: string; value: string; sub?: string; change?: number | null }) {
  return <div className="rounded-xl border border-border bg-background/40 p-4">
    <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
    <div className="mt-2 flex items-end justify-between gap-3">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {typeof change === "number" && <span className={`text-xs font-medium ${change >= 0 ? "text-emerald-300" : "text-amber-300"}`}>{pct(change)}</span>}
    </div>
    {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
  </div>;
}

export function VercelAnalyticsDashboard({ data, periodStart, periodEnd, fetchedAt }: {
  data: VercelAnalyticsSummary;
  periodStart: string;
  periodEnd: string;
  fetchedAt: string;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [query, setQuery] = useState("");
  const pageviews = data.pageviews ?? 0;
  const visitors = data.visitors ?? 0;
  const pagesPerVisitor = visitors > 0 ? pageviews / visitors : 0;
  const visitorDelta = delta(data.visitors, data.previous?.visitors);
  const pageviewDelta = delta(data.pageviews, data.previous?.pageviews);
  const filteredPages = useMemo(() => (data.topPages ?? []).filter((row) => (row.label ?? "").toLowerCase().includes(query.toLowerCase())), [data.topPages, query]);
  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Vue d’ensemble" },
    { id: "pages", label: "Pages" },
    { id: "acquisition", label: "Acquisition" },
    { id: "audience", label: "Audience" },
    { id: "conversions", label: "Conversions" },
  ];

  return <div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="font-semibold">Audience & conversions</h2>
        <p className="mt-1 text-sm text-muted">Vercel Web Analytics · {periodStart} → {periodEnd}</p>
      </div>
      <p className="text-xs text-muted">Synchronisé {new Date(fetchedAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</p>
    </div>

    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Visiteurs" value={nf.format(visitors)} change={visitorDelta} sub="vs période précédente" />
      <Metric label="Pages vues" value={nf.format(pageviews)} change={pageviewDelta} sub="vs période précédente" />
      <Metric label="Pages / visiteur" value={pagesPerVisitor.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} sub="Indicateur d’exploration, pas un taux de rebond" />
      <Metric label="Événements" value={nf.format((data.events ?? []).reduce((sum, item) => sum + (item.count ?? 0), 0))} sub="Interactions personnalisées remontées" />
    </div>

    <div className="mt-5 flex gap-2 overflow-x-auto border-b border-border pb-2">
      {tabs.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm transition ${tab === item.id ? "bg-white/10 text-foreground" : "text-muted hover:text-foreground"}`}>{item.label}</button>)}
    </div>

    {tab === "overview" && <div className="mt-5 grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border p-4"><h3 className="mb-4 text-sm font-medium">Pages principales</h3><MiniBars rows={data.topPages ?? []} metric="pageviews" /></div>
        <div className="rounded-xl border border-border p-4"><h3 className="mb-4 text-sm font-medium">Sources principales</h3><MiniBars rows={data.topReferrers ?? []} metric="visitors" /></div>
      </div>
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-medium">Lecture automatique</h3>
        <div className="mt-3 space-y-3">
          {(data.insights ?? []).map((item, index) => <div key={index} className="rounded-lg bg-white/4 p-3">
            <div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${item.kind === "warning" ? "bg-amber-300" : item.kind === "positive" ? "bg-emerald-300" : "bg-sky-300"}`} /><p className="text-sm font-medium">{item.title}</p></div>
            <p className="mt-1 text-xs leading-5 text-muted">{item.detail}</p>
          </div>)}
          {!data.insights?.length && <p className="text-sm text-muted">Aucun signal notable détecté sur cette période.</p>}
        </div>
      </div>
    </div>}

    {tab === "pages" && <div className="mt-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="font-medium">Performance par page</h3><p className="text-sm text-muted">Classement par trafic réellement observé.</p></div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrer une URL…" className="min-h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-white/30" />
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[620px] text-sm">
          <thead className="bg-white/4 text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-3">Page</th><th className="px-4 py-3 text-right">Vues</th><th className="px-4 py-3 text-right">Visiteurs</th><th className="px-4 py-3 text-right">Part des vues</th></tr></thead>
          <tbody className="divide-y divide-border">{filteredPages.map((row) => <tr key={row.label}><td className="max-w-[420px] break-all px-4 py-3 font-medium">{row.label}</td><td className="px-4 py-3 text-right tabular-nums">{nf.format(row.pageviews ?? 0)}</td><td className="px-4 py-3 text-right tabular-nums">{nf.format(row.visitors ?? 0)}</td><td className="px-4 py-3 text-right tabular-nums">{pageviews > 0 ? `${(((row.pageviews ?? 0) / pageviews) * 100).toFixed(1)} %` : "—"}</td></tr>)}</tbody>
        </table>
      </div>
    </div>}

    {tab === "acquisition" && <div className="mt-5 grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-border p-4"><h3 className="mb-4 text-sm font-medium">Référents</h3><MiniBars rows={data.topReferrers ?? []} metric="visitors" /></div>
      <div className="rounded-xl border border-border p-4"><h3 className="mb-4 text-sm font-medium">Routes</h3><MiniBars rows={data.routes ?? []} metric="pageviews" /></div>
    </div>}

    {tab === "audience" && <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-xl border border-border p-4"><h3 className="mb-4 text-sm font-medium">Appareils</h3><MiniBars rows={data.devices ?? []} /></div>
      <div className="rounded-xl border border-border p-4"><h3 className="mb-4 text-sm font-medium">Pays</h3><MiniBars rows={data.countries ?? []} /></div>
      <div className="rounded-xl border border-border p-4"><h3 className="mb-4 text-sm font-medium">Systèmes</h3><MiniBars rows={data.operatingSystems ?? []} /></div>
      <div className="rounded-xl border border-border p-4"><h3 className="mb-4 text-sm font-medium">Navigateurs</h3><MiniBars rows={data.browsers ?? []} /></div>
    </div>}

    {tab === "conversions" && <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_.8fr]">
      <div className="rounded-xl border border-border p-4">
        <h3 className="mb-4 text-sm font-medium">Événements personnalisés</h3>
        <MiniBars rows={data.events ?? []} metric="count" />
      </div>
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-medium">Qualité du suivi</h3>
        {data.events?.length ? <p className="mt-3 text-sm text-muted">Les événements sont disponibles pour les rapports et les analyses. Un clic téléphone reste une interaction, pas un lead confirmé.</p> : <div className="mt-3 space-y-2 text-sm text-muted"><p>Aucun événement métier n’est encore remonté.</p><p>À instrumenter en priorité : <span className="text-foreground">lead_form_submit, phone_click, whatsapp_click, email_click, quote_request</span>.</p></div>}
      </div>
    </div>}
  </div>;
}
