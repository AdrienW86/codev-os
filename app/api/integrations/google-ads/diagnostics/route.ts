import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/require-admin";
import { getClientAdsDiagnostics } from "@/lib/ads/diagnostics";
export const runtime = "nodejs";
export async function GET(request: Request) {
  await requireAdmin();
  const url = new URL(request.url);
  const params = z.object({ clientId: z.uuid(), campaignId: z.string().regex(/^\d{1,20}$/) })
    .safeParse({ clientId: url.searchParams.get("clientId"), campaignId: url.searchParams.get("campaignId") });
  if (!params.success) return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  try {
    return NextResponse.json(await getClientAdsDiagnostics(params.data.clientId, params.data.campaignId),
      { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Diagnostics indisponibles. Vérifiez les droits API et la connexion." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
