import "server-only";
// Synthèse IA du rapport (Agent Rapport, famille stratégie) : un appel mesuré, une correction au plus si un chiffre
// n'est pas repris des données. Tout échec garde le résumé calculé ; rien n'est envoyé sans validation humaine.
import { agentsAiConfigured } from "@/lib/ai/models";
import { structuredResponse, withAiScope } from "@/lib/ai/metered";
import { withCharter } from "@/lib/harness/charter";
import { REPORT_SYNTHESIS_INSTRUCTIONS, reportSynthesisSchema, synthesisPayload, validateSynthesis, type SynthesisSource } from "./synthesis";

export type SynthesisResult = { summary: string; reason?: undefined } | { summary: null; reason: string };

export async function synthesizeReport(clientId: string, source: SynthesisSource): Promise<SynthesisResult> {
  if (!agentsAiConfigured()) return { summary: null, reason: "IA non configurée" };
  const payload = synthesisPayload(source);
  const ask = (feedback?: string) => withAiScope({ agent: "report", clientId }, () => structuredResponse(
    withCharter("report", REPORT_SYNTHESIS_INSTRUCTIONS),
    JSON.stringify(feedback ? { ...payload, previous_attempt_refused: feedback } : payload),
    reportSynthesisSchema, { agent: "report", clientId, maxOutputTokens: 1500 }));
  try {
    let check = validateSynthesis((await ask()).value, source);
    if (!check.ok && check.reason === "ungrounded") check = validateSynthesis((await ask(`chiffres absents des données : ${check.detail} ; reprends uniquement des chiffres présents, sans calcul`)).value, source);
    return check.ok ? { summary: check.summary } : { summary: null, reason: check.reason === "ungrounded" ? `chiffres non repris des données (${check.detail})` : "réponse invalide" };
  } catch (error) {
    console.error("[report-synthesis] indisponible");
    return { summary: null, reason: (error as { message?: string } | null)?.message === "ai_budget_exceeded" ? "plafond IA du client atteint" : "IA indisponible" };
  }
}
