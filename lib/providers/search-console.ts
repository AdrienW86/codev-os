import "server-only";
// Google Search Console (lecture seule, scope webmasters.readonly).
import { googleAccessToken, providerJson, type FetchLike } from "@/lib/providers/api";
import { ProviderError } from "@/lib/providers/errors";

type Env = Record<string, string | undefined>;
export type QueryRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };

export function searchConsoleConfigured(env: Env = process.env) {
  return Boolean(env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID && env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET && env.GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN);
}

/** Propriété acceptée : « sc-domain:exemple.fr » ou URL https avec slash final. */
export function isValidProperty(value: string) {
  return /^sc-domain:[a-z0-9.-]{3,253}$/i.test(value) || /^https:\/\/[a-z0-9.-]{3,253}\/$/i.test(value);
}

export async function searchAnalytics(property: string, query: { startDate: string; endDate: string; dimensions: ("query" | "page" | "date")[]; rowLimit?: number }, options: { env?: Env; fetchImpl?: FetchLike } = {}): Promise<QueryRow[]> {
  const env = options.env ?? process.env;
  if (!searchConsoleConfigured(env)) throw new ProviderError("search-console", "not_configured");
  if (!isValidProperty(property)) throw new ProviderError("search-console", "blocked");
  const token = await googleAccessToken("search-console", { clientId: env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID, clientSecret: env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET, refreshToken: env.GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN }, options.fetchImpl);
  const data = await providerJson<{ rows?: unknown }>("search-console", `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
    method: "POST", fetchImpl: options.fetchImpl, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ startDate: query.startDate, endDate: query.endDate, dimensions: query.dimensions, rowLimit: Math.min(query.rowLimit ?? 250, 1000) }),
  });
  if (data.rows === undefined) return [];
  if (!Array.isArray(data.rows)) throw new ProviderError("search-console", "malformed");
  return data.rows.map((row) => {
    const value = row as Record<string, unknown>;
    if (!Array.isArray(value.keys) || typeof value.clicks !== "number" || typeof value.impressions !== "number") throw new ProviderError("search-console", "malformed");
    return { keys: value.keys.map(String), clicks: value.clicks, impressions: value.impressions, ctr: Number(value.ctr ?? 0), position: Number(value.position ?? 0) };
  });
}
