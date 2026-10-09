import "server-only";
// Google Ads — LECTURE SEULE (V1) : métriques de campagnes. Aucune mutation n'est implémentée.
import { googleAccessToken, providerJson, type FetchLike } from "@/lib/providers/api";
import { ProviderError } from "@/lib/providers/errors";

type Env = Record<string, string | undefined>;
export type CampaignMetrics = { id: string; name: string; status: string; impressions: number; clicks: number; cost: number; conversions: number; budget: number | null };

const customer = /^\d{10}$/;
const number = (value: unknown) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; };

export async function campaignMetrics(customerId: string, period: { start: string; end: string }, options: { managerId?: string | null; env?: Env; fetchImpl?: FetchLike } = {}): Promise<CampaignMetrics[]> {
  const env = options.env ?? process.env;
  if (!env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_REFRESH_TOKEN || !env.GOOGLE_ADS_DEVELOPER_TOKEN) throw new ProviderError("google-ads", "not_configured");
  const manager = options.managerId ?? env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? null;
  if (!customer.test(customerId) || (manager && !customer.test(manager))) throw new ProviderError("google-ads", "blocked");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period.start) || !/^\d{4}-\d{2}-\d{2}$/.test(period.end)) throw new ProviderError("google-ads", "blocked");
  const token = await googleAccessToken("google-ads", { clientId: env.GOOGLE_ADS_CLIENT_ID, clientSecret: env.GOOGLE_ADS_CLIENT_SECRET, refreshToken: env.GOOGLE_ADS_REFRESH_TOKEN }, options.fetchImpl);
  const query = `SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE campaign.status != 'REMOVED' AND segments.date BETWEEN '${period.start}' AND '${period.end}'`;
  const data = await providerJson<{ results?: unknown }>("google-ads", `https://googleads.googleapis.com/v21/customers/${customerId}/googleAds:search`, {
    method: "POST", fetchImpl: options.fetchImpl,
    headers: { Authorization: `Bearer ${token}`, "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN, "Content-Type": "application/json", ...(manager ? { "login-customer-id": manager } : {}) },
    body: JSON.stringify({ query }),
  });
  if (data.results === undefined) return [];
  if (!Array.isArray(data.results)) throw new ProviderError("google-ads", "malformed");
  const byId = new Map<string, CampaignMetrics>();
  for (const row of data.results as Record<string, Record<string, unknown> | undefined>[]) {
    const campaign = row.campaign, metrics = row.metrics;
    if (!campaign || typeof campaign.id !== "string" && typeof campaign.id !== "number") throw new ProviderError("google-ads", "malformed");
    const id = String(campaign.id);
    const current = byId.get(id) ?? { id, name: String(campaign.name ?? id).slice(0, 200), status: String(campaign.status ?? "UNKNOWN"), impressions: 0, clicks: 0, cost: 0, conversions: 0, budget: row.campaign_budget?.amountMicros !== undefined ? number(row.campaign_budget.amountMicros) / 1_000_000 : null };
    current.impressions += number(metrics?.impressions); current.clicks += number(metrics?.clicks); current.cost += number(metrics?.costMicros) / 1_000_000; current.conversions += number(metrics?.conversions);
    byId.set(id, current);
  }
  return [...byId.values()];
}
