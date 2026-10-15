import "server-only";
import { legacyAnalyzeSeoRun } from "./legacy-run";
import { missingSeoSchema } from "./schema-availability";
// Handler « seo.analyze » — moteur unique de l'Agent SEO.
//  - quotidien : nouvelles données Search Console (28 j consolidés vs 28 j précédents), détection des opportunités,
//    déduplication, changements significatifs, mesure des interventions déployées ;
//  - hebdomadaire (et lancement manuel) : en plus, contenu des pages (GitHub), sujets et zones absents, PageSpeed.
// Constats → opportunités et recommandations ; aucune modification du site sans action approuvée.
import { recordSync } from "@/lib/connections/sync";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { searchAnalytics, type QueryRow, type SearchDimension, type SearchFilter } from "@/lib/providers/search-console";
import { searchConsoleAccess } from "@/lib/integrations/search-console/connection";
import { normalizeProperty } from "@/lib/integrations/search-console/model";
import { pageSpeed, type PageSpeedResult } from "@/lib/providers/pagespeed";
import { readSeoPageContexts, type SeoPageContext } from "@/lib/providers/github";
import { ProviderError } from "@/lib/providers/errors";
import { totals } from "@/lib/seo/analyze";
import { addDays, detectOpportunities, pageSignals, pathOf, type DetectedOpportunity, type Period, type SitePage } from "@/lib/seo/opportunities";
import { buildBusinessContext } from "@/lib/seo/context";
import { persistOpportunities, type StoreDeps } from "@/lib/seo/opportunity-store";
import { measureInterventions } from "@/lib/seo/measure";
import { siteUrl } from "@/lib/monitoring/evaluate";
import { recordRecommendation } from "@/lib/agents/outputs";
import { writeAudit } from "@/lib/core/audit";
import { RunError, type RunHandler } from "@/lib/runs/types";
import type { Json } from "@/lib/supabase/database.types";
import type { AnalysisTrigger } from "@/lib/supabase/seo-opportunities.types";

const day = (date: Date, offset: number) => { const value = new Date(date); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); };
const wrap = (error: unknown): never => { if (error instanceof ProviderError) throw new RunError(error.message, error.retryable); throw error; };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const parisDate = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** Profondeur demandée : « weekly » explicitement, sinon quotidienne (une exécution manuelle sans précision est complète). */
export function analysisDepth(payload: unknown, trigger: string): "daily" | "weekly" {
  const depth = record(payload).depth;
  if (depth === "weekly" || depth === "daily") return depth;
  return trigger === "schedule" ? "daily" : "weekly";
}

/** Périodes comparées : 28 jours consolidés (Search Console a ~3 jours de retard) et les 28 jours précédents. */
export function analysisPeriods(now: Date): { current: Period; previous: Period } {
  const end = day(now, -3);
  const start = addDays(end, -27);
  return { current: { start, end }, previous: { start: addDays(start, -28), end: addDays(start, -1) } };
}

/** Format historique des constats (fiche client « Santé ») dérivé des opportunités. */
function legacyFindings(items: DetectedOpportunity[]) {
  return items.flatMap((item) => {
    const kind = item.category === "declining_page" ? "page_drop" : item.category === "low_ctr" ? "low_ctr" : ["striking_distance", "page_two", "emerging_query"].includes(item.category) ? "emerging_query" : null;
    if (!kind || !item.metrics) return [];
    return [{ kind, key: item.category === "declining_page" ? item.targetUrl ?? item.keyword : item.keyword, detail: item.rationale.slice(0, 400), severity: item.priority,
      metrics: { clicks: item.metrics.clicks, priorClicks: item.previous?.clicks, impressions: item.metrics.impressions, priorImpressions: item.previous?.impressions, ctr: item.metrics.ctr ?? undefined, position: item.metrics.position ?? undefined },
      suggestedAction: item.recommendedAction.slice(0, 400), targetPage: item.targetUrl ?? undefined }];
  }).slice(0, 20);
}

