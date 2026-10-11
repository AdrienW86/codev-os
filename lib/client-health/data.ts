import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

type SearchConsoleSummary = {
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number | null;
  previous_clicks?: number;
};

type SeoOpportunity = {
  kind: "page_drop" | "page_growth" | "emerging_query" | "low_ctr";
  key: string;
  detail: string;
  severity: "low" | "medium" | "high";
  metrics?: { clicks?: number; priorClicks?: number; impressions?: number; priorImpressions?: number; ctr?: number; position?: number };
  suggestedAction?: string;
};

type PageSpeedSummary = {
  performance?: number | null;
  lcpMs?: number | null;
  cls?: number | null;
  inpMs?: number | null;
};

export type ClientHealthOverview = {
  searchConsole: { fetchedAt: string; periodStart: string; periodEnd: string; data: SearchConsoleSummary } | null;
  pageSpeed: { fetchedAt: string; data: PageSpeedSummary } | null;
  siteCheck: { checkedAt: string; ok: boolean; statusCode: number | null; responseMs: number | null; errorKind: string | null; url: string } | null;
  incidents: { id: string; title: string; severity: string; status: string; detectedAt: string; source: string }[];
  runs: { id: string; runType: string; status: string; summary: string | null; startedAt: string }[];
  opportunities: { fetchedAt: string; periodStart: string; periodEnd: string; findings: (SeoOpportunity & { recommendationId?: string })[]; counts: Record<string, number> } | null;
};

const object = (value: Json | null): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export async function getClientHealthOverview(clientId: string): Promise<ClientHealthOverview> {
  const db = getSupabaseServerClient();
  const [search, speed, site, incidents, runs, opportunities, recommendations] = await Promise.all([
    db.from("metric_snapshots").select("period_start,period_end,fetched_at,data").eq("client_id", clientId).eq("provider", "search-console").eq("metric_key", "summary").order("fetched_at", { ascending: false }).limit(1),
    db.from("metric_snapshots").select("fetched_at,data").eq("client_id", clientId).eq("provider", "pagespeed").eq("metric_key", "mobile").order("fetched_at", { ascending: false }).limit(1),
    db.from("site_checks").select("checked_at,ok,status_code,response_ms,error_kind,url").eq("client_id", clientId).order("checked_at", { ascending: false }).limit(1),
    db.from("incidents").select("id,title,severity,status,detected_at,source").eq("client_id", clientId).in("source", ["monitoring", "seo"]).neq("status", "resolved").order("detected_at", { ascending: false }).limit(10),
    db.from("agent_runs").select("id,status,summary,started_at,metadata").eq("client_id", clientId).order("started_at", { ascending: false }).limit(20),
    db.from("metric_snapshots").select("period_start,period_end,fetched_at,data").eq("client_id", clientId).eq("provider", "search-console").eq("metric_key", "opportunities").order("fetched_at", { ascending: false }).limit(1),
    db.from("recommendations").select("id,payload,status").eq("client_id", clientId).eq("status", "pending").order("created_at", { ascending: false }).limit(50),
  ]);

  if (search.error || speed.error || site.error || incidents.error || runs.error || opportunities.error || recommendations.error) throw new Error("client health read");

  const searchRow = search.data?.[0];
  const speedRow = speed.data?.[0];
  const siteRow = site.data?.[0];
  const opportunityRow = opportunities.data?.[0];
  const opportunityData = opportunityRow ? object(opportunityRow.data) : {};
  const rawFindings = Array.isArray(opportunityData.findings) ? opportunityData.findings : [];
  const recommendationByFinding = new Map<string, string>();
  for (const item of recommendations.data ?? []) {
    const payload = object(item.payload);
    const kind = typeof payload.kind === "string" ? payload.kind : "";
    const key = typeof payload.key === "string" ? payload.key : "";
    if (kind && key && !recommendationByFinding.has(`${kind}:${key}`)) recommendationByFinding.set(`${kind}:${key}`, item.id);
  }

  return {
    searchConsole: searchRow ? {
      fetchedAt: searchRow.fetched_at,
      periodStart: searchRow.period_start,
      periodEnd: searchRow.period_end,
      data: object(searchRow.data) as SearchConsoleSummary,
    } : null,
    pageSpeed: speedRow ? {
      fetchedAt: speedRow.fetched_at,
      data: object(speedRow.data) as PageSpeedSummary,
    } : null,
    siteCheck: siteRow ? {
      checkedAt: siteRow.checked_at,
      ok: siteRow.ok,
      statusCode: siteRow.status_code,
      responseMs: siteRow.response_ms,
      errorKind: siteRow.error_kind,
      url: siteRow.url,
    } : null,
    incidents: (incidents.data ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      severity: item.severity,
      status: item.status,
      detectedAt: item.detected_at,
      source: item.source,
    })),
    opportunities: opportunityRow ? {
      fetchedAt: opportunityRow.fetched_at,
      periodStart: opportunityRow.period_start,
      periodEnd: opportunityRow.period_end,
      findings: rawFindings.flatMap((value) => {
        const item = object(value as Json);
        const kind = item.kind;
        const key = item.key;
        const detail = item.detail;
        const severity = item.severity;
        if (!["page_drop", "page_growth", "emerging_query", "low_ctr"].includes(String(kind)) || typeof key !== "string" || typeof detail !== "string" || !["low", "medium", "high"].includes(String(severity))) return [];
        const finding = item as unknown as SeoOpportunity;
        return [{ ...finding, recommendationId: recommendationByFinding.get(`${finding.kind}:${finding.key}`) }];
      }),
      counts: object(opportunityData.counts as Json) as Record<string, number>,
    } : null,
    runs: (runs.data ?? []).flatMap((item) => {
      const metadata = object(item.metadata);
      const runType = typeof metadata.run_type === "string" ? metadata.run_type : "";
      if (runType !== "seo.analyze" && runType !== "monitoring.check_sites") return [];
      return [{
        id: item.id,
        runType,
        status: item.status,
        summary: item.summary,
        startedAt: item.started_at,
      }];
    }).slice(0, 8),
  };
}
