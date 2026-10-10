import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { checkCronAuthorization } from "@/lib/scheduler/cron-auth";
import { runTick } from "@/lib/scheduler/engine";
import { ensureGlobalAgents } from "@/lib/services/domain";
import { flushPushNotifications } from "@/lib/notifications/push";

// Déclencheur serveur-à-serveur : jamais de session navigateur, uniquement CRON_SECRET.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(request: Request) {
  const auth = checkCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET);
  const headers = { "Cache-Control": "no-store" };
  if (!auth.ok) return NextResponse.json({ error: auth.status === 503 ? "scheduler_not_configured" : "unauthorized" }, { status: auth.status, headers });
  try {
    const summary = await runTick(`cron-${randomUUID().slice(0, 8)}`, new Date(), { ensureGlobal: (actor) => ensureGlobalAgents(actor) });
    let push;
    try { push = await flushPushNotifications(); } catch { push = { unavailable: true }; }
    return NextResponse.json({ ok: true, ...summary, push }, { headers });
  } catch {
    console.error("[scheduler] Tick interrompu.");
    return NextResponse.json({ error: "tick_failed" }, { status: 500, headers });
  }
}

export const GET = handle;
export const POST = handle;
