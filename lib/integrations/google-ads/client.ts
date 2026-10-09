import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import { accountSummaryQuery, campaignsQuery, campaignPerformanceQuery, accountPerformanceQuery } from "./queries";
import { normalizeCustomerId } from "./validation";
import type { AdsAccount, AdsCampaign, AdsMetrics, AdsPeriod, GoogleAdsReadClient } from "./types";

export class GoogleAdsError extends Error {
  constructor(public readonly kind: "configuration" | "authentication" | "access" | "quota" | "unavailable" | "response", public readonly requestId: string | null = null) {
    super("Google Ads est indisponible. Vérifiez la configuration et les droits du compte, puis réessayez.");
  }
}
type Row = Record<string, Record<string, unknown> | undefined>;
function safeRequestId(value: string | null) { return value && /^[\w-]{1,128}$/.test(value) ? value : null; }
function failure(response: Response) {
  return new GoogleAdsError(response.status === 401 ? "authentication" : response.status === 403 ? "access" : response.status === 429 ? "quota" : "unavailable", safeRequestId(response.headers.get("request-id")));
}
function numeric(value: unknown): number | null {
  if ((typeof value !== "number" && typeof value !== "string") || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
export function normalizeMetrics(input: Record<string, unknown> = {}): AdsMetrics {
  const micros = numeric(input.costMicros), cpc = numeric(input.averageCpc), conversions = numeric(input.conversions);
  const cost = micros === null ? null : micros / 1_000_000;
  return { impressions: numeric(input.impressions), clicks: numeric(input.clicks), cost, conversions, conversionValue: numeric(input.conversionsValue), ctr: numeric(input.ctr), averageCpc: cpc === null ? null : cpc / 1_000_000, costPerConversion: cost !== null && conversions !== null && conversions > 0 ? cost / conversions : null };
}
function text(value: unknown): string | null { return typeof value === "string" && value.length <= 1000 ? value : null; }

// Only these three read operations are public. OAuth credentials and raw transport stay private.
class RestGoogleAdsReadClient implements GoogleAdsReadClient {
  async #accessToken(): Promise<string> {
    const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) throw new GoogleAdsError("configuration");
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    });
    if (!response.ok) throw failure(response);
    const data = await response.json();
    if (typeof data.access_token !== "string" || !data.access_token || /[\r\n]/.test(data.access_token)) throw new GoogleAdsError("response");
    return data.access_token;
  }

  async #search(customerId: string, query: string, managerId?: string): Promise<Row[]> {
    await requireAdmin();
    if (normalizeCustomerId(customerId) !== customerId || managerId && normalizeCustomerId(managerId) !== managerId) throw new GoogleAdsError("configuration");
    try {
      const token = await this.#accessToken();
      const rows: Row[] = [];
      let pageToken: string | undefined;
      const seen = new Set<string>();
      do {
        const response = await fetch(`https://googleads.googleapis.com/v25/customers/${customerId}/googleAds:search`, {
          method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000),
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(managerId ? { "login-customer-id": managerId } : {}) },
          body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
        });
        if (!response.ok) throw failure(response);
        const body = await response.json();
        if (body.results !== undefined && !Array.isArray(body.results)) throw new GoogleAdsError("response");
        for (const row of body.results ?? []) {
          if (!row || typeof row !== "object" || Array.isArray(row)) throw new GoogleAdsError("response");
          rows.push(row);
        }
        if (rows.length > 50000) throw new GoogleAdsError("response");
        pageToken = body.nextPageToken || undefined;
        if (pageToken && (typeof pageToken !== "string" || seen.has(pageToken) || seen.size >= 100)) throw new GoogleAdsError("response");
        if (pageToken) seen.add(pageToken);
      } while (pageToken);
      return rows;
    } catch (error) {
      const mapped = error instanceof GoogleAdsError ? error : new GoogleAdsError("unavailable");
      console.error("[google-ads]", { type: mapped.kind, requestId: mapped.requestId, customerId, operation: "search" });
      throw mapped;
    }
  }

  async getAccountSummary(customerId: string, managerId?: string): Promise<AdsAccount> {
    const row = (await this.#search(customerId, accountSummaryQuery, managerId))[0]?.customer;
    const currency = text(row?.currencyCode), timezone = text(row?.timeZone);
    if (!row || String(row.id) !== customerId || !currency || !/^[A-Z]{3}$/.test(currency) || !timezone) throw new GoogleAdsError("response");
    try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { throw new GoogleAdsError("response"); }
    return { id: customerId, name: text(row.descriptiveName), currency, timezone };
  }

  async getCampaignPerformance(account: AdsAccount, period: AdsPeriod, managerId?: string) {
    const inventory = await this.#search(account.id, campaignsQuery, managerId);
    const performance = await this.#search(account.id, campaignPerformanceQuery(period), managerId);
    const totals = await this.#search(account.id, accountPerformanceQuery(period), managerId);
    const byId = new Map(performance.map((row) => [String(row.campaign?.id), normalizeMetrics(row.metrics)]));
    const campaigns: AdsCampaign[] = inventory.map((row) => {
      const campaign = row.campaign;
      if (!campaign || !/^\d+$/.test(String(campaign.id))) throw new GoogleAdsError("response");
      const budget = numeric(row.campaignBudget?.amountMicros);
      return { id: String(campaign.id), name: text(campaign.name) ?? "Campagne", status: text(campaign.status) ?? "UNKNOWN", channel: text(campaign.advertisingChannelType) ?? "UNKNOWN", budget: budget === null ? null : budget / 1_000_000, startDate: text(campaign.startDateTime), endDate: text(campaign.endDateTime), metrics: byId.get(String(campaign.id)) ?? normalizeMetrics() };
    });
    return { campaigns, totals: normalizeMetrics(totals[0]?.metrics) };
  }
}

export function createGoogleAdsReadClient(): GoogleAdsReadClient { return new RestGoogleAdsReadClient(); }
