import "server-only";
import { selectAIProvider } from "@/lib/ai/providers";
import { isBudgetExceeded, meteredProvider, withAiScope } from "@/lib/ai/metered";
import { ProviderError } from "@/lib/providers/errors";
import { buildAdsFindings } from "./findings";
import { analyzeAdsWithAI, ANALYSIS_LIMITATIONS } from "./ai-analysis";
import type { AdsInstructionSnapshot } from "./business-context";
import type { CampaignRow } from "./dashboard";
import type { StoredAdsScope } from "./scope";
import type { AdsExpertSignals } from "./types";
import { buildExpertDiagnosis, expertCoverage } from "./expert";

/** Shared bounded analysis for interactive requests and report preparation. No external writes. */
export async function analyzeRecommendation(rows: CampaignRow[], scope: StoredAdsScope, instructions: AdsInstructionSnapshot, mode: "ai" | "deterministic", expertSignals: AdsExpertSignals | null = null, clientId: string | null = null) {
  const started = performance.now();
  let ai: Awaited<ReturnType<typeof analyzeAdsWithAI>> | null = null;
  let fallback = false;
  let fallbackCode: string | null = null;
  // Passerelle mesurée : l'appel compte dans le budget IA du client et s'arrête au plafond.
  const provider = mode === "ai" ? meteredProvider(selectAIProvider()) : null;
  if (mode === "ai") {
    try { if (!provider) throw new Error("unavailable"); const analyze = () => analyzeAdsWithAI(provider, rows, scope, instructions, expertSignals);
      ai = clientId ? await withAiScope({ agent: "google-ads", clientId }, analyze) : await analyze(); }
    catch (error) { fallback = true;
      const kind = error instanceof Error ? error.name : "unknown";
      const reason = isBudgetExceeded(error) ? "ai_budget_exceeded" : error instanceof Error && /Sortie IA structurée absente/.test(error.message) ? "tool_response_missing" : error instanceof Error && kind === "ZodError" ? "structured_validation" : kind === "ProviderError" ? "provider_failure" : kind === "TimeoutError" ? "timeout" : "analysis_failure";
      fallbackCode = error instanceof ProviderError ? `provider_${error.kind}${error.code ? `_${error.code}` : ""}` : reason;
      console.error("[google-ads-ai] fallback", { provider: provider?.id ?? "none", model: provider?.model ?? "none", reason: fallbackCode });
    }
  }
  const signals = rows.filter(row => !row.localServices && row.metrics.cost !== null && row.metrics.cost > 0 && row.metrics.conversions === 0);
  const money = new Intl.NumberFormat("fr-FR", { style: "currency", currency: scope.currency });
  const deterministic = signals.map(row => `Priorité moyenne · ${row.name} (ID ${row.id}) : ${money.format(row.metrics.cost!)} dépensés, aucune conversion enregistrée. Vérifier le suivi avant toute conclusion commerciale.`);
  const number = (value: number | null) => value === null ? "indisponible" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);
  const facts = [false, true].flatMap(localServices => {
    const group = rows.filter(row => row.localServices === localServices);
    return !group.length ? [] : [localServices ? "Local Services — faits" : "Search et autres campagnes hors Local Services — faits", ...group.map(row => `${row.name} (ID ${row.id}) : dépenses ${row.metrics.cost === null ? "indisponibles" : money.format(row.metrics.cost)}, clics ${number(row.metrics.clicks)}, impressions ${number(row.metrics.impressions)}, conversions ${number(row.metrics.conversions)}. Mesures distinctes des leads Local Services.`)];
  });
  const findings = buildAdsFindings(rows, scope);
  const findingsText = findings.length ? ["", "Contrôles prioritaires fondés sur les données", ...findings.slice(0, 12).map(item => `• ${item.priority === "high" ? "Haute" : item.priority === "medium" ? "Moyenne" : "Information"} · ${item.title} : ${item.detail} Action proposée : ${item.nextStep}`)].join("\n") : "\nAucun contrôle prioritaire supplémentaire détecté sur ces métriques.";
  // Diagnostic expert (termes, part d'impressions, Quality Score, appareils, cible) : présent avec ou sans IA.
  const expert = ai?.expert ?? buildExpertDiagnosis(rows, expertSignals, instructions.business, scope, scope.currency);
  const coverage = expertCoverage(expertSignals);
  const expertText = ["", "Plan d’optimisation expert (propositions à valider, aucune modification automatique)",
    ...(expert.length ? expert.slice(0, 12).map(item => `• ${item.priority === "high" ? "Haute" : item.priority === "medium" ? "Moyenne" : "Basse"} · ${item.title} : ${item.detail}${item.items.length ? ` Détail : ${item.items.join(" ; ")}.` : ""} Action : ${item.action} Impact attendu : ${item.expectedImpact}`) : ["• Aucun levier expert déclenché sur les données lues."]),
    `Signaux lus : ${coverage.read.length ? coverage.read.join(", ") : "aucun"}.${coverage.missing.length ? ` Indisponibles : ${coverage.missing.join(", ")}.` : ""}`].join("\n");
  const personalized = ai ? `${instructions.business ? "" : "Contexte commercial non renseigné : recommandations limitées aux instructions disponibles.\n"}${ai.text}${findingsText}${expertText}` : null;
  const text = personalized ?? [fallback ? "IA indisponible : repli déterministe explicite, sans personnalisation." : "Analyse déterministe, sans IA ni utilisation des instructions client.", `Période : ${scope.start} → ${scope.end} (${scope.timezone}).`, ...facts, "Recommandations", ...deterministic, !signals.length ? "Aucun signal de dépenses sans conversion hors Local Services." : "", "Local Services : aucun verdict fondé sur les conversions Search.", findingsText, expertText, ...ANALYSIS_LIMITATIONS].filter(Boolean).join("\n");
  return { text, expert, engine: ai ? "ai" : fallback ? "deterministic_fallback" : "deterministic", fallbackCode, ai, aiMs: Math.round(performance.now() - started), provider: provider?.id ?? null, model: provider?.model ?? null };
}
