// Google Search Console : règles pures (propriétés, périodes, agrégation, indicateurs). Sans réseau, sans secret,
// utilisable côté client. Aucune valeur n'est inventée : une donnée absente reste `null` et l'interface le dit.

export const SEARCH_CONSOLE_PROVIDER = "search-console";
export const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
/** Format des instantanés `metric_snapshots` (provider search-console, metric_key performance). */
export const SEARCH_CONSOLE_SNAPSHOT_VERSION = 1;
export const SEARCH_CONSOLE_METRIC_KEY = "performance";
/** Délai habituel de consolidation des données Google (jours) : repli quand Google ne renvoie encore rien. */
export const SEARCH_CONSOLE_DELAY_DAYS = 3;
/** Google conserve 16 mois de données. */
export const SEARCH_CONSOLE_MAX_LOOKBACK_DAYS = 486;

// ——— Propriétés ———

export type PropertyKind = "domain" | "url";
const label = "[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?";
const domainPattern = new RegExp(`^sc-domain:${label}(?:\\.${label})+$`);

/**
 * Propriété Search Console normalisée : « sc-domain:exemple.fr » (minuscules) ou préfixe d'URL http(s) se terminant
 * par « / » (hôte en minuscules, chemin conservé). `null` si le format n'est pas celui d'une propriété.
 */
export function normalizeProperty(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > 300 || /[\s"'<>\\]/.test(value)) return null;
  if (/^sc-domain:/i.test(value)) {
    const lower = value.toLowerCase();
    return domainPattern.test(lower) && lower.length <= 263 ? lower : null;
  }
  if (/\/\.{1,2}(\/|$)/.test(value)) return null; // segments « . » / « .. » : jamais résolus silencieusement
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || url.search || url.hash || url.port) return null;
  if (!url.hostname.includes(".") || url.pathname.includes("..") || !value.endsWith("/")) return null;
  return `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname}`;
}

export function propertyKind(property: string): PropertyKind {
  return property.startsWith("sc-domain:") ? "domain" : "url";
}

/** Libellé lisible : « exemple.fr · Domaine » ou « https://www.exemple.fr/ · Préfixe d'URL ». */
export function propertyLabel(property: string) {
  return propertyKind(property) === "domain" ? `${property.slice("sc-domain:".length)} · Domaine` : `${property} · Préfixe d’URL`;
}

export type PermissionLevel = "siteOwner" | "siteFullUser" | "siteRestrictedUser" | "siteUnverifiedUser";
export type DiscoveredProperty = { property: string; permission: PermissionLevel };
const usableLevels: PermissionLevel[] = ["siteOwner", "siteFullUser", "siteRestrictedUser"];
export const permissionLabels: Record<PermissionLevel, string> = { siteOwner: "Propriétaire", siteFullUser: "Accès complet", siteRestrictedUser: "Accès restreint", siteUnverifiedUser: "Non validé" };

/** Réponse `sites.list` → propriétés exploitables (accès validé), dédoublonnées et triées. */
export function normalizeSites(body: unknown): DiscoveredProperty[] {
  const entries = body && typeof body === "object" && Array.isArray((body as { siteEntry?: unknown }).siteEntry) ? (body as { siteEntry: unknown[] }).siteEntry : [];
  const seen = new Map<string, DiscoveredProperty>();
  for (const entry of entries.slice(0, 1000)) {
    if (!entry || typeof entry !== "object") continue;
    const property = normalizeProperty((entry as { siteUrl?: unknown }).siteUrl);
    const permission = (entry as { permissionLevel?: unknown }).permissionLevel;
    if (!property || !usableLevels.includes(permission as PermissionLevel)) continue;
    if (!seen.has(property)) seen.set(property, { property, permission: permission as PermissionLevel });
  }
  return [...seen.values()].sort((a, b) => propertyKind(a.property).localeCompare(propertyKind(b.property)) || a.property.localeCompare(b.property));
}

