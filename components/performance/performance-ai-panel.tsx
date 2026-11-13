"use client";

import { useState } from "react";

type Priority = { level: "haute" | "moyenne" | "faible"; title: string; evidence: string; explanation: string; action: string };
type Analysis = { summary: string; context: string; priorities: Priority[]; nextSteps: string[]; limitations: string[] };
type Result = {
  auditId: string; clientName: string | null; analysis: Analysis;
  engine: string; model: string; generatedAt: string; saved: false;
};

export function PerformanceAgentPanel({ auditId }: { auditId: string | null }) {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function explain() {
    if (!auditId || loading) return;
    setLoading(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/performance/explain", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Analyse IA indisponible.");
      setResult(body as Result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "L'analyse de l'agent n'a pas abouti.");
    } finally { setLoading(false); }
  }

  return <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-7" aria-label="Agent Performance">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-accent">Agent Performance · CODE-V OS</p>
        <h2 className="mt-2 text-lg font-semibold">Interpréter cet audit avec les données du client</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          L&apos;agent recoupe scores, mesures, anomalies, historique comparable et, si disponible, activité, zone et projets du client.
          Il prépare des recommandations en lecture seule, à valider avant toute intervention.
        </p>
      </div>
      <button disabled={!auditId || loading} type="button" onClick={explain}
        className="rounded-lg bg-accent-strong px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50">
        {loading ? "Analyse IA en cours…" : result ? "Actualiser l'analyse" : "Demander l'analyse de l'agent"}
      </button>
    </div>
    {!auditId && <p className="mt-4 text-sm text-muted">Lance et enregistre un audit ou sélectionne un audit de l&apos;historique pour activer l&apos;agent.</p>}
    {error && <p role="alert" className="mt-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
    {result && <div className="mt-7 space-y-6">
      <div className="rounded-xl bg-surface-raised p-5">
        <h3 className="font-semibold">Synthèse{result.clientName ? " — " + result.clientName : ""}</h3>
        <p className="mt-2 text-sm leading-relaxed">{result.analysis.summary}</p>
        <p className="mt-3 text-sm text-muted">{result.analysis.context}</p>
      </div>
      <div>
        <h3 className="font-semibold">Priorités argumentées</h3>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          {result.analysis.priorities.map((priority, index) => <article key={index} className="rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted">PRIORITÉ {index + 1}</span>
              <span className="rounded-full bg-surface-raised px-2 py-1 text-xs text-foreground">{priority.level}</span>
            </div>
            <h4 className="mt-3 font-semibold">{priority.title}</h4>
            <p className="mt-2 text-sm font-medium text-accent">{priority.evidence}</p>
            <p className="mt-3 text-sm text-muted">{priority.explanation}</p>
            <p className="mt-3 border-l-2 border-accent pl-3 text-sm"><strong>Action : </strong>{priority.action}</p>
          </article>)}
        </div>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <div><h3 className="font-semibold">Prochaines étapes à valider</h3>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">{result.analysis.nextSteps.map((step, i) => <li key={i}>{step}</li>)}</ol>
        </div>
        <div><h3 className="font-semibold">Limites et vérifications</h3>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted">{result.analysis.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul>
        </div>
      </div>
      <p className="text-xs text-muted">Brouillon IA non enregistré · {result.engine} / {result.model} · {new Date(result.generatedAt).toLocaleString("fr-FR")}.
        Aucun changement n&apos;est exécuté. Les coordonnées privées du client ne sont pas transmises au modèle.</p>
      <button type="button" onClick={() => window.print()} className="rounded-lg border border-border px-4 py-2 text-sm">Imprimer l&apos;analyse</button>
    </div>}
  </section>;
}
