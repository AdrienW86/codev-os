import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { checkCronAuthorization } from "@/lib/scheduler/cron-auth";
import { runTick } from "@/lib/scheduler/engine";
import { ensureGlobalAgents } from "@/lib/services/domain";
import { flushPushNotifications } from "@/lib/notifications/push";
import { syncDueSearchConsole } from "@/lib/integrations/search-console/sync";
import { ingestionEnabled, processMediaBatch, purgeExpiredPersonalData } from "@/lib/whatsapp/service";

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
    // Synchro quotidienne Search Console : une exécution par client et par jour (verrou en base), budget borné.
    let searchConsole;
    try { searchConsole = await syncDueSearchConsole(new Date()); } catch { console.error("[scheduler] Synchro Search Console différée."); searchConsole = { unavailable: true }; }
    // Reprises WhatsApp → Drive : vide la file (médias disponibles 7 jours chez Meta) et applique la conservation.
    let whatsapp;
    try {
      whatsapp = ingestionEnabled() ? { ...await processMediaBatch({ kind: "system", worker: "whatsapp-scheduler" }, 20, 60000), retention: await purgeExpiredPersonalData() } : { disabled: true };
    } catch { console.error("[scheduler] Import WhatsApp différé."); whatsapp = { unavailable: true }; }
    return NextResponse.json({ ok: true, ...summary, push, searchConsole, whatsapp }, { headers });
  } catch {
    console.error("[scheduler] Tick interrompu.");
    return NextResponse.json({ error: "tick_failed" }, { status: 500, headers });
  }
}

export const GET = handle;
export const POST = handle;
