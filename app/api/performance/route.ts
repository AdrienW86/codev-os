import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { EngineError, engineConfig, runEngineAudit, saveAudit, type EngineReport } from "@/lib/performance/engine";

export const runtime = "nodejs";
export const maxDuration = 70;
export const dynamic = "force-dynamic";

function failure(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  await requireAdmin();
  const config = engineConfig();
  if (!config.ok) return failure(config.message, 503);
  if (Number(request.headers.get("content-length") || 0) > 2500) return failure("Requête trop volumineuse.", 413);
  let body: { url?: unknown; strategy?: unknown; clientId?: unknown };
  try { body = await request.json(); } catch { return failure("JSON invalide.", 400); }
  if (!body || typeof body.url !== "string" || body.url.length > 1600) return failure("URL invalide.", 400);
  if (body.strategy !== "mobile" && body.strategy !== "desktop") return failure("Support invalide.", 400);
  const clientId = typeof body.clientId === "string" && uuid.test(body.clientId) ? body.clientId : null;
  if (body.clientId && !clientId) return failure("Client invalide.", 400);
  if (clientId) {
    const { data, error } = await getSupabaseServerClient().from("clients").select("id").eq("id", clientId).maybeSingle();
    if (error || !data) return failure("Client inconnu.", 400);
  }
  let report: EngineReport;
  try {
    report = await runEngineAudit({ url: body.url, strategy: body.strategy });
  } catch (error) {
    if (error instanceof EngineError) return failure(error.message, error.status);
    return failure("Impossible de joindre CODE-V Performance.", 502);
  }
  // L'absence de migration n'empêche pas l'audit.
  const saved = await saveAudit(getSupabaseServerClient(), clientId, report);
  return NextResponse.json({ ...report, saved }, { headers: { "Cache-Control": "no-store" } });
}
