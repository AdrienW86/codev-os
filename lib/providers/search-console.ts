import "server-only";
// Google Search Console (lecture seule, scope webmasters.readonly).
// Jeton : connexion OAuth de CODE-V OS (lib/integrations/search-console/connection.ts), ou à défaut l'ancien jeton de
// rafraîchissement serveur GOOGLE_SEARCH_CONSOLE_* (compatibilité). Le jeton n'est jamais journalisé ni renvoyé.
import { googleAccessToken, providerJson, type FetchLike } from "@/lib/providers/api";
import { ProviderError } from "@/lib/providers/errors";
import { normalizeProperty, normalizeSites, type DiscoveredProperty } from "@/lib/integrations/search-console/model";

type Env = Record<string, string | undefined>;
export type QueryRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };
export type SearchDimension = "query" | "page" | "date" | "country" | "device";
type Options = { env?: Env; fetchImpl?: FetchLike; accessToken?: () => Promise<string> };

const API = "https://searchconsole.googleapis.com/webmasters/v3";

/** Ancien mode (jeton de rafraîchissement en variable serveur) : conservé pour les installations existantes. */
export function legacySearchConsoleConfigured(env: Env = process.env) {
  return Boolean(env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID && env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET && env.GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN);
}
/** @deprecated nom historique : voir legacySearchConsoleConfigured. */
export const searchConsoleConfigured = legacySearchConsoleConfigured;

/** Propriété acceptée : « sc-domain:exemple.fr » ou préfixe d'URL http(s) avec slash final. */
export function isValidProperty(value: string) {
  return normalizeProperty(value) === value;
}

async function bearer(options: Options) {
  if (options.accessToken) return options.accessToken();
  const env = options.env ?? process.env;
  if (!legacySearchConsoleConfigured(env)) throw new ProviderError("search-console", "not_configured");
  return googleAccessToken("search-console", { clientId: env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID, clientSecret: env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET, refreshToken: env.GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN }, options.fetchImpl);
}

/** Propriétés accessibles au compte Google connecté (accès validé uniquement). */
export async function listSearchConsoleSites(options: Options = {}): Promise<DiscoveredProperty[]> {
  const token = await bearer(options);
  const data = await providerJson<unknown>("search-console", `${API}/sites`, { fetchImpl: options.fetchImpl, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!data || typeof data !== "object") throw new ProviderError("search-console", "malformed");
  return normalizeSites(data);
}

const day = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Search Analytics (type « web »). `dataState: "final"` (défaut) ne renvoie que des jours consolidés.
 * Les lignes sont triées par clics décroissants par Google ; `rowLimit` ≤ 25 000 (limite de l'API).
 */
export async function searchAnalytics(property: string, query: { startDate: string; endDate: string; dimensions: SearchDimension[]; rowLimit?: number; dataState?: "final" | "all" }, options: Options = {}): Promise<QueryRow[]> {
  if (!isValidProperty(property) || !day.test(query.startDate) || !day.test(query.endDate) || query.startDate > query.endDate) throw new ProviderError("search-console", "blocked");
  const token = await bearer(options);
  const data = await providerJson<{ rows?: unknown }>("search-console", `${API}/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
    method: "POST", fetchImpl: options.fetchImpl, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ startDate: query.startDate, endDate: query.endDate, dimensions: query.dimensions, type: "web", dataState: query.dataState ?? "final", rowLimit: Math.max(1, Math.min(query.rowLimit ?? 250, 25_000)) }),
  });
  if (data.rows === undefined) return [];
  if (!Array.isArray(data.rows)) throw new ProviderError("search-console", "malformed");
  return data.rows.map((row) => {
    const value = row as Record<string, unknown>;
    if (!Array.isArray(value.keys) || typeof value.clicks !== "number" || typeof value.impressions !== "number" || !Number.isFinite(value.clicks) || !Number.isFinite(value.impressions)) throw new ProviderError("search-console", "malformed");
    return { keys: value.keys.map(String), clicks: value.clicks, impressions: value.impressions, ctr: Number(value.ctr ?? 0), position: Number(value.position ?? 0) };
  });
}
