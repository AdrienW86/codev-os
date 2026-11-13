"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type Client = { id: string; name: string; website: string | null };
type Scores = { performance: number | null; seo: number | null; accessibility: number | null; bestPractices: number | null };
type Report = {
  url: string; strategy: "mobile" | "desktop"; analyzedAt: string; saved: boolean;
  scores: Scores;
  lab: Record<"lcp" | "fcp" | "cls" | "tbt" | "speedIndex", { display: string }>;
  field: { lcpMs: number | null; inpMs: number | null; cls: number | null; scope: string };
  opportunities: { id: string; title: string; description: string; savingsMs: number | null }[];
};
type History = { id: string; client_id: string | null; url: string; strategy: string; scores: unknown; analyzed_at: string };
const scoreLabels = [
  ["performance", "Performance"], ["seo", "SEO"], ["accessibility", "Accessibilité"], ["bestPractices", "Bonnes pratiques"],
] as const;
const metricLabels = [
  ["lcp", "LCP"], ["fcp", "FCP"], ["cls", "CLS"], ["tbt", "TBT"], ["speedIndex", "Speed Index"],
] as const;
function scoreColor(n: number | null | undefined) {
  return n == null ? "text-muted" : n >= 90 ? "text-success" : n >= 50 ? "text-warning" : "text-danger";
}
function host(url: string) {
  try { return new URL(url).hostname; } catch { return url; }
}
export function PerformanceAnalyzer({ clients, history }: { clients: Client[]; history: History[] | null }) {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [url, setUrl] = useState("");
  const [strategy, setStrategy] = useState<"mobile" | "desktop">("mobile");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  async function analyze(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setLoading(true); setError(""); setReport(null);
    try {
      const response = await fetch("/api/performance", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, strategy, clientId: clientId || null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Analyse indisponible.");
      setReport(data as Report);
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Une erreur s'est produite."); }
    finally { setLoading(false); }
  }
  return <div className="space-y-8">
    <form onSubmit={analyze} className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-7">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm text-muted">Client (facultatif)
          <select className="mt-2 w-full rounded-lg border border-border bg-background p-3 text-foreground" value={clientId}
            onChange={event => { const id = event.target.value; setClientId(id); const client = clients.find(c => c.id === id); if (client?.website) setUrl(client.website); }}>
            <option value="">Audit indépendant</option>
            {clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
        </label>
        <label className="block text-sm text-muted">Appareil
          <select className="mt-2 w-full rounded-lg border border-border bg-background p-3 text-foreground" value={strategy} onChange={e => setStrategy(e.target.value as "mobile" | "desktop")}>
            <option value="mobile">Mobile</option><option value="desktop">Ordinateur</option>
          </select>
        </label>
      </div>
      <label className="mt-4 block text-sm text-muted">Adresse à analyser
        <input type="url" required maxLength={1600} placeholder="https://www.exemple.fr" className="mt-2 w-full rounded-lg border border-border bg-background p-3 text-foreground" value={url} onChange={e => setUrl(e.target.value)} />
      </label>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button disabled={loading} type="submit" className="rounded-lg bg-accent-strong px-5 py-3 font-semibold text-accent-foreground disabled:opacity-60">
          {loading ? "Test Lighthouse en cours…" : "Lancer l'audit"}
        </button>
        <a href="https://www.code-v.fr/outils/analyse-site" target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline">Voir l&apos;outil public</a>
      </div>
      <p className="mt-3 text-xs text-muted">L&apos;analyse utilise Google PageSpeed Insights. Aucune modification n&apos;est effectuée sur le site testé.</p>
    </form>
    {loading && <p role="status" className="rounded-lg bg-surface-raised p-4 text-sm">Exécution d&apos;une mesure réelle en laboratoire…</p>}
    {error && <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm">
      <p className="text-danger">{error}</p>
      <a href="https://pagespeed.web.dev/" target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-medium text-accent underline">
        Tester directement sur Google PageSpeed Insights
      </a>
      <p className="mt-1 text-xs text-muted">Ce test externe ne sera pas enregistré dans l&apos;historique CODE-V OS.</p>
    </div>}
    {report && <section className="rounded-2xl border border-border bg-surface p-5 sm:p-7" aria-label="Rapport">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="text-xl font-semibold">Rapport : {host(report.url)}</h2><p className="mt-1 text-xs text-muted">{report.strategy} · {new Date(report.analyzedAt).toLocaleString("fr-FR")} · {report.saved ? "Enregistré dans Supabase" : "Non enregistré (migration ou stockage indisponible)"}</p></div>
        <button type="button" onClick={() => window.print()} className="rounded-lg border border-border px-4 py-2 text-sm">Imprimer / PDF</button>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">{scoreLabels.map(([key, label]) =>
        <div key={key} className="rounded-xl border border-border bg-background p-4 text-center"><strong className={"block text-3xl " + scoreColor(report.scores[key])}>{report.scores[key] ?? "—"}<small className="text-xs text-muted"> /100</small></strong><span className="text-xs text-muted">{label}</span></div>
      )}</div>
      <h3 className="mt-7 font-semibold">Mesures de laboratoire</h3>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">{metricLabels.map(([key, label]) =>
        <div key={key} className="rounded-lg border border-border p-3"><span className="text-xs text-muted">{label}</span><strong className="mt-2 block text-lg">{report.lab[key]?.display || "—"}</strong></div>
      )}</div>
      <h3 className="mt-7 font-semibold">Données réelles (CrUX)</h3>
      {report.field.scope === "unavailable" ? <p className="mt-2 text-sm text-muted">Aucune donnée utilisateur réelle disponible pour cette URL ou ce domaine.</p> :
        <p className="mt-2 text-sm text-muted">75e percentile — LCP {report.field.lcpMs == null ? "—" : (report.field.lcpMs / 1000).toFixed(2) + " s"} · INP {report.field.inpMs == null ? "—" : report.field.inpMs + " ms"} · CLS {report.field.cls ?? "—"} ({report.field.scope === "url" ? "page" : "domaine"}).</p>}
      <h3 className="mt-7 font-semibold">Corrections recommandées</h3>
      <ul className="mt-3 divide-y divide-border">{report.opportunities.length ? report.opportunities.map(item =>
        <li className="py-3" key={item.id}><p className="font-medium">{item.title}</p>{item.savingsMs != null && <p className="mt-1 text-xs text-accent">Économie potentielle : {(item.savingsMs / 1000).toFixed(2)} s</p>}<p className="mt-1 text-sm text-muted">{item.description}</p></li>
      ) : <li className="py-4 text-sm text-muted">Aucune optimisation majeure signalée par ce test.</li>}</ul>
    </section>}
    <section className="rounded-2xl border border-border bg-surface p-5 sm:p-7">
      <h2 className="text-lg font-semibold">Historique des analyses</h2>
      <p className="mt-1 text-sm text-muted">Les 30 derniers audits conservés dans CODE-V OS, pour comparer les performances dans le temps.</p>
      {history === null ? <p className="mt-5 rounded-lg bg-surface-raised p-4 text-sm text-muted">Historique indisponible. Appliquer la migration performance_audits dans Supabase.</p>
      : history.length === 0 ? <p className="mt-5 text-sm text-muted">Aucun audit enregistré.</p>
      : <div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border text-muted"><th className="px-2 py-3">Date</th><th className="px-2 py-3">Site</th><th className="px-2 py-3">Client</th><th className="px-2 py-3">Appareil</th><th className="px-2 py-3">Performance</th></tr></thead><tbody>{history.map(item => {
        const scores = item.scores as Partial<Scores> | null;
        return <tr key={item.id} className="border-b border-border/60"><td className="whitespace-nowrap px-2 py-3">{new Date(item.analyzed_at).toLocaleDateString("fr-FR")}</td><td className="max-w-56 truncate px-2 py-3" title={item.url}>{host(item.url)}</td><td className="px-2 py-3">{clients.find(c => c.id === item.client_id)?.name || "—"}</td><td className="px-2 py-3">{item.strategy}</td><td className={"px-2 py-3 font-semibold " + scoreColor(scores?.performance)}>{scores?.performance ?? "—"}</td></tr>;
      })}</tbody></table></div>}
    </section>
    <p className="text-xs text-muted">Les résultats varient selon les conditions de test. Les audits sont en lecture seule et les recommandations ne sont jamais appliquées automatiquement.</p>
  </div>;
}
