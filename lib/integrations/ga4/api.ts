import "server-only";
import { providerJson, type FetchLike } from "@/lib/providers/api";
import { normalizeGa4Property, parseGa4AccountSummaries, count, rate, type Ga4Property, type Ga4Metric, type Ga4DimensionRow, type Ga4DailyRow, type Ga4EventRow } from "@/lib/integrations/ga4/model";

export async function discoverGa4Properties(token: string, fetchImpl?: FetchLike): Promise<Ga4Property[]> {
  const all: Ga4Property[] = [];
  let pageToken = "";
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ pageSize: "200" });
    if (pageToken) params.set("pageToken", pageToken);
    const body = await providerJson<{ accountSummaries?: unknown[]; nextPageToken?: unknown }>(
      "google-analytics", `https://analyticsadmin.googleapis.com/v1beta/accountSummaries?${params}`,
      { headers: { Authorization: `Bearer ${token}` }, fetchImpl });
    all.push(...parseGa4AccountSummaries(body));
    if (typeof body.nextPageToken !== "string" || !body.nextPageToken || body.nextPageToken === pageToken) break;
    pageToken = body.nextPageToken;
  }
  return [...new Map(all.map(item => [item.id, item])).values()];
}

export type Ga4Report = {
  rows?: Array<{ dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }>;
  totals?: Array<{ metricValues?: Array<{ value?: string }> }>;
};
export async function ga4RunReport(token: string, property: string, body: object, fetchImpl?: FetchLike): Promise<Ga4Report> {
  const id = normalizeGa4Property(property);
  if (!id) throw new Error("Invalid GA4 property ID");
  return providerJson<Ga4Report>("google-analytics",
    `https://analyticsdata.googleapis.com/v1beta/properties/${id}:runReport`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), fetchImpl });
}
const values = (row: { metricValues?: Array<{ value?: string }> }) => row.metricValues?.map(x => x.value ?? "") ?? [];
export function parseGa4Totals(body: Ga4Report): Ga4Metric {
  const row = body.rows?.[0] ?? body.totals?.[0];
  const v = row ? values(row) : [];
  return {
    sessions: count(v[0]), activeUsers: count(v[1]), pageViews: count(v[2]),
    engagedSessions: count(v[3]), engagementRate: rate(v[4]), bounceRate: rate(v[5]),
    eventCount: count(v[6]),
  };
}
export function parseGa4Dimensions(body: Ga4Report, opts: { labelIndex?: number } = {}): Ga4DimensionRow[] {
  return (body.rows ?? []).slice(0, 50).map(row => {
    const v = values(row);
    return {
      label: (row.dimensionValues?.[opts.labelIndex ?? 0]?.value ?? "(inconnu)").slice(0, 240),
      sessions: count(v[0]), engagementRate: rate(v[1]), bounceRate: rate(v[2]),
    };
  });
}
export function parseGa4Daily(body: Ga4Report): Ga4DailyRow[] {
  return (body.rows ?? []).slice(0, 366).map(row => {
    const raw = row.dimensionValues?.[0]?.value ?? "";
    const date = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : "";
    const v = values(row);
    return { date, sessions: count(v[0]), activeUsers: count(v[1]) };
  }).filter(row => Boolean(row.date)).sort((a, b) => a.date.localeCompare(b.date));
}
export function parseGa4Events(body: Ga4Report): Ga4EventRow[] {
  return (body.rows ?? []).slice(0, 50).map(row => ({
    name: (row.dimensionValues?.[0]?.value ?? "").slice(0, 80), count: count(values(row)[0]),
  })).filter(row => /^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(row.name));
}
