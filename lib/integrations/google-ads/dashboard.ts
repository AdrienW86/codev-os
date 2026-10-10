// Tableau de bord des campagnes (pur, partagé serveur / navigateur) : filtres sérialisés dans l'URL,
// lignes de campagnes, totaux EXACTEMENT égaux à la somme des campagnes sélectionnées, rapprochement
// avec le total du compte (jamais supposé identique), séparation Search / Local Services.
import { PERIOD_PRESETS, isValidDay, type PeriodPreset, type PeriodSelection } from "./periods";
import type { AdsAccount, AdsMetrics, AdsPeriod } from "./types";

export type StatusFilter = "enabled" | "paused" | "all";
export type DashboardFilters = { period: PeriodSelection; compare: boolean; status: StatusFilter; types: string[]; campaigns: string[] };

export const DEFAULT_FILTERS: DashboardFilters = { period: { preset: "last_30" }, compare: false, status: "enabled", types: [], campaigns: [] };
const MAX_SELECTED = 50;
const campaignId = /^\d{1,20}$/;
const channel = /^[A-Z_]{2,40}$/;

type Params = URLSearchParams | Record<string, string | string[] | undefined>;
const read = (params: Params, key: string) => {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  return typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined;
};
const list = (value: string | undefined, pattern: RegExp) => [...new Set((value ?? "").split(",").map((item) => item.trim()).filter((item) => pattern.test(item)))].slice(0, MAX_SELECTED);

/** Lecture tolérante : toute valeur invalide retombe sur la valeur par défaut (validation stricte des dates côté serveur). */
export function parseFilters(params: Params): DashboardFilters {
  const preset = read(params, "ads_period");
  const period: PeriodSelection = { preset: (PERIOD_PRESETS as readonly string[]).includes(preset ?? "") ? preset as PeriodPreset : "last_30" };
  if (period.preset === "day") period.date = read(params, "ads_date");
  if (period.preset === "custom") { period.start = read(params, "ads_start"); period.end = read(params, "ads_end"); }
  const status = read(params, "ads_status");
  return {
    period, compare: read(params, "ads_compare") === "1",
    status: status === "paused" || status === "all" ? status : "enabled",
    types: list(read(params, "ads_types"), channel),
    campaigns: list(read(params, "ads_campaigns"), campaignId),
  };
}

/** Écrit les filtres dans une copie des paramètres existants (onglet, client… conservés). */
export function writeFilters(base: URLSearchParams, filters: DashboardFilters): URLSearchParams {
  const params = new URLSearchParams(base);
  for (const key of ["ads_period", "ads_date", "ads_start", "ads_end", "ads_compare", "ads_status", "ads_types", "ads_campaigns", "ads_days"]) params.delete(key);
  if (filters.period.preset !== DEFAULT_FILTERS.period.preset) params.set("ads_period", filters.period.preset);
  if (filters.period.preset === "day" && isValidDay(filters.period.date)) params.set("ads_date", filters.period.date);
  if (filters.period.preset === "custom") {
    if (filters.period.start) params.set("ads_start", filters.period.start);
    if (filters.period.end) params.set("ads_end", filters.period.end);
  }
  if (filters.compare) params.set("ads_compare", "1");
  if (filters.status !== "enabled") params.set("ads_status", filters.status);
  if (filters.types.length) params.set("ads_types", filters.types.join(","));
  if (filters.campaigns.length) params.set("ads_campaigns", filters.campaigns.join(","));
  return params;
}

/** Clé de la période demandée : sert à ignorer les réponses périmées et à décider d'un rechargement. */
export const periodKey = (filters: DashboardFilters) => JSON.stringify([filters.period.preset, filters.period.date ?? "", filters.period.start ?? "", filters.period.end ?? "", filters.compare]);

/** Ne retient que la DERNIÈRE demande : une réponse arrivée après une demande plus récente est ignorée. */
export function createRequestTracker() {
  let latest = 0;
  return { start: () => ++latest, isLatest: (id: number) => id === latest };
}

// ---------------------------------------------------------------------------------------------

export type CampaignBudget = { amount: number | null; shared: boolean | null; period: string | null };
export type CampaignRow = {
  id: string; name: string; status: string; type: string; subType: string | null;
  /** Déterminé par advertising_channel_type = LOCAL_SERVICES (donnée API), jamais par le nom. */
  localServices: boolean;
  budget: CampaignBudget;
  /** false : aucune ligne de métriques renvoyée pour la période (affiché « aucune activité », pas un zéro inventé). */
  hasActivity: boolean;
  metrics: AdsMetrics; previous: AdsMetrics | null;
};
export type LocalServicesLeads =
  | { available: true; total: number; byType: Record<string, number>; charged: number | null }
  | { available: false; reason: string };
export type DashboardData = {
  account: AdsAccount; period: AdsPeriod & { includesToday: boolean; today: string; preset: PeriodPreset };
  previousPeriod: AdsPeriod | null;
  campaigns: CampaignRow[]; accountTotals: AdsMetrics; accountPrevious: AdsMetrics | null;
  leads: LocalServicesLeads | null;
  fetchedAt: string;
};

