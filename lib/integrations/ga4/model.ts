/** Contrats publics de Google Analytics 4 (API Data et Admin) : aucune donnée personnelle. */
export const GA4_PROVIDER = "google-analytics";
export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
export const GA4_SNAPSHOT_VERSION = 1;
export const GA4_METRIC_KEY = "audience";
const numeric = /^[1-9][0-9]{0,19}$/;

export function normalizeGa4Property(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return numeric.test(v) ? v : null;
}

export type Ga4Property = { id: string; name: string; account: string };
export function parseGa4AccountSummaries(body: unknown): Ga4Property[] {
  const summaries = body && typeof body === "object" && Array.isArray((body as { accountSummaries?: unknown[] }).accountSummaries)
    ? (body as { accountSummaries: unknown[] }).accountSummaries : [];
  const found = new Map<string, Ga4Property>();
  for (const raw of summaries.slice(0, 200)) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as { account?: unknown; displayName?: unknown; propertySummaries?: unknown };
    if (typeof s.account !== "string" || !/^accounts\/[0-9]+$/.test(s.account)) continue;
    if (!Array.isArray(s.propertySummaries)) continue;
    for (const item of s.propertySummaries.slice(0, 500)) {
      if (!item || typeof item !== "object") continue;
      const property = item as { property?: unknown; displayName?: unknown };
      const id = typeof property.property === "string" ? normalizeGa4Property(property.property.replace(/^properties\//, "")) : null;
      if (id && !found.has(id)) found.set(id, {
        id, account: s.account,
        name: typeof property.displayName === "string" ? property.displayName.slice(0, 160) : "Propriété " + id,
      });
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
}
export function storedGa4Properties(metadata: unknown): Ga4Property[] {
  const items = metadata && typeof metadata === "object" ? (metadata as { properties?: unknown }).properties : null;
  if (!Array.isArray(items)) return [];
  const safe = new Map<string, Ga4Property>();
  for (const item of items.slice(0, 1000)) {
    if (!item || typeof item !== "object") continue;
    const v = item as Partial<Ga4Property>;
    const id = normalizeGa4Property(v.id);
    if (id && typeof v.name === "string" && typeof v.account === "string" && /^accounts\/[0-9]+$/.test(v.account))
      safe.set(id, { id, name: v.name.slice(0, 160), account: v.account });
  }
  return [...safe.values()];
}
export type Ga4Metric = { sessions: number; activeUsers: number; pageViews: number; engagedSessions: number; bounceRate: number | null; engagementRate: number | null; eventCount: number };
export type Ga4DimensionRow = { label: string; sessions: number; engagementRate: number | null; bounceRate: number | null };
export type Ga4EventRow = { name: string; count: number };
export type Ga4DailyRow = { date: string; sessions: number; activeUsers: number };
export type Ga4Snapshot = {
  version: 1; property: string; period: { start: string; end: string };
  totals: Ga4Metric; daily: Ga4DailyRow[]; pages: Ga4DimensionRow[];
  channels: Ga4DimensionRow[]; devices: Ga4DimensionRow[]; events: Ga4EventRow[];
  sections: Record<string, { ok: boolean; error?: string }>;
};
export function isGa4Snapshot(input: unknown, property: string, start: string, end: string): input is Ga4Snapshot {
  if (!input || typeof input !== "object") return false;
  const x = input as Partial<Ga4Snapshot>;
  return x.version === GA4_SNAPSHOT_VERSION && x.property === property && x.period?.start === start && x.period?.end === end
    && Boolean(x.totals) && Array.isArray(x.daily) && Array.isArray(x.pages) && Array.isArray(x.channels)
    && Array.isArray(x.devices) && Array.isArray(x.events);
}
/** Les données GA4 dépendent du consentement Analytics et peuvent être incomplètes à très faible trafic. */
export function rate(value: unknown): number | null {
  const n = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}
export function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
