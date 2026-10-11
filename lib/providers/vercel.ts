import "server-only";
// Vercel : déploiements + Web Analytics en lecture seule.
import { providerJson, type FetchLike } from "@/lib/providers/api";
import { ProviderError } from "@/lib/providers/errors";

type Env = Record<string, string | undefined>;
export type Deployment = { id: string; state: string; createdAt: number; url: string | null; target: string | null };
export type VercelAnalyticsRow = { label: string; pageviews?: number; visitors?: number; count?: number };
export type VercelAnalyticsTrendPoint = { timestamp: string; pageviews: number; visitors: number };
export type VercelAnalyticsSummary = {
  projectId: string;
  period: { start: string; end: string };
  pageviews: number;
  visitors: number;
  trend: VercelAnalyticsTrendPoint[];
  topPages: VercelAnalyticsRow[];
  topReferrers: VercelAnalyticsRow[];
  routes: VercelAnalyticsRow[];
  countries: VercelAnalyticsRow[];
  devices: VercelAnalyticsRow[];
  operatingSystems: VercelAnalyticsRow[];
  browsers: VercelAnalyticsRow[];
  events: VercelAnalyticsRow[];
};

const projectPattern = /^(?:prj_[A-Za-z0-9]{6,64}|[A-Za-z0-9_.-]{1,100})$/;
const day = /^\d{4}-\d{2}-\d{2}$/;
type VisitDimension = "requestPath" | "route" | "country" | "deviceType" | "osName" | "browserName" | "referrerHostname";

function assertProject(projectId: string) {
  if (!projectPattern.test(projectId) || projectId.includes("..")) throw new ProviderError("vercel", "blocked");
}

function headers(env: Env) {
  if (!env.VERCEL_TOKEN) throw new ProviderError("vercel", "not_configured");
  return { Authorization: `Bearer ${env.VERCEL_TOKEN}` };
}

function commonParams(projectId: string, env: Env, period?: { start: string; end: string }) {
  assertProject(projectId);
  const params = new URLSearchParams({ projectId });
  if (env.VERCEL_TEAM_ID) params.set("teamId", env.VERCEL_TEAM_ID);
  if (period) {
    if (!day.test(period.start) || !day.test(period.end) || period.start > period.end) throw new ProviderError("vercel", "blocked");
    params.set("since", period.start);
    params.set("until", period.end);
  }
  return params;
}

export async function latestDeployment(projectId: string, options: { env?: Env; fetchImpl?: FetchLike } = {}): Promise<Deployment | null> {
  const env = options.env ?? process.env;
  const params = commonParams(projectId, env);
  params.set("limit", "1");
  const data = await providerJson<{ deployments?: unknown }>("vercel", `https://api.vercel.com/v6/deployments?${params}`, { fetchImpl: options.fetchImpl, headers: headers(env) });
  if (!Array.isArray(data.deployments)) throw new ProviderError("vercel", "malformed");
  const first = data.deployments[0] as Record<string, unknown> | undefined;
  if (!first) return null;
  if (typeof first.uid !== "string" || typeof first.state !== "string") throw new ProviderError("vercel", "malformed");
  return { id: first.uid, state: first.state, createdAt: Number(first.created ?? 0), url: typeof first.url === "string" ? first.url : null, target: typeof first.target === "string" ? first.target : null };
}

type CountResponse = { data?: { pageviews?: unknown; visitors?: unknown; count?: unknown } };
type AggregateResponse = { data?: unknown };
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0;

export async function webAnalyticsCount(
  projectId: string,
  period: { start: string; end: string },
  options: { env?: Env; fetchImpl?: FetchLike } = {},
): Promise<{ pageviews: number; visitors: number }> {
  const env = options.env ?? process.env;
  const params = commonParams(projectId, env, period);
  const count = await providerJson<CountResponse>("vercel", `https://api.vercel.com/v1/query/web-analytics/visits/count?${params}`, { fetchImpl: options.fetchImpl, headers: headers(env) });
  if (!count.data || typeof count.data !== "object") throw new ProviderError("vercel", "malformed");
  return { pageviews: finite(count.data.pageviews), visitors: finite(count.data.visitors) };
}

async function aggregate(
  projectId: string,
  period: { start: string; end: string },
  by: VisitDimension | "eventName",
  dataset: "visits" | "events",
  options: { env?: Env; fetchImpl?: FetchLike; limit?: number } = {},
): Promise<VercelAnalyticsRow[]> {
  const env = options.env ?? process.env;
  const params = commonParams(projectId, env, period);
  params.set("by", by);
  params.set("limit", String(Math.max(1, Math.min(options.limit ?? 20, 50))));
  const data = await providerJson<AggregateResponse>("vercel", `https://api.vercel.com/v1/query/web-analytics/${dataset}/aggregate?${params}`, { fetchImpl: options.fetchImpl, headers: headers(env) });
  if (!Array.isArray(data.data)) throw new ProviderError("vercel", "malformed");
  return data.data.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const row = raw as Record<string, unknown>;
    const label = row[by];
    if (typeof label !== "string" || !label) return [];
    return [{ label, pageviews: dataset === "visits" ? finite(row.pageviews) : undefined, visitors: finite(row.visitors), count: dataset === "events" ? finite(row.count) : undefined }];
  });
}

async function dailyTrend(
  projectId: string,
  period: { start: string; end: string },
  options: { env?: Env; fetchImpl?: FetchLike; limit?: number } = {},
): Promise<VercelAnalyticsTrendPoint[]> {
  const env = options.env ?? process.env;
  const params = commonParams(projectId, env, period);
  params.set("by", "day");
  params.set("limit", "366");
  const data = await providerJson<AggregateResponse>("vercel", `https://api.vercel.com/v1/query/web-analytics/visits/aggregate?${params}`, { fetchImpl: options.fetchImpl, headers: headers(env) });
  if (!Array.isArray(data.data)) throw new ProviderError("vercel", "malformed");
  return data.data.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const row = raw as Record<string, unknown>;
    if (typeof row.timestamp !== "string") return [];
    return [{ timestamp: row.timestamp, pageviews: finite(row.pageviews), visitors: finite(row.visitors) }];
  });
}

async function optionalAggregate(
  projectId: string,
  period: { start: string; end: string },
  by: VisitDimension,
  options: { env?: Env; fetchImpl?: FetchLike; limit?: number },
) {
  try { return await aggregate(projectId, period, by, "visits", options); }
  catch (error) {
    if (error instanceof ProviderError && ["unauthorized", "not_configured", "rate_limited", "timeout"].includes(error.kind)) throw error;
    return [];
  }
}

export async function webAnalyticsSummary(
  projectId: string,
  period: { start: string; end: string },
  options: { env?: Env; fetchImpl?: FetchLike; limit?: number } = {},
): Promise<VercelAnalyticsSummary> {
  const [count, trend, topPages, topReferrers, routes, countries, devices, operatingSystems, browsers, events] = await Promise.all([
    webAnalyticsCount(projectId, period, options),
    dailyTrend(projectId, period, options),
    aggregate(projectId, period, "requestPath", "visits", options),
    aggregate(projectId, period, "referrerHostname", "visits", options),
    optionalAggregate(projectId, period, "route", options),
    optionalAggregate(projectId, period, "country", options),
    optionalAggregate(projectId, period, "deviceType", options),
    optionalAggregate(projectId, period, "osName", options),
    optionalAggregate(projectId, period, "browserName", options),
    aggregate(projectId, period, "eventName", "events", options),
  ]);
  return {
    projectId, period, ...count, trend, topPages, topReferrers, routes, countries, devices, operatingSystems, browsers, events,
  };
}
