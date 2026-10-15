import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/require-admin";
import { getAgentById } from "@/lib/agents/data";
import { isProviderConfigured } from "@/lib/system/providers";
import { getSchedulerHeartbeat } from "@/lib/scheduler/heartbeat";
import { classifyScheduler, DIAGNOSTIC_STATUS_LABELS } from "@/lib/system/diagnostic-model";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { EmptyState, InlineNotice } from "@/components/ui/states";
import { MutationForm } from "@/components/ui/mutation-form";
import { actionClass } from "@/components/ui/button";
import { formatDate } from "@/lib/format-date";
import { listAnalyses, listOpportunities, listSeoAutomations, listSeoClients, seoV2SchemaReady } from "@/lib/seo/opportunity-service";
import { categoryLabels, intentLabels, levelLabels, pathOf, type Level, type OpportunityCategory } from "@/lib/seo/opportunities";
import { opportunityStatusLabels, opportunityStatuses } from "@/lib/seo/opportunity-status";
import { clickChange, countByStatus, filterQuery, formatChange, formatNumber, formatPct, formatPosition, metricsOf, parseFilters, sortOpportunities, type OpportunityFilters, type SortKey } from "@/lib/seo/opportunity-view";
import type { SeoOpportunityRow } from "@/lib/supabase/seo-opportunities.types";
import { runAnalysisAction, scheduleAnalysesAction } from "./actions";

export const metadata: Metadata = { title: "Opportunités de mots-clés" };

const levelTone: Record<Level, StatusTone> = { high: "red", medium: "amber", low: "neutral" };
const selectClass = "mt-1.5 block min-h-11 w-full min-w-0 rounded-lg border border-border-strong bg-surface-sunken px-3 text-sm text-foreground hover:border-accent/40";

function SortHeader({ label, sortKey, filters, base, align = "right" }: { label: string; sortKey: SortKey; filters: OpportunityFilters; base: string; align?: "left" | "right" }) {
  const active = filters.sort === sortKey;
  const dir = active ? (filters.dir === "asc" ? "desc" : "asc") : sortKey === "position" ? "asc" : "desc";
  return (
    <th scope="col" aria-sort={active ? (filters.dir === "asc" ? "ascending" : "descending") : "none"} className={`pb-2 pr-3 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <Link href={`${base}${filterQuery(filters, { sort: sortKey, dir })}`} className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""}`}>
        {label}<span aria-hidden="true">{active ? (filters.dir === "asc" ? "↑" : "↓") : ""}</span>
      </Link>
    </th>
  );
}

function ChangeCell({ row }: { row: SeoOpportunityRow }) {
  const change = clickChange(row);
  const tone = change === null ? "text-muted" : change > 0 ? "text-success" : change < 0 ? "text-danger" : "text-muted";
  return <span className={tone}>{formatChange(change)}</span>;
}

