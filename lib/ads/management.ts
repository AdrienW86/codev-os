import "server-only";
import { googleAccessToken, providerJson } from "@/lib/providers/api";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import { executeApprovedAdsChange, prepareAdsChange, type AdsChange } from "@/lib/ads/write-foundation";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const customer = /^\d{10}$/;
type Request = { clientId: string; change: AdsChange; confirm?: string; dryRun?: boolean };

export async function manageClientAds(actor: Actor & { kind: "admin" }, request: Request) {
  const { clientId, change } = request;
  if (!uuid.test(clientId)) throw new Error("Client invalide.");
  const db = getSupabaseServerClient();
  const { data: connection, error } = await db.from("client_connections")
    .select("external_account_id,status,metadata").eq("client_id", clientId)
    .eq("provider", "google_ads").maybeSingle();
  if (error || !connection || connection.status !== "connected") throw new Error("Compte Google Ads client non connecté.");
  const account = String(connection.external_account_id ?? "").replace(/-/g, "");
  if (!customer.test(account) || change.customerId !== account) throw new Error("Compte Google Ads non autorisé pour ce client.");
  const manager = (connection.metadata as { manager_customer_id?: string } | null)?.manager_customer_id?.replace(/-/g, "") ?? null;
  const preview = prepareAdsChange(change);
  if (request.dryRun !== false) return { executed: false, preview };
  if (request.confirm !== `CONFIRMER ${change.campaignId}`) throw new Error("Confirmation explicite requise.");
  if (process.env.CODEV_GOOGLE_ADS_WRITES_ENABLED !== "true") throw new Error("Écriture Google Ads non activée.");
  const env = process.env;
  if (!env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_REFRESH_TOKEN || !env.GOOGLE_ADS_DEVELOPER_TOKEN) {
    throw new Error("Identifiants Google Ads incomplets.");
  }
  // Verify target belongs to the selected customer, and do not touch Local Services.
  const token = await googleAccessToken("google-ads", {
    clientId: env.GOOGLE_ADS_CLIENT_ID, clientSecret: env.GOOGLE_ADS_CLIENT_SECRET,
    refreshToken: env.GOOGLE_ADS_REFRESH_TOKEN,
  });
  const headers = {
    Authorization: `Bearer ${token}`, "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN,
    "Content-Type": "application/json", ...(manager ? { "login-customer-id": manager } : {}),
  };
  const query = `SELECT campaign.id, campaign.status, campaign.advertising_channel_type FROM campaign WHERE campaign.id = ${change.campaignId} AND campaign.status != 'REMOVED' LIMIT 1`;
  const found = await providerJson<{ results?: { campaign?: { id: string | number; status: string; advertisingChannelType: string } }[] }>(
    "google-ads", `https://googleads.googleapis.com/v21/customers/${account}/googleAds:search`,
    { method: "POST", headers, body: JSON.stringify({ query }) },
  );
  const campaign = found.results?.[0]?.campaign;
  if (!campaign || String(campaign.id) !== change.campaignId || campaign.advertisingChannelType === "LOCAL_SERVICES") {
    throw new Error("Campagne non autorisée ou introuvable.");
  }
  if ("adGroupId" in change) {
    const groupQuery = `SELECT ad_group.id, ad_group.campaign FROM ad_group WHERE ad_group.id = ${change.adGroupId} LIMIT 1`;
    const group = await providerJson<{ results?: { adGroup?: { id: string | number; campaign: string } }[] }>(
      "google-ads", `https://googleads.googleapis.com/v21/customers/${account}/googleAds:search`,
      { method: "POST", headers, body: JSON.stringify({ query: groupQuery }) },
    );
    const selected = group.results?.[0]?.adGroup;
    if (!selected || String(selected.id) !== change.adGroupId || selected.campaign !== `customers/${account}/campaigns/${change.campaignId}`) {
      throw new Error("Groupe d'annonces extérieur à la campagne sélectionnée.");
    }
  }
  // Append an audit record before the external side effect. Fail closed if audit unavailable.
  await writeAudit(actor, { action: "ads.change.requested", resource_type: "client", resource_id: clientId,
    metadata: { account, campaignId: change.campaignId, kind: change.kind, preview } });
  try {
    const result = await executeApprovedAdsChange(change, { approved: true, dryRun: false, managerId: manager });
    // Read back only the resource actually mutated; never misreport another resource's status.
    let verified = false;
    if (change.kind === "campaign_pause" || change.kind === "campaign_enable") {
      const checked = await providerJson<{ results?: { campaign?: { status: string } }[] }>(
        "google-ads", `https://googleads.googleapis.com/v21/customers/${account}/googleAds:search`,
        { method: "POST", headers, body: JSON.stringify({ query }) },
      );
      verified = checked.results?.[0]?.campaign?.status === (change.kind === "campaign_pause" ? "PAUSED" : "ENABLED");
    }
    // Keywords and negatives require a separate adGroupCriterion/campaignCriterion readback.
    // Until implemented, report unverified rather than returning a false success.
    await writeAudit(actor, { action: "ads.change.executed", resource_type: "client", resource_id: clientId,
      metadata: { account, campaignId: change.campaignId, kind: change.kind, verified } });
    return { executed: true, verified, preview, result: result.response };
  } catch (failure) {
    await writeAudit(actor, { action: "ads.change.failed", resource_type: "client", resource_id: clientId,
      metadata: { account, campaignId: change.campaignId, kind: change.kind } });
    throw failure;
  }
}
