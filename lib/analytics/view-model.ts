// Transformations pures du tableau de bord « Données et performances ».
// Aucune donnée n'est inventée : chaque valeur dérive de l'instantané Vercel Web Analytics
// (lib/vercel-analytics/sync.ts). Une valeur absente reste absente (null) et l'interface le dit.
import type { VercelAnalyticsSummary } from "@/lib/client-health/data";

export type AnalyticsData = VercelAnalyticsSummary;
export type PeriodPreset = "7" | "30" | "90" | "custom";
export type AnalyticsPeriod = { preset: PeriodPreset; start: string; end: string };
export type CompareMode = "none" | "previous";
export type ChannelKey = "all" | "search" | "direct" | "referral" | "social";
export type Granularity = "day" | "week" | "month";
export type TrendMetric = "visitors" | "pageviews" | "conversions";

const DAY_MS = 86_400_000;
const day = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_PERIOD_DAYS = 366;

const iso = (date: Date) => date.toISOString().slice(0, 10);
const param = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;

export function periodDays(period: { start: string; end: string }) {
  return Math.floor((Date.parse(`${period.end}T00:00:00Z`) - Date.parse(`${period.start}T00:00:00Z`)) / DAY_MS) + 1;
}

export function presetPeriod(days: number, today = new Date()): { start: string; end: string } {
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { start: iso(start), end: iso(end) };
}

/** Période demandée dans l'URL (?period=7|30|90 ou ?period=custom&start=…&end=…) ; 7 jours par défaut. */
export function resolvePeriod(params: Record<string, string | string[] | undefined>, today = new Date()): AnalyticsPeriod {
  const preset = param(params.period);
  const start = param(params.start);
  const end = param(params.end);
  if (preset === "custom" && start && end && day.test(start) && day.test(end) && start <= end) {
    const days = periodDays({ start, end });
    if (days >= 1 && days <= MAX_PERIOD_DAYS) return { preset: "custom", start, end };
  }
  const days = preset === "30" ? 30 : preset === "90" ? 90 : 7;
  return { preset: String(days) as PeriodPreset, ...presetPeriod(days, today) };
}

export const resolveCompare = (value: string | string[] | undefined): CompareMode => param(value) === "none" ? "none" : "previous";

const channelKeys: ChannelKey[] = ["all", "search", "direct", "referral", "social"];
export const resolveChannel = (value: string | string[] | undefined): ChannelKey => {
  const raw = param(value);
  return channelKeys.includes(raw as ChannelKey) ? raw as ChannelKey : "all";
};

export const channelLabels: Record<ChannelKey, string> = {
  all: "Tous les canaux",
  search: "Recherche",
  direct: "Accès direct",
  referral: "Sites référents",
  social: "Réseaux sociaux",
};

const shortDate = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

export function periodLabel(period: AnalyticsPeriod) {
  if (period.preset !== "custom") return `${period.preset} derniers jours`;
  return `${shortDate(period.start)} → ${shortDate(period.end)}`;
}

/** Variation en % ; null si la période de comparaison est vide ou absente. */
export function pctDelta(now: number | null | undefined, before: number | null | undefined) {
  if (typeof now !== "number" || typeof before !== "number" || before <= 0) return null;
  return Math.round(((now - before) / before) * 1000) / 10;
}

export const share = (value: number, total: number) => total > 0 ? Math.round((value / total) * 1000) / 10 : null;

// ——— Événements personnalisés ———

export type EventKind = "form" | "cta" | "other";

/** Classe un nom d'événement Vercel (« lead_form_submit », « phone_click »…) en formulaire, CTA ou autre. */
export function classifyEvent(name: string): EventKind {
  const value = name.toLowerCase();
  if (/(form|formulaire|submit|soumission|lead|devis|quote|contact_request)/.test(value)) return "form";
  if (/(cta|click|clic|button|bouton|phone|tel|call|appel|email|mail|whatsapp|booking|rdv|reservation)/.test(value)) return "cta";
  return "other";
}

const eventNames: [RegExp, string][] = [
  [/whatsapp/, "Clic WhatsApp"],
  [/(phone|tel|call|appel)/, "Clic sur numéro de téléphone"],
  [/(email|mail)/, "Clic sur email"],
  [/(form|formulaire|submit|soumission|lead|devis|quote)/, "Soumission de formulaire"],
  [/contact/, "Clic sur bouton « Contact »"],
  [/(image|photo|gallery|galerie)/, "Visionnage d’une image"],
  [/(cta|button|bouton)/, "Clic sur CTA"],
];

