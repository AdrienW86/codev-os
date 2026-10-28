// Protection des passages du planificateur (déclenchement manuel existant) : authentification CRON_SECRET, verrou d'un seul passage
// à la fois porté par la ligne de battement, reprise après interruption, battement à chaque passage, étapes désactivées
// identifiées, aucun contournement de l'arrêt d'urgence ni de la validation humaine. Mocks uniquement, aucun réseau.
import test from "node:test";
import assert from "node:assert/strict";
import { load, src, json } from "./helpers/ts-load.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";

const SECRET = "cron-secret-0123456789abcdef-XYZ";
const STEPS = ["whatsapp_exports", "automations", "publication_auto_approval", "publication_delivery_prepare", "publication_delivery_send", "push", "search_console", "whatsapp", "media_intelligence", "publication_preparation"];
const minutesAgo = m => new Date(Date.now() - m * 60_000).toISOString();

function routeWith(fake, { env = { CRON_SECRET: SECRET }, slow } = {}) {
  const ran = [], logs = [];
  const mark = (name, value) => async (...args) => { ran.push(name); if (slow) await slow(name); return typeof value === "function" ? value(...args) : value; };
  const capture = { error: (...a) => logs.push(a.join(" ")), warn: (...a) => logs.push(a.join(" ")), log: (...a) => logs.push(a.join(" ")), info: (...a) => logs.push(a.join(" ")) };
  const route = load("app/api/internal/scheduler/tick/route.ts", {
    "next/server": { NextResponse: { json: (body, init) => ({ body, init }) } },
    "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client },
    "@/lib/scheduler/engine": { runTick: mark("automations", { enqueued: 0, processed: 0 }) },
    "@/lib/services/domain": { ensureGlobalAgents: async () => {} },
    "@/lib/notifications/push": { flushPushNotifications: mark("push", { accepted: 0, failed: 0, disabled: true }) },
    "@/lib/integrations/search-console/sync": { syncDueSearchConsole: mark("search_console", { synced: 0, failed: 0, pending: 0, disabled: true }) },
    "@/lib/whatsapp/service": { ingestionEnabled: () => false, processMediaBatch: mark("whatsapp", {}), purgeExpiredPersonalData: async () => ({}) },
    "@/lib/media-intelligence/service": { runMediaIntelligenceTick: mark("media_intelligence", { clients: 0 }) },
    // Comportement réel en production : arrêt d'urgence actif et drapeau absent → étapes « disabled ».
    "@/lib/publications/automation/scheduled": {
      prepareApprovedDeliveries: mark("publication_delivery_prepare", e => ({ disabled: e.PUBLICATIONS_SCHEDULED_DELIVERY === "enabled" ? "global" : "flag", prepared: 0 })),
      runScheduledPreparation: mark("publication_preparation", { disabled: "global", clients: 0 }) },
    "@/lib/publications/automation/auto-approval": { runAutoApproval: mark("publication_auto_approval", { disabled: "global", approved: 0, blocked: 0, noActor: 0 }) },
    "@/lib/publications/delivery/registry": { processScheduledDuePublications: mark("publication_delivery_send", { disabled: true }) },
    "@/lib/whatsapp/export-import": { purgeExportImports: mark("whatsapp_exports", { purged: 0, failed: 0, orphans: 0 }) },
  }, { process: { env }, console: capture });
  return { route, ran, logs };
}
const request = auth => ({ headers: { get: name => (name.toLowerCase() === "authorization" ? auth : null) } });
const heartbeat = fake => fake.tables.scheduler_heartbeats.find(r => r.name === "scheduler_tick");

test("cron-auth: Bearer CRON_SECRET only, constant-time; absent or short secret = 503, wrong or missing header = 401", () => {
  const { checkCronAuthorization: check } = load("lib/scheduler/cron-auth.ts");
  assert.deepEqual(json(check(`Bearer ${SECRET}`, SECRET)), { ok: true });
  assert.deepEqual(json(check(`Bearer ${SECRET}`, undefined)), { ok: false, status: 503 });
  assert.deepEqual(json(check(`Bearer ${SECRET}`, "")), { ok: false, status: 503 });
  assert.deepEqual(json(check("Bearer short", "short")), { ok: false, status: 503 }, "a secret under 16 characters never authorizes");
  for (const header of [null, "", SECRET, `bearer ${SECRET}`, `Basic ${SECRET}`, `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(1)}`, "Bearer "])
    assert.deepEqual(json(check(header, SECRET)), { ok: false, status: 401 }, String(header));
  assert.match(src("lib/scheduler/cron-auth.ts"), /timingSafeEqual/);
});

