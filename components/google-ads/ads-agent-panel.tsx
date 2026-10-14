"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import type { DashboardFilters } from "@/lib/integrations/google-ads/dashboard";
import { writeFilters } from "@/lib/integrations/google-ads/dashboard";
import { runGoogleAdsScopeAIAnalysisAction } from "@/app/(cockpit)/clients/[id]/google-ads-actions";
import type { DashboardScope } from "@/components/google-ads/campaign-dashboard";

type AssistantResult = { reply?: string; error?: string; degraded?: boolean; view?: { type: string; result?: { text?: string } }; links?: { href: string; label: string }[] };
type Turn = { role: "user" | "assistant"; content: string };

/** Embedded entrypoint to the existing agent, without a second LLM or an automatic Ads write path. */
export function AdsAgentPanel({ clientId, clientName, filters, scope, connected }: {
  clientId: string; clientName: string; filters: DashboardFilters; scope: DashboardScope; connected: boolean;
}) {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [analysisHref, setAnalysisHref] = useState("");
  const manageHref = `/advertising/manage?client=${encodeURIComponent(clientId)}`;
  const ask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = question.trim();
    if (!message || pending || !connected) return;
    const next = [...turns, { role: "user" as const, content: message }].slice(-12);
    setQuestion(""); setTurns(next); setPending(true); setError("");
    try {
      const response = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, context: { clientId, clientName, view: "ads_campaigns",
          adsQuery: writeFilters(new URLSearchParams(), filters).toString() } }) });
      const data = await response.json() as AssistantResult;
      if (!response.ok) throw new Error("L'assistant est indisponible. Réessayez.");
      setTurns([...next, { role: "assistant", content: data.reply ?? "Aucune réponse." }].slice(-12));
      if (data.view?.type === "ads_recommendations" && data.view.result?.text) setAnalysis(data.view.result.text);
    } catch { setError("L'assistant n'a pas pu répondre. Réessayez."); }
    finally { setPending(false); }
  };
  const recommendations = async () => {
    if (pending || !connected) return;
    setPending(true); setError(""); setAnalysis(""); setAnalysisHref("");
    try {
      const result = await runGoogleAdsScopeAIAnalysisAction(clientId, scope);
      if (!result.ok) setError(result.message ?? "Analyse indisponible.");
      else { setAnalysis(result.detail ?? result.message ?? "Analyse terminée."); setAnalysisHref(result.href ?? ""); }
    } catch { setError("Analyse indisponible. Vérifiez la connexion Google Ads et l'agent assigné."); }
    finally { setPending(false); }
  };
  return <section aria-label="Agent Google Ads" className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-medium uppercase tracking-wide text-accent">Agent Google Ads</p>
        <h3 className="mt-1 text-lg font-semibold">Demandez une analyse ou des améliorations</h3>
        <p className="mt-1 text-sm text-muted">Client : {clientName} · L'agent examine les campagnes sélectionnées. Aucune modification automatique.</p>
      </div>
      <Link href={manageHref} className="rounded-lg border border-border px-3 py-2 text-sm text-accent">Préparer une modification →</Link>
    </div>
    <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" disabled={!connected || pending || !scope.campaignIds.length} onClick={() => void recommendations()}
        className="min-h-10 rounded-lg bg-accent/10 px-4 text-sm font-medium text-accent disabled:opacity-50">
        {pending ? "Analyse en cours…" : "Obtenir les recommandations IA"}
      </button>
      <button type="button" disabled={pending} onClick={() => setQuestion("Quelles campagnes dépensent sans conversion enregistrée et que dois-je vérifier en priorité ?")}
        className="min-h-10 rounded-lg border border-border px-3 text-sm">Priorités à vérifier</button>
      <button type="button" disabled={pending} onClick={() => setQuestion("Propose des optimisations Google Ads pour ce client, sans modifier les budgets ni exécuter de changements.")}
        className="min-h-10 rounded-lg border border-border px-3 text-sm">Idées d'optimisation</button>
    </div>
    <form onSubmit={ask} className="mt-4 flex flex-col gap-2 sm:flex-row">
      <label className="sr-only" htmlFor="ads-agent-question">Demande à l'agent Ads</label>
      <input id="ads-agent-question" className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm"
        value={question} maxLength={2000} onChange={(event) => setQuestion(event.target.value)}
        placeholder="Ex. Pourquoi mes campagnes ne génèrent-elles pas de conversions ?" />
      <button type="submit" disabled={pending || !question.trim() || !connected}
        className="min-h-11 rounded-lg bg-accent-strong px-4 text-sm font-medium text-accent-foreground disabled:opacity-50">Demander à l'agent</button>
    </form>
    {error && <p role="alert" className="mt-3 text-sm text-warning">{error}</p>}
    {turns.length > 0 && <div aria-live="polite" className="mt-4 max-h-80 space-y-3 overflow-auto border-t border-border pt-3">
      {turns.map((item, index) => <p key={index} className="whitespace-pre-wrap text-sm"><strong>{item.role === "user" ? "Vous" : "Agent"} :</strong> {item.content}</p>)}
    </div>}
    {analysis && <div className="mt-4 rounded-xl border border-border bg-background p-4">
      <p className="font-medium">Recommandations pour ce périmètre</p>
      <p className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-sm">{analysis}</p>
      {analysisHref && <Link href={analysisHref} className="mt-3 inline-block text-sm text-accent">Ouvrir l'analyse complète →</Link>}
    </div>}
    <p className="mt-3 text-xs text-muted">Les recommandations ne constituent pas une validation de conversion. Les demandes de modification passent par la préparation manuelle et les protections serveur.</p>
  </section>;
}
