"use client";

// Rendu des vues structurées : composants connus, texte échappé par React, liens filtrés.
// Aucune chaîne n'est interprétée comme du HTML.
import Link from "next/link";
import { CampaignDashboard } from "@/components/google-ads/campaign-dashboard";
import { loadGoogleAdsDashboardAction } from "@/app/(cockpit)/clients/[id]/google-ads-actions";
import { isSafeHref, type AssistantView, type MetricsView, type TableView, type ViewLink } from "@/lib/assistant/views";
import type { DashboardFilters } from "@/lib/integrations/google-ads/dashboard";
import type { Proposal } from "@/components/assistant/use-assistant";

export function SafeLink({ link, className = "text-sm text-accent hover:underline" }: { link: ViewLink; className?: string }) {
  if (!isSafeHref(link.href)) return null;
  return link.href.startsWith("/")
    ? <Link href={link.href} className={className}>{link.label}</Link>
    : <a href={link.href} target="_blank" rel="noopener noreferrer nofollow" className={className}>{link.label} ↗</a>;
}

function Metrics({ view }: { view: MetricsView }) {
  const tones = { neutral: "", amber: "border-amber-300/40", green: "border-accent/40" };
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {view.items.map((item) => (
        <div key={item.label} className={`rounded-xl border border-border bg-surface p-3 ${tones[item.tone ?? "neutral"]}`}>
          <dt className="text-xs text-muted">{item.label}</dt>
          <dd className="mt-1 text-lg font-semibold break-words">{item.value}</dd>
          {item.href && isSafeHref(item.href) && <dd className="mt-1"><Link href={item.href} className="text-xs text-accent hover:underline">Voir</Link></dd>}
        </div>
      ))}
    </dl>
  );
}

function Table({ view }: { view: TableView }) {
  if (!view.rows.length) return <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">{view.empty}</p>;
  return (
    // Défilement horizontal limité au tableau : la page elle-même ne défile jamais horizontalement.
    <div className="max-w-full overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead className="bg-white/[0.03] text-xs text-muted"><tr>{view.columns.map((column) => <th key={column} scope="col" className="px-3 py-2 font-medium">{column}</th>)}<th scope="col" className="px-3 py-2"><span className="sr-only">Lien</span></th></tr></thead>
        <tbody className="divide-y divide-border">
          {view.rows.map((row, index) => (
            <tr key={index}>
              {row.cells.map((cell, cellIndex) => cellIndex === 0 ? <th key={cellIndex} scope="row" className="px-3 py-2 font-medium">{cell}</th> : <td key={cellIndex} className="px-3 py-2">{cell}</td>)}
              <td className="px-3 py-2 text-right">{row.href && <SafeLink link={{ label: "Ouvrir", href: row.href }} className="text-xs text-accent hover:underline" />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ResultView({ view, version, onAdsFilters, propose }: {
  view: AssistantView; version: number;
  onAdsFilters: (clientId: string, clientName: string, filters: DashboardFilters) => void;
  propose: (tool: string, input: Record<string, unknown>) => Promise<{ ok?: boolean; message?: string }>;
}) {
  return (
    <div className="space-y-4">
      {view.type !== "ads_campaigns" && "caption" in view && view.caption && <p className="text-sm text-muted">{view.caption}</p>}
      {view.type === "metrics" && <Metrics view={view} />}
      {view.type === "table" && <Table view={view} />}
      {view.type === "ads_campaigns" && (
        <CampaignDashboard key={version} clientId={view.clientId} initial={{ ok: true, data: view.data }} initialFilters={view.filters} load={loadGoogleAdsDashboardAction}
          syncUrl={false} onFiltersChange={(filters) => onAdsFilters(view.clientId, view.clientName, filters)}
          actionLabels={{ report: "Proposer le rapport", analysis: "Proposer l’analyse", aiAnalysis: "Proposer l’analyse IA" }}
          analysisNote="IA facultative utilisant les instructions et le contexte commercial. Proposée ici, exécutée seulement après confirmation. Repli déterministe explicite si l’IA échoue."
          prepareReport={(clientId, scope) => propose("ads_prepare_report", { client_id: clientId, ...scope })}
          runAnalysis={(clientId, scope) => propose("ads_run_analysis", { client_id: clientId, ...scope })}
          runAIAnalysis={(clientId, scope) => propose("ads_run_analysis", { client_id: clientId, ...scope, mode: "ai" })} />
      )}
      {view.link && <p><SafeLink link={view.link} /></p>}
    </div>
  );
}

export function ProposalCard({ proposal, pending, onConfirm, onCancel }: { proposal: Proposal; pending: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div role="group" aria-label="Action proposée" className="rounded-xl border border-accent/40 bg-accent/[0.06] p-4">
      <p className="text-xs font-medium tracking-[0.14em] text-muted uppercase">À confirmer</p>
      {proposal.heard && <p className="mt-1 text-xs text-muted">Compris à l’oral : « {proposal.heard} » — vérifiez avant de confirmer.</p>}
      <p className="mt-1 text-sm">{proposal.summary}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onConfirm} disabled={pending} className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-background disabled:opacity-60">Confirmer</button>
        <button type="button" onClick={onCancel} disabled={pending} className="min-h-11 rounded-lg border border-border px-4 text-sm">Annuler</button>
      </div>
    </div>
  );
}
