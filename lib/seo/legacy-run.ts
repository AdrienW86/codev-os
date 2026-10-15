import "server-only";
import { recordSync } from "@/lib/connections/sync";
// Handler « seo.analyze » : Search Console (28 j vs 28 j précédents) + PageSpeed mobile.
// Constats → recommandations ; aucune modification du site sans action validée.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { searchAnalytics } from "@/lib/providers/search-console";
import { searchConsoleAccess } from "@/lib/integrations/search-console/connection";
import { normalizeProperty } from "@/lib/integrations/search-console/model";
import { pageSpeed } from "@/lib/providers/pagespeed";
import { readSeoPageContexts } from "@/lib/providers/github";
import { ProviderError } from "@/lib/providers/errors";
import { analyzeSeo, totals } from "@/lib/seo/analyze";
import { siteUrl } from "@/lib/monitoring/evaluate";
import { recordRecommendation } from "@/lib/agents/outputs";
import { RunError, type RunHandler } from "@/lib/runs/types";
import type { Json } from "@/lib/supabase/database.types";

const day = (date: Date, offset: number) => { const value = new Date(date); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); };
const wrap = (error: unknown): never => { if (error instanceof ProviderError) throw new RunError(error.message, error.retryable); throw error; };

export const legacyAnalyzeSeoRun: RunHandler = async ({ job, agent, actor, now }) => {
  if (!job.client_id) throw new RunError("Client requis pour l’analyse SEO.", false);
  const supabase = getSupabaseServerClient();
  const [{ data: client, error }, { data: searchConnection }, { data: githubConnection }] = await Promise.all([
    supabase.from("clients").select("id,name,website").eq("id", job.client_id).maybeSingle(),
    supabase.from("client_connections").select("metadata").eq("client_id", job.client_id).eq("provider", "search-console").maybeSingle(),
    supabase.from("client_connections").select("metadata").eq("client_id", job.client_id).eq("provider", "github").maybeSingle(),
  ]);
  if (error || !client) throw new RunError("Client introuvable.", false);
  const notes: string[] = [];
  let findings = 0;
  // Propriété associée à CE client uniquement ; accès via la connexion OAuth de l'agence (ou l'ancien jeton serveur).
  const property = normalizeProperty((searchConnection?.metadata as { property?: unknown } | null)?.property);
  const repository = (githubConnection?.metadata as { repository?: string } | null)?.repository;
  const access = property ? await searchConsoleAccess() : null;
  if (access && property) {
    const options = { accessToken: access.accessToken };
    // Les données Search Console ont ~3 jours de retard.
    const current = { startDate: day(now, -30), endDate: day(now, -3) }, previous = { startDate: day(now, -58), endDate: day(now, -31) };
    const [pagesNow, pagesBefore, queriesNow, queriesBefore, queryPagesNow] = await Promise.all([
      searchAnalytics(property, { ...current, dimensions: ["page"] }, options), searchAnalytics(property, { ...previous, dimensions: ["page"] }, options),
      searchAnalytics(property, { ...current, dimensions: ["query"] }, options), searchAnalytics(property, { ...previous, dimensions: ["query"] }, options),
      searchAnalytics(property, { ...current, dimensions: ["query", "page"], rowLimit: 1000 }, options),
    ]).catch(async (failure) => { await recordSync(client.id, "search-console", failure); return wrap(failure); });
    await recordSync(client.id, "search-console", null);
    const summary = totals(pagesNow);
    const seoFindings = analyzeSeo(pagesNow, pagesBefore, queriesNow, queriesBefore, queryPagesNow);
    const targetUrls = seoFindings.flatMap((finding) => {
      const target = finding.kind === "page_drop" ? finding.key : finding.targetPage;
      return typeof target === "string" && /^https?:\/\//i.test(target) ? [target] : [];
    });
    const githubContexts = repository ? await readSeoPageContexts(repository, targetUrls).catch(async (failure) => {
      await recordSync(client.id, "github", failure);
      return [];
    }) : [];
    if (repository && githubContexts.length) await recordSync(client.id, "github", null);
    const githubByUrl = new Map(githubContexts.map((item) => [item.targetUrl, item]));
    await Promise.all([
      supabase.from("metric_snapshots").upsert({ client_id: client.id, provider: "search-console", metric_key: "summary", period_start: current.startDate, period_end: current.endDate, data: { ...summary, previous_clicks: totals(pagesBefore).clicks } as unknown as Json }, { onConflict: "client_id,provider,metric_key,period_start,period_end" }),
      supabase.from("metric_snapshots").upsert({
        client_id: client.id,
        provider: "search-console",
        metric_key: "opportunities",
        period_start: current.startDate,
        period_end: current.endDate,
        data: {
          findings: seoFindings,
          counts: {
            page_drop: seoFindings.filter((item) => item.kind === "page_drop").length,
            emerging_query: seoFindings.filter((item) => item.kind === "emerging_query").length,
            low_ctr: seoFindings.filter((item) => item.kind === "low_ctr").length,
            near_first_page: seoFindings.filter((item) => item.kind === "near_first_page").length,
            page_growth: seoFindings.filter((item) => item.kind === "page_growth").length,
          },
        } as unknown as Json,
      }, { onConflict: "client_id,provider,metric_key,period_start,period_end" }),
    ]);
    for (const finding of seoFindings) {
      if (finding.kind === "page_growth") continue;
      const title = finding.kind === "page_drop" ? `Page en baisse : ${finding.key}` : finding.kind === "emerging_query" ? `Opportunité : « ${finding.key} »` : finding.kind === "near_first_page" ? `Renforcer la visibilité pour « ${finding.key} »` : `Améliorer le titre pour « ${finding.key} »`;
      const targetUrl = finding.kind === "page_drop" ? finding.key : finding.targetPage ?? null;
      const repositoryContext = targetUrl ? githubByUrl.get(targetUrl) ?? null : null;
      const created = await recordRecommendation(actor, { agentId: agent.id, clientId: client.id, title: title.slice(0, 200), reason: finding.detail, severity: finding.severity, payload: { kind: finding.kind, key: finding.key, metrics: finding.metrics, suggested_action: finding.suggestedAction, target_page: finding.targetPage ?? null, repository_context: repositoryContext, period: current } });
      if (created.created) findings++;
    }
    notes.push(`Search Console : ${summary.clicks} clics, ${summary.impressions} impressions`);
    if (repository) notes.push(githubContexts.length ? `GitHub : ${githubContexts.length} page(s) rapprochée(s) du code` : "GitHub : dépôt renseigné, aucune page source rapprochée");
  } else notes.push(property ? "Search Console non connectée" : "Propriété Search Console non renseignée");

  const url = siteUrl(client.website);
  if (url) {
    try {
      const result = await pageSpeed(url);
      const today = now.toISOString().slice(0, 10);
      await supabase.from("metric_snapshots").upsert({ client_id: client.id, provider: "pagespeed", metric_key: "mobile", period_start: today, period_end: today, data: result as unknown as Json }, { onConflict: "client_id,provider,metric_key,period_start,period_end" });
      if (result.performance !== null && result.performance < 50) {
        const created = await recordRecommendation(actor, { agentId: agent.id, clientId: client.id, title: `Performances mobiles faibles (${result.performance}/100)`, reason: `Score PageSpeed mobile ${result.performance}/100${result.lcpMs ? `, LCP ${(result.lcpMs / 1000).toFixed(1)} s` : ""}. Optimiser images, scripts et cache.`, severity: result.performance < 30 ? "high" : "medium", payload: { pagespeed: result } });
        if (created.created) findings++;
      }
      notes.push(`PageSpeed mobile : ${result.performance ?? "?"}/100`);
    } catch (failure) {
      if (!(failure instanceof ProviderError) || failure.kind === "blocked") throw failure;
      notes.push(`PageSpeed indisponible (${failure.kind})`);
    }
  } else notes.push("Aucun site renseigné");
  return { status: "succeeded", summary: `${client.name} — ${notes.join(" ; ")} ; ${findings} nouvelle(s) recommandation(s).`, data: { findings } };
};
