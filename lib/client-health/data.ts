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
};

const object = (value: Json | null): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export async function getClientHealthOverview(clientId: string): Promise<ClientHealthOverview> {
  const db = getSupabaseServerClient();
  const [search, speed, site, incidents, runs] = await Promise.all([
    db.from("metric_snapshots").select("period_start,period_end,fetched_at,data").eq("client_id", clientId).eq("provider", "search-console").eq("metric_key", "summary").order("fetched_at", { ascending: false }).limit(1),
    db.from("metric_snapshots").select("fetched_at,data").eq("client_id", clientId).eq("provider", "pagespeed").eq("metric_key", "mobile").order("fetched_at", { ascending: false }).limit(1),
    db.from("site_checks").select("checked_at,ok,status_code,response_ms,error_kind,url").eq("client_id", clientId).order("checked_at", { ascending: false }).limit(1),
    db.from("incidents").select("id,title,severity,status,detected_at,source").eq("client_id", clientId).in("source", ["monitoring", "seo"]).neq("status", "resolved").order("detected_at", { ascending: false }).limit(10),
    db.from("agent_runs").select("id,run_type,status,summary,started_at").eq("client_id", clientId).in("run_type", ["seo.analyze", "monitoring.check_sites"]).order("started_at", { ascending: false }).limit(8),
  ]);

  if (search.error || speed.error || site.error || incidents.error || runs.error) throw new Error("client health read");

  const searchRow = search.data?.[0];
  const speedRow = speed.data?.[0];
  const siteRow = site.data?.[0];

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
    runs: (runs.data ?? []).map((item) => ({
      id: item.id,
      runType: item.run_type,
      status: item.status,
      summary: item.summary,
      startedAt: item.started_at,
    })),
  };
}