/** Libellé lisible ; le nom technique reste disponible en infobulle. */
export function eventLabel(name: string) {
  const value = name.toLowerCase();
  const known = eventNames.find(([pattern]) => pattern.test(value));
  if (known) return known[1];
  const words = name.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

type EventRow = { label?: string; count?: number; visitors?: number };

export function eventTotals(events: EventRow[] | undefined) {
  const totals = { form: 0, cta: 0, other: 0, all: 0 };
  for (const event of events ?? []) {
    if (!event.label) continue;
    const count = event.count ?? 0;
    totals[classifyEvent(event.label)] += count;
    totals.all += count;
  }
  return totals;
}

// ——— Sources de trafic ———

const searchHosts = /(^|\.)(google|bing|duckduckgo|qwant|ecosia|yahoo|yandex|baidu|startpage|brave|search\.lilo|lilo)\./;
const socialHosts = /(^|\.)(facebook|fb|instagram|linkedin|lnkd|t\.co|twitter|x\.com|tiktok|pinterest|youtube|youtu\.be|snapchat|reddit|threads|whatsapp|messenger)/;

export function channelOf(hostname: string): Exclude<ChannelKey, "all" | "direct"> {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  if (searchHosts.test(`.${host}`) || host.startsWith("google.")) return "search";
  if (socialHosts.test(`.${host}`) || host === "t.co" || host === "x.com") return "social";
  return "referral";
}

export type ChannelRow = { key: Exclude<ChannelKey, "all">; label: string; visitors: number; share: number | null; estimated: boolean };

/**
 * Regroupe les référents Vercel par canal. L'accès direct n'est pas fourni par Vercel :
 * il est estimé comme les visiteurs sans référent identifié (total − référents), et marqué comme tel.
 */
export function trafficChannels(data: AnalyticsData): ChannelRow[] {
  const totals: Record<Exclude<ChannelKey, "all" | "direct">, number> = { search: 0, referral: 0, social: 0 };
  for (const row of data.topReferrers ?? []) {
    if (!row.label) continue;
    totals[channelOf(row.label)] += row.visitors ?? 0;
  }
  const visitors = data.visitors ?? 0;
  const identified = totals.search + totals.referral + totals.social;
  const direct = Math.max(0, visitors - identified);
  const rows: ChannelRow[] = [
    { key: "search", label: "Recherche", visitors: totals.search, share: share(totals.search, visitors), estimated: false },
    { key: "direct", label: "Accès direct", visitors: direct, share: share(direct, visitors), estimated: true },
    { key: "referral", label: "Sites référents", visitors: totals.referral, share: share(totals.referral, visitors), estimated: false },
    { key: "social", label: "Réseaux sociaux", visitors: totals.social, share: share(totals.social, visitors), estimated: false },
  ];
  return rows.sort((a, b) => b.visitors - a.visitors);
}

// ——— Dimensions ———

let regionNames: Intl.DisplayNames | null = null;
export function countryLabel(code: string) {
  if (!/^[A-Za-z]{2}$/.test(code)) return code;
  try {
    regionNames ??= new Intl.DisplayNames(["fr"], { type: "region" });
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code.toUpperCase();
  }
}

/** Drapeau emoji à partir d'un code pays ISO alpha-2 ; null sinon. */
export function countryFlag(code: string) {
  if (!/^[A-Za-z]{2}$/.test(code)) return null;
  return String.fromCodePoint(...[...code.toUpperCase()].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65));
}

