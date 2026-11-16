import "server-only";
// Synchronisation Google Analytics 4 d'un client : 30 jours terminés la veille et les 30 précédents, sur la propriété
// associée au client (jamais celle d'un autre). Totaux, canaux, pages de destination × canal, source/support,
// campagnes Google Ads, événements clés et appareils. Écrit un instantané `metric_snapshots` (provider
// google-analytics, metric_key ga4) lu par l'Agent SEO et l'Agent Google Ads. Un bloc refusé est marqué non récupéré,
// jamais complété ; un accès refusé ou un quota épuisé fait échouer toute la synchronisation (rien de partiel).
import { recordSync } from "@/lib/connections/sync";
import { ProviderError, type ProviderErrorKind } from "@/lib/providers/errors";
import { runAnalyticsReport, type ReportRequest } from "@/lib/providers/google-analytics";
import { googleAnalyticsAccess, productionGoogleAnalyticsDeps, type GoogleAnalyticsDeps } from "@/lib/integrations/google-analytics/connection";
import {
  GOOGLE_ANALYTICS_METRIC_KEY, GOOGLE_ANALYTICS_PROVIDER, GOOGLE_ANALYTICS_SNAPSHOT_VERSION, SEGMENT_METRICS, TOTAL_METRICS, analyticsWindow, keyEventsFrom, landingFrom,
  normalizePropertyId, segmentsFrom, totalsFrom, type AnalyticsSectionKey, type AnalyticsSnapshot, type ParsedReport, type Period,
} from "@/lib/integrations/google-analytics/model";
import type { Json } from "@/lib/supabase/database.types";

type Db = GoogleAnalyticsDeps["db"];
export type AnalyticsSyncResult = { ok: true; snapshot: AnalyticsSnapshot; warning: string | null } | { ok: false; reason: "no_property" | "not_connected" | "unavailable"; error: string | null; kind?: ProviderErrorKind };

const errorMessage = (error: unknown) => error instanceof ProviderError ? error.message : "Synchronisation Google Analytics indisponible.";
const FATAL: ProviderErrorKind[] = ["unauthorized", "rate_limited", "not_configured"];

/** Propriété GA4 associée au client, ou null. */
export async function clientAnalyticsProperty(db: Db, clientId: string): Promise<string | null> {
  const { data, error } = await db.from("client_connections").select("metadata").eq("client_id", clientId).eq("provider", GOOGLE_ANALYTICS_PROVIDER).maybeSingle();
  if (error) throw new Error("google analytics property read");
  const metadata = data?.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata) ? data.metadata as Record<string, unknown> : {};
  return normalizePropertyId(metadata.property);
}

/** Exécute des tâches avec une concurrence bornée (10 requêtes simultanées max côté Google, on reste à 3). */
async function limited<T>(tasks: (() => Promise<T>)[], concurrency = 3): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (next < tasks.length) {
      const index = next++;
      try { results[index] = { status: "fulfilled", value: await tasks[index]() }; } catch (reason) { results[index] = { status: "rejected", reason }; }
    }
  }));
  return results;
}

/** Demandes d'un instantané : l'ordre fixe celui des sections. */
export function snapshotRequests(period: Period, previous: Period): [AnalyticsSectionKey, ReportRequest][] {
  return [
    ["totals", { period, dimensions: [], metrics: TOTAL_METRICS, limit: 1 }],
    ["previousTotals", { period: previous, dimensions: [], metrics: TOTAL_METRICS, limit: 1 }],
    ["channels", { period, dimensions: ["sessionDefaultChannelGroup"], metrics: SEGMENT_METRICS, limit: 25 }],
    ["previousChannels", { period: previous, dimensions: ["sessionDefaultChannelGroup"], metrics: SEGMENT_METRICS, limit: 25 }],
    ["landingPages", { period, dimensions: ["landingPage", "sessionDefaultChannelGroup"], metrics: SEGMENT_METRICS, limit: 250 }],
    ["sourceMedium", { period, dimensions: ["sessionSourceMedium"], metrics: SEGMENT_METRICS, limit: 30 }],
    ["adsCampaigns", { period, dimensions: ["sessionGoogleAdsCampaignName"], metrics: SEGMENT_METRICS, limit: 50 }],
    ["keyEvents", { period, dimensions: ["eventName"], metrics: ["keyEvents"], limit: 50 }],
    ["devices", { period, dimensions: ["deviceCategory"], metrics: SEGMENT_METRICS, limit: 10 }],
  ];
}

