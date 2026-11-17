// Google Analytics 4 : règles pures (propriétés, rapports, instantané, signaux pour les agents SEO et Google Ads).
// Sans réseau, sans secret, utilisable côté client et dans les tests. Aucune valeur n'est inventée : une donnée
// absente reste `null` (ou un bloc marqué non récupéré) et l'interface comme les agents le disent.

export const GOOGLE_ANALYTICS_PROVIDER = "google-analytics";
export const GOOGLE_ANALYTICS_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
/** Instantané `metric_snapshots` (provider google-analytics, metric_key ga4). */
export const GOOGLE_ANALYTICS_METRIC_KEY = "ga4";
export const GOOGLE_ANALYTICS_SNAPSHOT_VERSION = 1;
/** Fenêtre analysée chaque jour : 30 jours terminés la veille (comme la veille Google Ads), comparés aux 30 précédents. */
export const GOOGLE_ANALYTICS_WINDOW_DAYS = 30;

// ——— Propriétés ———

/** Identifiant numérique de propriété GA4 (« 123456789 » ou « properties/123456789 »), sinon null. */
export function normalizePropertyId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().replace(/^properties\//i, "");
  return /^[1-9]\d{3,14}$/.test(value) ? value : null;
}

export type DiscoveredAnalyticsProperty = { property: string; name: string; account: string };

const label = (value: unknown, max = 120) => typeof value === "string" ? value.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max) : "";

/** Réponse `accountSummaries.list` (Admin API) → propriétés GA4 accessibles, dédoublonnées et triées. */
export function normalizeAccountSummaries(body: unknown): DiscoveredAnalyticsProperty[] {
  const accounts = body && typeof body === "object" && Array.isArray((body as { accountSummaries?: unknown }).accountSummaries) ? (body as { accountSummaries: unknown[] }).accountSummaries : [];
  const seen = new Map<string, DiscoveredAnalyticsProperty>();
  for (const account of accounts.slice(0, 200)) {
    if (!account || typeof account !== "object") continue;
    const accountName = label((account as { displayName?: unknown }).displayName) || "Compte sans nom";
    const properties = Array.isArray((account as { propertySummaries?: unknown }).propertySummaries) ? (account as { propertySummaries: unknown[] }).propertySummaries : [];
    for (const item of properties.slice(0, 500)) {
      if (!item || typeof item !== "object") continue;
      const property = normalizePropertyId((item as { property?: unknown }).property);
      if (!property || seen.has(property)) continue;
      seen.set(property, { property, name: label((item as { displayName?: unknown }).displayName) || `Propriété ${property}`, account: accountName });
    }
  }
  return [...seen.values()].sort((a, b) => a.account.localeCompare(b.account) || a.name.localeCompare(b.name) || a.property.localeCompare(b.property));
}

/** Liste lue depuis les métadonnées non sensibles de la connexion globale. */
export function storedAnalyticsProperties(metadata: unknown): DiscoveredAnalyticsProperty[] {
  const list = metadata && typeof metadata === "object" && Array.isArray((metadata as { properties?: unknown }).properties) ? (metadata as { properties: unknown[] }).properties : [];
  return normalizeAccountSummaries({ accountSummaries: list.map((item) => item && typeof item === "object" ? { displayName: (item as { account?: unknown }).account, propertySummaries: [{ property: (item as { property?: unknown }).property, displayName: (item as { name?: unknown }).name }] } : null) });
}

export const analyticsPropertyLabel = (item: DiscoveredAnalyticsProperty) => `${item.name} · ${item.account} (${item.property})`;

// ——— Périodes ———

export type Period = { start: string; end: string };
export function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
/** Fenêtre quotidienne : 30 jours terminés la veille (jour de Paris), et les 30 jours précédents. */
export function analyticsWindow(now: Date): { period: Period; previous: Period } {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const end = addDays(today, -1);
  const start = addDays(end, -(GOOGLE_ANALYTICS_WINDOW_DAYS - 1));
  return { period: { start, end }, previous: { start: addDays(start, -GOOGLE_ANALYTICS_WINDOW_DAYS), end: addDays(start, -1) } };
}

// ——— Rapports (Data API runReport) ———

export type ReportRow = { dimensions: string[]; metrics: number[] };
export type ParsedReport = { rows: ReportRow[]; thresholded: boolean; otherRow: boolean };