export function deviceLabel(value: string) {
  const key = value.toLowerCase();
  if (key === "mobile" || key === "smartphone") return "Mobile";
  if (key === "desktop" || key === "computer") return "Ordinateur";
  if (key === "tablet") return "Tablette";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function osLabel(value: string) {
  const key = value.toLowerCase();
  if (key === "ios" || key === "iphone os") return "iOS";
  if (key === "mac os" || key === "macos" || key === "mac os x") return "macOS";
  if (key === "linux" || key === "ubuntu" || key === "gnu/linux") return "GNU/Linux";
  if (key === "chrome os" || key === "chromeos") return "ChromeOS";
  return value;
}

export type ShareRow = { label: string; raw: string; value: number; share: number | null };

/** Top N lignes + « Autres » pour le reste du total, si le total le permet. */
export function topWithOthers(rows: { label?: string; visitors?: number; pageviews?: number; count?: number }[] | undefined, metric: "visitors" | "pageviews" | "count", total: number, limit: number, format: (raw: string) => string = (raw) => raw): ShareRow[] {
  const valid = (rows ?? []).filter((row): row is typeof row & { label: string } => Boolean(row.label) && typeof row[metric] === "number");
  const top = valid.slice(0, limit).map((row) => ({ label: format(row.label), raw: row.label, value: row[metric] ?? 0, share: share(row[metric] ?? 0, total) }));
  const shown = top.reduce((sum, row) => sum + row.value, 0);
  const rest = total - shown;
  if (valid.length > limit && rest > 0) top.push({ label: "Autres", raw: "", value: rest, share: share(rest, total) });
  return top;
}

// ——— Séries temporelles ———

export type TrendPoint = { key: string; label: string; value: number };

function weekStart(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  const offset = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - offset);
  return iso(value);
}

/** Série du graphique principal. Les agrégats semaine/mois additionnent les valeurs quotidiennes. */
export function trendSeries(data: AnalyticsData, metric: TrendMetric, granularity: Granularity): TrendPoint[] {
  const daily: { date: string; value: number }[] = metric === "conversions"
    ? (data.eventTrend ?? []).flatMap((point) => point.timestamp ? [{ date: point.timestamp.slice(0, 10), value: point.count ?? 0 }] : [])
    : (data.trend ?? []).flatMap((point) => point.timestamp ? [{ date: point.timestamp.slice(0, 10), value: point[metric] ?? 0 }] : []);
  return bucket(daily, granularity);
}

export function previousTrendSeries(data: AnalyticsData, metric: TrendMetric, granularity: Granularity): TrendPoint[] {
  if (metric === "conversions") return [];
  const daily = (data.previous?.trend ?? []).flatMap((point) => point.timestamp ? [{ date: point.timestamp.slice(0, 10), value: point[metric] ?? 0 }] : []);
  return bucket(daily, granularity);
}

function bucket(daily: { date: string; value: number }[], granularity: Granularity): TrendPoint[] {
  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  if (granularity === "day") return sorted.map((point) => ({ key: point.date, label: shortDate(point.date), value: point.value }));
  const groups = new Map<string, number>();
  for (const point of sorted) {
    const key = granularity === "week" ? weekStart(point.date) : point.date.slice(0, 7);
    groups.set(key, (groups.get(key) ?? 0) + point.value);
  }
  return [...groups.entries()].map(([key, value]) => ({
    key,
    label: granularity === "week" ? `Sem. du ${shortDate(key)}` : new Date(`${key}-01T00:00:00Z`).toLocaleDateString("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" }),
    value,
  }));
}

export function availableGranularities(days: number): Granularity[] {
  return days >= 60 ? ["day", "week", "month"] : days >= 14 ? ["day", "week"] : ["day"];
}

// ——— KPI ———

export type Kpi = {
  key: "visitors" | "pageviews" | "pagesPerVisitor" | "forms" | "cta" | "conversions";
  label: string;
  value: number | null;
  format: "number" | "decimal";
  delta: number | null;
  deltaUnit: "%";
  spark: number[];
  hint: string;
};

