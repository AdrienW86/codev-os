import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/require-admin";
import { getAgentById } from "@/lib/agents/data";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { InlineNotice } from "@/components/ui/states";
import { MutationForm } from "@/components/ui/mutation-form";
import { formatDate } from "@/lib/format-date";
import { actionStatusLabel, actionTypeLabel } from "@/lib/presentation/labels";
import { getOpportunityDetail } from "@/lib/seo/opportunity-service";
import { actionKindLabels, categoryLabels, intentLabels, levelLabels, pathOf, type Level, type Metrics } from "@/lib/seo/opportunities";
import { nextOpportunityStatuses, opportunityStatusLabels } from "@/lib/seo/opportunity-status";
import { formatNumber, formatPct, formatPosition, metricsOf } from "@/lib/seo/opportunity-view";
import type { Json } from "@/lib/supabase/database.types";
import { OpportunityDecision } from "@/components/seo/opportunity-decision";
import { openRecommendationAction, prepareChangeAction, recordDeploymentAction, recordInterventionAction } from "../actions";

export async function generateMetadata({ params }: PageProps<"/agents/[id]/opportunities/[opportunityId]">): Promise<Metadata> {
  const { opportunityId } = await params;
  const detail = await getOpportunityDetail(opportunityId).catch(() => null);
  return { title: detail ? `Opportunité « ${detail.row.keyword} »` : "Opportunité" };
}

const levelTone: Record<Level, StatusTone> = { high: "red", medium: "amber", low: "neutral" };
const record = (value: Json | null | undefined): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const inputClass = "mt-1.5 block min-h-11 w-full rounded-lg border border-border-strong bg-surface-sunken px-3 text-sm text-foreground";
const verdictLabels: Record<string, { label: string; tone: StatusTone }> = {
  improved: { label: "Amélioration observée", tone: "green" }, degraded: { label: "Dégradation observée", tone: "red" },
  stable: { label: "Stable", tone: "neutral" }, insufficient_data: { label: "Données insuffisantes", tone: "neutral" },
};

function Delta({ now, before, invert = false, format }: { now: number | null | undefined; before: number | null | undefined; invert?: boolean; format: (value: number) => string }) {
  if (typeof now !== "number" || typeof before !== "number") return <span className="text-muted">—</span>;
  const diff = now - before;
  if (Math.abs(diff) < 1e-9) return <span className="text-muted">=</span>;
  const good = invert ? diff < 0 : diff > 0;
  return <span className={good ? "text-success" : "text-danger"}>{diff > 0 ? "+" : "−"}{format(Math.abs(diff))}</span>;
}

