import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { generateTikTokMotionVideo } from "@/lib/publications/motion-video";

// Génération à la demande de la vidéo motion design d'une publication TikTok (administrateur uniquement). Route
// dédiée plutôt qu'une action serveur : le rendu peut durer jusqu'à quelques minutes. Aucune diffusion ici.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request, ctx: RouteContext<"/api/publications/[id]/motion-video">) {
  const headers = { "Cache-Control": "no-store" };
  // Même origine uniquement (le cookie de session ne suffit pas à prouver l'intention).
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return NextResponse.json({ ok: false, message: "Requête refusée." }, { status: 403, headers });
  const { userId } = await requireAdmin();
  const { id } = await ctx.params;
  const result = await generateTikTokMotionVideo(id, userId);
  return NextResponse.json(result, { status: result.ok ? 200 : result.code === "invalid" ? 400 : 409, headers });
}
