import "server-only";
// Plan SEO hebdomadaire (Agent SEO, famille stratégie) : un appel mesuré, une correction au plus. Échec : rien n'est
// publié, les opportunités détectées par les règles restent telles quelles.
import { agentsAiConfigured } from "@/lib/ai/models";
import { structuredResponse, withAiScope } from "@/lib/ai/metered";
import { withCharter } from "@/lib/harness/charter";
import type { DetectedOpportunity } from "@/lib/seo/opportunities";
import { SEO_PLAN_INSTRUCTIONS, seoPlanPayload, seoPlanSchema, validateSeoPlan, type SeoPlan } from "./weekly-plan";

export async function weeklySeoPlan(clientId: string, clientName: string, detected: readonly DetectedOpportunity[]): Promise<{ plan: SeoPlan } | { plan: null; reason: string }> {
  if (!detected.length) return { plan: null, reason: "aucune opportunité" };
  if (!agentsAiConfigured()) return { plan: null, reason: "IA non configurée" };
  const payload = seoPlanPayload(clientName, detected);
  const ask = (feedback?: string) => withAiScope({ agent: "seo", clientId }, () => structuredResponse(withCharter("seo", SEO_PLAN_INSTRUCTIONS),
    JSON.stringify(feedback ? { ...payload, previous_attempt_refused: feedback } : payload), seoPlanSchema(payload.opportunities.map((item) => item.fingerprint)),
    { agent: "seo", clientId, maxOutputTokens: 1500 }));
  try {
    let check = validateSeoPlan((await ask()).value, clientName, detected);
    if (!check.ok && check.reason === "ungrounded") check = validateSeoPlan((await ask(`chiffres absents des données : ${check.detail} ; aucun calcul`)).value, clientName, detected);
    return check.ok ? { plan: check.plan } : { plan: null, reason: check.reason === "ungrounded" ? "chiffres non repris des données" : "réponse invalide" };
  } catch (error) {
    console.error("[seo-plan] indisponible");
    return { plan: null, reason: (error as { message?: string } | null)?.message === "ai_budget_exceeded" ? "plafond IA du client atteint" : "IA indisponible" };
  }
}