/** Réponse runReport → lignes typées (une métrique non numérique rend la réponse invalide, jamais complétée). */
export function parseReport(body: unknown, dimensionCount: number, metricCount: number): ParsedReport | null {
  if (!body || typeof body !== "object") return null;
  const value = body as { rows?: unknown; metadata?: { subjectToThresholding?: unknown; dataLossFromOtherRow?: unknown } };
  if (value.rows !== undefined && !Array.isArray(value.rows)) return null;
  const rows: ReportRow[] = [];
  for (const raw of (value.rows as unknown[] | undefined) ?? []) {
    const row = raw as { dimensionValues?: { value?: unknown }[]; metricValues?: { value?: unknown }[] };
    if (!Array.isArray(row?.dimensionValues) || !Array.isArray(row?.metricValues) || row.dimensionValues.length !== dimensionCount || row.metricValues.length !== metricCount) return null;
    const metrics = row.metricValues.map((item) => Number(item?.value));
    if (metrics.some((item) => !Number.isFinite(item) || item < 0)) return null;
    rows.push({ dimensions: row.dimensionValues.map((item) => label(item?.value, 500)), metrics });
  }
  return { rows, thresholded: value.metadata?.subjectToThresholding === true, otherRow: value.metadata?.dataLossFromOtherRow === true };
}

// ——— Instantané ———

export type TrafficMetrics = { sessions: number; users: number | null; newUsers: number | null; engagedSessions: number; keyEvents: number; pageViews: number | null; averageSessionSeconds: number | null };
/** Taux calculés (jamais la moyenne de taux) : engagement = sessions engagées ÷ sessions, conversion = événements clés ÷ sessions. */
export const engagementRate = (row: { sessions: number; engagedSessions: number }) => row.sessions > 0 ? row.engagedSessions / row.sessions : null;
export const keyEventRate = (row: { sessions: number; keyEvents: number }) => row.sessions > 0 ? row.keyEvents / row.sessions : null;

export type SegmentRow = { key: string; sessions: number; engagedSessions: number; keyEvents: number };
export type LandingRow = SegmentRow & { channel: string };
export type KeyEventRow = { name: string; count: number };
export type AnalyticsSectionKey = "totals" | "previousTotals" | "channels" | "previousChannels" | "landingPages" | "sourceMedium" | "adsCampaigns" | "keyEvents" | "devices";
export type AnalyticsSnapshot = {
  version: number;
  property: string;
  period: Period;
  previousPeriod: Period;
  totals: TrafficMetrics | null;
  previousTotals: TrafficMetrics | null;
  /** Groupes de canaux par défaut GA4 (Organic Search, Paid Search, Direct…). */
  channels: SegmentRow[];
  previousChannels: SegmentRow[];
  /** Pages de destination × canal (250 premières par sessions). */
  landingPages: LandingRow[];
  sourceMedium: SegmentRow[];
  /** Campagnes Google Ads vues par GA4 (liaison Ads ↔ GA4 requise, sinon vide). */
  adsCampaigns: SegmentRow[];
  /** Événements clés (conversions GA4) réellement déclenchés sur la période. */
  keyEvents: KeyEventRow[];
  devices: SegmentRow[];
  /** Données seuillées par Google (petits volumes masqués) ou regroupées dans « (other) ». */
  thresholded: boolean;
  sections: Partial<Record<AnalyticsSectionKey, { ok: true } | { ok: false; error: string }>>;
};

export const TOTAL_METRICS = ["sessions", "totalUsers", "newUsers", "engagedSessions", "keyEvents", "screenPageViews", "averageSessionDuration"] as const;
export const SEGMENT_METRICS = ["sessions", "engagedSessions", "keyEvents"] as const;

export function totalsFrom(report: ParsedReport | null): TrafficMetrics | null {
  const row = report?.rows[0];
  if (!report) return null;
  if (!row) return { sessions: 0, users: 0, newUsers: 0, engagedSessions: 0, keyEvents: 0, pageViews: 0, averageSessionSeconds: null };
  const [sessions, users, newUsers, engagedSessions, keyEvents, pageViews, duration] = row.metrics;
  return { sessions, users, newUsers, engagedSessions, keyEvents, pageViews, averageSessionSeconds: sessions > 0 ? duration : null };
}
export function segmentsFrom(report: ParsedReport | null, limit: number): SegmentRow[] {
  return (report?.rows ?? []).filter((row) => row.dimensions[0]).slice(0, limit).map((row) => ({ key: row.dimensions[0].slice(0, 300), sessions: row.metrics[0], engagedSessions: row.metrics[1], keyEvents: row.metrics[2] }));
}
export function landingFrom(report: ParsedReport | null, limit: number): LandingRow[] {
  return (report?.rows ?? []).filter((row) => row.dimensions[0] && row.dimensions[0] !== "(not set)").slice(0, limit).map((row) => ({ key: row.dimensions[0].slice(0, 500), channel: row.dimensions[1] || "Unassigned", sessions: row.metrics[0], engagedSessions: row.metrics[1], keyEvents: row.metrics[2] }));
}
export function keyEventsFrom(report: ParsedReport | null): KeyEventRow[] {
  return (report?.rows ?? []).filter((row) => row.dimensions[0] && row.metrics[0] > 0).slice(0, 30).map((row) => ({ name: row.dimensions[0].slice(0, 100), count: row.metrics[0] }));
}

