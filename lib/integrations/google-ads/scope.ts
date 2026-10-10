// Périmètre explicite d'une analyse ou d'un rapport Google Ads (pur) : dates exactes + campagnes.
// Transmis tel quel du tableau de bord au serveur, revalidé, puis enregistré dans le run, les
// recommandations et le rapport. Il ne dépend jamais des filtres affichés ensuite.
import { MAX_PERIOD_DAYS, isValidDay } from "./periods";
import type { StatusFilter } from "./dashboard";

export type AdsScope = { start: string; end: string; status: StatusFilter; types: string[]; campaignIds: string[] };
export const MAX_SCOPE_CAMPAIGNS = 50;

export function parseScope(input: unknown): AdsScope | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  const keys = Object.keys(value);
  if (keys.some((key) => !["start", "end", "status", "types", "campaignIds"].includes(key))) return null;
  if (!isValidDay(value.start) || !isValidDay(value.end) || value.end < value.start) return null;
  const days = (Date.parse(`${value.end}T00:00:00Z`) - Date.parse(`${value.start}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > MAX_PERIOD_DAYS) return null;
  if (value.status !== "enabled" && value.status !== "paused" && value.status !== "all") return null;
  const types = value.types, ids = value.campaignIds;
  if (!Array.isArray(types) || types.length > 20 || types.some((type) => typeof type !== "string" || !/^[A-Z_]{2,40}$/.test(type))) return null;
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_SCOPE_CAMPAIGNS || ids.some((id) => typeof id !== "string" || !/^\d{1,20}$/.test(id)) || new Set(ids).size !== ids.length) return null;
  return { start: value.start, end: value.end, status: value.status, types: [...types] as string[], campaignIds: [...ids] as string[] };
}

/** Forme enregistrée (run, recommandation, rapport) : périmètre + contexte du compte au moment de l'exécution. */
export type StoredAdsScope = AdsScope & { days: number; timezone: string; currency: string; accountId: string; campaignNames: Record<string, string> };

export function isStoredScope(value: unknown): value is StoredAdsScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const { days, timezone, currency, accountId, campaignNames, ...rest } = value as Record<string, unknown>;
  return parseScope(rest) !== null && Number.isInteger(days) && typeof timezone === "string" && /^[A-Z]{3}$/.test(String(currency)) && /^\d{10}$/.test(String(accountId))
    && Boolean(campaignNames) && typeof campaignNames === "object" && Object.values(campaignNames as object).every((name) => typeof name === "string" && name.length <= 1000);
}

/**
 * Fige un périmètre demandé sur les campagnes réellement renvoyées par LE compte du client :
 * null si une campagne demandée n'existe pas (ou plus) dans ce compte.
 */
export function storeScope(scope: AdsScope, rows: { id: string; name: string }[], context: { days: number; timezone: string; currency: string; accountId: string }): StoredAdsScope | null {
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (scope.campaignIds.some((id) => !byId.has(id))) return null;
  return {
    start: scope.start, end: scope.end, status: scope.status, types: [...scope.types], campaignIds: [...scope.campaignIds], ...context,
    campaignNames: Object.fromEntries(scope.campaignIds.map((id) => [id, byId.get(id)!.name.slice(0, 200)])),
  };
}
