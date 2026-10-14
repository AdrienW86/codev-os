import "server-only";
import { adsChangeFingerprint } from "./approval-protocol";
import { requireAdmin } from "@/lib/require-admin";
import { getActiveScenario } from "@/lib/simulation/server";
import { googleAccessToken, providerJson } from "@/lib/providers/api";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import { executeApprovedAdsChange, prepareAdsChange, type AdsChange } from "@/lib/ads/write-foundation";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const customer = /^\d{10}$/;
type Request = { clientId: string; change: AdsChange; confirm?: string; dryRun?: boolean; approvalId?: string };

export async function manageClientAds(actor: Actor & { kind: "admin" }, request: Request) {
  const { userId } = await requireAdmin();
  if (actor.kind !== "admin" || actor.userId !== userId) throw new Error("Administrateur non autorisé.");
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
  if (await getActiveScenario()) throw new Error("Écritures Google Ads interdites en simulation.");
  if (request.confirm !== `CONFIRMER ${change.campaignId}`) throw new Error("Confirmation explicite requise.");
  if (process.env.CODEV_GOOGLE_ADS_WRITES_ENABLED !== "true") throw new Error("Écriture Google Ads non activée.");
  const hash = adsChangeFingerprint(change);
  const approvalDb = db as unknown as { from: (table: string) => any; rpc: (name: string, args: Record<string, string>) => Promise<{data: unknown; error: unknown}> };
  if (!request.approvalId) {
    const { data, error: approvalError } = await approvalDb.from("ads_change_approvals").insert({
      client_id: clientId, account_id: account, campaign_id: change.campaignId,
      actor_id: userId, operation_kind: change.kind, operation_sha256: hash,
    }).select("id").single();
    if (approvalError || !data) throw new Error("Approbation indisponible : migration Supabase à vérifier.");
    return { executed: false, requiresApproval: true, approvalId: data.id, preview };
  }
  if (!uuid.test(request.approvalId)) throw new Error("Approbation invalide.");
  const { data: claimed, error: claimError } = await approvalDb.rpc("codev_claim_ads_change", {
    p_id: request.approvalId, p_client_id: clientId, p_account_id: account,
    p_campaign_id: change.campaignId, p_actor_id: userId, p_operation_sha256: hash,
  });
  if (claimError || claimed !== true) throw new Error("Approbation expirée ou déjà consommée.");
  const complete = async (status: "succeeded" | "uncertain") => {
    const { error } = await approvalDb.from("ads_change_approvals").update({
      status, completed_at: new Date().toISOString(),
    }).eq("id", request.approvalId).eq("status", "executing");
    if (error) console.error("[ads] approval status update failed");
  };
  const env = process.env;
  if (!env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_REFRESH_TOKEN) {
    throw new Error("Identifiants Google Ads incomplets.");
  }
  // Verify target belongs to the selected customer, and do not touch Local Services.
  const token = await googleAccessToken("google-ads", {
    clientId: env.GOOGLE_ADS_CLIENT_ID, clientSecret: env.GOOGLE_ADS_CLIENT_SECRET,
    refreshToken: env.GOOGLE_ADS_REFRESH_TOKEN,
  });
  const headers = {
    Authorization: `Bearer ${token}`, ...(env.GOOGLE_ADS_DEVELOPER_TOKEN ? { "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN } : {}),
    "Content-Type": "application/json", ...(manager ? { "login-customer-id": manager } : {}),
  };
  const query = `SELECT campaign.id, campaign.status, campaign.advertising_channel_type FROM campaign WHERE campaign.id = ${change.campaignId} AND campaign.status != 'REMOVED' LIMIT 1`;
  const found = await providerJson<{ results?: { campaign?: { id: string | number; status: string; advertisingChannelType: string } }[] }>(
    "google-ads", `https://googleads.googleapis.com/v25/customers/${account}/googleAds:search`,
    { method: "POST", headers, body: JSON.stringify({ query }) },
  );
  const campaign = found.results?.[0]?.campaign;
  if (!campaign || String(campaign.id) !== change.campaignId || campaign.advertisingChannelType === "LOCAL_SERVICES") {
    throw new Error("Campagne non autorisée ou introuvable.");
  }
  if ("adGroupId" in change) {
    const groupQuery = `SELECT ad_group.id, ad_group.campaign FROM ad_group WHERE ad_group.id = ${change.adGroupId} LIMIT 1`;
    const group = await providerJson<{ results?: { adGroup?: { id: string | number; campaign: string } }[] }>(
      "google-ads", `https://googleads.googleapis.com/v25/customers/${account}/googleAds:search`,
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
        "google-ads", `https://googleads.googleapis.com/v25/customers/${account}/googleAds:search`,
        { method: "POST", headers, body: JSON.stringify({ query }) },
      );
      verified = checked.results?.[0]?.campaign?.status === (change.kind === "campaign_pause" ? "PAUSED" : "ENABLED");
    }
    if (change.kind === "keyword_pause" || change.kind === "keyword_enable") {
      const criterionQuery = `SELECT ad_group_criterion.criterion_id, ad_group_criterion.status
        FROM ad_group_criterion WHERE ad_group.id = ${change.adGroupId}
        AND ad_group_criterion.criterion_id = ${change.criterionId} LIMIT 1`;
      const checked = await providerJson<{ results?: { adGroupCriterion?: { criterionId?: string | number; status?: string } }[] }>(
        "google-ads", `https://googleads.googleapis.com/v25/customers/${account}/googleAds:search`,
        { method: "POST", headers, body: JSON.stringify({ query: criterionQuery }) },
      );
      const criterion = checked.results?.[0]?.adGroupCriterion;
      verified = String(criterion?.criterionId ?? "") === change.criterionId &&
        criterion?.status === (change.kind === "keyword_pause" ? "PAUSED" : "ENABLED");
    }
    if (change.kind === "keyword_add" || change.kind === "negative_keyword_add") {
      // The mutation receipt only means accepted by the API. Never claim a readback
      // of newly-created criteria until their resource names have been queried.
      verified = false;
    }
    await writeAudit(actor, { action: "ads.change.executed", resource_type: "client", resource_id: clientId,
      metadata: { account, campaignId: change.campaignId, kind: change.kind, verified } });
    await complete("succeeded");
    return { executed: true, verified, preview, result: result.response };
  } catch (failure) {
    await complete("uncertain");
    await writeAudit(actor, { action: "ads.change.failed", resource_type: "client", resource_id: clientId,
      metadata: { account, campaignId: change.campaignId, kind: change.kind } });
    throw failure;
  }
}
