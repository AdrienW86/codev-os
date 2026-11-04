import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { generateAgentVideo } from "@/lib/video-agent/service";

// Agent Vidéo : génération immédiate pour un client (administrateur, même origine). Route dédiée : le rendu peut
// durer une minute. La vidéo est rangée dans le Studio du client ; rien n'est publié.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return NextResponse.json({ ok: false, message: "Requête refusée." }, { status: 403, headers });
  const { userId } = await requireAdmin();
  let clientId: unknown;
  try { clientId = ((await request.json()) as { client_id?: unknown }).client_id; } catch { clientId = null; }
  if (typeof clientId !== "string" || !UUID.test(clientId)) return NextResponse.json({ ok: false, message: "Client invalide." }, { status: 400, headers });
  const result = await generateAgentVideo(clientId, { trigger: "manual", actorId: userId });
  return NextResponse.json(result.ok ? { ...result, message: `Vidéo de ${result.seconds} s créée (« ${result.headline} », ${result.service}). Elle est dans le Studio.` } : result, { status: result.ok ? 200 : 422, headers });
}
