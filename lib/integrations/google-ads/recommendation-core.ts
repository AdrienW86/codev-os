import "server-only";
import { selectAIProvider } from "@/lib/ai/providers";
import { analyzeAdsWithAI, ANALYSIS_LIMITATIONS } from "./ai-analysis";
import type { AdsInstructionSnapshot } from "./business-context";
import type { CampaignRow } from "./dashboard";
import type { StoredAdsScope } from "./scope";

/** Shared bounded analysis for interactive requests and report preparation. No external writes. */
export async function analyzeRecommendation(rows: CampaignRow[], scope: StoredAdsScope, instructions: AdsInstructionSnapshot, mode: "ai" | "deterministic") {
  const started = performance.now();
  let ai: Awaited<ReturnType<typeof analyzeAdsWithAI>> | null = null;
  let fallback = false;
  const provider = mode === "ai" ? selectAIProvider() : null;
  if (mode === "ai") {
    try { if (!provider) throw new Error("unavailable"); ai = await analyzeAdsWithAI(provider, rows, scope, instructions); }
    catch { fallback = true; }
  }
  const signals = rows.filter(row => !row.localServices && row.metrics.cost !== null && row.metrics.cost > 0 && row.metrics.conversions === 0);
  const money = new Intl.NumberFormat("fr-FR", { style: "currency", currency: scope.currency });
  const deterministic = signals.map(row => `Priorité moyenne · ${row.name} (ID ${row.id}) : ${money.format(row.metrics.cost!)} dépensés, aucune conversion enregistrée. Vérifier le suivi avant toute conclusion commerciale.`);
  const number = (value: number | null) => value === null ? "indisponible" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);
  const facts = [false, true].flatMap(localServices => {
    const group = rows.filter(row => row.localServices === localServices);
    return !group.length ? [] : [localServices ? "Local Services — faits" : "Search et autres campagnes hors Local Services — faits", ...group.map(row => `${row.name} (ID ${row.id}) : dépenses ${row.metrics.cost === null ? "indisponibles" : money.format(row.metrics.cost)}, clics ${number(row.metrics.clicks)}, impressions ${number(row.metrics.impressions)}, conversions ${number(row.metrics.conversions)}. Mesures distinctes des leads Local Services.`)];
  });
  const personalized = ai ? `${instructions.business ? "" : "Contexte commercial non renseigné : recommandations limitées aux instructions disponibles.\n"}${ai.text}` : null;
  const text = personalized ?? [fallback ? "IA indisponible : repli déterministe explicite, sans personnalisation." : "Analyse déterministe, sans IA ni utilisation des instructions client.", `Période : ${scope.start} → ${scope.end} (${scope.timezone}).`, ...facts, "Recommandations", ...deterministic, !signals.length ? "Aucun signal de dépenses sans conversion hors Local Services." : "", "Local Services : aucun verdict fondé sur les conversions Search.", ...ANALYSIS_LIMITATIONS].filter(Boolean).join("\n");
  return { text, engine: ai ? "ai" : fallback ? "deterministic_fallback" : "deterministic", ai, aiMs: Math.round(performance.now() - started), provider: provider?.id ?? null, model: provider?.model ?? null };
}
