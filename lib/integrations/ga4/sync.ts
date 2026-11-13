import "server-only";
import { ga4RunReport, parseGa4Daily, parseGa4Dimensions, parseGa4Events, parseGa4Totals } from "@/lib/integrations/ga4/api";
import { ga4AccessToken, ga4Deps, type Ga4Deps } from "@/lib/integrations/ga4/connection";
import { GA4_PROVIDER, GA4_METRIC_KEY, GA4_SNAPSHOT_VERSION, normalizeGa4Property, type Ga4Snapshot } from "@/lib/integrations/ga4/model";
import { recordSync } from "@/lib/connections/sync";
import { ProviderError } from "@/lib/providers/errors";
import type { Json } from "@/lib/supabase/database.types";

type Period = { start: string; end: string };
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
export function ga4PeriodValid(p: Period) {
  if (!dayPattern.test(p.start) || !dayPattern.test(p.end) || p.start > p.end) return false;
  const days = (Date.parse(p.end + "T00:00:00Z") - Date.parse(p.start + "T00:00:00Z")) / 86400000 + 1;
  return Number.isInteger(days) && days > 0 && days <= 366 && p.end <= new Date().toISOString().slice(0, 10);
}
export type Ga4SyncResult =
  | { ok: true; snapshot: Ga4Snapshot; warning: string | null }
  | { ok: false; reason: "not_connected" | "no_property" | "invalid" | "unavailable"; error: string };

export async function syncGa4(clientId: string, period: Period, deps: Ga4Deps = ga4Deps()): Promise<Ga4SyncResult> {
  if (!/^[0-9a-f-]{36}$/i.test(clientId) || !ga4PeriodValid(period))
    return { ok: false, reason: "invalid", error: "Identifiant client ou période invalide." };
  const { data: assigned, error: assignedError } = await deps.db.from("client_connections")
    .select("metadata").eq("client_id", clientId).eq("provider", GA4_PROVIDER).maybeSingle();
  if (assignedError) return { ok: false, reason: "unavailable", error: "Lecture de la source GA4 impossible." };
  const property = normalizeGa4Property((assigned?.metadata as Record<string, unknown> | null)?.property_id);
  if (!property) return { ok: false, reason: "no_property", error: "Aucune propriété GA4 associée au client." };
  try {
    const token = await ga4AccessToken(deps);
    if (!token) return { ok: false, reason: "not_connected", error: "Google Analytics doit être connecté dans Paramètres → Connexions." };
    const dateRanges = [{ startDate: period.start, endDate: period.end }];
    const base = { dateRanges, keepEmptyRows: false };
    const reports = [
      { ...base, metrics: ["sessions", "activeUsers", "screenPageViews", "engagedSessions", "engagementRate", "bounceRate", "eventCount"].map(name => ({ name })) },
      { ...base, dimensions: [{ name: "date" }], metrics: [{ name: "sessions" }, { name: "activeUsers" }], orderBys: [{ dimension: { dimensionName: "date" } }], limit: "366" },
      { ...base, dimensions: [{ name: "landingPagePlusQueryString" }], metrics: [{ name: "sessions" }, { name: "engagementRate" }, { name: "bounceRate" }], orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: "25" },
      { ...base, dimensions: [{ name: "sessionDefaultChannelGroup" }], metrics: [{ name: "sessions" }, { name: "engagementRate" }, { name: "bounceRate" }], orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: "25" },
      { ...base, dimensions: [{ name: "deviceCategory" }], metrics: [{ name: "sessions" }, { name: "engagementRate" }, { name: "bounceRate" }], orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: "10" },
      { ...base, dimensions: [{ name: "eventName" }], metrics: [{ name: "eventCount" }], orderBys: [{ metric: { metricName: "eventCount" }, desc: true }], limit: "40" },
    ];
    // Le premier rapport est indispensable ; les dimensions facultatives échouent isolément.
    const totals = await ga4RunReport(token, property, reports[0], deps.fetchImpl);
    const names = ["daily", "pages", "channels", "devices", "events"] as const;
    const optional = await Promise.allSettled(reports.slice(1).map(report => ga4RunReport(token, property, report, deps.fetchImpl)));
    const sections: Ga4Snapshot["sections"] = { totals: { ok: true } };
    for (let i = 0; i < optional.length; i++) {
      const result = optional[i];
      sections[names[i]] = result.status === "fulfilled" ? { ok: true } : { ok: false, error: "API Analytics indisponible pour cette section." };
    }
    const get = (i: number) => { const result = optional[i]; return result?.status === "fulfilled" ? result.value : { rows: [] }; };
    const snapshot: Ga4Snapshot = {
      version: GA4_SNAPSHOT_VERSION,
      property, period, totals: parseGa4Totals(totals),
      daily: parseGa4Daily(get(0)), pages: parseGa4Dimensions(get(1)),
      channels: parseGa4Dimensions(get(2)), devices: parseGa4Dimensions(get(3)),
      events: parseGa4Events(get(4)), sections,
    };
    const { error: saveError } = await deps.db.from("metric_snapshots").upsert({
      client_id: clientId, provider: GA4_PROVIDER, metric_key: GA4_METRIC_KEY,
      period_start: period.start, period_end: period.end, data: snapshot as unknown as Json,
      fetched_at: new Date().toISOString(),
    }, { onConflict: "client_id,provider,metric_key,period_start,period_end" });
    if (saveError) throw new Error("snapshot write");
    const warning = Object.values(sections).some(x => !x.ok) ? "Certaines sections GA4 sont indisponibles." : null;
    await recordSync(clientId, GA4_PROVIDER, null, { warning }).catch(() => undefined);
    return { ok: true, snapshot, warning };
  } catch (error) {
    const message = error instanceof ProviderError
      ? error.kind === "unauthorized" ? "Autorisation GA4 refusée ou expirée." : error.kind === "rate_limited" ? "Quota de Google Analytics atteint." : "Lecture des données GA4 indisponible."
      : "Synchronisation des données GA4 indisponible.";
    await recordSync(clientId, GA4_PROVIDER, new Error(message)).catch(() => undefined);
    return { ok: false, reason: "unavailable", error: message };
  }
}