export async function syncGoogleAnalytics(clientId: string, deps: GoogleAnalyticsDeps = productionGoogleAnalyticsDeps(), now = new Date()): Promise<AnalyticsSyncResult> {
  const property = await clientAnalyticsProperty(deps.db, clientId);
  if (!property) return { ok: false, reason: "no_property", error: null };
  const access = await googleAnalyticsAccess(deps);
  if (!access) return { ok: false, reason: "not_connected", error: null };
  const { period, previous } = analyticsWindow(now);
  const requests = snapshotRequests(period, previous);
  try {
    const results = await limited<ParsedReport>(requests.map(([, request]) => () => runAnalyticsReport(property, request, { accessToken: access.accessToken, fetchImpl: deps.fetchImpl })));
    for (const result of results) if (result.status === "rejected" && result.reason instanceof ProviderError && FATAL.includes(result.reason.kind)) throw result.reason;
    if (results[0].status === "rejected") throw results[0].reason; // sans totaux, l'instantané n'a pas de sens
    const sections: AnalyticsSnapshot["sections"] = {};
    const reports = {} as Record<AnalyticsSectionKey, ParsedReport | null>;
    requests.forEach(([key], index) => {
      const result = results[index];
      sections[key] = result.status === "fulfilled" ? { ok: true } : { ok: false, error: errorMessage(result.reason) };
      reports[key] = result.status === "fulfilled" ? result.value : null;
    });
    const snapshot: AnalyticsSnapshot = {
      version: GOOGLE_ANALYTICS_SNAPSHOT_VERSION, property, period, previousPeriod: previous,
      totals: totalsFrom(reports.totals), previousTotals: totalsFrom(reports.previousTotals),
      channels: segmentsFrom(reports.channels, 25), previousChannels: segmentsFrom(reports.previousChannels, 25),
      landingPages: landingFrom(reports.landingPages, 250), sourceMedium: segmentsFrom(reports.sourceMedium, 30),
      adsCampaigns: segmentsFrom(reports.adsCampaigns, 50), keyEvents: keyEventsFrom(reports.keyEvents), devices: segmentsFrom(reports.devices, 10),
      thresholded: Object.values(reports).some((report) => report?.thresholded || report?.otherRow), sections,
    };
    const { error: writeError } = await deps.db.from("metric_snapshots").upsert({
      client_id: clientId, provider: GOOGLE_ANALYTICS_PROVIDER, metric_key: GOOGLE_ANALYTICS_METRIC_KEY, period_start: period.start, period_end: period.end, data: snapshot as unknown as Json, fetched_at: now.toISOString(),
    }, { onConflict: "client_id,provider,metric_key,period_start,period_end" });
    if (writeError) throw new Error("google analytics snapshot write");
    const failed = Object.entries(sections).filter(([, status]) => status && !status.ok).map(([key]) => key);
    const warning = failed.length ? `Google Analytics : blocs non récupérés (${failed.join(", ")}).` : null;
    await recordSync(clientId, GOOGLE_ANALYTICS_PROVIDER, null, { warning });
    return { ok: true, snapshot, warning };
  } catch (failure) {
    await recordSync(clientId, GOOGLE_ANALYTICS_PROVIDER, failure instanceof ProviderError ? failure : new Error("Synchronisation Google Analytics indisponible."));
    if (!(failure instanceof ProviderError)) console.error("[google-analytics] sync", { kind: "internal" });
    return { ok: false, reason: "unavailable", error: errorMessage(failure), ...(failure instanceof ProviderError ? { kind: failure.kind } : {}) };
  }
}

const parisDay = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const RETRY_MS = 3 * 3_600_000;

/** Client à synchroniser maintenant : pas encore réussi aujourd'hui (jour de Paris) et pas d'essai dans les 3 dernières heures. */
export function analyticsSyncDue(row: { last_sync_at?: string | null; last_checked_at?: string | null }, now: Date) {
  if (row.last_sync_at && parisDay(new Date(row.last_sync_at)) === parisDay(now)) return false;
  return !row.last_checked_at || now.getTime() - Date.parse(row.last_checked_at) >= RETRY_MS;
}

/**
 * Synchronisation quotidienne (planificateur) : chaque client ayant une propriété GA4 est synchronisé au plus une fois
 * par jour, avec au plus un essai toutes les 3 heures en cas d'échec, dans un budget de temps borné.
 */
export async function syncDueGoogleAnalytics(now = new Date(), options: { budgetMs?: number; deps?: GoogleAnalyticsDeps } = {}) {
  const summary = { synced: 0, failed: 0, pending: 0 };
  const deps = options.deps ?? productionGoogleAnalyticsDeps();
  if (!await googleAnalyticsAccess(deps)) return summary;
  const started = Date.now(), budget = options.budgetMs ?? 40_000;
  const { data, error } = await deps.db.from("client_connections").select("id,client_id,metadata,last_sync_at,last_checked_at").eq("provider", GOOGLE_ANALYTICS_PROVIDER).not("client_id", "is", null).order("last_sync_at", { ascending: true, nullsFirst: true }).limit(200);
  if (error) throw new Error("google analytics clients read");
  for (const row of data ?? []) {
    if (!row.client_id || !normalizePropertyId((row.metadata as Record<string, unknown> | null)?.property) || !analyticsSyncDue(row, now)) continue;
    if (Date.now() - started > budget) { summary.pending++; continue; }
    await deps.db.from("client_connections").update({ last_checked_at: now.toISOString() }).eq("id", row.id).then(() => undefined, () => undefined);
    const result = await syncGoogleAnalytics(row.client_id, deps, now);
    if (result.ok) summary.synced++; else summary.failed++;
  }
  return summary;
}

/** Dernier instantané GA4 d'un client, s'il date de moins de `maxAgeDays` (lecture seule, aucun appel Google). */
export async function latestAnalyticsSnapshot(db: Db, clientId: string, maxAgeDays = 10): Promise<{ data: unknown; fetchedAt: string } | null> {
  const since = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
  const { data, error } = await db.from("metric_snapshots").select("data,fetched_at").eq("client_id", clientId).eq("provider", GOOGLE_ANALYTICS_PROVIDER).eq("metric_key", GOOGLE_ANALYTICS_METRIC_KEY)
    .gte("fetched_at", since).order("fetched_at", { ascending: false }).limit(1).maybeSingle();
  if (error || !data) return null;
  return { data: data.data, fetchedAt: data.fetched_at };
}
