import "server-only";
// Transcription vocale (Speech-to-Text) côté serveur. Fournisseur interchangeable ; aucune clé
// côté navigateur. Sans fournisseur, l'interface se replie sur la reconnaissance vocale du navigateur.
import { providerJson, type FetchLike } from "@/lib/providers/api";
import { ProviderError } from "@/lib/providers/errors";

export interface SpeechToTextProvider {
  readonly id: string;
  transcribe(audio: Blob, options?: { language?: string; signal?: AbortSignal }): Promise<string>;
}

export const ACCEPTED_AUDIO = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/aac"];
export const MAX_AUDIO_BYTES = 4_000_000;

export function createOpenAISpeechToText(apiKey: string, model: string, fetchImpl?: FetchLike): SpeechToTextProvider {
  return {
    id: "openai",
    async transcribe(audio, options = {}) {
      const form = new FormData();
      const extension = audio.type.split("/")[1]?.split(";")[0] || "webm";
      form.append("file", audio, `dictée.${extension}`);
      form.append("model", model);
      form.append("language", options.language ?? "fr");
      form.append("response_format", "json");
      const data = await providerJson<{ text?: unknown }>("openai", "https://api.openai.com/v1/audio/transcriptions", {
        method: "POST", fetchImpl, signal: options.signal, timeoutMs: 30_000, headers: { Authorization: `Bearer ${apiKey}` }, body: form,
      });
      if (typeof data.text !== "string") throw new ProviderError("openai", "malformed");
      return data.text.trim().slice(0, 2000);
    },
  };
}

export function selectSpeechToText(env: Record<string, string | undefined> = process.env, fetchImpl?: FetchLike): SpeechToTextProvider | null {
  const key = env.OPENAI_API_KEY?.trim();
  return key ? createOpenAISpeechToText(key, env.ASSISTANT_STT_MODEL?.trim() || "whisper-1", fetchImpl) : null;
}
