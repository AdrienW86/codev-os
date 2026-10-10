import "server-only";
// Diagnostic du fournisseur d'IA en production : quel fournisseur / modèle est retenu, et la clé
// est-elle acceptée ? Appel sans génération (GET /v1/models/{modèle}) : aucun coût de jetons.
// Ne renvoie jamais la clé, ni un en-tête, ni le corps d'une réponse.
import { selectAIProvider } from "@/lib/ai/providers";
import { providerFailureReason } from "@/lib/assistant/orchestrator";

export type AIDiagnostic = { ok: boolean; message: string };

export async function diagnoseAIProvider(env: Record<string, string | undefined> = process.env): Promise<AIDiagnostic> {
  const deployment = [env.VERCEL_ENV ? `environnement ${env.VERCEL_ENV}` : null, env.VERCEL_GIT_COMMIT_SHA ? `déploiement ${env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)}` : null].filter(Boolean).join(", ");
  const where = deployment ? ` (${deployment})` : "";
  const provider = selectAIProvider(env);
  if (!provider) return { ok: false, message: `Aucun fournisseur d’IA retenu${where} : OPENAI_API_KEY et ANTHROPIC_API_KEY sont absentes ou vides pour ce déploiement. Après ajout d’une variable dans Vercel, un nouveau déploiement est nécessaire.` };
  const label = `${provider.id === "openai" ? "OpenAI" : "Anthropic"} · ${provider.model}`;
  try {
    await provider.ping();
    return { ok: true, message: `${label}${where} : clé acceptée, modèle accessible.` };
  } catch (error) {
    const details = error as { kind?: string; status?: number | null; code?: string | null };
    console.error("[assistant] Diagnostic du fournisseur IA en échec", { provider: provider.id, model: provider.model.slice(0, 80), kind: details?.kind ?? "unexpected", status: details?.status ?? null, code: details?.code ?? null });
    return { ok: false, message: `${label}${where} : ${providerFailureReason(error, provider.id)}.` };
  }
}
