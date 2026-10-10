import "server-only";
import { recordSync } from "@/lib/connections/sync";
// Handler « seo.analyze » : Search Console (28 j vs 28 j précédents) + PageSpeed mobile.
// Constats → recommandations ; aucune modification du site sans action validée.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { searchAnalytics, searchConsoleConfigured } from "@/lib/providers/search-console";
import { pageSpeed } from "@/lib/providers/pagespeed";
import { ProviderError } from "@/lib/providers/errors";
import { analyzeSeo, totals } from "@/lib/seo/analyze";
import { siteUrl } from "@/lib/monitoring/evaluate";
import { recordRecommendation } from "@/lib/agents/outputs";
import { RunError, type RunHandler } from "@/lib/runs/types";
import type { Json } from "@/lib/supabase/database.types";

const day = (date: Date, offset: number) => { const value = new Date(date); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); };
const wrap = (error: unknown): never => { if (error instanceof ProviderError) throw new RunError(error.message, error.retryable); throw error; };

export const analyzeSeoRun: RunHandler = async ({ job, agent, actor, now }) => {
  if (!job.client_id) throw new RunError("Client requis pour l’analyse SEO.", false);
  const supabase = getSupabaseServerClient();
  const [{ data: client, error }, { data: connection }] = await Promise.all([
    supabase.from("clients").select("id,name,website").eq("id", job.client_id).maybeSingle(),
    supabase.from("client_connections").select("metadata").eq("client_id", job.client_id).eq("provider", "search-console").maybeSingle(),
  ]);
  if (error || !client) throw new RunError("Client introuvable.", false);
  const notes: string[] = [];
  let findings = 0;
  const property = (connection?.metadata as { property?: string } | null)?.property;
  if (searchConsoleConfigured() && property) {
    // Les données Search Console ont ~3 jours de retard.
    const current = { startDate: day(now, -30), endDate: day(now, -3) }, previous = { startDate: day(now, -58), endDate: day(now, -31) };
    const [pagesNow, pagesBefore, queriesNow, queriesBefore] = await Promise.all([
      searchAnalytics(property, { ...current, dimensions: ["page"] }), searchAnalytics(property, { ...previous, dimensions: ["page"] }),
      searchAnalytics(property, { ...current, dimensions: ["query"] }), searchAnalytics(property, { ...previous, dimensions: ["query"] }),
    ]).catch(async (failure) => { await recordSync(client.id, "search-console", failure); return wrap(failure); });
    await recordSync(client.id, "search-console", null);
    const summary = totals(pagesNow);
    await supabase.from("metric_snapshots").upsert({ client_id: client.id, provider: "search-console", metric_key: "summary", period_start: current.startDate, period_end: current.endDate, data: { ...summary, previous_clicks: totals(pagesBefore).clicks } as unknown as Json }, { onConflict: "client_id,provider,metric_key,period_start,period_end" });
    for (const finding of analyzeSeo(pagesNow, pagesBefore, queriesNow, queriesBefore)) {
      if (finding.kind === "page_growth") continue;
      const title = finding.kind === "page_drop" ? `Page en baisse : ${finding.key}` : finding.kind === "emerging_query" ? `Opportunité : « ${finding.key} »` : `Améliorer le titre pour « ${finding.key} »`;
      const created = await recordRecommendation(actor, { agentId: agent.id, clientId: client.id, title: title.slice(0, 200), reason: finding.detail, severity: finding.severity, payload: { kind: finding.kind, key: finding.key } });
      if (created.created) findings++;
    }
    notes.push(`Search Console : ${summary.clicks} clics, ${summary.impressions} impressions`);
  } else notes.push(searchConsoleConfigured() ? "Propriété Search Console non renseignée" : "Search Console non connectée");

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