/** Liste de propriétés lue depuis les métadonnées non sensibles de la connexion globale. */
export function storedProperties(metadata: unknown): DiscoveredProperty[] {
  const list = metadata && typeof metadata === "object" && Array.isArray((metadata as { properties?: unknown }).properties) ? (metadata as { properties: unknown[] }).properties : [];
  return normalizeSites({ siteEntry: list.map((item) => item && typeof item === "object" ? { siteUrl: (item as { property?: unknown }).property, permissionLevel: (item as { permission?: unknown }).permission } : null) });
}

// ——— Périodes ———

export type Period = { start: string; end: string };
const DAY_MS = 86_400_000;
const isoDay = /^\d{4}-\d{2}-\d{2}$/;

export function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export const dayCount = (period: Period) => Math.round((Date.parse(`${period.end}T00:00:00Z`) - Date.parse(`${period.start}T00:00:00Z`)) / DAY_MS) + 1;
export const isPeriod = (period: Period) => isoDay.test(period.start) && isoDay.test(period.end) && period.start <= period.end;
export function previousOf(period: Period): Period {
  const days = dayCount(period);
  return { start: addDays(period.start, -days), end: addDays(period.start, -1) };
}

/**
 * Période réellement mesurable : même durée que la période demandée, mais terminée au plus tard au dernier jour
 * consolidé par Google (les jours plus récents sont incomplets). La période précédente a la même durée, ce qui rend
 * la comparaison équitable. `shifted` indique que la fin a été avancée.
 */
export function alignPeriod(requested: Period, lastAvailable: string | null, today: string): { period: Period; previous: Period; shifted: boolean } {
  const ceiling = lastAvailable ?? addDays(today, -SEARCH_CONSOLE_DELAY_DAYS);
  const end = requested.end > ceiling ? ceiling : requested.end;
  const period = { start: addDays(end, -(dayCount(requested) - 1)), end };
  return { period, previous: previousOf(period), shifted: end !== requested.end };
}

// ——— Agrégation (règles Google) ———

export type Metrics = { clicks: number; impressions: number; ctr: number | null; position: number | null };
export type DailyMetrics = { date: string; clicks: number; impressions: number; position: number | null };

/**
 * Totaux d'une série : clics et impressions s'additionnent ; le CTR se recalcule (clics ÷ impressions, jamais la
 * moyenne des CTR) ; la position moyenne est pondérée par les impressions (jamais la moyenne simple des positions).
 */
export function aggregate(rows: readonly { clicks: number; impressions: number; position: number | null }[]): Metrics {
  let clicks = 0, impressions = 0, weighted = 0, weight = 0;
  for (const row of rows) {
    clicks += row.clicks;
    impressions += row.impressions;
    if (row.position !== null && Number.isFinite(row.position) && row.impressions > 0) { weighted += row.position * row.impressions; weight += row.impressions; }
  }
  return { clicks, impressions, ctr: impressions > 0 ? clicks / impressions : null, position: weight > 0 ? weighted / weight : null };
}

// ——— Instantané ———

export type DimensionRow = Metrics & { key: string; previous: Metrics | null };
export type SectionKey = "daily" | "previousDaily" | "queries" | "pages" | "countries" | "devices";
export type SearchConsoleSnapshot = {
  version: number;
  property: string;
  /** Période demandée par l'interface et période réellement mesurée (alignée sur les données consolidées). */
  requested: Period;
  period: Period;
  previousPeriod: Period;
  /** Dernier jour consolidé renvoyé par Google (fuseau horaire Pacifique, celui de Search Console). */
  lastAvailableDate: string | null;
  totals: Metrics;
  previousTotals: Metrics | null;
  daily: DailyMetrics[];
  previousDaily: DailyMetrics[];
  queries: DimensionRow[];
  pages: DimensionRow[];
  countries: DimensionRow[];
  devices: DimensionRow[];
  sections: Partial<Record<SectionKey, { ok: boolean; error?: string }>>;
};

// ——— Indicateurs ———

