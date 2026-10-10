import "server-only";
// Transcription vocale (Speech-to-Text) côté serveur. Fournisseur interchangeable ; aucune clé
// côté navigateur. Sans fournisseur, l'interface se replie sur la reconnaissance vocale du navigateur.
import { providerJson, type FetchLike } from "@/lib/providers/api";
import { ProviderError } from "@/lib/providers/errors";
import { audioFormatOf } from "@/lib/voice/audio";

export interface SpeechToTextProvider {
  readonly id: string;
  readonly model: string;
  transcribe(audio: Blob, options?: { language?: string; signal?: AbortSignal }): Promise<string>;
  /** Vérification sans transcription ni coût : la clé est acceptée et le modèle accessible. */
  ping(signal?: AbortSignal): Promise<void>;
}

export { ACCEPTED_AUDIO, MAX_AUDIO_BYTES } from "@/lib/voice/audio";

export function createOpenAISpeechToText(apiKey: string, model: string, fetchImpl?: FetchLike): SpeechToTextProvider {
  return {
    id: "openai", model,
    async transcribe(audio, options = {}) {
      const format = audioFormatOf(audio.type);
      if (!format) throw new ProviderError("openai", "rejected", null, "unsupported_audio_type");
      const form = new FormData();
      // Nom ASCII avec une extension reconnue par OpenAI : c'est l'extension qui désigne le format du fichier.
      form.append("file", new Blob([audio], { type: format.mime }), `dictation.${format.extension}`);
      form.append("model", model);
      form.append("language", options.language ?? "fr");
      form.append("response_format", "json");
      const data = await providerJson<{ text?: unknown }>("openai", "https://api.openai.com/v1/audio/transcriptions", {
        method: "POST", fetchImpl, signal: options.signal, timeoutMs: 30_000, headers: { Authorization: `Bearer ${apiKey}` }, body: form,
      });
      if (typeof data.text !== "string") throw new ProviderError("openai", "malformed");
      return data.text.trim().slice(0, 2000);
    },
    async ping(signal) {
      await providerJson("openai", `https://api.openai.com/v1/models/${encodeURIComponent(model)}`, { fetchImpl, signal, timeoutMs: 10_000, headers: { Authorization: `Bearer ${apiKey}` } });
    },
  };
}

export const DEFAULT_STT_MODEL = "whisper-1";

export function selectSpeechToText(env: Record<string, string | undefined> = process.env, fetchImpl?: FetchLike): SpeechToTextProvider | null {
  const key = env.OPENAI_API_KEY?.trim();
  return key ? createOpenAISpeechToText(key, env.ASSISTANT_STT_MODEL?.trim() || DEFAULT_STT_MODEL, fetchImpl) : null;
}

/** Raison lisible d'un échec de transcription (affichée à l'administrateur ; aucun secret, aucun message brut). */
export function sttFailureReason(error: unknown, model: string): { reason: string; message: string } {
  const { kind, code, status } = (error ?? {}) as { kind?: string; code?: string | null; status?: number | null };
  if (code === "insufficient_quota") return { reason: "quota", message: "Quota OpenAI épuisé : vérifiez la facturation du compte OpenAI." };
  if (code === "invalid_api_key" || kind === "unauthorized") return { reason: "unauthorized", message: `Clé OpenAI refusée ou sans accès à la transcription (HTTP ${status ?? "?"}).` };
  if (code === "model_not_found" || kind === "not_found") return { reason: "model", message: `Modèle de transcription « ${model} » introuvable ou non accessible avec cette clé (ASSISTANT_STT_MODEL).` };
  if (code === "unsupported_audio_type") return { reason: "format", message: "Format audio non pris en charge par la transcription." };
  if (kind === "rejected") return { reason: "rejected", message: `Fichier audio ou paramètre refusé par OpenAI${code ? ` (${code})` : ""}.` };
  if (kind === "rate_limited") return { reason: "rate_limited", message: "Limite de débit OpenAI atteinte : réessayez dans un instant." };
  if (kind === "timeout") return { reason: "timeout", message: "OpenAI n’a pas répondu à temps : réessayez avec un message plus court." };
  if (kind === "unavailable") return { reason: "unavailable", message: `Service de transcription OpenAI indisponible (HTTP ${status ?? "?"}).` };
  if (kind === "blocked") return { reason: "blocked", message: "Accès réseau à OpenAI refusé." };
  return { reason: "unexpected", message: "Réponse inattendue du service de transcription." };
}