/** Lecture tolérante d'un instantané stocké (version inconnue ou forme invalide → null, jamais complété). */
export function parseAnalyticsSnapshot(data: unknown): AnalyticsSnapshot | null {
  const value = data as Partial<AnalyticsSnapshot> | null;
  if (!value || typeof value !== "object" || value.version !== GOOGLE_ANALYTICS_SNAPSHOT_VERSION || typeof value.property !== "string") return null;
  if (!value.period || !Array.isArray(value.channels) || !Array.isArray(value.landingPages) || !Array.isArray(value.keyEvents) || !value.sections) return null;
  return value as AnalyticsSnapshot;
}

// ——— Signaux pour les agents ———

export const ORGANIC_CHANNEL = "Organic Search";
export const PAID_SEARCH_CHANNEL = "Paid Search";
const pct = (value: number) => `${Math.round(value * 100)} %`;
export const pathOfLanding = (value: string) => value.split(/[?#]/)[0].replace(/\/+$/, "") || "/";

/** Agrégat d'un canal sur les pages de destination (ou null si le bloc n'a pas été lu). */
function landingFor(snapshot: AnalyticsSnapshot, channel: string) {
  if (!snapshot.sections.landingPages?.ok) return null;
  const byPath = new Map<string, SegmentRow>();
  for (const row of snapshot.landingPages.filter((item) => item.channel === channel)) {
    const key = pathOfLanding(row.key), found = byPath.get(key);
    if (found) { found.sessions += row.sessions; found.engagedSessions += row.engagedSessions; found.keyEvents += row.keyEvents; }
    else byPath.set(key, { key, sessions: row.sessions, engagedSessions: row.engagedSessions, keyEvents: row.keyEvents });
  }
  return [...byPath.values()].sort((a, b) => b.sessions - a.sessions);
}

export type OrganicLanding = { path: string; sessions: number; engagementRate: number | null; keyEvents: number; keyEventRate: number | null };
/** Pages d'arrivée du trafic organique (canal Organic Search) avec engagement et événements clés. */
export function organicLandingPages(snapshot: AnalyticsSnapshot | null): OrganicLanding[] | null {
  const rows = snapshot ? landingFor(snapshot, ORGANIC_CHANNEL) : null;
  return rows ? rows.map((row) => ({ path: row.key, sessions: row.sessions, engagementRate: engagementRate(row), keyEvents: row.keyEvents, keyEventRate: keyEventRate(row) })) : null;
}

export type AnalyticsInsight = { id: string; priority: "high" | "medium" | "low"; title: string; detail: string; action: string; items: string[] };

/**
 * Constats SEO tirés de GA4 (pur) : pages qui attirent du trafic organique sans générer d'événement clé alors que le
 * site en enregistre ailleurs, engagement organique faible, mesure absente. Seuils prudents, chiffres lus tels quels.
 */
export function seoAnalyticsInsights(snapshot: AnalyticsSnapshot | null): AnalyticsInsight[] {
  if (!snapshot || !snapshot.totals) return [];
  const insights: AnalyticsInsight[] = [];
  const organic = organicLandingPages(snapshot) ?? [];
  const period = `${snapshot.period.start} → ${snapshot.period.end}`;
  if (snapshot.sections.keyEvents?.ok && snapshot.keyEvents.length === 0 && snapshot.totals.sessions >= 100) {
    insights.push({ id: "ga:no_key_events", priority: "high", title: "Aucun événement clé mesuré dans Google Analytics",
      detail: `${snapshot.totals.sessions.toLocaleString("fr-FR")} sessions sur ${period} sans aucun événement clé : impossible de savoir quelles pages génèrent des demandes.`,
      action: "Déclarer comme événements clés dans GA4 les actions de contact (formulaire envoyé, clic sur le téléphone, clic e-mail), puis vérifier leur déclenchement.", items: [] });
    return insights;
  }
  const siteConverts = snapshot.totals.keyEvents > 0;
  const leaking = organic.filter((row) => row.sessions >= 40 && row.keyEvents === 0).slice(0, 10);
  if (siteConverts && leaking.length) insights.push({ id: "ga:organic_no_conversion", priority: leaking.some((row) => row.sessions >= 150) ? "high" : "medium",
    title: "Pages qui attirent du trafic Google sans générer de demande",
    detail: `${leaking.length} page(s) reçoivent du trafic organique sur ${period} sans aucun événement clé, alors que le site en enregistre ${snapshot.totals.keyEvents.toLocaleString("fr-FR")} au total.`,
    action: "Ajouter sur ces pages un appel à l’action visible (téléphone, formulaire court, devis), vérifier qu’il répond à l’intention de la recherche et que le suivi s’y déclenche.",
    items: leaking.map((row) => `${row.path} (${row.sessions.toLocaleString("fr-FR")} sessions organiques, engagement ${row.engagementRate === null ? "inconnu" : pct(row.engagementRate)})`) });
  const disengaged = organic.filter((row) => row.sessions >= 50 && row.engagementRate !== null && row.engagementRate < 0.35).slice(0, 10);
  if (disengaged.length) insights.push({ id: "ga:organic_low_engagement", priority: "medium",
    title: "Visiteurs Google qui repartent sans interagir",
    detail: `${disengaged.length} page(s) d’arrivée organiques ont moins de 35 % de sessions engagées sur ${period} : le contenu ne correspond probablement pas à ce que la recherche promettait, ou la page est lente.`,
    action: "Comparer le title et la requête qui amène le visiteur avec le haut de la page ; vérifier la vitesse mobile ; renforcer la réponse dès le premier écran.",
    items: disengaged.map((row) => `${row.path} (${row.sessions.toLocaleString("fr-FR")} sessions, engagement ${pct(row.engagementRate!)})`) });
  return insights;
}

export type AdsAnalyticsSignals = {
  period: Period;
  /** Sessions et événements clés des visiteurs venus des campagnes Google Ads selon GA4. */
  paid: { sessions: number; engagedSessions: number; keyEvents: number; source: "ads_campaigns" | "google_cpc" } | null;
  /** Pages de destination du canal Paid Search. */
  landings: { path: string; sessions: number; engagementRate: number | null; keyEvents: number }[];
  campaigns: { name: string; sessions: number; engagementRate: number | null; keyEvents: number }[];
  keyEventsTracked: boolean;
};

/** Signaux GA4 utiles à l'Agent Google Ads (null si l'instantané est absent ou si aucun bloc payant n'a été lu). */
export function adsAnalyticsSignals(snapshot: AnalyticsSnapshot | null): AdsAnalyticsSignals | null {
  if (!snapshot) return null;
  const campaigns = snapshot.sections.adsCampaigns?.ok ? snapshot.adsCampaigns.filter((row) => row.key !== "(not set)" && row.key !== "(organic)" && row.key !== "(direct)") : [];
  const cpc = snapshot.sections.sourceMedium?.ok ? snapshot.sourceMedium.find((row) => row.key.replace(/\s+/g, "") === "google/cpc") ?? null : null;
  const sum = (rows: SegmentRow[]) => rows.reduce((acc, row) => ({ sessions: acc.sessions + row.sessions, engagedSessions: acc.engagedSessions + row.engagedSessions, keyEvents: acc.keyEvents + row.keyEvents }), { sessions: 0, engagedSessions: 0, keyEvents: 0 });
  const paid = campaigns.length ? { ...sum(campaigns), source: "ads_campaigns" as const } : cpc ? { sessions: cpc.sessions, engagedSessions: cpc.engagedSessions, keyEvents: cpc.keyEvents, source: "google_cpc" as const } : null;
  const landings = (landingFor(snapshot, PAID_SEARCH_CHANNEL) ?? []).map((row) => ({ path: row.key, sessions: row.sessions, engagementRate: engagementRate(row), keyEvents: row.keyEvents }));
  if (!paid && !landings.length) return null;
  return {
    period: snapshot.period, paid, landings,
    campaigns: campaigns.map((row) => ({ name: row.key, sessions: row.sessions, engagementRate: engagementRate(row), keyEvents: row.keyEvents })),
    keyEventsTracked: Boolean(snapshot.sections.keyEvents?.ok && snapshot.keyEvents.length > 0),
  };
}