export type SeoKpiKey = "clicks" | "impressions" | "ctr" | "position";
export type SeoKpi = {
  key: SeoKpiKey; label: string; value: number | null; previous: number | null;
  /** clics / impressions : variation en % ; CTR : écart en points ; position : écart en places (négatif = progression). */
  delta: number | null; deltaUnit: "%" | "pt" | "place";
  /** Sens favorable de la variation. */
  better: "up" | "down"; spark: number[]; hint: string;
};

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
export function percentChange(now: number | null, before: number | null) {
  if (now === null || before === null || before <= 0) return null;
  return round(((now - before) / before) * 100, 1);
}

export function buildSeoKpis(snapshot: SearchConsoleSnapshot): SeoKpi[] {
  const { totals, previousTotals: before } = snapshot;
  const daily = [...snapshot.daily].sort((a, b) => a.date.localeCompare(b.date));
  const dailyCtr = daily.map((row) => row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0);
  return [
    { key: "clicks", label: "Clics organiques", value: totals.clicks, previous: before?.clicks ?? null, delta: percentChange(totals.clicks, before?.clicks ?? null), deltaUnit: "%", better: "up", spark: daily.map((row) => row.clicks), hint: "Clics depuis la recherche Google" },
    { key: "impressions", label: "Impressions", value: totals.impressions, previous: before?.impressions ?? null, delta: percentChange(totals.impressions, before?.impressions ?? null), deltaUnit: "%", better: "up", spark: daily.map((row) => row.impressions), hint: "Affichages dans les résultats Google" },
    { key: "ctr", label: "CTR moyen", value: totals.ctr === null ? null : totals.ctr * 100, previous: before?.ctr == null ? null : before.ctr * 100,
      delta: totals.ctr !== null && before?.ctr != null ? round((totals.ctr - before.ctr) * 100, 2) : null, deltaUnit: "pt", better: "up", spark: dailyCtr, hint: "Clics ÷ impressions" },
    { key: "position", label: "Position moyenne", value: totals.position, previous: before?.position ?? null,
      delta: totals.position !== null && before?.position != null ? round(totals.position - before.position, 1) : null, deltaUnit: "place", better: "down", spark: daily.map((row) => row.position ?? 0), hint: "Pondérée par les impressions" },
  ];
}

// ——— Séries ———

export type SeoMetric = "clicks" | "impressions" | "ctr" | "position";
export type SeoGranularity = "day" | "week" | "month";
export type SeoPoint = { key: string; label: string; value: number };

function weekStart(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.toISOString().slice(0, 10);
}
const shortDate = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

function metricValue(metrics: Metrics, metric: SeoMetric) {
  if (metric === "ctr") return metrics.ctr === null ? 0 : round(metrics.ctr * 100, 2);
  if (metric === "position") return metrics.position === null ? 0 : round(metrics.position, 1);
  return metrics[metric];
}

/** Série du graphique ; les regroupements semaine / mois réappliquent les règles d'agrégation de Google. */
export function seoSeries(daily: readonly DailyMetrics[], metric: SeoMetric, granularity: SeoGranularity): SeoPoint[] {
  const groups = new Map<string, DailyMetrics[]>();
  for (const row of [...daily].sort((a, b) => a.date.localeCompare(b.date))) {
    const key = granularity === "day" ? row.date : granularity === "week" ? weekStart(row.date) : row.date.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([key, rows]) => ({
    key,
    label: granularity === "day" ? shortDate(key) : granularity === "week" ? `Sem. du ${shortDate(key)}` : new Date(`${key}-01T00:00:00Z`).toLocaleDateString("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" }),
    value: metricValue(aggregate(rows), metric),
  })).filter((point) => metric !== "position" || point.value > 0);
}

// ——— Libellés des dimensions ———

