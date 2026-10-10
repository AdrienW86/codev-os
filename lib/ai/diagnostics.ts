import "server-only";
// Diagnostic du fournisseur d'IA en production. Il exécute les MÊMES requêtes que l'usage réel
// (même variable, même en-tête, même URL) : une complétion minimale pour l'assistant et la
// transcription d'une seconde de silence pour la dictée — coût négligeable. Lire la liste des
// modèles ne suffit pas : une clé peut lire les modèles sans avoir le droit de les utiliser.
// Ne renvoie jamais la clé, ni un en-tête, ni le corps d'une réponse.
import { selectAIProvider } from "@/lib/ai/providers";
import { providerFailureReason } from "@/lib/assistant/orchestrator";
import { selectSpeechToText, sttFailureReason } from "@/lib/voice/stt";
import { silentWav } from "@/lib/voice/audio";

export type AIDiagnostic = { ok: boolean; message: string };

async function diagnoseAssistant(env: Record<string, string | undefined> = process.env): Promise<AIDiagnostic> {
  const deployment = [env.VERCEL_ENV ? `environnement ${env.VERCEL_ENV}` : null, env.VERCEL_GIT_COMMIT_SHA ? `déploiement ${env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)}` : null].filter(Boolean).join(", ");
  const where = deployment ? ` (${deployment})` : "";
  const provider = selectAIProvider(env);
  if (!provider) return { ok: false, message: `Aucun fournisseur d’IA retenu${where} : OPENAI_API_KEY et ANTHROPIC_API_KEY sont absentes ou vides pour ce déploiement. Après ajout d’une variable dans Vercel, un nouveau déploiement est nécessaire.` };
  const label = `${provider.id === "openai" ? "OpenAI" : "Anthropic"} · ${provider.model}`;
  try {
    await provider.complete({ system: "Réponds uniquement « OK ».", messages: [{ role: "user", content: "Test de connexion." }], tools: [] });
    return { ok: true, message: `${label}${where} : requête de l’assistant acceptée.` };
  } catch (error) {
    console.error("[assistant] Diagnostic du fournisseur IA en échec", { provider: provider.id, model: provider.model.slice(0, 80), ...failureFields(error) });
    return { ok: false, message: `${label}${where} : ${providerFailureReason(error, provider.id)}.` };
  }
}

/** Transcription vocale : modèle retenu et accès vérifiés (GET /v1/models/{modèle}, sans audio ni coût). */
async function diagnoseSpeechToText(env: Record<string, string | undefined>): Promise<AIDiagnostic> {
  const stt = selectSpeechToText(env);
  if (!stt) return { ok: false, message: "Transcription : OPENAI_API_KEY absente, la dictée utilise le navigateur." };
  try {
    await stt.transcribe(new Blob([silentWav()], { type: "audio/wav" }));
    return { ok: true, message: `Transcription · ${stt.model} : requête de transcription acceptée.` };
  } catch (error) {
    console.error("[voice] Diagnostic de la transcription en échec", { model: stt.model.slice(0, 80), ...failureFields(error) });
    return { ok: false, message: `Transcription · ${stt.model} : ${sttFailureReason(error, stt.model).message}` };
  }
}

export async function diagnoseAIProvider(env: Record<string, string | undefined> = process.env): Promise<AIDiagnostic> {
  const [assistant, speech] = await Promise.all([diagnoseAssistant(env), diagnoseSpeechToText(env)]);
  return { ok: assistant.ok && speech.ok, message: `${assistant.message} ${speech.message}` };
}

/** Champs d'erreur assainis pour le journal (jamais clé, en-têtes ni corps). */
function failureFields(error: unknown) {
  const details = error as { kind?: string; status?: number | null; code?: string | null; type?: string | null; scopes?: string[] };
  return { kind: details?.kind ?? "unexpected", status: details?.status ?? null, code: details?.code ?? null, type: details?.type ?? null, scopes: details?.scopes?.join(",") || null };
}
