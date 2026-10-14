import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import { getActiveScenario } from "@/lib/simulation/server";
import { normalizeCustomerId } from "./validation";

/**
 * Explicitly gated Google Ads mutation transport. Not connected to the agent/UI yet.
 * Never pass arbitrary AI-generated Google Ads operation objects to this endpoint.
 */
export type NegativeKeywordProposal = {
  customerId: string;
  campaignId: string;
  text: string;
  matchType: "EXACT" | "PHRASE";
  managerId?: string;
};
export type ApprovedNegativeKeyword = NegativeKeywordProposal & {
  approvedByAdmin: true;
};

export function validateNegativeKeyword(input: NegativeKeywordProposal) {
  if (normalizeCustomerId(input.customerId) !== input.customerId) throw new Error("Compte Google Ads invalide.");
  if (input.managerId && normalizeCustomerId(input.managerId) !== input.managerId) throw new Error("Compte gestionnaire invalide.");
  if (!/^\d{1,20}$/.test(input.campaignId)) throw new Error("Campagne invalide.");
  const text = input.text.trim();
  if (!text || text.length > 80 || /[\r\n]/.test(text)) throw new Error("Mot-clé négatif invalide.");
  if (input.matchType !== "EXACT" && input.matchType !== "PHRASE") throw new Error("Correspondance invalide.");
  return { ...input, text };
}
export function previewNegativeKeyword(input: NegativeKeywordProposal) {
  const proposal = validateNegativeKeyword(input);
  return {
    ...proposal,
    impact: "Exclut les recherches correspondant à ce terme dans la campagne sélectionnée.",
    requiresApproval: true as const,
  };
}

/** Internal write primitive: caller MUST persist and verify a one-time admin approval first. */
export async function applyApprovedNegativeKeyword(input: ApprovedNegativeKeyword) {
  await requireAdmin();
  if (await getActiveScenario()) throw new Error("Modifications Google Ads interdites en simulation.");
  if (process.env.GOOGLE_ADS_MUTATIONS_ENABLED !== "true") throw new Error("Écriture Google Ads désactivée.");
  if (input.approvedByAdmin !== true) throw new Error("Approbation requise.");
  const proposal = validateNegativeKeyword(input);
  const id = process.env.GOOGLE_ADS_CLIENT_ID;
  const secret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refresh = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  if (!id || !secret || !refresh) throw new Error("OAuth Google Ads non configuré.");

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  if (!tokenResponse.ok) throw new Error("Autorisation Google Ads indisponible.");
  const tokenBody: unknown = await tokenResponse.json();
  if (!tokenBody || typeof tokenBody !== "object" || !("access_token" in tokenBody) || typeof tokenBody.access_token !== "string") {
    throw new Error("Jeton OAuth Google Ads invalide.");
  }
  const response = await fetch(`https://googleads.googleapis.com/v25/customers/${proposal.customerId}/googleAds:mutate`, {
    method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Bearer ${tokenBody.access_token}`,
      "Content-Type": "application/json",
      ...(proposal.managerId ? { "login-customer-id": proposal.managerId } : {}),
    },
    body: JSON.stringify({
      mutateOperations: [{
        campaignCriterionOperation: {
          create: {
            campaign: `customers/${proposal.customerId}/campaigns/${proposal.campaignId}`,
            negative: true,
            keyword: { text: proposal.text, matchType: proposal.matchType },
          },
        },
      }],
      partialFailure: false,
      validateOnly: false,
    }),
  });
  if (!response.ok) throw new Error("Échec de modification Google Ads : vérifiez les autorisations et le mot-clé.");
  const result: unknown = await response.json();
  return { applied: true as const, result };
}
