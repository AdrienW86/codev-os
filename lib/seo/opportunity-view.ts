// Présentation des opportunités (pur) : tri, filtres d'URL, évolutions, libellés.
import type { OpportunityStatus, SeoOpportunityRow } from "@/lib/supabase/seo-opportunities.types";
import { categoryLabels, type Metrics, type OpportunityCategory } from "@/lib/seo/opportunities";
import { isOpportunityStatus } from "@/lib/seo/opportunity-status";

export const sortKeys = ["priority", "impressions", "clicks", "ctr", "position", "potential", "change", "detected"] as const;
export type SortKey = (typeof sortKeys)[number];
export type SortDir = "asc" | "desc";
export type OpportunityFilters = { client: string | null; category: OpportunityCategory | null; status: OpportunityStatus | null; sort: SortKey; dir: SortDir; compare: boolean };

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export function parseFilters(params: Record<string, string | string[] | undefined>): OpportunityFilters {
  const client = first(params.client);
  const category = first(params.category);
  const status = first(params.status);
  const sort = first(params.sort);
  const dir = first(params.dir);
  return {
    client: client && /^[0-9a-f-]{36}$/i.test(client) ? client : null,
    category: category && Object.hasOwn(categoryLabels, category) ? category as OpportunityCategory : null,
    status: isOpportunityStatus(status) ? status : null,
    sort: (sortKeys as readonly string[]).includes(sort ?? "") ? sort as SortKey : "priority",
    dir: dir === "asc" ? "asc" : dir === "desc" ? "desc" : (sort === "position" ? "asc" : "desc"),
    compare: first(params.compare) !== "0",
  };
}

export function filterQuery(filters: OpportunityFilters, patch: Partial<OpportunityFilters> = {}) {
  const next = { ...filters, ...patch };
  const query = new URLSearchParams();
  if (next.client) query.set("client", next.client);
  if (next.category) query.set("category", next.category);
  if (next.status) query.set("status", next.status);
  if (next.sort !== "priority") query.set("sort", next.sort);
  if (next.dir !== (next.sort === "position" ? "asc" : "desc")) query.set("dir", next.dir);
  if (!next.compare) query.set("compare", "0");
  const text = query.toString();
  return text ? `?${text}` : "";
}

export function metricsOf(value: unknown): Metrics | null {
  const item = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  return item && typeof item.clicks === "number" && typeof item.impressions === "number"
    ? { clicks: item.clicks, impressions: item.impressions, ctr: typeof item.ctr === "number" ? item.ctr : null, position: typeof item.position === "number" ? item.position : null }
    : null;
}

/** Variation relative des clics (en %) ; null si la période précédente n'a pas de base. */
export function clickChange(row: Pick<SeoOpportunityRow, "metrics" | "previous_metrics">) {
  const now = metricsOf(row.metrics), before = metricsOf(row.previous_metrics);
  if (!now || !before || before.clicks <= 0) return null;
  return Math.round(((now.clicks - before.clicks) / before.clicks) * 1000) / 10;
}

const LEVEL: Record<string, number> = { high: 3, medium: 2, low: 1 };
const STATUS_ORDER: Record<OpportunityStatus, number> = { to_review: 0, detected: 1, approved: 2, in_progress: 3, done: 4, dismissed: 5 };

function value(row: SeoOpportunityRow, key: SortKey): number | null {
  const metrics = metricsOf(row.metrics);
  switch (key) {
    case "priority": return LEVEL[row.priority] * 10 + LEVEL[row.confidence];
    case "impressions": return metrics?.impressions ?? null;
    case "clicks": return metrics?.clicks ?? null;
    case "ctr": return metrics?.ctr ?? null;
    case "position": return metrics?.position ?? null;
    case "potential": return row.potential_clicks;
    case "change": return clickChange(row);
    case "detected": return Date.parse(row.first_detected_at);
  }
}

/** Tri stable ; les valeurs absentes (hypothèses sans métrique) restent en fin de liste quel que soit le sens. */
export function sortOpportunities(rows: SeoOpportunityRow[], key: SortKey, dir: SortDir) {
  const factor = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = value(a, key), right = value(b, key);
    if (left === null && right !== null) return 1;
    if (right === null && left !== null) return -1;
    if (left !== null && right !== null && left !== right) return (left - right) * factor;
    return STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (metricsOf(b.metrics)?.impressions ?? 0) - (metricsOf(a.metrics)?.impressions ?? 0) || a.keyword.localeCompare(b.keyword);
  });
}

export function countByStatus(rows: SeoOpportunityRow[]) {
  const counts: Record<OpportunityStatus, number> = { detected: 0, to_review: 0, approved: 0, in_progress: 0, done: 0, dismissed: 0 };
  for (const row of rows) counts[row.status]++;
  return counts;
}

export const formatPct = (value: number | null | undefined) => typeof value === "number" ? `${(value * 100).toFixed(1).replace(".", ",")} %` : "—";
export const formatPosition = (value: number | null | undefined) => typeof value === "number" ? value.toFixed(1).replace(".", ",") : "—";
export const formatNumber = (value: number | null | undefined) => typeof value === "number" ? new Intl.NumberFormat("fr-FR").format(value) : "—";
export const formatChange = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1).replace(".", ",")} %`;