test("tick: valid trigger runs every step once and writes a finished heartbeat; disabled steps are identified", async () => {
  const fake = createFakeSupabase({ scheduler_heartbeats: [] });
  const { route, ran, logs } = routeWith(fake);
  const res = await route.GET(request(`Bearer ${SECRET}`));
  assert.equal(res.init.status, 200); assert.equal(res.init.headers["Cache-Control"], "no-store");
  assert.deepEqual(ran, STEPS.filter(s => s !== "whatsapp"), "whatsapp ingestion off: its work never starts");
  const row = heartbeat(fake);
  assert.ok(row.finished_at); assert.equal(row.ok, true); assert.equal(row.last_success_at, row.finished_at);
  assert.deepEqual(json(Object.fromEntries(Object.entries(row.steps).map(([k, v]) => [k, v.status]))), {
    whatsapp_exports: "ok", automations: "ok", publication_auto_approval: "disabled", publication_delivery_prepare: "disabled", publication_delivery_send: "disabled", push: "disabled",
    search_console: "disabled", whatsapp: "disabled", media_intelligence: "ok", publication_preparation: "disabled" });
  assert.doesNotMatch(JSON.stringify([res, fake.tables, logs]), new RegExp(SECRET), "the secret never appears in the response, the heartbeat or the logs");
  // Le passage suivant (une minute plus tard) reprend la ligne terminée.
  const again = await route.GET(request(`Bearer ${SECRET}`));
  assert.equal(again.init.status, 200); assert.equal(ran.filter(s => s === "automations").length, 2);
  assert.equal(fake.tables.scheduler_heartbeats.length, 1, "one row per name");
});

test("tick: absent CRON_SECRET → 503, wrong or missing secret → 401; nothing runs and nothing is written", async () => {
  for (const [env, auth, status, error] of [[{}, `Bearer ${SECRET}`, 503, "scheduler_not_configured"], [{ CRON_SECRET: SECRET }, "Bearer wrong-secret-wrong-secret", 401, "unauthorized"], [{ CRON_SECRET: SECRET }, null, 401, "unauthorized"]]) {
    const fake = createFakeSupabase({ scheduler_heartbeats: [] });
    const { route, ran, logs } = routeWith(fake, { env });
    const res = await route.POST(request(auth));
    assert.equal(res.init.status, status); assert.deepEqual(json(res.body), { error });
    assert.deepEqual(ran, []); assert.equal(fake.calls.length, 0, "no database access before authentication");
    assert.doesNotMatch(JSON.stringify([res, logs]), new RegExp(SECRET));
  }
});

test("tick: overlapping triggers (cron every minute, duplicate delivery) → exactly one pass runs, the other is skipped untouched", async () => {
  const fake = createFakeSupabase({ scheduler_heartbeats: [] });
  let release; const gate = new Promise(r => { release = r; });
  const { route, ran } = routeWith(fake, { slow: async name => { if (name === "whatsapp_exports") await gate; } });
  const first = route.GET(request(`Bearer ${SECRET}`));
  await new Promise(r => setTimeout(r, 20));
  const running = { ...heartbeat(fake) };
  assert.equal(running.finished_at, null, "heartbeat shows a pass in progress");
  const [second, third] = await Promise.all([route.GET(request(`Bearer ${SECRET}`)), route.POST(request(`Bearer ${SECRET}`))]);
  for (const res of [second, third]) { assert.equal(res.init.status, 200); assert.deepEqual(json(res.body), { ok: true, skipped: "running" }); }
  assert.deepEqual(json(heartbeat(fake)), json(running), "a skipped pass writes nothing");
  release(); const done = await first;
  assert.equal(done.init.status, 200);
  assert.equal(ran.filter(s => s === "automations").length, 1, "the engine ran once");
  assert.ok(heartbeat(fake).finished_at);
});

