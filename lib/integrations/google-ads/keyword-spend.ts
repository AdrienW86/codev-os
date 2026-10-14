import "server-only";
import { googleAccessToken, providerJson } from "@/lib/providers/api";
import { getGoogleAdsConnection } from "@/lib/integrations/google-ads/service";
import { requireAdmin } from "@/lib/require-admin";

export type AdsKeywordRow = {
  campaignId: string; campaignName: string; adGroupId: string;
  criterionId: string; text: string; matchType: string; status: string;
  impressions: number; clicks: number; cost: number; conversions: number;
};

/** Only reads the linked customer, never an untrusted customer id from the URL. */
export async function getClientKeywordSpend(clientId: string, period: { start: string; end: string }): Promise<AdsKeywordRow[]> {
  await requireAdmin();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period.start) || !/^\d{4}-\d{2}-\d{2}$/.test(period.end) || period.start > period.end) throw new Error("Période invalide.");
  const linked = await getGoogleAdsConnection(clientId);
  if (!linked || linked.status !== "connected" || !linked.external_account_id) throw new Error("Compte Google Ads non connecté.");
  const account = linked.external_account_id.replace(/-/g, "");
  const manager = linked.metadata.manager_customer_id?.replace(/-/g, "") ?? process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, "");
  if (!/^\d{10}$/.test(account) || (manager && !/^\d{10}$/.test(manager))) throw new Error("Compte Google Ads invalide.");
  const env = process.env;
  const token = await googleAccessToken("google-ads", {
    clientId: env.GOOGLE_ADS_CLIENT_ID, clientSecret: env.GOOGLE_ADS_CLIENT_SECRET,
    refreshToken: env.GOOGLE_ADS_REFRESH_TOKEN,
  });
  const query = `SELECT campaign.id, campaign.name, campaign.advertising_channel_type, ad_group.id,
    ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
    ad_group_criterion.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
    FROM keyword_view WHERE campaign.status != 'REMOVED'
    AND ad_group_criterion.status != 'REMOVED'
    AND segments.date BETWEEN '${period.start}' AND '${period.end}'
    ORDER BY metrics.cost_micros DESC LIMIT 300`;
  const json = await providerJson<{ results?: Array<{
    campaign?: { id?: string; name?: string; advertisingChannelType?: string };
    adGroup?: { id?: string };
    adGroupCriterion?: { criterionId?: string; keyword?: { text?: string; matchType?: string }; status?: string };
    metrics?: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number };
  }> }>("google-ads", `https://googleads.googleapis.com/v25/customers/${account}/googleAds:search`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(manager ? { "login-customer-id": manager } : {}) },
    body: JSON.stringify({ query }),
  });
  const rows = json.results ?? [];
  return rows.filter((r) => r.campaign?.advertisingChannelType !== "LOCAL_SERVICES").map((r) => ({
    campaignId: String(r.campaign?.id ?? ""), campaignName: r.campaign?.name ?? "",
    adGroupId: String(r.adGroup?.id ?? ""), criterionId: String(r.adGroupCriterion?.criterionId ?? ""),
    text: r.adGroupCriterion?.keyword?.text ?? "", matchType: r.adGroupCriterion?.keyword?.matchType ?? "",
    status: r.adGroupCriterion?.status ?? "UNKNOWN",
    impressions: Number(r.metrics?.impressions ?? 0), clicks: Number(r.metrics?.clicks ?? 0),
    cost: Number(r.metrics?.costMicros ?? 0) / 1_000_000, conversions: Number(r.metrics?.conversions ?? 0),
  }));
}
