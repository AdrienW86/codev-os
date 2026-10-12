import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { checkCronAuthorization } from "@/lib/scheduler/cron-auth";
import { runTick } from "@/lib/scheduler/engine";
import { recordSchedulerHeartbeat, stepCounts, type SchedulerStep, type SchedulerStepName } from "@/lib/scheduler/heartbeat";
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

// Échéance partagée du passage (maxDuration) : chaque étape indique le temps minimal qu'il lui faut ; s'il reste
// moins, elle est sautée (« skipped ») plutôt que coupée par la plateforme. Marge pour répondre et écrire le battement.
const MARGIN_MS = 15_000;
const minimumMs: Record<SchedulerStepName, number> = {
  automations: 0, publication_delivery_prepare: 20_000, publication_delivery_send: 60_000, push: 10_000,
  search_console: 60_000, whatsapp: 75_000, media_intelligence: 60_000, publication_preparation: 120_000,
};
const isDisabled = (value: unknown) => typeof value === "object" && value !== null && Boolean((value as { disabled?: unknown }).disabled);

async function handle(request: Request) {
  const auth = checkCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET);
  const headers = { "Cache-Control": "no-store" };
  if (!auth.ok) return NextResponse.json({ error: auth.status === 503 ? "scheduler_not_configured" : "unauthorized" }, { status: auth.status, headers });
  const startedAt = new Date(), deadline = startedAt.getTime() + maxDuration * 1000 - MARGIN_MS;
  const steps: Partial<Record<SchedulerStepName, SchedulerStep>> = {};
  await recordSchedulerHeartbeat({ startedAt });
  // Chaque étape est isolée dans son propre try : un échec (ou un saut faute de temps) n'empêche jamais les suivantes.
  async function step<T>(name: SchedulerStepName, work: () => Promise<T>, label: string): Promise<T | { unavailable: true } | { skipped: "deadline" }> {
    const begin = Date.now();
    if (deadline - begin < minimumMs[name]) { steps[name] = { status: "skipped", ms: 0 }; return { skipped: "deadline" }; }
    try {
      const result = await work();
      steps[name] = { status: isDisabled(result) ? "disabled" : "ok", ms: Date.now() - begin, counts: stepCounts(result) };
      return result;
    } catch {
      console.error(`[scheduler] ${label}`);
      steps[name] = { status: "failed", ms: Date.now() - begin };
      return { unavailable: true };
    }
  }
  const summary = await step("automations", () => runTick(`cron-${randomUUID().slice(0, 8)}`, new Date(), { ensureGlobal: (actor) => ensureGlobalAgents(actor) }), "Automatisations différées.");
  // Publications (socle lot 6), avant les étapes lourdes pour tenir l'heure prévue : diffusions des publications
  // approuvées par un humain, puis un envoi dû au plus. Désactivé tant que PUBLICATIONS_SCHEDULED_DELIVERY ≠ « enabled ».
  const delivery = await step("publication_delivery_prepare", () => prepareApprovedDeliveries(process.env), "Diffusion des publications différée.");
  const due = await step("publication_delivery_send", () => processScheduledDuePublications(process.env), "Envoi des publications différé.");
  const push = await step("push", () => flushPushNotifications(), "Notifications push différées.");
  // Synchro quotidienne Search Console : une exécution par client et par jour (verrou en base), budget borné.
  const searchConsole = await step("search_console", () => syncDueSearchConsole(new Date()), "Synchro Search Console différée.");
  // Reprises WhatsApp → Drive : vide la file (médias disponibles 7 jours chez Meta) et applique la conservation.
  const whatsapp = await step("whatsapp", async () => ingestionEnabled() ? { ...await processMediaBatch({ kind: "system", worker: "whatsapp-scheduler" }, 20, 60000), retention: await purgeExpiredPersonalData() } : { disabled: true }, "Import WhatsApp différé.");
  // Photothèque intelligente : classement borné des clients qui l'ont activé et purge des rejets expirés. Jamais de publication.
  const mediaIntelligence = await step("media_intelligence", () => runMediaIntelligenceTick(), "Classement de la photothèque différé.");
  // Préparation IA bornée des clients en préparation automatique : brouillons soumis « À valider », jamais approuvés.
  const publicationPreparation = await step("publication_preparation", () => runScheduledPreparation(), "Préparation des publications différée.");
  await recordSchedulerHeartbeat({ startedAt, finishedAt: new Date(), steps });
  const ok = !Object.values(steps).some((s) => s?.status === "failed");
  return NextResponse.json({ ok, ...(summary && typeof summary === "object" ? summary : {}), push, searchConsole, whatsapp, mediaIntelligence, publications: { delivery, due }, publicationPreparation, steps },
    { status: steps.automations?.status === "failed" ? 500 : 200, headers });
}

export const GET = handle;
export const POST = handle;