function MetricsTable({ current, previous, currentLabel, previousLabel }: { current: Metrics | null; previous: Metrics | null; currentLabel: string; previousLabel: string }) {
  const rows: [string, (m: Metrics) => number | null, (v: number | null) => string, boolean][] = [
    ["Clics", (m) => m.clicks, formatNumber, false], ["Impressions", (m) => m.impressions, formatNumber, false],
    ["CTR", (m) => m.ctr, formatPct, false], ["Position moyenne", (m) => m.position, formatPosition, true],
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[26rem] text-sm">
        <thead><tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle"><th scope="col" className="pb-2 pr-3 font-medium">Indicateur</th><th scope="col" className="pb-2 pr-3 text-right font-medium">{currentLabel}</th><th scope="col" className="pb-2 pr-3 text-right font-medium">{previousLabel}</th><th scope="col" className="pb-2 text-right font-medium">Écart</th></tr></thead>
        <tbody>{rows.map(([label, pick, format, invert]) => (
          <tr key={label} className="border-b border-border/60 last:border-0">
            <th scope="row" className="py-2 pr-3 text-left font-normal text-muted">{label}</th>
            <td className="py-2 pr-3 text-right tabular-nums">{current ? format(pick(current)) : "—"}</td>
            <td className="py-2 pr-3 text-right tabular-nums">{previous ? format(pick(previous)) : "—"}</td>
            <td className="py-2 text-right tabular-nums"><Delta now={current ? pick(current) : null} before={previous ? pick(previous) : null} invert={invert} format={(value) => format(value)} /></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export default async function OpportunityDetailPage({ params }: PageProps<"/agents/[id]/opportunities/[opportunityId]">) {
  await requireAdmin();
  const { id, opportunityId } = await params;
  const [agent, detail] = await Promise.all([getAgentById(id), getOpportunityDetail(opportunityId)]);
  if (!agent || agent.agent_type !== "seo" || !detail) notFound();
  const { row, interventions, recommendation, actions } = detail;
  const current = metricsOf(row.metrics), previous = metricsOf(row.previous_metrics);
  const evidence = record(row.evidence);
  const github = record(evidence.github as Json);
  const vercel = record(evidence.vercel as Json);
  const latest = record(evidence.latest as Json);
  const pages = (Array.isArray(evidence.competingPages) ? evidence.competingPages : Array.isArray(evidence.pages) ? evidence.pages : []) as { url: string; clicks: number; impressions: number; position: number | null; share: number }[];
  const variants = (Array.isArray(evidence.variants) ? evidence.variants : []) as { keyword: string; impressions: number; clicks: number; position: number | null }[];
  const coveringQueries = (Array.isArray(evidence.coveringQueries) ? evidence.coveringQueries : []) as string[];
  const canPrepare = (row.status === "approved" || row.status === "in_progress") && typeof github.path === "string";
  const base = `/agents/${agent.id}/opportunities`;

  return (
    <>
      <Link href={`${base}?client=${row.client_id}`} className="mb-6 inline-block text-xs text-accent hover:underline">← Opportunités de {detail.clientName}</Link>
      <PageHeading eyebrow={`${detail.clientName} · ${categoryLabels[row.category]}`} title={row.keyword} description={row.verified ? `Search Console, ${row.period_start} → ${row.period_end}, comparé à ${row.previous_start} → ${row.previous_end}.` : "Hypothèse issue du contexte client : aucune donnée de volume Google n’est disponible pour ce sujet."}
        action={<div className="flex flex-wrap gap-2"><StatusBadge label={opportunityStatusLabels[row.status].label} tone={opportunityStatusLabels[row.status].tone} /><StatusBadge label={`Priorité ${levelLabels[row.priority].toLowerCase()}`} tone={levelTone[row.priority]} /><StatusBadge label={`Confiance ${levelLabels[row.confidence].toLowerCase()}`} /></div>} />

      {row.significant_change && <div className="mb-6"><InlineNotice tone="amber" title="Changement significatif depuis la décision">Les données ont nettement évolué depuis que cette opportunité a été {row.status === "dismissed" ? "écartée" : "traitée"}{latest.metrics ? ` (dernier relevé : ${formatNumber(metricsOf(latest.metrics as Json)?.clicks)} clics, ${formatNumber(metricsOf(latest.metrics as Json)?.impressions)} impressions)` : ""}. Elle n’est pas relancée automatiquement : rouvrez-la si nécessaire.</InlineNotice></div>}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <div className="min-w-0 space-y-6">
          <Panel className="p-6">
            <h2 className="font-semibold">Analyse</h2>
            <p className="mt-3 text-sm leading-6">{row.rationale}</p>
            <dl className="mt-5 grid gap-4 border-t border-border pt-5 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted">Page cible</dt><dd className="mt-1 break-all">{row.target_url ? pathOf(row.target_url) : row.target_status === "missing" ? "Aucune page adaptée identifiée" : "—"}</dd></div>
              <div><dt className="text-xs text-muted">Intention de recherche (estimée)</dt><dd className="mt-1">{intentLabels[row.intent]} <span className="text-muted">— {row.intent_basis ?? "règles"}</span></dd></div>
              <div><dt className="text-xs text-muted">Source des données</dt><dd className="mt-1">{row.verified ? "Google Search Console (données consolidées)" : "Contexte client (hypothèse, non vérifiée par Google)"}</dd></div>
              <div><dt className="text-xs text-muted">Détection</dt><dd className="mt-1">{formatDate(row.first_detected_at)} · revue {row.detection_count} fois · dernière {formatDate(row.last_detected_at)}</dd></div>
            </dl>
            <div className="mt-5 border-t border-border pt-5">
              <h3 className="text-sm font-semibold">Action recommandée — {actionKindLabels[row.action_kind]}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{row.recommended_action}</p>
              {row.factors.length > 0 && <><h3 className="mt-4 text-sm font-semibold">Facteurs de priorité</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">{row.factors.map((factor) => <li key={factor}>{factor}</li>)}</ul></>}
              {row.potential_clicks ? <p className="mt-3 text-xs text-muted">Potentiel estimé : ≈ {formatNumber(row.potential_clicks)} clics supplémentaires sur 28 jours (courbe de CTR de référence ; estimation, pas une donnée Google).</p> : null}
            </div>
          </Panel>

          {row.verified && <Panel className="p-6">
            <h2 className="mb-4 font-semibold">Comparaison des périodes</h2>
            <MetricsTable current={current} previous={previous} currentLabel={`${row.period_start} → ${row.period_end}`} previousLabel={`${row.previous_start} → ${row.previous_end}`} />
            <p className="mt-3 text-xs text-muted">Pour une comparaison sur trois mois, demandez-le à l’Agent SEO dans la conversation de la recommandation.</p>
          </Panel>}

          <Panel className="p-6">
            <h2 className="font-semibold">Contexte</h2>
            {variants.length > 0 && <div className="mt-4"><h3 className="text-sm font-medium">Variantes regroupées</h3><ul className="mt-2 space-y-1 text-sm text-muted">{variants.map((item) => <li key={item.keyword} className="flex justify-between gap-3"><span className="break-words">{item.keyword}</span><span className="shrink-0 tabular-nums">{formatNumber(item.impressions)} impr. · pos. {formatPosition(item.position)}</span></li>)}</ul></div>}
            {pages.length > 0 && <div className="mt-4"><h3 className="text-sm font-medium">{row.category === "cannibalization" ? "Pages concurrentes sur la requête" : "Pages qui apparaissent sur la requête"}</h3><ul className="mt-2 space-y-1 text-sm text-muted">{pages.map((page) => <li key={page.url} className="flex flex-wrap justify-between gap-x-3"><span className="break-all">{pathOf(page.url)}</span><span className="tabular-nums">{formatNumber(page.clicks)} clics · {formatNumber(page.impressions)} impr. · pos. {formatPosition(page.position)}{typeof page.share === "number" ? ` · ${Math.round(page.share * 100)} %` : ""}</span></li>)}</ul></div>}
            {coveringQueries.length > 0 && <div className="mt-4"><h3 className="text-sm font-medium">Requêtes existantes sur la prestation</h3><p className="mt-1 text-sm text-muted">{coveringQueries.join(" · ")}</p></div>}
            {typeof github.path === "string" ? <div className="mt-4 rounded-lg border border-border bg-surface-sunken/60 p-4">
              <h3 className="text-sm font-medium">Code de la page (GitHub)</h3>
              <p className="mt-1 break-all font-mono text-xs text-muted">{String(github.repository)} · {String(github.branch)} · {github.path}</p>
              <p className="mt-2 text-sm"><span className="text-muted">Title :</span> {typeof github.title === "string" ? github.title : "non détecté"}</p>
              <p className="mt-1 text-sm"><span className="text-muted">Description :</span> {typeof github.description === "string" ? github.description : "non détectée"}</p>
              <p className="mt-1 text-sm"><span className="text-muted">H1 :</span> {typeof github.h1 === "string" ? github.h1 : "non détecté"}</p>
            </div> : <p className="mt-4 text-sm text-muted">Code de la page : non lu (dépôt GitHub non renseigné ou analyse hebdomadaire pas encore effectuée).</p>}
            <p className="mt-3 text-sm text-muted">Vercel Analytics : {typeof vercel.visitors === "number" || typeof vercel.pageviews === "number" ? `${formatNumber(vercel.visitors as number)} visiteurs, ${formatNumber(vercel.pageviews as number)} pages vues sur la page (${String(record(vercel.period as Json).start ?? "?")} → ${String(record(vercel.period as Json).end ?? "?")})` : "aucune donnée de trafic pour cette page"}.</p>
          </Panel>

          <Panel className="p-6">
            <h2 className="font-semibold">Interventions et mesure des résultats</h2>
            {interventions.length ? <ul className="mt-4 space-y-5">
              {interventions.map((item) => {
                const measurements = record(item.measurements);
                return (
                  <li key={item.id} className="rounded-lg border border-border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">Intervention du {formatDate(item.created_at)}</p>
                      {item.pull_request_url && <a href={item.pull_request_url} target="_blank" rel="noreferrer noopener" className="text-sm text-accent hover:underline">Pull request GitHub ↗</a>}
                    </div>
                    <p className="mt-2 text-xs text-muted">Situation de référence ({item.baseline_start ?? "?"} → {item.baseline_end ?? "?"}) : {(() => { const baseline = metricsOf(item.baseline); return baseline ? `${formatNumber(baseline.clicks)} clics, ${formatNumber(baseline.impressions)} impressions, CTR ${formatPct(baseline.ctr)}, position ${formatPosition(baseline.position)}` : "aucune métrique (hypothèse)"; })()}</p>
                    {item.deployed_at ? <p className="mt-1 text-xs text-muted">Déployée le {item.deployed_at}.</p> : <MutationForm action={recordDeploymentAction} fields={{ intervention_id: item.id }} label="Enregistrer la date de déploiement" className="mt-3 flex flex-wrap items-end gap-3">
                      <label className="text-xs text-muted">Date de mise en production<input type="date" name="deployed_at" required className={inputClass} /></label>
                    </MutationForm>}
                    {item.deployed_at && <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      {(["7", "28", "60"] as const).map((window) => {
                        const result = record(measurements[window] as Json);
                        const verdict = typeof result.verdict === "string" ? verdictLabels[result.verdict] : null;
                        const before = metricsOf(result.before as Json), after = metricsOf(result.after as Json);
                        return (
                          <div key={window} className="rounded-lg bg-surface-sunken/60 p-3">
                            <p className="text-xs font-medium">{window} jours</p>
                            {verdict && before && after ? <>
                              <StatusBadge label={verdict.label} tone={verdict.tone} className="mt-2" />
                              <p className="mt-2 text-xs text-muted">Avant : {formatNumber(before.clicks)} clics · pos. {formatPosition(before.position)}</p>
                              <p className="text-xs text-muted">Après : {formatNumber(after.clicks)} clics · pos. {formatPosition(after.position)}</p>
                            </> : <p className="mt-2 text-xs text-muted">En attente des données consolidées.</p>}
                          </div>
                        );
                      })}
                    </div>}
                  </li>
                );
              })}
            </ul> : <p className="mt-3 text-sm text-muted">Aucune intervention enregistrée.</p>}
            <p className="mt-4 text-xs leading-5 text-muted">Les mesures comparent la même durée avant et après le déploiement, sur la requête et la page concernées. Une évolution est signalée, jamais attribuée automatiquement à la modification (saisonnalité, mises à jour Google, concurrence).</p>
            {["approved", "in_progress"].includes(row.status) && <MutationForm action={recordInterventionAction} fields={{ id: row.id }} label="Enregistrer une intervention réalisée" className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
              <label className="text-xs text-muted">Mise en production (facultatif)<input type="date" name="deployed_at" className={inputClass} /></label>
            </MutationForm>}
          </Panel>
        </div>

        <div className="min-w-0 space-y-6">
          <Panel className="p-6">
            <h2 className="font-semibold">Décision</h2>
            <OpportunityDecision id={row.id} status={row.status} next={[...nextOpportunityStatuses(row.status)]} />
            {row.status_reason && <p className="mt-4 text-xs leading-5 text-muted">Justification enregistrée : {row.status_reason}</p>}
            <div className="mt-5 border-t border-border pt-5">
              {recommendation ? <Link href={`/recommendations/${recommendation.id}`} className="text-sm text-accent hover:underline">Ouvrir la recommandation et discuter avec l’agent →</Link>
                : <MutationForm action={openRecommendationAction} fields={{ id: row.id }} label="Ouvrir la recommandation" pendingLabel="Ouverture…" />}
              <p className="mt-2 text-xs text-muted">La recommandation existante porte la conversation avec l’Agent SEO et les actions à approuver.</p>
            </div>
          </Panel>

          <Panel className="p-6">
            <h2 className="font-semibold">Préparer une modification</h2>
            {canPrepare ? <MutationForm action={prepareChangeAction} fields={{ id: row.id }} label="Préparer la modification (à approuver)" pendingLabel="Préparation…" variant="primary" className="mt-3 space-y-3">
              <label className="block text-xs text-muted">Nouveau title<input name="title" maxLength={120} defaultValue={typeof github.title === "string" ? github.title : ""} className={inputClass} /></label>
              <label className="block text-xs text-muted">Nouvelle meta description<textarea name="description" maxLength={300} rows={3} defaultValue={typeof github.description === "string" ? github.description : ""} className={`${inputClass} py-2`} /></label>
              <label className="block text-xs text-muted">Nouveau H1<input name="h1" maxLength={120} defaultValue={typeof github.h1 === "string" ? github.h1 : ""} className={inputClass} /></label>
              <p className="text-xs leading-5 text-muted">Seuls les champs modifiés sont repris. L’action créée attend votre approbation (contenu figé) ; ensuite seulement, une branche et une PR en brouillon sont créées. Rien n’est fusionné ni déployé.</p>
            </MutationForm> : <p className="mt-3 text-sm leading-6 text-muted">{row.status === "approved" || row.status === "in_progress" ? "Fichier source inconnu : renseignez le dépôt GitHub du client et lancez une analyse complète, ou préparez une action manuelle depuis la recommandation." : "Disponible après approbation de l’opportunité."}</p>}
          </Panel>

          <Panel className="p-6">
            <h2 className="font-semibold">Actions liées <span className="text-sm font-normal text-muted">({actions.length})</span></h2>
            {actions.length ? <ul className="mt-3 divide-y divide-border">{actions.map((action) => {
              const result = record(action.result);
              return (
                <li key={action.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm">{actionTypeLabel(action.action_type)}</span><StatusBadge label={actionStatusLabel(action.status).label} tone={actionStatusLabel(action.status).tone === "green" ? "green" : actionStatusLabel(action.status).tone === "amber" ? "amber" : "neutral"} /></div>
                  {typeof result.pull_request_url === "string" && <a href={result.pull_request_url} target="_blank" rel="noreferrer noopener" className="mt-1 block text-xs text-accent hover:underline">PR #{String(result.pull_request_number)} ↗</a>}
                  {action.error_message && <p className="mt-1 text-xs text-warning">{action.error_message}</p>}
                </li>
              );
            })}</ul> : <p className="mt-3 text-sm text-muted">Aucune action.</p>}
            <Link href="/actions" className="mt-3 inline-block text-xs text-accent hover:underline">Approuver ou exécuter dans Actions →</Link>
          </Panel>
        </div>
      </div>
    </>
  );
}
