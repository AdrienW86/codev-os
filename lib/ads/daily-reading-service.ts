import "server-only";
// Lecture IA des anomalies Google Ads (Agent Google Ads, famille stratégie) : un appel mesuré par veille, seulement
// quand de nouvelles anomalies sont ouvertes, une correction au plus. Échec : les textes fixes restent en place.
import { agentsAiConfigured } from "@/lib/ai/models";
import { structuredResponse, withAiScope } from "@/lib/ai/metered";
import { withCharter } from "@/lib/harness/charter";
import type { AdsAnomaly } from "@/lib/ads/anomalies";
import type { CampaignMetrics } from "@/lib/providers/google-ads";
import { ADS_READING_INSTRUCTIONS, adsReadingPayload, adsReadingSchema, validateAdsReading, type AdsReading } from "./daily-reading";

export async function readAdsAnomalies(clientId: string, anomalies: readonly AdsAnomaly[], thisWeek: readonly CampaignMetrics[], lastWeek: readonly CampaignMetrics[]): Promise<{ readings: Map<string, AdsReading> } | { readings: null; reason: string }> {
  if (!anomalies.length) return { readings: null, reason: "aucune anomalie" };
  if (!agentsAiConfigured()) return { readings: null, reason: "IA non configurée" };
  const payload = adsReadingPayload(anomalies, thisWeek, lastWeek);
  const ask = (feedback?: string) => withAiScope({ agent: "google-ads", clientId }, () => structuredResponse(withCharter("google-ads", ADS_READING_INSTRUCTIONS),
    JSON.stringify(feedback ? { ...payload, previous_attempt_refused: feedback } : payload), adsReadingSchema(payload.anomalies.map((item) => item.campaign_id)),
    { agent: "google-ads", clientId, maxOutputTokens: 1500 }));
  try {
    let check = validateAdsReading((await ask()).value, payload);
    if (!check.ok && check.reason === "ungrounded") check = validateAdsReading((await ask(`chiffres absents des données : ${check.detail} ; aucun calcul`)).value, payload);
    return check.ok ? { readings: check.readings } : { readings: null, reason: check.reason === "ungrounded" ? "chiffres non repris des données" : "réponse invalide" };
  } catch (error) {
    console.error("[ads-reading] indisponible");
    return { readings: null, reason: (error as { message?: string } | null)?.message === "ai_budget_exceeded" ? "plafond IA du client atteint" : "IA indisponible" };
  }
}
