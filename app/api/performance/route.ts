import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

export const runtime = "nodejs";
export const maxDuration = 70;
export const dynamic = "force-dynamic";

function failure(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Report = {
  url: string; strategy: "mobile" | "desktop"; analyzedAt: string;
  source: string; scores: Json; lab: Json; field: Json; opportunities: Json;
};

export async function POST(request: NextRequest) {
  await requireAdmin();
  const apiKey = process.env.CODEV_PERFORMANCE_SERVICE_KEY;
  const serviceUrl = process.env.CODEV_PERFORMANCE_API_URL || "https://www.code-v.fr/api/performance";
  if (!apiKey || apiKey.length < 24) return failure("Clé de service CODE-V Performance non configurée.", 503);
  let destination: URL;
  try { destination = new URL(serviceUrl); } catch { return failure("URL du moteur invalide.", 503); }
  if (destination.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && destination.hostname === "localhost")) return failure("Le moteur doit utiliser HTTPS.", 503);
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
  let report: Report;
  try {
    const upstream = await fetch(destination, {
      method: "POST", headers: { "Content-Type": "application/json", "x-codev-service-key": apiKey },
      body: JSON.stringify({ url: body.url, strategy: body.strategy }), cache: "no-store", signal: AbortSignal.timeout(60000),
    });
    const result = await upstream.json();
    if (!upstream.ok) {
      const code = [400, 422, 429, 503, 504].includes(upstream.status) ? upstream.status : 502;
      return failure(typeof result.error === "string" ? result.error : "Moteur indisponible.", code);
    }
    report = result as Report;
    if (!report || typeof report.url !== "string" || !report.scores || !report.lab) throw new Error("invalid-response");
  } catch {
    return failure("Impossible de joindre CODE-V Performance.", 502);
  }
  let saved = false;
  let auditId: string | null = null;
  try {
    const { data, error } = await getSupabaseServerClient().from("performance_audits").insert({
      client_id: clientId, url: report.url, strategy: report.strategy, source: report.source,
      scores: report.scores, lab: report.lab, field: report.field, opportunities: report.opportunities,
      analyzed_at: report.analyzedAt,
    }).select("id").single();
    saved = !error && Boolean(data?.id);
    auditId = saved ? data!.id : null;
  } catch { /* L'absence de migration n'empêche pas l'audit. */ }
  return NextResponse.json({ ...report, saved, auditId }, { headers: { "Cache-Control": "no-store" } });
}
