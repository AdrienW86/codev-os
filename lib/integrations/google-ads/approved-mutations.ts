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
  /** Server-issued reference to a consumed one-time authorization, never a client boolean. */
  approvalId: string;
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

/**
 * Writes are intentionally unavailable until the one-time approval workflow,
 * account binding, transactional claim, audit and post-write verification exist.
 */
export async function applyApprovedNegativeKeyword(_input: ApprovedNegativeKeyword): Promise<never> {
  await requireAdmin();
  if (await getActiveScenario()) throw new Error("Modifications Google Ads interdites en simulation.");
  throw new Error("Écritures Google Ads désactivées : approbation sécurisée non implémentée.");
}
