import "server-only";
// Google Analytics 4 (lecture seule, scope analytics.readonly) : Admin API pour découvrir les propriétés accessibles,
// Data API (runReport) pour les rapports. Jeton : connexion OAuth de CODE-V OS (lib/integrations/google-analytics/
// connection.ts). Le jeton n'est jamais journalisé ni renvoyé ; une erreur garde le type normalisé (ProviderError).
import { providerJson, type FetchLike } from "@/lib/providers/api";
import { ProviderError } from "@/lib/providers/errors";
import { normalizeAccountSummaries, normalizePropertyId, parseReport, type DiscoveredAnalyticsProperty, type ParsedReport, type Period } from "@/lib/integrations/google-analytics/model";

type Options = { accessToken: () => Promise<string>; fetchImpl?: FetchLike };
const ADMIN = "https://analyticsadmin.googleapis.com/v1beta";
const DATA = "https://analyticsdata.googleapis.com/v1beta";
const day = /^\d{4}-\d{2}-\d{2}$/;
const name = /^[a-zA-Z][a-zA-Z0-9_]{1,60}$/;

/** Propriétés GA4 accessibles au compte Google connecté (pagination bornée à 10 pages de 200). */
export async function listAnalyticsProperties(options: Options): Promise<DiscoveredAnalyticsProperty[]> {
  const token = await options.accessToken();
  const summaries: unknown[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < 10; page++) {
    const url = new URL(`${ADMIN}/accountSummaries`);
    url.searchParams.set("pageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const data = await providerJson<{ accountSummaries?: unknown; nextPageToken?: unknown }>("google-analytics", url.toString(), { fetchImpl: options.fetchImpl, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (data.accountSummaries !== undefined && !Array.isArray(data.accountSummaries)) throw new ProviderError("google-analytics", "malformed");
    summaries.push(...((data.accountSummaries as unknown[] | undefined) ?? []));
    pageToken = typeof data.nextPageToken === "string" && data.nextPageToken && data.nextPageToken.length < 2000 ? data.nextPageToken : null;
    if (!pageToken) break;
  }
  return normalizeAccountSummaries({ accountSummaries: summaries });
}

export type ReportRequest = {
  period: Period; dimensions: string[]; metrics: readonly string[]; limit?: number;
  /** Tri décroissant sur une métrique (par défaut la première). */
  orderBy?: string;
};

/** Rapport GA4 (une période). Les jours sont ceux du fuseau horaire de la propriété. */
export async function runAnalyticsReport(propertyId: string, request: ReportRequest, options: Options): Promise<ParsedReport> {
  const property = normalizePropertyId(propertyId);
  if (!property || property !== propertyId || !day.test(request.period.start) || !day.test(request.period.end) || request.period.start > request.period.end) throw new ProviderError("google-analytics", "blocked");
  if (request.dimensions.length > 3 || !request.metrics.length || request.metrics.length > 10 || [...request.dimensions, ...request.metrics].some((item) => !name.test(item))) throw new ProviderError("google-analytics", "blocked");
  const token = await options.accessToken();
  const body = await providerJson<unknown>("google-analytics", `${DATA}/properties/${property}:runReport`, {
    method: "POST", fetchImpl: options.fetchImpl, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: request.period.start, endDate: request.period.end }],
      dimensions: request.dimensions.map((item) => ({ name: item })), metrics: request.metrics.map((item) => ({ name: item })),
      limit: String(Math.max(1, Math.min(request.limit ?? 100, 10_000))), keepEmptyRows: false,
      orderBys: [{ metric: { metricName: request.orderBy ?? request.metrics[0] }, desc: true }],
    }),
  });
  const parsed = parseReport(body, request.dimensions.length, request.metrics.length);
  if (!parsed) throw new ProviderError("google-analytics", "malformed");
  return parsed;
}
