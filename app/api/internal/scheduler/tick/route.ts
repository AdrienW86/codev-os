import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { checkCronAuthorization } from "@/lib/scheduler/cron-auth";
import { runTick } from "@/lib/scheduler/engine";
import { ensureGlobalAgents } from "@/lib/services/domain";
import { flushPushNotifications } from "@/lib/notifications/push";
import { syncDueSearchConsole } from "@/lib/integrations/search-console/sync";
import { ingestionEnabled, processMediaBatch, purgeExpiredPersonalData } from "@/lib/whatsapp/service";
import { runMediaIntelligenceTick } from "@/lib/media-intelligence/service";
import { prepareApprovedDeliveries, runScheduledPreparation } from "@/lib/publications/automation/scheduled";
import { processScheduledDuePublications } from "@/lib/publications/delivery/registry";

// Déclencheur serveur-à-serveur : jamais de session navigateur, uniquement CRON_SECRET.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(request: Request) {
  const auth = checkCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET);
  const headers = { "Cache-Control": "no-store" };
  if (!auth.ok) return NextResponse.json({ error: auth.status === 503 ? "scheduler_not_configured" : "unauthorized" }, { status: auth.status, headers });
  try {
    const summary = await runTick(`cron-${randomUUID().slice(0, 8)}`, new Date(), { ensureGlobal: (actor) => ensureGlobalAgents(actor) });
    // Publications (socle lot 6), en premier pour tenir l'heure prévue : diffusions des publications approuvées par un
    // humain, puis un envoi dû au plus. Entièrement désactivé tant que PUBLICATIONS_SCHEDULED_DELIVERY ≠ « enabled ».
    let publications;
    try {
      const delivery = await prepareApprovedDeliveries(process.env);
      const due = await processScheduledDuePublications(process.env);
      publications = { delivery, due };
    } catch { console.error("[scheduler] Diffusion des publications différée."); publications = { unavailable: true }; }
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
    // Photothèque intelligente : classement borné des clients qui l'ont activé et purge des rejets expirés. Jamais de publication.
    let mediaIntelligence;
    try { mediaIntelligence = await runMediaIntelligenceTick(); } catch { console.error("[scheduler] Classement de la photothèque différé."); mediaIntelligence = { unavailable: true }; }
    // Préparation IA bornée des clients en préparation automatique : brouillons soumis « À valider », jamais approuvés.
    let publicationPreparation;
    try { publicationPreparation = await runScheduledPreparation(); } catch { console.error("[scheduler] Préparation des publications différée."); publicationPreparation = { unavailable: true }; }
    return NextResponse.json({ ok: true, ...summary, push, searchConsole, whatsapp, mediaIntelligence, publications, publicationPreparation }, { headers });
  } catch {
    console.error("[scheduler] Tick interrompu.");
    return NextResponse.json({ error: "tick_failed" }, { status: 500, headers });
  }
}

export const GET = handle;
export const POST = handle;
