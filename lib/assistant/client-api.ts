// Client navigateur de l'assistant : uniquement les routes de même origine, jamais un fournisseur.
// La session admin (cookie Clerk) et le contrôle d'origine sont vérifiés côté serveur.
export async function postAssistant(body: unknown): Promise<Response> {
  return fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
}

export async function postTranscription(audio: Blob, signal?: AbortSignal): Promise<Response> {
  return fetch("/api/assistant/transcribe", { method: "POST", headers: { "Content-Type": audio.type.split(";")[0] || "audio/webm" }, body: audio, signal, credentials: "same-origin" });
}
