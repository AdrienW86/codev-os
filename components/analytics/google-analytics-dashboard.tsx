"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { syncGa4NowAction } from "@/app/(cockpit)/analytics/google-analytics-actions";
import type { Ga4ClientOption, Ga4DashboardState } from "@/lib/integrations/ga4/dashboard";
import type { AnalyticsPeriod } from "@/lib/analytics/view-model";
import type { Ga4DimensionRow, Ga4EventRow } from "@/lib/integrations/ga4/model";

const integer = new Intl.NumberFormat("fr-FR");
const percent = (n: number | null) => n === null ? "—" : `${(n * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
const fmt = (n: number) => integer.format(n);
const href = (client: string, period: string) => `/analytics?source=ga4&client=${encodeURIComponent(client)}&period=${period}`;

function Stat({ name, value, subtitle }: { name: string; value: string; subtitle?: string }) {
  return <article className="rounded-xl border border-border bg-surface p-5">
    <p className="text-sm text-muted">{name}</p><p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
    {subtitle && <p className="mt-2 text-xs text-muted">{subtitle}</p>}
  </article>;
}
function DimensionTable({ title, rows, caption }: { title: string; rows: Ga4DimensionRow[]; caption: string }) {
  return <section className="rounded-xl border border-border bg-surface p-5">
    <h3 className="font-semibold">{title}</h3><p className="mt-1 text-xs text-muted">{caption}</p>
    {!rows.length ? <p className="mt-4 text-sm text-muted">Aucune donnée remontée pour cette période.</p> : (
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[400px] text-left text-sm">
        <thead className="border-b border-border text-xs text-muted"><tr><th className="pb-2 font-medium">Source</th><th className="pb-2 text-right font-medium">Sessions</th><th className="pb-2 text-right font-medium">Rebond</th><th className="pb-2 text-right font-medium">Engagement</th></tr></thead>
        <tbody>{rows.slice(0, 15).map((row, i) => <tr key={i} className="border-b border-border/60">
          <td className="max-w-[270px] break-all py-2 pr-2">{row.label}</td><td className="py-2 text-right tabular-nums">{fmt(row.sessions)}</td>
          <td className="py-2 text-right tabular-nums">{percent(row.bounceRate)}</td><td className="py-2 text-right tabular-nums">{percent(row.engagementRate)}</td>
        </tr>)}</tbody>
      </table></div>
    )}
  </section>;
}
function EventTable({ rows }: { rows: Ga4EventRow[] }) {
  const relevant = rows.filter(row => /^(phone_click|callback_request|quote_form_submit|contact_form_submit|quote_form_start|page_view)$/.test(row.name));
  return <section className="rounded-xl border border-border bg-surface p-5">
    <h3 className="font-semibold">Interactions et demandes</h3>
    <p className="mt-1 text-xs text-muted">Événements enregistrés dans GA4, pas nécessairement des prospects uniques ou des appels aboutis.</p>
    {!relevant.length ? <p className="mt-4 text-sm text-muted">Aucun événement métier reçu.</p> : <dl className="mt-4 space-y-3">
      {relevant.map(row => <div key={row.name} className="flex justify-between gap-3 border-b border-border pb-2 text-sm">
        <dt className="break-all">{row.name}</dt><dd className="font-semibold tabular-nums">{fmt(row.count)}</dd>
      </div>)}
    </dl>}
  </section>;
}
export function Ga4Dashboard({ clients, client, period, state }: {
  clients: Pick<Ga4ClientOption, "id" | "name" | "property">[]; client: { id: string; name: string };
  period: AnalyticsPeriod; state: Ga4DashboardState;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => startTransition(async () => {
    const result = await syncGa4NowAction(client.id, period.start, period.end);
    setNotice(result.message);
    if (result.ok) router.refresh();
  });
  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-border bg-surface p-4">
      <div><h2 className="font-semibold">Audience · Google Analytics 4</h2><p className="mt-1 text-sm text-muted">Sessions, rebond et conversions de navigation · données soumises au consentement du visiteur.</p></div>
      <form action="/analytics" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="source" value="ga4" />
        <input type="hidden" name="period" value={period.preset === "custom" ? "custom" : period.preset} />
        {period.preset === "custom" && <><input type="hidden" name="start" value={period.start} /><input type="hidden" name="end" value={period.end} /></>}
        <label className="text-xs text-muted">Client
          <select name="client" defaultValue={client.id} className="mt-1 block min-h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground">
            {clients.map(item => <option key={item.id} value={item.id}>{item.name}{item.property ? "" : " (GA4 à associer)"}</option>)}
          </select>
        </label>
        <button type="submit" className="min-h-10 rounded-lg border border-border px-3 text-sm">Afficher</button>
      </form>
    </div>
    <nav aria-label="Période Google Analytics" className="flex flex-wrap gap-2">
      {["7", "30", "90"].map(days => <Link key={days} href={href(client.id, days)}
        className={`rounded-lg border px-4 py-2 text-sm ${period.preset === days ? "border-accent bg-surface text-foreground font-semibold" : "border-border text-muted"}`}>{days} jours</Link>)}
    </nav>
    {state.status === "not_connected" ? <div className="rounded-xl border border-border bg-surface p-5">
      <p className="font-semibold">Google Analytics n'est pas prêt pour {client.name}.</p>
      <p className="mt-2 text-sm text-muted">{state.reason === "connection" ? "Connectez l'accès Google Analytics en lecture seule." : "Associez une propriété GA4 à ce client."}</p>
      <Link href={state.reason === "connection" ? "/settings?tab=connections" : `/clients/${client.id}?tab=agents`} className="mt-3 inline-block text-sm text-accent underline">Configurer la connexion GA4</Link>
    </div> : state.status === "unavailable" ? <p role="alert" className="rounded-xl border border-border p-5 text-sm text-warning">{state.error ?? "Google Analytics est temporairement indisponible."}</p> : <>
      {(state.stale || state.syncError) && <p className="text-sm text-warning">{state.syncError ?? "Données archivées : synchronisation en attente."}</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat name="Sessions" value={fmt(state.snapshot.totals.sessions)} />
        <Stat name="Utilisateurs actifs" value={fmt(state.snapshot.totals.activeUsers)} />
        <Stat name="Taux de rebond" value={percent(state.snapshot.totals.bounceRate)} subtitle="GA4 : sessions non engagées" />
        <Stat name="Taux d'engagement" value={percent(state.snapshot.totals.engagementRate)} subtitle="Définition GA4" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <DimensionTable title="Pages d'entrée" rows={state.snapshot.pages} caption="Pages avec le plus de sessions : prioriser celles au fort rebond." />
        <DimensionTable title="Canaux d'acquisition" rows={state.snapshot.channels} caption="Google Ads, recherche naturelle, direct et autres sources." />
        <DimensionTable title="Appareils" rows={state.snapshot.devices} caption="Comparer l'engagement mobile et ordinateur." />
        <EventTable rows={state.snapshot.events} />
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <span>Source : Google Analytics Data API · propriété {state.snapshot.property} · synchronisé le {new Date(state.fetchedAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}.</span>
        <button type="button" onClick={refresh} disabled={pending} className="text-accent underline disabled:opacity-50">{pending ? "Synchronisation…" : "Synchroniser maintenant"}</button>
      </div>
    </>}
    {notice && <p role="status" className="text-sm text-muted">{notice}</p>}
  </div>;
}
