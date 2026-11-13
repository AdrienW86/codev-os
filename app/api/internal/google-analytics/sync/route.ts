import { NextResponse } from "next/server";
import { checkCronAuthorization } from "@/lib/scheduler/cron-auth";
import { syncDueGa4 } from "@/lib/integrations/ga4/daily";

/** Hourly CRON: at most one due GA4 client, each at most once per 23 hours. */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const auth = checkCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET);
  const headers = { "Cache-Control": "no-store" };
  if (!auth.ok) return NextResponse.json({ error: auth.status === 503 ? "scheduler_not_configured" : "unauthorized" }, { status: auth.status, headers });
  try {
    const result = await syncDueGa4(new Date());
    return NextResponse.json({ ok: true, ...result }, { headers });
  } catch {
    console.error("[google-analytics] Synchronisation CRON indisponible.");
    return NextResponse.json({ ok: false, error: "ga4_unavailable" }, { status: 503, headers });
  }
}