export const typeLabels: Record<string, string> = {
  SEARCH: "Search", LOCAL_SERVICES: "Local Services", PERFORMANCE_MAX: "Performance Max", DISPLAY: "Display", VIDEO: "Vidéo",
  SHOPPING: "Shopping", DEMAND_GEN: "Demand Gen", SMART: "Smart", MULTI_CHANNEL: "Applications", LOCAL: "Local", HOTEL: "Hôtel", TRAVEL: "Voyage", DISCOVERY: "Discovery",
};
export const typeLabel = (type: string) => typeLabels[type] ?? type.charAt(0) + type.slice(1).toLowerCase().replaceAll("_", " ");
export const statusLabels: Record<string, string> = { ENABLED: "Active", PAUSED: "En pause", REMOVED: "Supprimée" };

/** Filtrage : statut ACTUEL, types, sélection explicite. Une campagne en pause peut avoir des dépenses passées. */
export function filterCampaigns(rows: CampaignRow[], filters: Pick<DashboardFilters, "status" | "types" | "campaigns">) {
  return rows.filter((row) => (filters.status === "all" || (filters.status === "enabled" ? row.status === "ENABLED" : row.status === "PAUSED"))
    && (!filters.types.length || filters.types.includes(row.type))
    && (!filters.campaigns.length || filters.campaigns.includes(row.id)));
}

const additive = ["impressions", "clicks", "cost", "conversions", "conversionValue"] as const;
export type Totals = { metrics: AdsMetrics; incomplete: (keyof AdsMetrics)[] };

/** Somme exacte des lignes : une valeur absente ne devient jamais zéro ; elle rend le total « incomplet ». */
export function sumCampaigns(rows: CampaignRow[], pick: (row: CampaignRow) => AdsMetrics | null = (row) => row.metrics): Totals {
  const incomplete: (keyof AdsMetrics)[] = [];
  const sum = Object.fromEntries(additive.map((key) => {
    const values = rows.map((row) => pick(row)?.[key] ?? null);
    const known = values.filter((value): value is number => value !== null);
    if (known.length && known.length < values.length) incomplete.push(key);
    return [key, known.length ? known.reduce((total, value) => total + value, 0) : null];
  })) as Pick<AdsMetrics, (typeof additive)[number]>;
  const ratio = (a: number | null, b: number | null) => (a !== null && b !== null && b > 0 ? a / b : null);
  return {
    metrics: { ...sum, ctr: ratio(sum.clicks, sum.impressions), averageCpc: ratio(sum.cost, sum.clicks), costPerConversion: ratio(sum.cost, sum.conversions) },
    incomplete,
  };
}

export type Reconciliation = { metric: keyof AdsMetrics; account: number; campaigns: number; difference: number }[];

/** Écarts entre le total du compte et la somme de TOUTES les campagnes renvoyées (aucune équivalence supposée). */
export function reconcile(account: AdsMetrics, campaigns: AdsMetrics): Reconciliation {
  const tolerance: Partial<Record<keyof AdsMetrics, number>> = { cost: 0.01, conversions: 0.01, conversionValue: 0.01 };
  return (["cost", "impressions", "clicks", "conversions"] as const).flatMap((metric) => {
    const a = account[metric], c = campaigns[metric];
    if (a === null || c === null) return [];
    const difference = a - c;
    return Math.abs(difference) > (tolerance[metric] ?? 0) ? [{ metric, account: a, campaigns: c, difference }] : [];
  });
}

/** Groupes d'affichage : Search, Local Services, puis chaque autre type réellement renvoyé. */
export function groupByType(rows: CampaignRow[]) {
  const order = (type: string) => (type === "SEARCH" ? 0 : type === "LOCAL_SERVICES" ? 1 : 2);
  const types = [...new Set(rows.map((row) => row.type))].sort((a, b) => order(a) - order(b) || typeLabel(a).localeCompare(typeLabel(b), "fr"));
  return types.map((type) => ({ type, label: typeLabel(type), rows: rows.filter((row) => row.type === type) }));
}

/** « 1 campagne Search active », « 3 campagnes (2 types) en pause ou actives »… (sans les dates). */
export function describeScope(rows: CampaignRow[], filters: Pick<DashboardFilters, "status" | "types" | "campaigns">) {
  const n = rows.length;
  const types = [...new Set(rows.map((row) => row.type))];
  const typePart = types.length === 1 ? ` ${typeLabel(types[0])}` : types.length > 1 ? ` (${types.length} types)` : "";
  const statusPart = filters.status === "enabled" ? (n > 1 ? " actives" : " active") : filters.status === "paused" ? " en pause" : "";
  const selection = filters.campaigns.length ? " sélectionnée" + (n > 1 ? "s" : "") : "";
  return `${n} campagne${n > 1 ? "s" : ""}${typePart}${statusPart}${selection}${filters.status === "all" ? " (tous statuts)" : ""}`;
}

/** Variation relative, null si non calculable (pas de division par zéro, pas de valeur inventée). */
export function change(current: number | null, previous: number | null) {
  return current === null || previous === null || previous === 0 ? null : (current - previous) / previous;
}