export function buildKpis(data: AnalyticsData): Kpi[] {
  const visitors = data.visitors ?? 0;
  const pageviews = data.pageviews ?? 0;
  const previous = data.previous;
  const events = eventTotals(data.events);
  const before = previous?.events ? eventTotals(previous.events) : null;
  const hasEvents = (data.events ?? []).length > 0;
  const trend = (data.trend ?? []).filter((point) => point.timestamp);
  const ratio = (views?: number, people?: number) => typeof views === "number" && typeof people === "number" && people > 0 ? views / people : null;
  const pagesPerVisitor = ratio(pageviews, visitors);
  const previousPagesPerVisitor = ratio(previous?.pageviews, previous?.visitors);
  // Conversions = formulaires + clics CTA (les autres événements, ex. vues d'image, n'en sont pas).
  const conversions = events.form + events.cta;
  const conversionShare = visitors > 0 && conversions <= visitors ? Math.round((conversions / visitors) * 1000) / 10 : null;
  return [
    { key: "visitors", label: "Visiteurs uniques", value: visitors, format: "number", delta: pctDelta(visitors, previous?.visitors), deltaUnit: "%", spark: trend.map((point) => point.visitors ?? 0), hint: "Visiteurs anonymisés Vercel" },
    { key: "pageviews", label: "Vues de pages", value: pageviews, format: "number", delta: pctDelta(pageviews, previous?.pageviews), deltaUnit: "%", spark: trend.map((point) => point.pageviews ?? 0), hint: "Pages chargées sur la période" },
    { key: "pagesPerVisitor", label: "Pages par visiteur", value: pagesPerVisitor, format: "decimal", delta: pctDelta(pagesPerVisitor, previousPagesPerVisitor), deltaUnit: "%", spark: trend.map((point) => (point.visitors ?? 0) > 0 ? (point.pageviews ?? 0) / (point.visitors ?? 1) : 0), hint: "Engagement (taux de rebond non fourni)" },
    { key: "forms", label: "Formulaires envoyés", value: hasEvents ? events.form : null, format: "number", delta: before ? pctDelta(events.form, before.form) : null, deltaUnit: "%", spark: [], hint: hasEvents ? "Événements de type formulaire" : "Événements non instrumentés" },
    { key: "cta", label: "Clics sur CTA", value: hasEvents ? events.cta : null, format: "number", delta: before ? pctDelta(events.cta, before.cta) : null, deltaUnit: "%", spark: [], hint: hasEvents ? "Téléphone, email, boutons…" : "Événements non instrumentés" },
    { key: "conversions", label: "Conversions", value: hasEvents ? conversions : null, format: "number", delta: before ? pctDelta(conversions, before.form + before.cta) : null, deltaUnit: "%", spark: (data.eventTrend ?? []).map((point) => point.count ?? 0), hint: hasEvents ? `Formulaires + CTA${conversionShare !== null ? ` · ${conversionShare.toLocaleString("fr-FR")} % des visites` : ""}` : "Événements non instrumentés" },
  ];
}

// ——— Export ———

const csvCell = (value: string | number | null | undefined) => {
  const text = value === null || value === undefined ? "" : String(value);
  // Neutralise les formules tableur (=, +, -, @) issues de libellés externes.
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d/.test(text) ? `'${text}` : text;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Export CSV (séparateur « ; » pour Excel FR) des données affichées. */
export function analyticsCsv(data: AnalyticsData, meta: { client: string; period: AnalyticsPeriod }) {
  const lines: (string | number | null | undefined)[][] = [
    ["Client", meta.client],
    ["Période", `${meta.period.start} → ${meta.period.end}`],
    [],
    ["Indicateur", "Valeur", "Variation vs période précédente"],
    ...buildKpis(data).map((kpi) => [kpi.label, kpi.value === null ? "" : Math.round(kpi.value * 100) / 100, kpi.delta === null ? "" : `${kpi.delta} ${kpi.deltaUnit}`]),
    [],
    ["Date", "Visiteurs", "Vues de pages"],
    ...(data.trend ?? []).map((point) => [point.timestamp?.slice(0, 10), point.visitors ?? 0, point.pageviews ?? 0]),
  ];
  const section = (title: string, header: string[], rows: (string | number | null | undefined)[][]) => { lines.push([], [title], header, ...rows); };
  section("Pages les plus visitées", ["Page", "Visiteurs", "Vues"], (data.topPages ?? []).map((row) => [row.label, row.visitors ?? 0, row.pageviews ?? 0]));
  section("Référents", ["Domaine", "Canal", "Visiteurs"], (data.topReferrers ?? []).map((row) => [row.label, row.label ? channelLabels[channelOf(row.label)] : "", row.visitors ?? 0]));
  section("Pays", ["Pays", "Visiteurs"], (data.countries ?? []).map((row) => [row.label ? countryLabel(row.label) : "", row.visitors ?? 0]));
  section("Appareils", ["Appareil", "Visiteurs"], (data.devices ?? []).map((row) => [row.label ? deviceLabel(row.label) : "", row.visitors ?? 0]));
  section("Systèmes d’exploitation", ["Système", "Visiteurs"], (data.operatingSystems ?? []).map((row) => [row.label ? osLabel(row.label) : "", row.visitors ?? 0]));
  section("Événements", ["Événement", "Nom technique", "Visiteurs", "Total"], (data.events ?? []).map((row) => [row.label ? eventLabel(row.label) : "", row.label, row.visitors ?? 0, row.count ?? 0]));
  return lines.map((line) => line.map(csvCell).join(";")).join("\n");
}
