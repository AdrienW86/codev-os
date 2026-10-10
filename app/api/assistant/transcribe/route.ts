import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { getActiveScenario } from "@/lib/simulation/server";
import { checkSameOrigin, createRateLimiter } from "@/lib/core/request-guard";
import { ACCEPTED_AUDIO, MAX_AUDIO_BYTES, selectSpeechToText } from "@/lib/voice/stt";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const limiter = createRateLimiter(15, 60_000);
const headers = { "Cache-Control": "no-store" };

/** Dictée push-to-talk : l'audio n'est ni stocké ni journalisé ; seul le texte est renvoyé. */
export async function POST(request: Request) {
  const { userId } = await requireAdmin();
  const origin = checkSameOrigin(request.headers, request.url);
  if (!origin.ok) return NextResponse.json({ error: origin.error }, { status: origin.status, headers });
  if (await getActiveScenario()) return NextResponse.json({ error: "simulation" }, { status: 409, headers });
  const provider = selectSpeechToText();
  if (!provider) return NextResponse.json({ error: "stt_not_configured" }, { status: 503, headers });
  if (!limiter(userId)) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers });
  const type = (request.headers.get("content-type") ?? "").toLowerCase().split(";")[0].trim();
  if (!ACCEPTED_AUDIO.includes(type)) return NextResponse.json({ error: "unsupported_media_type" }, { status: 415, headers });
  if (Number(request.headers.get("content-length") ?? "0") > MAX_AUDIO_BYTES) return NextResponse.json({ error: "payload_too_large" }, { status: 413, headers });
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > MAX_AUDIO_BYTES) return NextResponse.json({ error: "payload_too_large" }, { status: 413, headers });
  if (buffer.byteLength < 1_000) return NextResponse.json({ error: "no_speech" }, { status: 422, headers });
  try {
    const text = await provider.transcribe(new Blob([buffer], { type }));
    if (!text) return NextResponse.json({ error: "no_speech" }, { status: 422, headers });
    return NextResponse.json({ text }, { headers });
  } catch {
    console.error("[voice] Transcription indisponible.");
    return NextResponse.json({ error: "stt_failed" }, { status: 502, headers });
  }
}
