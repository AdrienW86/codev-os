import "server-only";
// Mesure des résultats après une intervention SEO : mêmes durées avant / après le déploiement (7, 28, 60 jours),
// sur la requête et la page concernées, uniquement quand les journées sont consolidées dans Search Console.
// Une évolution est signalée, jamais attribuée automatiquement à la modification.
import type { getSupabaseServerClient } from "@/lib/supabase/server";
import type { QueryRow, SearchFilter } from "@/lib/providers/search-console";
import type { Json } from "@/lib/supabase/database.types";
import type { SeoInterventionRow } from "@/lib/supabase/seo-opportunities.types";
import { MEASUREMENT_WINDOWS, compareWindow, measurementPeriods, sumRows, windowReady, type Period } from "@/lib/seo/opportunities";

type Db = ReturnType<typeof getSupabaseServerClient>;
export type SearchFn = (period: Period, filters: SearchFilter[]) => Promise<QueryRow[]>;

/** Filtres exacts : la requête suivie (sauf pour une page en baisse) et la page cible si elle est connue. */
export function interventionFilters(row: Pick<SeoInterventionRow, "keyword" | "target_url">, category: string): SearchFilter[] {
  const filters: SearchFilter[] = [];
  if (category !== "declining_page") filters.push({ dimension: "query", expression: row.keyword });
  if (row.target_url && /^https?:\/\//i.test(row.target_url)) filters.push({ dimension: "page", expression: row.target_url });
  return filters;
}

export async function measureInterventions(deps: { db: Db; search: SearchFn; now?: () => Date }, clientId: string, lastAvailableDate: string) {
  const summary = { measured: 0, improved: 0, degraded: 0 };
  const { data, error } = await deps.db.from("seo_opportunity_interventions").select("*").eq("client_id", clientId).not("deployed_at", "is", null).limit(50);
  if (error) throw new Error("interventions read");
  const rows = (data ?? []) as SeoInterventionRow[];
  if (!rows.length) return summary;
  const { data: opportunities, error: opportunityError } = await deps.db.from("seo_keyword_opportunities").select("id,category").in("id", [...new Set(rows.map((row) => row.opportunity_id))]);
  if (opportunityError) throw new Error("opportunities read");
  const categoryById = new Map((opportunities ?? []).map((row) => [row.id as string, row.category as string]));
  for (const row of rows) {
    const done = row.measurements && typeof row.measurements === "object" && !Array.isArray(row.measurements) ? row.measurements as Record<string, unknown> : {};
    const pending = MEASUREMENT_WINDOWS.filter((window) => !done[String(window)] && windowReady(row.deployed_at!, window, lastAvailableDate));
    if (!pending.length) continue;
    const filters = interventionFilters(row, categoryById.get(row.opportunity_id) ?? "");
    if (!filters.length) continue;
    const next: Record<string, unknown> = { ...done };
    for (const window of pending) {
      const periods = measurementPeriods(row.deployed_at!, window);
      const [before, after] = await Promise.all([deps.search(periods.before, filters), deps.search(periods.after, filters)]);
      const beforeMetrics = sumRows(before), afterMetrics = sumRows(after);
      const verdict = compareWindow(beforeMetrics, afterMetrics);
      next[String(window)] = { before: beforeMetrics, after: afterMetrics, beforePeriod: periods.before, afterPeriod: periods.after, ...verdict };
      summary.measured++;
      if (verdict.verdict === "improved") summary.improved++;
      if (verdict.verdict === "degraded") summary.degraded++;
    }
    const { error: updateError } = await deps.db.from("seo_opportunity_interventions").update({ measurements: next as Json, measured_at: (deps.now ?? (() => new Date()))().toISOString() }).eq("id", row.id);
    if (updateError) throw new Error("intervention update");
  }
  return summary;
}