const alpha3: Record<string, string> = {
  fra: "FR", bel: "BE", che: "CH", lux: "LU", mco: "MC", can: "CA", usa: "US", gbr: "GB", irl: "IE", deu: "DE", aut: "AT", esp: "ES", prt: "PT", ita: "IT",
  nld: "NL", dnk: "DK", swe: "SE", nor: "NO", fin: "FI", pol: "PL", cze: "CZ", rou: "RO", hun: "HU", grc: "GR", tur: "TR", rus: "RU", ukr: "UA",
  mar: "MA", dza: "DZ", tun: "TN", sen: "SN", civ: "CI", cmr: "CM", mdg: "MG", mus: "MU", reu: "RE", glp: "GP", mtq: "MQ", guf: "GF", myt: "YT", pyf: "PF", ncl: "NC",
  bra: "BR", mex: "MX", arg: "AR", chl: "CL", col: "CO", per: "PE", ind: "IN", chn: "CN", jpn: "JP", kor: "KR", sgp: "SG", hkg: "HK", twn: "TW", tha: "TH", vnm: "VN",
  phl: "PH", idn: "ID", mys: "MY", aus: "AU", nzl: "NZ", zaf: "ZA", egy: "EG", nga: "NG", ken: "KE", isr: "IL", are: "AE", sau: "SA", qat: "QA", lbn: "LB", pak: "PK", bgd: "BD",
};
let regionNames: Intl.DisplayNames | null = null;
/** Pays Search Console (ISO 3166-1 alpha-3, ex. « fra ») → libellé français et code alpha-2 (drapeau). */
export function searchCountry(code: string): { label: string; alpha2: string | null } {
  const alpha2 = alpha3[code.toLowerCase()] ?? null;
  if (!alpha2) return { label: code.toUpperCase(), alpha2: null };
  try {
    regionNames ??= new Intl.DisplayNames(["fr"], { type: "region" });
    return { label: regionNames.of(alpha2) ?? code.toUpperCase(), alpha2 };
  } catch { return { label: code.toUpperCase(), alpha2 }; }
}

export function searchDevice(value: string) {
  const key = value.toUpperCase();
  return key === "MOBILE" ? "Mobile" : key === "DESKTOP" ? "Ordinateur" : key === "TABLET" ? "Tablette" : value;
}

/** Chemin lisible d'une page de résultat (l'hôte est celui de la propriété). */
export function pagePath(url: string) {
  try { const parsed = new URL(url); return `${parsed.pathname}${parsed.search}` || "/"; } catch { return url; }
}

// ——— Export ———

const csvCell = (value: string | number | null | undefined) => {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d/.test(text) ? `'${text}` : text;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const pct = (value: number | null) => value === null ? "" : round(value * 100, 2);
const pos = (value: number | null) => value === null ? "" : round(value, 1);

export function searchConsoleCsv(snapshot: SearchConsoleSnapshot, client: string) {
  const lines: (string | number | null)[][] = [
    ["Client", client], ["Propriété Search Console", snapshot.property], ["Période", `${snapshot.period.start} → ${snapshot.period.end}`],
    ["Période précédente", `${snapshot.previousPeriod.start} → ${snapshot.previousPeriod.end}`], [],
    ["Indicateur", "Valeur", "Période précédente"],
    ["Clics", snapshot.totals.clicks, snapshot.previousTotals?.clicks ?? ""], ["Impressions", snapshot.totals.impressions, snapshot.previousTotals?.impressions ?? ""],
    ["CTR (%)", pct(snapshot.totals.ctr), pct(snapshot.previousTotals?.ctr ?? null)], ["Position moyenne", pos(snapshot.totals.position), pos(snapshot.previousTotals?.position ?? null)],
    [], ["Date", "Clics", "Impressions", "CTR (%)", "Position"],
    ...snapshot.daily.map((row) => [row.date, row.clicks, row.impressions, pct(row.impressions > 0 ? row.clicks / row.impressions : null), pos(row.position)]),
  ];
  const section = (title: string, rows: DimensionRow[]) => lines.push([], [title], ["Clé", "Clics", "Impressions", "CTR (%)", "Position", "Clics période précédente"],
    ...rows.map((row) => [row.key, row.clicks, row.impressions, pct(row.ctr), pos(row.position), row.previous?.clicks ?? ""]));
  section("Requêtes", snapshot.queries);
  section("Pages", snapshot.pages);
  section("Pays", snapshot.countries);
  section("Appareils", snapshot.devices);
  return lines.map((line) => line.map(csvCell).join(";")).join("\n");
}
