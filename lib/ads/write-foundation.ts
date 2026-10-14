import "server-only";
import { googleAccessToken, providerJson, type FetchLike } from "@/lib/providers/api";

/**
 * Google Ads write foundation (opt-in).
 *
 * NOT an API route or agent tool. Only the existing admin-only approval workflow
 * may call executeApprovedAdsChange in a later integration step.
 * No campaign budget changes are supported here.
 */
const ID = /^\d{10}$/;
const RESOURCE_ID = /^\d+$/;
const KEYWORD = /^[^\n\r]{1,80}$/;
const MAX_NEGATIVES = 25;
type Env = Record<string, string | undefined>;

export type AdsChange =
  | { kind: "campaign_pause"; customerId: string; campaignId: string }
  | { kind: "campaign_enable"; customerId: string; campaignId: string }
  | { kind: "negative_keyword_add"; customerId: string; campaignId: string; keywords: { text: string; matchType: "EXACT" | "PHRASE" }[] };

export type AdsMutationPreview = {
  resource: string;
  operations: { create?: Record<string, unknown>; update?: Record<string, unknown>; updateMask?: string }[];
};

export function prepareAdsChange(change: AdsChange): AdsMutationPreview {
  if (!ID.test(change.customerId) || !RESOURCE_ID.test(change.campaignId)) {
    throw new Error("Identifiants Google Ads invalides.");
  }
  const campaign = `customers/${change.customerId}/campaigns/${change.campaignId}`;
  if (change.kind === "campaign_pause" || change.kind === "campaign_enable") {
    return {
      resource: "campaigns",
      operations: [{
        update: { resourceName: campaign, status: change.kind === "campaign_pause" ? "PAUSED" : "ENABLED" },
        updateMask: "status",
      }],
    };
  }
  if (change.keywords.length === 0 || change.keywords.length > MAX_NEGATIVES) {
    throw new Error("Nombre de mots-clés négatifs invalide.");
  }
  const seen = new Set<string>();
  const operations = change.keywords.map(({ text, matchType }) => {
    const normalized = text.trim().replace(/\s+/g, " ");
    if (!KEYWORD.test(normalized) || !["EXACT", "PHRASE"].includes(matchType)) {
      throw new Error("Mot-clé négatif invalide.");
    }
    const key = `${normalized.toLowerCase()}:${matchType}`;
    if (seen.has(key)) throw new Error("Mot-clé négatif en double.");
    seen.add(key);
    return { create: { campaign, negative: true, keyword: { text: normalized, matchType } } };
  });
  return { resource: "campaignCriteria", operations };
}

export async function executeApprovedAdsChange(
  change: AdsChange,
  options: {
    /** Must be provided by an authenticated admin approval workflow. */
    approved: true;
    /** Safe default: preview only, with no network request. */
    dryRun?: boolean;
    managerId?: string | null;
    env?: Env;
    fetchImpl?: FetchLike;
  },
): Promise<{ preview: AdsMutationPreview; executed: boolean; response?: unknown }> {
  const preview = prepareAdsChange(change);
  if (options.dryRun !== false) return { preview, executed: false };
  const env = options.env ?? process.env;
  // Fail closed until an audited approval/verification workflow is wired up.
  if (env.CODEV_GOOGLE_ADS_WRITES_ENABLED !== "true") {
    throw new Error("Écriture Google Ads désactivée.");
  }
  if (!env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_REFRESH_TOKEN || !env.GOOGLE_ADS_DEVELOPER_TOKEN) {
    throw new Error("Connexion Google Ads incomplète.");
  }
  const manager = options.managerId ?? env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? null;
  if (manager && !ID.test(manager)) throw new Error("Compte administrateur invalide.");
  const token = await googleAccessToken("google-ads", {
    clientId: env.GOOGLE_ADS_CLIENT_ID,
    clientSecret: env.GOOGLE_ADS_CLIENT_SECRET,
    refreshToken: env.GOOGLE_ADS_REFRESH_TOKEN,
  }, options.fetchImpl);
  const response = await providerJson<unknown>(
    "google-ads",
    `https://googleads.googleapis.com/v21/customers/${change.customerId}/${preview.resource}:mutate`,
    {
      method: "POST",
      fetchImpl: options.fetchImpl,
      headers: {
        Authorization: `Bearer ${token}`,
        "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN,
        "Content-Type": "application/json",
        ...(manager ? { "login-customer-id": manager } : {}),
      },
      body: JSON.stringify({ operations: preview.operations, partialFailure: false, validateOnly: false }),
    },
  );
  return { preview, executed: true, response };
}