export default async function OpportunitiesPage({ params, searchParams }: PageProps<"/agents/[id]/opportunities">) {
  await requireAdmin();
  const { id } = await params;
  const agent = await getAgentById(id);
  if (!agent || agent.agent_type !== "seo") notFound();
  const filters = parseFilters(await searchParams);
  const clients = await listSeoClients(agent.id);
  const client = clients.find((item) => item.id === filters.client) ?? clients[0] ?? null;
  const base = `/agents/${agent.id}/opportunities`;
  const current = { ...filters, client: client?.id ?? null };
  const schemaReady = await seoV2SchemaReady();
  const [all, analyses, automations] = client ? await Promise.all([schemaReady ? listOpportunities(client.id) : [], schemaReady ? listAnalyses(client.id) : [], listSeoAutomations(client.id)]) : [[], [], []];
  const visible = sortOpportunities(all.filter((row) => (!filters.category || row.category === filters.category) && (!filters.status || row.status === filters.status)), filters.sort, filters.dir);
  const counts = countByStatus(all);
  const active = agent.enabled && agent.status === "Actif";
  const scheduler = isProviderConfigured("scheduler");
  const schedulerHeartbeat = await getSchedulerHeartbeat().catch(() => "unavailable" as const);
  const schedulerDiagnostic = classifyScheduler(scheduler, schedulerHeartbeat === "unavailable" ? "unavailable" : schedulerHeartbeat ? { ...schedulerHeartbeat, steps: Object.entries(schedulerHeartbeat.steps).map(([name, step]) => ({ name, ...step })) } : null, new Date());
  const schedulerTone: StatusTone = schedulerDiagnostic.status === "operational" ? "green" : schedulerDiagnostic.status === "error" ? "red" : schedulerDiagnostic.status === "disabled" ? "neutral" : "amber";
  const lastAnalysis = analyses[0] ?? null;
  const hasDaily = automations.some((item) => (item.config as { depth?: string } | null)?.depth !== "weekly");
  const hasWeekly = automations.some((item) => (item.config as { depth?: string } | null)?.depth === "weekly");

  return (
    <>
      <Link href={`/agents/${agent.id}`} className="mb-6 inline-block text-xs text-accent hover:underline">← {agent.name}</Link>
      <PageHeading eyebrow="Agent SEO" title="Opportunités de mots-clés" description="Requêtes à potentiel, CTR sous-performants, pages en baisse, cannibalisation et sujets absents, détectés à partir des données réelles de Search Console. Chaque opportunité ouvre une recommandation ; aucune modification n’est faite sans votre approbation." />

      {!schemaReady && <div className="mb-6"><InlineNotice tone="amber" title="Stockage SEO V2 non installé">La migration SQL SEO V2 n’est pas encore appliquée. Les analyses SEO existantes restent disponibles depuis l’agent ; cette nouvelle vue sera active après validation et application de la migration, sans changement automatique de vos sites.</InlineNotice></div>}

      {!active && <div className="mb-6"><InlineNotice tone="amber" title="Agent SEO en pause">Les analyses planifiées ou manuelles sont ignorées tant que l’agent n’est pas activé et « Actif » (bouton « Modifier l’agent »). Les opportunités déjà détectées restent consultables.</InlineNotice></div>}

      <form method="get" aria-label="Client et filtres" className="mb-6 grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
        <label className="col-span-2 min-w-0 text-xs text-muted sm:w-56">Client
          <select name="client" defaultValue={client?.id ?? ""} className={selectClass}>
            {clients.length ? clients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>) : <option value="">Aucun client suivi</option>}
          </select>
        </label>
        <label className="min-w-0 text-xs text-muted sm:w-48">Catégorie
          <select name="category" defaultValue={filters.category ?? ""} className={selectClass}>
            <option value="">Toutes</option>
            {(Object.keys(categoryLabels) as OpportunityCategory[]).map((key) => <option key={key} value={key}>{categoryLabels[key]}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-xs text-muted sm:w-40">Statut
          <select name="status" defaultValue={filters.status ?? ""} className={selectClass}>
            <option value="">Tous</option>
            {opportunityStatuses.map((status) => <option key={status} value={status}>{opportunityStatusLabels[status].label}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-xs text-muted sm:w-48">Comparaison
          <select name="compare" defaultValue={filters.compare ? "1" : "0"} className={selectClass}>
            <option value="1">Période précédente</option>
            <option value="0">Sans comparaison</option>
          </select>
        </label>
        {filters.sort !== "priority" && <input type="hidden" name="sort" value={filters.sort} />}
        <div className="col-span-2 flex gap-2"><button type="submit" className={actionClass("secondary")}>Afficher</button></div>
      </form>

      {!client ? <EmptyState icon="seo" title="Aucun client suivi par l’Agent SEO" description="Activez le service SEO sur une fiche client et associez sa propriété Search Console pour lancer les analyses." /> : <>
        <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
          <Panel className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold">{client.name}</h2>
                <p className="mt-1 break-all text-xs text-muted">Search Console : {client.property ?? "propriété non renseignée"} · GitHub : {client.repository ?? "dépôt non renseigné"}</p>
              </div>
              <MutationForm action={runAnalysisAction} fields={{ client_id: client.id }} label="Lancer une analyse complète" pendingLabel="Analyse en cours…" variant="primary" disabled={!active || !schemaReady} />
            </div>
            <nav aria-label="Statuts" className="mt-4 flex flex-wrap gap-2">
              <Link href={`${base}${filterQuery(current, { status: null })}`} className={`rounded-lg border px-3 py-2 text-xs ${!filters.status ? "border-accent/50 text-foreground" : "border-border text-muted hover:text-foreground"}`}>Toutes · {all.length}</Link>
              {opportunityStatuses.map((status) => <Link key={status} href={`${base}${filterQuery(current, { status })}`} className={`rounded-lg border px-3 py-2 text-xs ${filters.status === status ? "border-accent/50 text-foreground" : "border-border text-muted hover:text-foreground"}`}>{opportunityStatusLabels[status].label} · {counts[status]}</Link>)}
            </nav>
            {!client.property && <div className="mt-4"><InlineNotice tone="amber">Aucune propriété Search Console n’est associée à ce client : seules les données déjà enregistrées sont affichées. Associez-la dans « Données et performances ».</InlineNotice></div>}
          </Panel>
          <Panel className="p-5">
            <h2 className="font-semibold">Automatisations</h2>
            <ul className="mt-3 space-y-1.5 text-sm">
              <li className="flex justify-between gap-3"><span className="text-muted">Quotidienne (nouvelles données)</span><StatusBadge label={hasDaily ? "Planifiée" : "Non planifiée"} tone={hasDaily ? "green" : "neutral"} /></li>
              <li className="flex justify-between gap-3"><span className="text-muted">Hebdomadaire (recherche approfondie)</span><StatusBadge label={hasWeekly ? "Planifiée" : "Non planifiée"} tone={hasWeekly ? "green" : "neutral"} /></li>
              <li className="flex justify-between gap-3"><span className="text-muted">Planificateur</span><StatusBadge label={DIAGNOSTIC_STATUS_LABELS[schedulerDiagnostic.status]} tone={schedulerTone} /></li>
            </ul>
            {schedulerDiagnostic.status !== "operational" && <p role="status" className="mt-3 text-xs leading-5 text-warning">{schedulerDiagnostic.evidence} Les analyses programmées ne sont pas confirmées. Vérifiez la tâche Vercel et le secret CRON_SECRET ; leur présence seule ne prouve pas un passage réussi.</p>}
            {schemaReady && (!hasDaily || !hasWeekly) && <MutationForm action={scheduleAnalysesAction} fields={{ client_id: client.id }} label="Planifier les analyses" pendingLabel="Planification…" className="mt-4" />}
            <p className="mt-3 text-xs leading-5 text-muted">Les analyses ne déclenchent jamais de modification externe : elles créent des opportunités et des recommandations.</p>
          </Panel>
        </div>

        <Panel className="p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">Opportunités <span className="text-sm font-normal text-muted">({visible.length})</span></h2>
            {lastAnalysis?.period_start && <p className="text-xs text-muted">Dernière période analysée : {lastAnalysis.period_start} → {lastAnalysis.period_end}{filters.compare && lastAnalysis.previous_start ? ` · comparée à ${lastAnalysis.previous_start} → ${lastAnalysis.previous_end}` : ""}</p>}
          </div>
          {!visible.length ? <div className="mt-4"><EmptyState compact icon="seo" title={all.length ? "Aucune opportunité pour ces filtres" : "Aucune opportunité enregistrée"} description={all.length ? "Modifiez la catégorie ou le statut." : "Lancez une analyse complète : seules les données réelles de Search Console et le contexte client renseigné sont utilisés."} /></div> : <>
            <ul className="mt-4 divide-y divide-border md:hidden">
              {visible.map((row) => {
                const metrics = metricsOf(row.metrics);
                return (
                  <li key={row.id} className="py-4 first:pt-0">
                    <div className="flex flex-wrap gap-2"><StatusBadge label={categoryLabels[row.category]} tone="blue" /><StatusBadge label={opportunityStatusLabels[row.status].label} tone={opportunityStatusLabels[row.status].tone} /></div>
                    <Link href={`${base}/${row.id}`} className="mt-2 block break-words font-medium hover:text-accent">{row.keyword}</Link>
                    <p className="mt-1 break-all text-xs text-muted">{row.target_url ? pathOf(row.target_url) : row.target_status === "missing" ? "Aucune page adaptée" : "—"}</p>
                    <dl className="mt-3 grid grid-cols-4 gap-2 text-xs">
                      <div><dt className="text-subtle">Clics</dt><dd className="tabular-nums">{formatNumber(metrics?.clicks)}</dd></div>
                      <div><dt className="text-subtle">Impr.</dt><dd className="tabular-nums">{formatNumber(metrics?.impressions)}</dd></div>
                      <div><dt className="text-subtle">CTR</dt><dd className="tabular-nums">{formatPct(metrics?.ctr)}</dd></div>
                      <div><dt className="text-subtle">Pos.</dt><dd className="tabular-nums">{formatPosition(metrics?.position)}</dd></div>
                    </dl>
                    <p className="mt-2 text-xs text-muted">Priorité <span className="text-foreground">{levelLabels[row.priority].toLowerCase()}</span> · confiance {levelLabels[row.confidence].toLowerCase()} · {intentLabels[row.intent].toLowerCase()}{filters.compare ? <> · clics <ChangeCell row={row} /></> : null}</p>
                    {!row.verified && <p className="mt-1 text-xs text-warning">Hypothèse : aucune donnée Google</p>}
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 hidden overflow-x-auto md:block">
              <table className="w-full min-w-[60rem] text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] font-medium uppercase tracking-wider text-subtle">
                    <th scope="col" className="pb-2 pr-3 font-medium">Mot-clé</th>
                    <th scope="col" className="pb-2 pr-3 font-medium">Page cible</th>
                    <SortHeader label="Clics" sortKey="clicks" filters={current} base={base} />
                    <SortHeader label="Impr." sortKey="impressions" filters={current} base={base} />
                    <SortHeader label="CTR" sortKey="ctr" filters={current} base={base} />
                    <SortHeader label="Pos." sortKey="position" filters={current} base={base} />
                    {filters.compare && <SortHeader label="Évol. clics" sortKey="change" filters={current} base={base} />}
                    <SortHeader label="Potentiel*" sortKey="potential" filters={current} base={base} />
                    <th scope="col" className="pb-2 pr-3 font-medium">Intention</th>
                    <SortHeader label="Priorité" sortKey="priority" filters={current} base={base} align="left" />
                    <th scope="col" className="pb-2 pr-3 font-medium">Statut</th>
                    <th scope="col" className="pb-2 font-medium"><span className="sr-only">Recommandation</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const metrics = metricsOf(row.metrics), previous = metricsOf(row.previous_metrics);
                    return (
                      <tr key={row.id} className="border-b border-border/60 align-top last:border-0">
                        <td className="max-w-[16rem] py-3 pr-3">
                          <Link href={`${base}/${row.id}`} className="font-medium break-words hover:text-accent">{row.keyword}</Link>
                          <p className="mt-1 text-[11px] text-muted">{categoryLabels[row.category]}{row.keywords.length > 1 ? ` · ${row.keywords.length - 1} variante(s)` : ""}{!row.verified ? " · hypothèse" : ""}{row.significant_change ? " · changement significatif" : ""}</p>
                        </td>
                        <td className="max-w-[12rem] py-3 pr-3 break-all text-muted">{row.target_url ? pathOf(row.target_url) : row.target_status === "missing" ? "Aucune page adaptée" : "—"}</td>
                        <td className="py-3 pr-3 text-right tabular-nums">{formatNumber(metrics?.clicks)}{filters.compare && previous && <span className="block text-[11px] text-subtle">{formatNumber(previous.clicks)}</span>}</td>
                        <td className="py-3 pr-3 text-right tabular-nums">{formatNumber(metrics?.impressions)}{filters.compare && previous && <span className="block text-[11px] text-subtle">{formatNumber(previous.impressions)}</span>}</td>
                        <td className="py-3 pr-3 text-right tabular-nums">{formatPct(metrics?.ctr)}{filters.compare && previous && <span className="block text-[11px] text-subtle">{formatPct(previous.ctr)}</span>}</td>
                        <td className="py-3 pr-3 text-right tabular-nums">{formatPosition(metrics?.position)}{filters.compare && previous && <span className="block text-[11px] text-subtle">{formatPosition(previous.position)}</span>}</td>
                        {filters.compare && <td className="py-3 pr-3 text-right tabular-nums"><ChangeCell row={row} /></td>}
                        <td className="py-3 pr-3 text-right tabular-nums text-muted">{row.potential_clicks ? `≈ ${formatNumber(row.potential_clicks)}` : "—"}</td>
                        <td className="py-3 pr-3 text-muted">{intentLabels[row.intent]}</td>
                        <td className="py-3 pr-3"><StatusBadge label={levelLabels[row.priority]} tone={levelTone[row.priority]} /><span className="mt-1 block text-[11px] text-muted">confiance {levelLabels[row.confidence].toLowerCase()}</span></td>
                        <td className="py-3 pr-3"><StatusBadge label={opportunityStatusLabels[row.status].label} tone={opportunityStatusLabels[row.status].tone} /></td>
                        <td className="py-3 text-right">{row.recommendation_id ? <Link href={`/recommendations/${row.recommendation_id}`} className="text-xs text-accent hover:underline">Recommandation</Link> : <Link href={`${base}/${row.id}`} className="text-xs text-muted hover:text-foreground">Fiche</Link>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-xs leading-5 text-muted">Métriques Search Console (28 derniers jours consolidés{filters.compare ? ", valeur précédente en dessous" : ""}). * Potentiel : estimation de clics supplémentaires d’après une courbe de CTR de référence, jamais une donnée Google. Intention : estimée par règles.</p>
          </>}
        </Panel>

        <Panel className="mt-6 p-5">
          <h2 className="font-semibold">Historique des analyses</h2>
          {analyses.length ? <ul className="mt-3 divide-y divide-border">
            {analyses.map((analysis) => {
              const counts = (analysis.counts ?? {}) as Record<string, number>;
              return (
                <li key={analysis.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm">{analysis.depth === "weekly" ? "Recherche approfondie" : "Analyse quotidienne"} · <span className="text-muted">{analysis.trigger === "schedule" ? "planifiée" : analysis.trigger === "assistant" ? "assistant" : "manuelle"}</span></p>
                    <p className="mt-1 text-xs text-muted">{analysis.summary ?? (analysis.status === "running" ? "En cours…" : "—")}</p>
                    {analysis.status === "succeeded" && <p className="mt-1 text-xs text-subtle">{counts.detected ?? 0} analysée(s) · {counts.created ?? 0} nouvelle(s) · {counts.toReview ?? 0} à examiner{counts.resurfaced ? ` · ${counts.resurfaced} changement(s) significatif(s)` : ""}</p>}
                  </div>
                  <div className="flex items-center gap-2"><StatusBadge label={analysis.status === "succeeded" ? "Terminée" : analysis.status === "failed" ? "Échec" : "En cours"} tone={analysis.status === "succeeded" ? "green" : analysis.status === "failed" ? "red" : "blue"} /><time className="text-xs text-muted" dateTime={analysis.started_at}>{formatDate(analysis.started_at)}</time></div>
                </li>
              );
            })}
          </ul> : <p className="mt-3 text-sm text-muted">Aucune analyse enregistrée pour ce client.</p>}
        </Panel>
      </>}
    </>
  );
}
