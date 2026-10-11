import "server-only";
// Vercel : déploiements + Web Analytics en lecture seule.
import { providerJson, type FetchLike } from "@/lib/providers/api";
import { ProviderError } from "@/lib/providers/errors";

type Env = Record<string, string | undefined>;
export type Deployment = { id: string; state: string; createdAt: number; url: string | null; target: string | null };
export type VercelAnalyticsRow = { label: string; pageviews?: number; visitors?: number; count?: number };
export type VercelAnalyticsSummary = {
  projectId: string;
  period: { start: string; end: string };
  pageviews: number;
  visitors: number;
  topPages: VercelAnalyticsRow[];
  topReferrers: VercelAnalyticsRow[];
  events: VercelAnalyticsRow[];
};

const projectPattern = /^(?:prj_[A-Za-z0-9]{6,64}|[A-Za-z0-9_.-]{1,100})$/;
const day = /^\d{4}-\d{2}-\d{2}$/;

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

async function aggregate(
  projectId: string,
  period: { start: string; end: string },
  by: "requestPath" | "referrerHostname" | "eventName",
  dataset: "visits" | "events",
  options: { env?: Env; fetchImpl?: FetchLike; limit?: number } = {},
): Promise<VercelAnalyticsRow[]> {
  const env = options.env ?? process.env;
  const params = commonParams(projectId, env, period);
  params.set("by", by);
  params.set("limit", String(Math.max(1, Math.min(options.limit ?? 10, 25))));
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

export async function webAnalyticsSummary(
  projectId: string,
  period: { start: string; end: string },
  options: { env?: Env; fetchImpl?: FetchLike; limit?: number } = {},
): Promise<VercelAnalyticsSummary> {
  const env = options.env ?? process.env;
  const params = commonParams(projectId, env, period);
  const [count, topPages, topReferrers, events] = await Promise.all([
    providerJson<CountResponse>("vercel", `https://api.vercel.com/v1/query/web-analytics/visits/count?${params}`, { fetchImpl: options.fetchImpl, headers: headers(env) }),
    aggregate(projectId, period, "requestPath", "visits", options),
    aggregate(projectId, period, "referrerHostname", "visits", options),
    aggregate(projectId, period, "eventName", "events", options),
  ]);
  if (!count.data || typeof count.data !== "object") throw new ProviderError("vercel", "malformed");
  return {
    projectId,
    period,
    pageviews: finite(count.data.pageviews),
    visitors: finite(count.data.visitors),
    topPages,
    topReferrers,
    events,
  };
}
