import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { createStudioVideo } from "@/lib/studio/videos";

// Studio vidéo : création d'une vidéo motion design (administrateur, même origine). Route dédiée plutôt qu'une action
// serveur : le rendu peut durer jusqu'à une minute ou deux. Aucune publication ici.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  // Même origine uniquement (le cookie de session ne suffit pas à prouver l'intention).
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return NextResponse.json({ ok: false, message: "Requête refusée." }, { status: 403, headers });
  await requireAdmin();
  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ ok: false, message: "Formulaire illisible (photos trop lourdes ?)." }, { status: 400, headers }); }
  const result = await createStudioVideo(form);
  return NextResponse.json(result, { status: result.ok ? 200 : 422, headers });
}
