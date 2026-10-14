import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import { getGoogleAdsConnection } from "@/lib/integrations/google-ads/service";
import { googleAccessToken, providerJson } from "@/lib/providers/api";

const ID = /^\d{1,20}$/;
type Goal = { category?: string; origin?: string; biddable?: boolean };
type Conversion = { id?: string; name?: string; category?: string; status?: string; primaryForGoal?: boolean };
type Ad = { id?: string; status?: string; strength?: string; approval?: string; policyTopics?: string[] };
type Asset = { resourceName?: string; fieldType?: string; status?: string; primaryStatus?: string };
export type AdsDiagnostics = {
  campaignId: string; customerId: string; checkedAt: string;
  conversionActions: Conversion[]; campaignGoals: Goal[]; ads: Ad[]; assets: Asset[];
  issues: { severity: "high" | "medium"; title: string; detail: string; recommendation: string }[];
  unavailable: string[];
};
function descriptionOfPolicy(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 8).map(item => {
    if (!item || typeof item !== "object") return "Politique non précisée";
    const entry = item as { type?: unknown; topic?: unknown };
    return String(entry.topic ?? entry.type ?? "Politique non précisée").slice(0, 120);
  });
}
export function buildDiagnosticIssues(info: Pick<AdsDiagnostics, "conversionActions" | "campaignGoals" | "ads" | "assets" | "unavailable">): AdsDiagnostics["issues"] {
  const issues: AdsDiagnostics["issues"] = [];
  const knownConversions = !info.unavailable.includes("conversionActions");
  const knownGoals = !info.unavailable.includes("campaignGoals");
  if (knownConversions && knownGoals && info.campaignGoals.length > 0) {
    const usable = info.conversionActions.some(action =>
      action.status === "ENABLED" && action.primaryForGoal === true &&
      info.campaignGoals.some(goal => goal.biddable && goal.category === action.category));
    if (!usable) issues.push({ severity: "high", title: "Aucune conversion principale compatible détectée",
      detail: "Aucune action active et principale ne correspond aux catégories des objectifs enchérissables relevés. Les objectifs personnalisés et les conversions inter-comptes peuvent nécessiter un contrôle supplémentaire.",
      recommendation: "Examiner les objectifs de la campagne et les actions Contact, Formulaire et Appel avant toute modification des enchères." });
  }
  for (const asset of info.assets) {
    if (asset.primaryStatus === "NOT_ELIGIBLE") issues.push({ severity: "high",
      title: `Composant ${asset.fieldType ?? "inconnu"} non éligible`,
      detail: `Statut de diffusion : ${asset.primaryStatus} · ${asset.resourceName ?? "ressource non renseignée"}.`,
      recommendation: "Examiner le motif de refus dans Google Ads, corriger le composant, puis demander un réexamen si nécessaire." });
  }
  for (const ad of info.ads) {
    if (ad.approval === "DISAPPROVED") issues.push({ severity: "high", title: "Annonce refusée",
      detail: `Annonce ${ad.id ?? "non identifiée"} · politiques : ${ad.policyTopics?.join(", ") || "motif à consulter"}.`,
      recommendation: "Corriger les éléments refusés dans Google Ads puis demander un réexamen." });
    else if (ad.strength === "POOR") issues.push({ severity: "medium", title: "Qualité créative à améliorer",
      detail: `Annonce ${ad.id ?? "non identifiée"} : force de l'annonce faible.`,
      recommendation: "Proposer des titres et descriptions vérifiables, non répétitifs et adaptés aux prestations réelles." });
  }
  return issues;
}
export async function getClientAdsDiagnostics(clientId: string, campaignId: string): Promise<AdsDiagnostics> {
  await requireAdmin();
  if (!ID.test(campaignId)) throw new Error("Campagne invalide.");
  const connection = await getGoogleAdsConnection(clientId);
  if (!connection || connection.status !== "connected" || !connection.external_account_id) throw new Error("Compte Google Ads non connecté.");
  const account = connection.external_account_id.replaceAll("-", "");
  const manager = connection.metadata.manager_customer_id?.replaceAll("-", "");
  if (!/^\d{10}$/.test(account) || (manager && !/^\d{10}$/.test(manager))) throw new Error("Compte invalide.");
  const env = process.env;
  const token = await googleAccessToken("google-ads", {
    clientId: env.GOOGLE_ADS_CLIENT_ID, clientSecret: env.GOOGLE_ADS_CLIENT_SECRET, refreshToken: env.GOOGLE_ADS_REFRESH_TOKEN,
  });
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json",
    ...(env.GOOGLE_ADS_DEVELOPER_TOKEN ? { "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN } : {}),
    ...(manager ? { "login-customer-id": manager } : {}) };
  const query = async <T,>(gaql: string): Promise<T[]> => {
    const rows: T[] = [];
    let pageToken: string | undefined;
    for (let n = 0; n < 10; n++) {
      const data = await providerJson<{ results?: T[]; nextPageToken?: string }>("google-ads",
        `https://googleads.googleapis.com/v25/customers/${account}/googleAds:search`,
        { method: "POST", headers, body: JSON.stringify({ query: gaql, ...(pageToken ? { pageToken } : {}) }) });
      if (data.results && !Array.isArray(data.results)) throw new Error("Réponse Google Ads invalide.");
      rows.push(...(data.results ?? []));
      if (!data.nextPageToken) return rows;
      pageToken = data.nextPageToken;
    }
    throw new Error("Diagnostics incomplets : pagination supérieure à la limite.");
  };
  const scope = await query<{ campaign?: { id?: string | number; advertisingChannelType?: string } }>(
    `SELECT campaign.id, campaign.advertising_channel_type FROM campaign WHERE campaign.id = ${campaignId} LIMIT 1`);
  if (String(scope[0]?.campaign?.id ?? "") !== campaignId || scope[0]?.campaign?.advertisingChannelType === "LOCAL_SERVICES") {
    throw new Error("Campagne introuvable ou type non pris en charge.");
  }
  const unavailable: string[] = [];
  async function safely<T>(section: string, gaql: string): Promise<T[]> {
    try { return await query<T>(gaql); }
    catch { unavailable.push(section); return []; }
  }
  const [actions, goals, ads, assets] = await Promise.all([
    safely<{ conversionAction?: { id?: string; name?: string; category?: string; status?: string; primaryForGoal?: boolean } }>(
      "conversionActions", "SELECT conversion_action.id, conversion_action.name, conversion_action.category, conversion_action.status, conversion_action.primary_for_goal FROM conversion_action WHERE conversion_action.status != 'REMOVED' LIMIT 500"),
    safely<{ campaignConversionGoal?: Goal }>(
      "campaignGoals", `SELECT campaign_conversion_goal.category, campaign_conversion_goal.origin, campaign_conversion_goal.biddable FROM campaign_conversion_goal WHERE campaign.id = ${campaignId} LIMIT 100`),
    safely<{ adGroupAd?: { ad?: { id?: string }; status?: string; adStrength?: string; policySummary?: { approvalStatus?: string; policyTopicEntries?: unknown } } }>(
      "ads", `SELECT ad_group_ad.ad.id, ad_group_ad.status, ad_group_ad.ad_strength, ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.policy_topic_entries FROM ad_group_ad WHERE campaign.id = ${campaignId} AND ad_group_ad.status != 'REMOVED' LIMIT 500`),
    safely<{ campaignAsset?: { resourceName?: string; fieldType?: string; status?: string; primaryStatus?: string } }>(
      "assets", `SELECT campaign_asset.resource_name, campaign_asset.field_type, campaign_asset.status, campaign_asset.primary_status FROM campaign_asset WHERE campaign.id = ${campaignId} AND campaign_asset.status != 'REMOVED' LIMIT 500`),
  ]);
  const report: AdsDiagnostics = {
    campaignId, customerId: account, checkedAt: new Date().toISOString(), unavailable,
    conversionActions: actions.map(a => a.conversionAction ?? {}),
    campaignGoals: goals.map(a => a.campaignConversionGoal ?? {}),
    ads: ads.map(a => ({ id: a.adGroupAd?.ad?.id, status: a.adGroupAd?.status,
      strength: a.adGroupAd?.adStrength, approval: a.adGroupAd?.policySummary?.approvalStatus,
      policyTopics: descriptionOfPolicy(a.adGroupAd?.policySummary?.policyTopicEntries) })),
    assets: assets.map(a => a.campaignAsset ?? {}),
    issues: [],
  };
  report.issues = buildDiagnosticIssues(report);
  return report;
}
