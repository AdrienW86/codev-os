import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { getActiveScenario } from "@/lib/simulation/server";
import { checkSameOrigin, createRateLimiter } from "@/lib/core/request-guard";
import { selectSpeechToText, sttFailureReason } from "@/lib/voice/stt";
import { ACCEPTED_AUDIO, MAX_AUDIO_BYTES, audioFormatOf, sniffContainer } from "@/lib/voice/audio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const limiter = createRateLimiter(15, 60_000);
const headers = { "Cache-Control": "no-store" };
const containerMime: Record<string, string> = { webm: "audio/webm", ogg: "audio/ogg", mp4: "audio/mp4", wav: "audio/wav", mp3: "audio/mpeg", flac: "audio/flac" };

/**
 * Dictée push-to-talk. Journal : modèle, type MIME, conteneur détecté, taille, statut et code du
 * fournisseur — jamais la clé, l'audio ni la transcription. L'audio n'est pas stocké.
 */
export async function POST(request: Request) {
  const { userId } = await requireAdmin();
  const origin = checkSameOrigin(request.headers, request.url);
  if (!origin.ok) return NextResponse.json({ error: origin.error }, { status: origin.status, headers });
  if (await getActiveScenario()) return NextResponse.json({ error: "simulation" }, { status: 409, headers });
  const provider = selectSpeechToText();
  if (!provider) return NextResponse.json({ error: "stt_not_configured" }, { status: 503, headers });
  if (!limiter(userId)) return NextResponse.json({ error: "rate_limited", message: "Trop de dictées rapprochées : patientez une minute." }, { status: 429, headers });
  const declared = (request.headers.get("content-type") ?? "").toLowerCase().split(";")[0].trim();
  if (!ACCEPTED_AUDIO.includes(declared)) {
    console.warn("[voice] Format audio refusé", { mime: declared.slice(0, 60) || null });
    return NextResponse.json({ error: "unsupported_media_type", message: `Format audio « ${declared.slice(0, 40) || "inconnu"} » non pris en charge.` }, { status: 415, headers });
  }
  if (Number(request.headers.get("content-length") ?? "0") > MAX_AUDIO_BYTES) return NextResponse.json({ error: "payload_too_large", message: "Dictée trop longue : 60 secondes au plus." }, { status: 413, headers });
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > MAX_AUDIO_BYTES) return NextResponse.json({ error: "payload_too_large", message: "Dictée trop longue : 60 secondes au plus." }, { status: 413, headers });
  if (buffer.byteLength < 1_000) return NextResponse.json({ error: "no_speech" }, { status: 422, headers });

  // Le conteneur réel prime sur le type annoncé (certains navigateurs annoncent mal le format).
  const container = sniffContainer(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 16)));
  const type = container && audioFormatOf(declared)?.container !== container ? containerMime[container] : declared;
  const context = { model: provider.model, mime: declared, container: container ?? "inconnu", size: buffer.byteLength };
  const started = Date.now();
  try {
    const text = await provider.transcribe(new Blob([buffer], { type }));
    console.info("[voice] Transcription réussie", { ...context, ms: Date.now() - started, empty: !text });
    if (!text) return NextResponse.json({ error: "no_speech" }, { status: 422, headers });
    return NextResponse.json({ text }, { headers });
  } catch (error) {
    const details = error as { kind?: string; status?: number | null; code?: string | null };
    const failure = sttFailureReason(error, provider.model);
    console.error("[voice] Transcription en échec", { ...context, kind: details?.kind ?? "unexpected", status: details?.status ?? null, code: details?.code ?? null, ms: Date.now() - started });
    return NextResponse.json({ error: "stt_failed", reason: failure.reason, message: failure.message }, { status: details?.kind === "timeout" ? 504 : 502, headers });
  }
}
