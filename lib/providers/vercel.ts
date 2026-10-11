import "server-only";
// Vercel : déploiements + Web Analytics en lecture seule.
import { providerJson, type FetchLike } from "@/lib/providers/api";
import { ProviderError } from "@/lib/providers/errors";

type Env = Record<string, string | undefined>;
export type Deployment = { id: string; state: string; createdAt: number; url: string | null; target: string | null };
export type VercelAnalyticsRow = { label: string; pageviews?: number; visitors?: number; count?: number };
export type VercelAnalyticsTrendPoint = { timestamp: string; pageviews: number; visitors: number };
export type VercelAnalyticsEventTrendPoint = { timestamp: string; count: number; visitors: number };
export type VercelAnalyticsSummary = {
  projectId: string;
  period: { start: string; end: string };
  pageviews: number;
  visitors: number;
  trend: VercelAnalyticsTrendPoint[];
  eventTrend: VercelAnalyticsEventTrendPoint[];
  topPages: VercelAnalyticsRow[];
  topReferrers: VercelAnalyticsRow[];
  routes: VercelAnalyticsRow[];
  countries: VercelAnalyticsRow[];
  devices: VercelAnalyticsRow[];
  operatingSystems: VercelAnalyticsRow[];
  browsers: VercelAnalyticsRow[];
  events: VercelAnalyticsRow[];
  /** Statut de chaque bloc complémentaire (absent des instantanés antérieurs à ce format). */
  sections: Partial<Record<AnalyticsSection, AnalyticsSectionStatus>>;
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
type Period = { start: string; end: string };
type QueryOptions = { env?: Env; fetchImpl?: FetchLike; limit?: number; now?: Date };
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0;

/** Plus grande valeur de `limit` acceptée par les requêtes historiques qui ont fonctionné (≤ 25). */
export const MAX_AGGREGATE_LIMIT = 25;
/** Une requête quotidienne couvre au plus 25 jours : 25 lignes maximum, sans dépasser `MAX_AGGREGATE_LIMIT`. */
export const TREND_WINDOW_DAYS = 25;
const DAY_MS = 86_400_000;

/**
 * Bornes horaires explicites (UTC) : `since` au début du premier jour, `until` à la fin du dernier jour,
 * plafonné à maintenant. Une simple date « AAAA-MM-JJ » en `until` s'arrête à minuit et exclut le dernier jour.
 */
function rangeParams(params: URLSearchParams, period: Period, now = new Date()) {
  const since = Date.parse(`${period.start}T00:00:00.000Z`);
  const until = Math.max(since, Math.min(Date.parse(`${period.end}T23:59:59.999Z`), now.getTime()));
  params.set("since", new Date(since).toISOString());
  params.set("until", new Date(until).toISOString());
}

function periodParams(projectId: string, env: Env, period: Period, options: QueryOptions) {
  const params = commonParams(projectId, env, period);
  rangeParams(params, period, options.now);
  return params;
}

export async function webAnalyticsCount(projectId: string, period: Period, options: QueryOptions = {}): Promise<{ pageviews: number; visitors: number }> {
  const env = options.env ?? process.env;
  const params = periodParams(projectId, env, period, options);
  const count = await providerJson<CountResponse>("vercel", `https://api.vercel.com/v1/query/web-analytics/visits/count?${params}`, { fetchImpl: options.fetchImpl, headers: headers(env) });
  if (!count.data || typeof count.data !== "object") throw new ProviderError("vercel", "malformed");
  return { pageviews: finite(count.data.pageviews), visitors: finite(count.data.visitors) };
}

async function aggregate(projectId: string, period: Period, by: VisitDimension | "eventName", dataset: "visits" | "events", options: QueryOptions = {}): Promise<VercelAnalyticsRow[]> {
  const env = options.env ?? process.env;
  const params = periodParams(projectId, env, period, options);
  params.set("by", by);
  params.set("limit", String(Math.max(1, Math.min(options.limit ?? 20, MAX_AGGREGATE_LIMIT))));
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

/** Découpe une période en fenêtres consécutives d'au plus `size` jours. */
export function periodWindows(period: Period, size = TREND_WINDOW_DAYS): Period[] {
  const windows: Period[] = [];
  const last = Date.parse(`${period.end}T00:00:00Z`);
  for (let cursor = Date.parse(`${period.start}T00:00:00Z`); cursor <= last; cursor += size * DAY_MS) {
    const end = Math.min(cursor + (size - 1) * DAY_MS, last);
    windows.push({ start: new Date(cursor).toISOString().slice(0, 10), end: new Date(end).toISOString().slice(0, 10) });
  }
  return windows;
}

/** Série quotidienne (visites ou événements), interrogée par fenêtres de 25 jours puis fusionnée par date. */
async function timeSeries(projectId: string, period: Period, dataset: "visits" | "events", options: QueryOptions) {
  const env = options.env ?? process.env;
  const chunks = await Promise.all(periodWindows(period).map(async (window) => {
    const params = periodParams(projectId, env, window, options);
    params.set("by", "day");
    params.set("limit", String(MAX_AGGREGATE_LIMIT));
    const data = await providerJson<AggregateResponse>("vercel", `https://api.vercel.com/v1/query/web-analytics/${dataset}/aggregate?${params}`, { fetchImpl: options.fetchImpl, headers: headers(env) });
    if (!Array.isArray(data.data)) throw new ProviderError("vercel", "malformed");
    return data.data;
  }));
  const byDate = new Map<string, Record<string, unknown>>();
  for (const raw of chunks.flat()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    const stamp = typeof row.timestamp === "string" ? row.timestamp : typeof row.day === "string" ? row.day : null;
    if (!stamp || !day.test(stamp.slice(0, 10))) continue;
    byDate.set(stamp.slice(0, 10), { ...row, timestamp: stamp.length === 10 ? `${stamp}T00:00:00.000Z` : stamp });
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row);
}

export async function dailyTrend(projectId: string, period: Period, options: QueryOptions = {}): Promise<VercelAnalyticsTrendPoint[]> {
  const rows = await timeSeries(projectId, period, "visits", options);
  return rows.map((row) => ({ timestamp: row.timestamp as string, pageviews: finite(row.pageviews), visitors: finite(row.visitors) }));
}

export async function dailyEventTrend(projectId: string, period: Period, options: QueryOptions = {}): Promise<VercelAnalyticsEventTrendPoint[]> {
  const rows = await timeSeries(projectId, period, "events", options);
  return rows.map((row) => ({ timestamp: row.timestamp as string, count: finite(row.count), visitors: finite(row.visitors) }));
}

export function webAnalyticsEvents(projectId: string, period: Period, options: QueryOptions = {}) {
  return aggregate(projectId, period, "eventName", "events", options);
}

/**
 * Message d'erreur sûr à enregistrer et afficher : message générique de ProviderError, statut HTTP et
 * code d'erreur assaini renvoyé par Vercel (jamais le corps de réponse, les en-têtes ni le jeton).
 */
export function describeVercelError(error: unknown) {
  if (!(error instanceof ProviderError)) return "Erreur inattendue lors de l’appel à Vercel.";
  const details = [error.status ? `HTTP ${error.status}` : null, error.code, ...(error.scopes ?? []).map((scope) => `portée ${scope}`)].filter(Boolean);
  return `${error.message}${details.length ? ` (${details.join(", ")})` : ""}`;
}

export type AnalyticsSection = "trend" | "eventTrend" | "topPages" | "topReferrers" | "routes" | "countries" | "devices" | "operatingSystems" | "browsers" | "events";
/** Résultat d'une requête complémentaire : chaque bloc échoue seul, avec sa cause, au lieu de tout faire échouer. */
export type AnalyticsSectionStatus = { ok: true } | { ok: false; error: string };

export const analyticsSectionLabels: Record<AnalyticsSection, string> = {
  trend: "série quotidienne", eventTrend: "série des événements", topPages: "pages", topReferrers: "référents", routes: "routes",
  countries: "pays", devices: "appareils", operatingSystems: "systèmes", browsers: "navigateurs", events: "événements personnalisés",
};

async function settle<T>(sections: Partial<Record<AnalyticsSection, AnalyticsSectionStatus>>, key: AnalyticsSection, task: Promise<T>, empty: T): Promise<T> {
  try {
    const value = await task;
    sections[key] = { ok: true };
    return value;
  } catch (error) {
    sections[key] = { ok: false, error: describeVercelError(error) };
    return empty;
  }
}

/**
 * Résumé Web Analytics d'une période. Le comptage (visiteurs, pages vues) est obligatoire : son échec fait
 * échouer la synchronisation. Les autres blocs sont indépendants et leur statut est conservé dans `sections`.
 */
export async function webAnalyticsSummary(projectId: string, period: Period, options: QueryOptions = {}): Promise<VercelAnalyticsSummary> {
  const sections: Partial<Record<AnalyticsSection, AnalyticsSectionStatus>> = {};
  const dimension = (by: VisitDimension) => aggregate(projectId, period, by, "visits", options);
  const [count, trend, eventTrend, topPages, topReferrers, routes, countries, devices, operatingSystems, browsers, events] = await Promise.all([
    webAnalyticsCount(projectId, period, options),
    settle(sections, "trend", dailyTrend(projectId, period, options), []),
    settle(sections, "eventTrend", dailyEventTrend(projectId, period, options), []),
    settle(sections, "topPages", dimension("requestPath"), []),
    settle(sections, "topReferrers", dimension("referrerHostname"), []),
    settle(sections, "routes", dimension("route"), []),
    settle(sections, "countries", dimension("country"), []),
    settle(sections, "devices", dimension("deviceType"), []),
    settle(sections, "operatingSystems", dimension("osName"), []),
    settle(sections, "browsers", dimension("browserName"), []),
    settle(sections, "events", webAnalyticsEvents(projectId, period, options), []),
  ]);
  return {
    projectId, period, ...count, trend, eventTrend, topPages, topReferrers, routes, countries, devices, operatingSystems, browsers, events, sections,
  };
}