function attachContext(items: DetectedOpportunity[], github: SeoPageContext[], vercel: { rows: { label: string; visitors?: number; pageviews?: number }[]; period: Period | null }) {
  const githubByUrl = new Map(github.map((item) => [item.targetUrl, item]));
  return items.map((item) => {
    if (!item.targetUrl) return item;
    const source = githubByUrl.get(item.targetUrl);
    const traffic = vercel.rows.find((row) => row.label === pathOf(item.targetUrl!));
    const signals = source && item.category !== "declining_page" && item.category !== "cannibalization" ? pageSignals(item.keyword, source) : [];
    return {
      ...item,
      factors: [...item.factors, ...signals].slice(0, 12),
      evidence: {
        ...item.evidence,
        ...(source ? { github: { repository: source.repository, branch: source.branch, path: source.path, sha: source.sha, title: source.title, description: source.description, h1: source.h1 }, pageSignals: signals } : {}),
        ...(traffic ? { vercel: { visitors: traffic.visitors ?? null, pageviews: traffic.pageviews ?? null, period: vercel.period } } : {}),
      },
    };
  });
}

export const analyzeSeoRun: RunHandler = async (args) => {
  const { job, agent, actor, now, runId } = args;
  if (!job.client_id) throw new RunError("Client requis pour l’analyse SEO.", false);
  const supabase = getSupabaseServerClient();
  // SEO V2 is additive: until its SQL is deliberately applied, keep the existing
  // Search Console/PageSpeed agent running rather than failing every SEO task.
  const schema = await supabase.from("seo_opportunity_analyses").select("id").limit(1);
  if (schema.error) {
    if (missingSeoSchema(schema.error)) return legacyAnalyzeSeoRun(args);
    throw new RunError("Disponibilité du stockage SEO V2 non vérifiable.", true);
  }
  const depth = analysisDepth(job.payload, job.trigger);
  const trigger: AnalysisTrigger = job.trigger === "schedule" ? "schedule" : job.trigger === "assistant" ? "assistant" : job.trigger === "system" ? "system" : "manual";
  const [{ data: client, error }, { data: searchConnection }, { data: githubConnection }, { data: adsContext }, { data: vercelSnapshot }] = await Promise.all([
    supabase.from("clients").select("id,name,company_name,activity,geographic_area,website").eq("id", job.client_id).maybeSingle(),
    supabase.from("client_connections").select("metadata").eq("client_id", job.client_id).eq("provider", "search-console").maybeSingle(),
    supabase.from("client_connections").select("metadata").eq("client_id", job.client_id).eq("provider", "github").maybeSingle(),
    supabase.from("client_ads_context").select("context").eq("client_id", job.client_id).maybeSingle(),
    supabase.from("metric_snapshots").select("period_start,period_end,data").eq("client_id", job.client_id).eq("provider", "vercel").eq("metric_key", "web_analytics").order("fetched_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (error || !client) throw new RunError("Client introuvable.", false);
  const property = normalizeProperty(record(searchConnection?.metadata).property);
  const repository = typeof record(githubConnection?.metadata).repository === "string" ? record(githubConnection?.metadata).repository as string : null;
  const { current, previous } = analysisPeriods(now);

  // Historique : une analyse planifiée par client, profondeur et jour.
  const { data: analysis, error: analysisError } = await supabase.from("seo_opportunity_analyses").insert({ client_id: client.id, depth, trigger, analysis_date: parisDate(now), property, agent_run_id: runId }).select("id").maybeSingle();
  if (analysisError?.code === "23505") return { status: "skipped", summary: `${client.name} — analyse ${depth === "weekly" ? "hebdomadaire" : "quotidienne"} déjà réalisée aujourd’hui.` };
  if (analysisError || !analysis) throw new RunError("Historique des analyses indisponible (migration à appliquer ?).", false);
  const analysisId = analysis.id as string;
  const sources: Record<string, unknown> = {};
  const notes: string[] = [];
  let counts: Record<string, number> = {};

  const finish = async (status: "succeeded" | "failed", summary: string, errorKind: string | null = null) => {
    await supabase.from("seo_opportunity_analyses").update({
      status, finished_at: new Date().toISOString(), period_start: current.start, period_end: current.end, previous_start: previous.start, previous_end: previous.end,
      sources: sources as Json, counts: counts as Json, summary: summary.slice(0, 2000), error_kind: errorKind,
    }).eq("id", analysisId);
  };

  try {
    let detected: DetectedOpportunity[] = [];
    const access = property ? await searchConsoleAccess() : null;
    if (access && property) {
      const options = { accessToken: access.accessToken };
      const call = (period: Period, dimensions: SearchDimension[], rowLimit: number, filters?: SearchFilter[]) =>
        searchAnalytics(property, { startDate: period.start, endDate: period.end, dimensions, rowLimit, dataState: "final", filters }, options);
      const [queries, previousQueries, pages, previousPages, queryPages] = await Promise.all([
        call(current, ["query"], 1000), call(previous, ["query"], 1000), call(current, ["page"], 500), call(previous, ["page"], 500),
        call(current, ["query", "page"], depth === "weekly" ? 10_000 : 5000),
      ]).catch(async (failure) => { await recordSync(client.id, "search-console", failure); return wrap(failure); });
      await recordSync(client.id, "search-console", null);
      sources.searchConsole = { ok: true, property, queries: queries.length, pages: pages.length };
      const context = buildBusinessContext(client, record(adsContext?.context));
      sources.businessContext = { services: context.services.length, areas: context.areas.length, exclusions: context.exclusions.length };
      const base = { period: current, previousPeriod: previous, queries, previousQueries, queryPages, pages, previousPages, context, depth, limit: 30 } as const;
      detected = detectOpportunities({ ...base, depth: "daily" });

      let github: SeoPageContext[] = [];
      if (depth === "weekly") {
        // Contenu réel des pages cibles et des pages les plus visibles (titles, H1, descriptions).
        const urls = [...new Set([...detected.flatMap((item) => item.targetUrl ? [item.targetUrl] : []).slice(0, 6), ...pages.slice(0, 4).map((row: QueryRow) => row.keys[0])])].filter((url) => /^https?:\/\//i.test(url));
        if (repository) {
          github = await readSeoPageContexts(repository, urls).catch(async (failure) => { await recordSync(client.id, "github", failure); sources.github = { ok: false, error: failure instanceof ProviderError ? failure.kind : "internal" }; return []; });
          if (!sources.github) { sources.github = { ok: true, pages: github.length }; await recordSync(client.id, "github", null); }
        } else sources.github = { ok: false, error: "not_configured" };
        const sitePages: SitePage[] = [
          ...github.map((item) => ({ url: item.targetUrl, path: item.path, title: item.title, h1: item.h1, description: item.description })),
          ...pages.slice(0, 200).map((row: QueryRow) => ({ url: row.keys[0], path: pathOf(row.keys[0]).replace(/[/-]/g, " "), title: null, h1: null, description: null })),
        ];
        detected = detectOpportunities({ ...base, depth: "weekly", sitePages });
      }
      const vercelData = record(vercelSnapshot?.data);
      const vercelRows = Array.isArray(vercelData.topPages) ? (vercelData.topPages as { label: string; visitors?: number; pageviews?: number }[]).filter((row) => typeof row?.label === "string") : [];
      sources.vercel = vercelSnapshot ? { ok: true, period: { start: vercelSnapshot.period_start, end: vercelSnapshot.period_end } } : { ok: false, error: "no_snapshot" };
      detected = attachContext(detected, github, { rows: vercelRows, period: vercelSnapshot ? { start: vercelSnapshot.period_start, end: vercelSnapshot.period_end } : null });

      const store: StoreDeps = {
        db: supabase,
        recommend: (input) => recordRecommendation(actor, { ...input, payload: input.payload }),
        audit: (entry) => writeAudit(actor, entry),
      };
      const persisted = await persistOpportunities(store, { clientId: client.id, agentId: agent.id, analysisId, period: current, previousPeriod: previous, opportunities: detected });
      const measured = await measureInterventions({ db: supabase, search: (period, filters) => call(period, [], 1, filters) }, client.id, current.end)
        .catch(() => { sources.measurement = { ok: false }; return { measured: 0, improved: 0, degraded: 0 }; });
      counts = { detected: detected.length, high: detected.filter((item) => item.priority === "high").length, ...persisted, ...measured };

      const summaryTotals = totals(pages);
      await Promise.all([
        supabase.from("metric_snapshots").upsert({ client_id: client.id, provider: "search-console", metric_key: "summary", period_start: current.start, period_end: current.end, data: { ...summaryTotals, previous_clicks: totals(previousPages).clicks } as unknown as Json }, { onConflict: "client_id,provider,metric_key,period_start,period_end" }),
        supabase.from("metric_snapshots").upsert({ client_id: client.id, provider: "search-console", metric_key: "opportunities", period_start: current.start, period_end: current.end, data: { findings: legacyFindings(detected), analysis_id: analysisId } as unknown as Json }, { onConflict: "client_id,provider,metric_key,period_start,period_end" }),
      ]);
      notes.push(`Search Console : ${summaryTotals.clicks} clics, ${summaryTotals.impressions} impressions`);
      notes.push(`${detected.length} opportunité(s) analysée(s), ${persisted.created} nouvelle(s), ${persisted.toReview} à examiner`);
      if (persisted.resurfaced) notes.push(`${persisted.resurfaced} changement(s) significatif(s) sur des opportunités closes`);
      if (measured.measured) notes.push(`${measured.measured} mesure(s) d’intervention`);
      if (depth === "weekly" && repository) notes.push(github.length ? `GitHub : ${github.length} page(s) lue(s)` : "GitHub : aucune page source rapprochée");
    } else {
      sources.searchConsole = { ok: false, error: property ? "not_connected" : "no_property" };
      notes.push(property ? "Search Console non connectée" : "Propriété Search Console non renseignée");
    }

    // PageSpeed (hebdomadaire / manuel) : performances techniques du site, indépendantes de Search Console.
    const url = depth === "weekly" ? siteUrl(client.website) : null;
    if (url) {
      try {
        const result: PageSpeedResult = await pageSpeed(url);
        const today = now.toISOString().slice(0, 10);
        sources.pagespeed = { ok: true, performance: result.performance };
        await supabase.from("metric_snapshots").upsert({ client_id: client.id, provider: "pagespeed", metric_key: "mobile", period_start: today, period_end: today, data: result as unknown as Json }, { onConflict: "client_id,provider,metric_key,period_start,period_end" });
        if (result.performance !== null && result.performance < 50) {
          await recordRecommendation(actor, { agentId: agent.id, clientId: client.id, title: `Performances mobiles faibles (${result.performance}/100)`, reason: `Score PageSpeed mobile ${result.performance}/100${result.lcpMs ? `, LCP ${(result.lcpMs / 1000).toFixed(1)} s` : ""}. Optimiser images, scripts et cache.`, severity: result.performance < 30 ? "high" : "medium", payload: { pagespeed: result } });
        }
        notes.push(`PageSpeed mobile : ${result.performance ?? "?"}/100`);
      } catch (failure) {
        if (!(failure instanceof ProviderError) || failure.kind === "blocked") throw failure;
        sources.pagespeed = { ok: false, error: failure.kind };
        notes.push(`PageSpeed indisponible (${failure.kind})`);
      }
    } else if (depth === "weekly") notes.push("Aucun site renseigné");

    const summary = `${client.name} — analyse ${depth === "weekly" ? "hebdomadaire" : "quotidienne"} : ${notes.join(" ; ")}.`;
    await finish("succeeded", summary);
    return { status: "succeeded", summary, data: { analysis_id: analysisId, ...counts } };
  } catch (failure) {
    await finish("failed", "Analyse interrompue.", failure instanceof ProviderError ? failure.kind : failure instanceof RunError ? "run_error" : "internal").catch(() => undefined);
    throw failure;
  }
};