test("tick: simultaneous first-ever triggers race on the insert; only one wins", async () => {
  const fake = createFakeSupabase({ scheduler_heartbeats: [] });
  const { route, ran } = routeWith(fake);
  const results = await Promise.all([1, 2, 3].map(() => route.GET(request(`Bearer ${SECRET}`))));
  assert.equal(results.filter(r => r.body.skipped === "running").length, 2);
  assert.equal(ran.filter(s => s === "automations").length, 1);
});

test("tick: recovery after interruption — a pass started beyond its lease and never finished is taken over; the late one cannot overwrite", async () => {
  const stalled = { name: "scheduler_tick", started_at: minutesAgo(6), finished_at: null, ok: true, steps: {}, last_success_at: minutesAgo(7), last_failure_at: null };
  const fake = createFakeSupabase({ scheduler_heartbeats: [stalled] });
  const { route, ran, logs } = routeWith(fake);
  const res = await route.GET(request(`Bearer ${SECRET}`));
  assert.equal(res.init.status, 200); assert.ok(ran.includes("automations"), "resumed");
  assert.ok(logs.some(l => /interrompu : reprise/.test(l)));
  const row = heartbeat(fake);
  assert.ok(row.finished_at); assert.notEqual(row.started_at, stalled.started_at);
  // Le passage interrompu se réveille et tente d'écrire sa fin : refusé (fencing par started_at).
  const hb = load("lib/scheduler/heartbeat.ts", { "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client } }, { console: { error: () => {} } });
  const before = json(row);
  assert.equal(await hb.finishSchedulerRun({ startedAt: new Date(stalled.started_at), finishedAt: new Date(), steps: { automations: { status: "failed", ms: 1 } } }), false);
  assert.deepEqual(json(heartbeat(fake)), before);
  // Un passage commencé il y a moins que le bail (5 min 30 s) n'est jamais repris.
  const young = createFakeSupabase({ scheduler_heartbeats: [{ ...stalled, started_at: minutesAgo(5) }] });
  const r2 = routeWith(young);
  assert.equal((await r2.route.GET(request(`Bearer ${SECRET}`))).body.skipped, "running"); assert.deepEqual(r2.ran, []);
  assert.equal(hb.SCHEDULER_LEASE_MS, 330_000);
});

test("tick: heartbeat store unreadable → 503; only the 24 h export purge runs, never an unlocked pass", async () => {
  const fake = createFakeSupabase({ scheduler_heartbeats: [] }, { failOn: table => table === "scheduler_heartbeats" });
  const { route, ran } = routeWith(fake);
  const res = await route.GET(request(`Bearer ${SECRET}`));
  assert.equal(res.init.status, 503); assert.deepEqual(json(res.body), { ok: false, error: "scheduler_lock_unavailable" }); assert.deepEqual(ran, ["whatsapp_exports"]);
});

test("tick never bypasses the emergency stop or human approval: only the gated entry points, with the real environment", () => {
  const route = src("app/api/internal/scheduler/tick/route.ts");
  assert.match(route, /prepareApprovedDeliveries\(process\.env\)/);
  assert.match(route, /processScheduledDuePublications\(process\.env, undefined, \{ deadline \}\)/);
  assert.match(route, /runScheduledPreparation\(new Date\(\), undefined, \{ deadline \}\)/);
  assert.doesNotMatch(route, /emergency_stop|publishing_enabled|PUBLICATIONS_SCHEDULED_DELIVERY\s*=|approve|processDuePublications\b|publication_review|runOnePublicationJob/);
  // Les garde-fous eux-mêmes (vérifiés à chaque appel) restent dans les modules appelés.
  assert.match(src("lib/publications/automation/scheduled.ts"), /s\.emergency_stop!==false\|\|s\.automation_enabled!==true\|\|s\.generation_enabled!==true/);
  assert.match(src("lib/publications/automation/scheduled.ts"), /s\.emergency_stop!==false\|\|s\.publishing_enabled!==true/);
  assert.match(src("lib/publications/delivery/registry.ts"), /if\(!scheduledDeliveryEnabled\(env\)\)return \{disabled:true\}/);
});

