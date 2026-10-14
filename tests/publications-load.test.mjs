// Phase 8 (#47) — robustesse et charge du pipeline Publications, côté serveur. Déterministe : base simulée en mémoire,
// horloge simulée, Agent v2, fournisseurs sociaux et Drive simulés. Aucun appel réseau, aucune IA réelle.
// Côté base (deux sessions PostgreSQL, SKIP LOCKED, garde de retard) : tests/publications-load-db.test.mjs.
// Les nombres mesurés sont imprimés (« LOAD … ») et repris dans docs/publications-robustness.md.
import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { load, json, uid, src } from "./helpers/ts-load.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";
import { candidates } from "./helpers/scheduled-candidates.mjs";
import { buildZip } from "./helpers/zip.mjs";

const C = n => uid("1", n), P = n => uid("3", n), PUB = n => uid("4", n), REV = n => uid("5", n), OCC = n => uid("6", n), RUN = n => uid("8", n);
const ADMIN = "user_admin", T0 = Date.parse("2026-10-12T06:00:00Z"), TICK = 15 * 60000;
const NO_OPEN = "Aucune occurrence ouverte. Préparez d’abord les prochaines semaines.";
const on = { id: "00000000-0000-0000-0000-000000000001", emergency_stop: false, generation_enabled: true, automation_enabled: true, publishing_enabled: true };
const enabled = { PUBLICATIONS_SCHEDULED_DELIVERY: "enabled" };
const report = (label, value) => console.log(`LOAD ${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);

// 20 clients fictifs (CODE-V, JRenov, Couverture Catalane, Protection Nuisibles… numérotés), un projet chacun.
function clientsTables(n = 20, extra = {}) {
  const ids = Array.from({ length: n }, (_, i) => i + 1);
  return {
    publication_client_settings: ids.map(i => ({ client_id: C(i), auto_prepare_enabled: true, generation_enabled: true, prepare_lead_days: 3, last_auto_prepared_at: null })),
    publication_events: ids.map(i => ({ client_id: C(i), action: "publication.client_settings_saved", actor_id: ADMIN, after_data: { auto_prepare_enabled: true }, created_at: "2026-10-01T00:00:00Z" })),
    publication_agent_projects: ids.map(i => ({ project_id: P(i), client_id: C(i), enabled: true, rights_confirmed: true })),
    publication_agent_v2_runs: [], publication_scheduled_runs: [], ...extra,
  };
}
function preparation(tables, { prepare, retryMedia } = {}) {
  const fake = createFakeSupabase({ publication_settings: [on], admin_notifications: [], ...tables }, { unique: { publication_scheduled_runs: [["run_id"]] }, rpc: {
    publication_channel_occurrences_ensure: () => ({ created: 0 }), publication_scheduled_delivery_candidates: candidates,
    publication_submit_manual: (a, t) => { const p = t.publications.find(x => x.id === a.p_publication_id); if (p.status !== "draft") throw Error("not a draft"); p.status = "pending_review"; },
  } });
  const mod = load("lib/publications/automation/scheduled.ts", {
    "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client }, "@/lib/admin-policy": { isAuthorizedAdmin: id => id === ADMIN }, "@/lib/core/audit": { writeAudit: async () => {} },
    "../agent-v2/service": { NO_OPEN_OCCURRENCE: NO_OPEN, prepareNextPublicationsAs: async () => { throw Error("not used"); }, retryAgentV2MediaAs: async () => { throw Error("not used"); } },
    "../delivery/registry": { SCHEDULED_LATE_TOLERANCE_SECONDS: 7200, scheduledDeliveryEnabled: env => env.PUBLICATIONS_SCHEDULED_DELIVERY === "enabled" },
  });
  const calls = [];
  const deps = { isAdmin: id => id === ADMIN, audit: async () => {},
    prepare: async (actor, project, options) => { calls.push({ actor, project, at: options.now.getTime() }); return prepare(project, calls.length, fake.tables, options); },
    retryMedia: async (actor, runId) => { if (!retryMedia) throw Error("no media retry expected"); return retryMedia(runId, fake.tables); } };
  return { fake, mod, deps, calls };
}
const success = (project, n) => ({ ok: true, message: "ok", publications: [], withMedia: false, mediaMissing: true, runId: RUN(n) });
const clientOf = project => Number(project.slice(-12));

// 1. Équité : 20 clients, 2 préparations IA par passage → tous servis en 10 passages, puis la rotation recommence.
test("L1 fairness: 20 clients are all served within 10 ticks (2 AI preparations per tick), rotation stays even over 30 ticks", async () => {
  const s = preparation(clientsTables(), { prepare: success });
  const perTick = [], ms = [];
  for (let t = 0; t < 30; t++) {
    const before = s.calls.length, start = performance.now();
    const r = await s.mod.runScheduledPreparation(new Date(T0 + t * TICK), s.deps);
    ms.push(performance.now() - start);
    assert.ok(r.preparations <= s.mod.MAX_PREPARATIONS_PER_TICK, "AI preparations per tick capped");
    perTick.push(s.calls.slice(before).map(c => clientOf(c.project)));
  }
  const firstRound = perTick.slice(0, 10).flat();
  assert.equal(new Set(firstRound).size, 20, "every client served once in the first 10 ticks");
  assert.equal(firstRound.length, 20, "no client served twice before the others");
  const served = new Map();
  for (const c of perTick.flat()) served.set(c, (served.get(c) ?? 0) + 1);
  assert.deepEqual([...new Set(served.values())], [3], "30 ticks: every client exactly 3 times");
  // Pire attente d'un client entre deux préparations : exactement un tour (10 passages).
  const gaps = [];
  for (let c = 1; c <= 20; c++) { const at = perTick.flatMap((x, t) => x.includes(c) ? [t] : []); for (let i = 1; i < at.length; i++) gaps.push(at[i] - at[i - 1]); }
  assert.deepEqual([...new Set(gaps)], [10]);
  report("rotation 20 clients", { ticks_to_serve_all: 10, max_ai_preparations_per_tick: Math.max(...perTick.map(x => x.length)), max_gap_ticks: 10, max_ms_per_tick: Math.round(Math.max(...ms)) });
});

// 2. IA en délai dépassé : chaque tentative compte (#47), le plafond par passage tient même quand tout échoue.
test("L2 AI timeouts: thrown preparations count towards the per-tick cap; failures back the project off (bounded daily AI calls)", async () => {
  // a) Exception (délai, base ou Drive) : avant #47, ignorée par le plafond → jusqu'à 10 appels IA par passage.
  const thrown = preparation(clientsTables(), { prepare: async () => { throw Error("Délai d'exécution dépassé"); } });
  const r = await thrown.mod.runScheduledPreparation(new Date(T0), thrown.deps);
  assert.equal(thrown.calls.length, 2, "two AI attempts at most per tick even when every attempt throws");
  assert.equal(r.preparations, 2); assert.equal(r.skipped.preparation_failed, 2);
  assert.match(src("lib/publications/automation/scheduled.ts"), /catch\{console\.error\('\[publications-scheduler\] preparation failed'\);summary\.preparations\+\+;/);
  // b) Échec de génération enregistré par l'Agent v2 (run « failed ») : pause de 6 h du projet, aucun nouvel appel IA.
  let aiCalls = 0;
  const occurrences = Array.from({ length: 20 }, (_, i) => ({ id: OCC(i + 1), publication_id: null, skipped_at: null, scheduled_for: new Date(T0 + 3 * 86400000).toISOString() }));
  const failing = preparation(clientsTables(20, { publication_channel_occurrences: occurrences }), { prepare: async (project, n, tables, options) => {
    // Seule occurrence ouverte du projet abandonnée (3 échecs) : l'Agent v2 répond « rien à préparer », sans IA.
    if (options.excludeOccurrenceIds?.includes(OCC(clientOf(project)))) return { ok: false, message: NO_OPEN, publications: [], withMedia: false };
    aiCalls++;
    tables.publication_agent_v2_runs.push({ id: RUN(1000 + n), project_id: project, status: "failed", occurrence_ids: [OCC(clientOf(project))], created_at: options.now.toISOString(), agent_id: uid("9", 1) });
    return { ok: false, message: "Génération indisponible. Aucun brouillon créé.", publications: [], withMedia: false };
  } });
  let maxPerTick = 0;
  for (let t = 0; t < 96; t++) { const before = aiCalls; await failing.mod.runScheduledPreparation(new Date(T0 + t * TICK), failing.deps); maxPerTick = Math.max(maxPerTick, aiCalls - before); }
  assert.equal(maxPerTick, 2);
  const perProject = new Map(); for (const run of failing.fake.tables.publication_agent_v2_runs) perProject.set(run.project_id, (perProject.get(run.project_id) ?? 0) + 1);
  assert.equal(Math.max(...perProject.values()), 3, "an occurrence failing 3 times is excluded, a failed project waits 6 h between attempts");
  const firstAt = new Map(), gaps = [];
  for (const run of failing.fake.tables.publication_agent_v2_runs) { const prev = firstAt.get(run.project_id); if (prev) gaps.push(Date.parse(run.created_at) - prev); firstAt.set(run.project_id, Date.parse(run.created_at)); }
  assert.ok(gaps.every(g => g >= failing.mod.PROJECT_FAILURE_BACKOFF_MS), "never two AI calls on a failing project within 6 h");
  // Coût plafonné : l'Agent v2 impute 0,10 € (maxCost) à une génération en échec ; le budget mensuel de l'agent est re-vérifié en base.
  report("AI failures over 24 h (96 ticks, 20 clients all failing)", { ai_calls: aiCalls, max_per_tick: maxPerTick, max_per_project: Math.max(...perProject.values()), worst_cost_eur: +(aiCalls * 0.1).toFixed(2) });
  assert.equal(aiCalls, 60, "20 projects × 3 attempts, then a human is notified");
  assert.equal(failing.fake.tables.admin_notifications.filter(x => x.category === "incident").length, 20, "one incident per abandoned occurrence");
});

// 3. Échéance du passage : aucune préparation IA ne démarre sans le temps de son pire cas ; le client garde sa place.
test("L3 tick deadline: no AI preparation starts without its worst-case budget; the client keeps its rotation slot", async () => {
  let clock = T0;
  const s = preparation(clientsTables(), { prepare: async (project, n) => { clock += 70_000; return success(project, n); } });
  const r = await s.mod.runScheduledPreparation(new Date(T0), s.deps, { deadline: T0 + 150_000, clock: () => clock });
  assert.equal(s.calls.length, 1, "70 s spent, 80 s left < 100 s budget: the second preparation waits");
  assert.equal(r.deadline, true); assert.equal(r.skipped.deadline, 1);
  const stamped = s.fake.tables.publication_client_settings.filter(x => x.last_auto_prepared_at).map(x => x.client_id);
  assert.deepEqual(stamped, [C(1)], "client 2 not stamped: first next tick");
  clock = T0 + TICK;
  await s.mod.runScheduledPreparation(new Date(clock), s.deps, { deadline: clock + 285_000, clock: () => clock });
  assert.deepEqual(s.calls.slice(1).map(c => clientOf(c.project)), [2, 3]);
  // Sans assez de temps dès le départ : rien n'est lancé, aucun client horodaté.
  const none = preparation(clientsTables(), { prepare: success });
  const z = await none.mod.runScheduledPreparation(new Date(T0), none.deps, { deadline: T0 + 99_000, clock: () => T0 });
  assert.equal(none.calls.length, 0); assert.equal(z.clients, 0);
  // Câblage : la route transmet l'échéance partagée du passage.
  assert.match(src("app/api/internal/scheduler/tick/route.ts"), /runScheduledPreparation\(new Date\(\), undefined, \{ deadline \}\)/);
});

// 4. Interruption : un client dont la préparation plante ne bloque plus la rotation ; deux passages simultanés ne
// préparent jamais le même client (compare-and-set sur l'horodatage de rotation).
test("L4 interrupted ticks and concurrent ticks: a crashing client never starves the others; no client prepared twice", async () => {
  // Client 1 « empoisonné » : le processus est coupé pendant sa préparation (exception non rattrapée simulée).
  const s = preparation(clientsTables(), { prepare: async (project, n) => { if (clientOf(project) === 1) throw Object.assign(Error("process killed"), { fatal: true }); return success(project, n); } });
  const served = [];
  for (let t = 0; t < 10; t++) { const before = s.calls.length; await s.mod.runScheduledPreparation(new Date(T0 + t * TICK), s.deps); served.push(...s.calls.slice(before).map(c => clientOf(c.project))); }
  assert.equal(new Set(served).size, 20, "all 20 clients reached within 10 ticks despite the crashing one");
  assert.equal(served.filter(c => c === 1).length, 1, "the crashing client is retried at its next turn, not every tick");
  // Deux passages simultanés (cron qui se chevauche) sur la même base.
  const twin = preparation(clientsTables(), { prepare: async (project, n) => { await new Promise(r => setTimeout(r, 1)); return success(project, n); } });
  const [a, b] = await Promise.all([twin.mod.runScheduledPreparation(new Date(T0), twin.deps), twin.mod.runScheduledPreparation(new Date(T0 + 1), twin.deps)]);
  const projects = twin.calls.map(c => c.project);
  assert.equal(new Set(projects).size, projects.length, "never the same client in both ticks");
  assert.ok((a.skipped.client_busy ?? 0) + (b.skipped.client_busy ?? 0) >= 1, "the second tick sees the client already claimed");
  report("concurrent ticks", { ai_preparations: projects.length, distinct_clients: new Set(projects).size, client_busy: (a.skipped.client_busy ?? 0) + (b.skipped.client_busy ?? 0) });
});

// 5. Beaucoup de publications approuvées le même passage : 10 diffusions préparées par passage, jamais deux fois ;
// des candidates bloquées (approbateur parti) n'affament plus les suivantes et sont signalées une fois.
function approvedTables(n, { badApprover = 0 } = {}) {
  const publications = [], publication_channel_occurrences = [], publication_reviews = [];
  for (let i = 1; i <= n; i++) {
    publications.push({ id: PUB(i), client_id: C(((i - 1) % 20) + 1), status: "approved", archived_at: null, current_revision_id: REV(i), occurrence_id: OCC(i) });
    publication_channel_occurrences.push({ id: OCC(i), scheduled_for: new Date(T0 + 3 * 3600000 + i * 60000).toISOString() });
    publication_reviews.push({ publication_id: PUB(i), revision_id: REV(i), decision: "approved", actor_id: i <= badApprover ? "user_former_admin" : ADMIN, created_at: "1" });
  }
  return { publications, publication_channel_occurrences, publication_reviews, publication_deliveries: [] };
}
const prepareRpc = { publication_prepare_delivery: (a, t) => {
  const p = t.publications.find(x => x.id === a.p_publication_id);
  if (t.publication_deliveries.some(d => d.publication_id === p.id && d.revision_id === p.current_revision_id)) return { created: false };
  t.publication_deliveries.push({ publication_id: p.id, revision_id: p.current_revision_id, status: "scheduled", actor: a.p_actor_id }); return { created: true };
} };
function deliveryPrep(tables) {
  const fake = createFakeSupabase({ publication_settings: [on], admin_notifications: [], ...tables }, { rpc: { publication_scheduled_delivery_candidates: candidates, ...prepareRpc } });
  const mod = load("lib/publications/automation/scheduled.ts", {
    "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client }, "@/lib/admin-policy": { isAuthorizedAdmin: id => id === ADMIN }, "@/lib/core/audit": { writeAudit: async () => {} },
    "../agent-v2/service": { NO_OPEN_OCCURRENCE: NO_OPEN }, "../delivery/registry": { SCHEDULED_LATE_TOLERANCE_SECONDS: 7200, scheduledDeliveryEnabled: env => env.PUBLICATIONS_SCHEDULED_DELIVERY === "enabled" },
  });
  return { fake, mod };
}
test("L5 120 approved publications for 20 clients: 10 deliveries prepared per tick, each exactly once; blocked candidates never starve the others", async () => {
  const s = deliveryPrep(approvedTables(120));
  const perTick = [];
  for (let t = 0; t < 14; t++) perTick.push((await s.mod.prepareApprovedDeliveries(enabled, new Date(T0 + t * TICK), { isAdmin: id => id === ADMIN })).prepared);
  assert.deepEqual(perTick, [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 0, 0]);
  const keys = s.fake.tables.publication_deliveries.map(d => `${d.publication_id}:${d.revision_id}`);
  assert.equal(keys.length, 120); assert.equal(new Set(keys).size, 120, "one delivery per publication revision");
  assert.ok(s.fake.tables.publication_deliveries.every(d => d.actor === ADMIN), "always as the human approver");
  report("delivery preparation 120 approved", { ticks: perTick.filter(Boolean).length, max_per_tick: Math.max(...perTick) });
  // 15 approbations d'un ancien administrateur sur les créneaux les plus proches : avant #47 elles consommaient le
  // budget (prepared + blocked ≥ 10) et la 16e (créneau 3 h plus tard) ratait son heure.
  const starved = deliveryPrep(approvedTables(16, { badApprover: 15 }));
  const r = await starved.mod.prepareApprovedDeliveries(enabled, new Date(T0), { isAdmin: id => id === ADMIN });
  assert.equal(r.prepared, 1, "the valid approval is prepared in the first tick"); assert.equal(r.blocked, 15);
  assert.equal(r.notified, 15, "each stale approval notified once");
  const again = await starved.mod.prepareApprovedDeliveries(enabled, new Date(T0 + TICK), { isAdmin: id => id === ADMIN });
  assert.equal(again.notified, 0, "never notified twice"); assert.equal(starved.fake.tables.admin_notifications.length, 15);
  assert.ok(starved.fake.tables.admin_notifications.every(n => n.category === "delivery_failed" && /^\/publications\/[0-9a-f-]{36}$/.test(n.href) && /^publication-approval-stale:/.test(n.event_key)));
  assert.equal(starved.fake.tables.publication_deliveries.length, 1, "nothing prepared for a former admin's approval");
});

// 6. Publications en attente depuis plusieurs jours : créneau manqué signalé une fois, jamais préparé ni envoyé.
test("L6 publications pending for days: missed slots notified once and never prepared; the 2 h guard is the boundary", async () => {
  const tables = approvedTables(30);
  // 10 créneaux passés depuis 1 à 5 jours, 10 passés depuis 1 h 59 (encore dans la tolérance), 10 à venir.
  tables.publication_channel_occurrences.forEach((o, i) => { o.scheduled_for = new Date(i < 10 ? T0 - (i % 5 + 1) * 86400000 : i < 20 ? T0 - 119 * 60000 : T0 + 86400000).toISOString(); });
  const s = deliveryPrep(tables);
  const r = await s.mod.prepareApprovedDeliveries(enabled, new Date(T0), { isAdmin: id => id === ADMIN });
  assert.equal(r.prepared, 10); assert.equal(r.late, 10, "missed by more than 2 h (up to 5 days)");
  const r2 = await s.mod.prepareApprovedDeliveries(enabled, new Date(T0 + 60000), { isAdmin: id => id === ADMIN });
  assert.equal(r2.late, 0, "notified once"); assert.equal(r2.prepared, 10);
  assert.ok(s.fake.tables.publication_deliveries.every(d => Number(d.publication_id.slice(-12)) > 10), "no delivery for a missed slot");
});

// 7. Envoi à l'heure prévue : capacité par passage avec l'échéance (#47), plateformes lentes jamais lancées hors délai.
function registryModule() {
  return load("lib/publications/delivery/registry.ts", {
    "@/lib/require-admin": { requireAdmin: async () => ({ userId: ADMIN }) }, "@/lib/supabase/server": { getSupabaseServerClient: () => ({}) },
    "@/lib/integrations/publications-oauth/config": {}, "@/lib/integrations/publications-oauth/http": {}, "@/lib/integrations/publications-meta-publish": {}, "@/lib/integrations/publications-gbp-publish": {},
    "../oauth/service": {}, "../connections/google-business-profile": {}, "./meta-publisher": {}, "./gbp-publisher": {}, "./engine": {}, "../connections/vault": {} });
}
const settingsDb = { from: () => ({ select: () => ({ limit: () => ({ maybeSingle: async () => ({ data: on, error: null }) }) }) }) };
// File simulée fidèle à publication_job_claim_scheduled : la tâche de tête n'est réservée que si sa plateforme est permise.
function queue(platforms, { sendMs = { facebook: 4000, google_business_profile: 4000, instagram: 30000 }, clock }) {
  const items = platforms.map((platform, i) => ({ id: i + 1, platform })), sent = [], claims = [];
  return { items, sent, claims, run: async (worker, options) => {
    claims.push(options?.platforms ?? null);
    const head = items[0];
    if (!head || (options?.platforms && !options.platforms.includes(head.platform))) return { state: "idle" };
    items.shift(); sent.push(head); clock.now += sendMs[head.platform]; return { state: "completed", outcome: "published" };
  } };
}
test("L7 scheduled sending: 20 deliveries due at the same slot all leave within the 2 h tolerance; Instagram only as a first send", async () => {
  const reg = registryModule();
  // Sans échéance (comportement historique) : 1 envoi par passage → 8 passages de 15 min tiennent dans 2 h, 12 bloqués.
  const clock = { now: T0 };
  const legacy = queue(Array(20).fill("google_business_profile"), { clock });
  let inTime = 0;
  for (let t = 0; t < 20; t++) { const r = await reg.processScheduledDuePublications(enabled, { db: settingsDb, run: legacy.run }); if (t * 15 < 120) inTime += r.counts.published; }
  assert.equal(inTime, 8, "historical capacity: 8 sends of the same slot within 2 h at a 15 min cadence");
  // Avec l'échéance du passage : 10 envois par passage au plus, tant que le pire cas tient dans le temps restant.
  const c2 = { now: T0 };
  const fast = queue(Array(20).fill("google_business_profile"), { clock: c2 });
  const ticks = [];
  for (let t = 0; t < 3; t++) { c2.now = T0 + t * TICK; const r = await reg.processScheduledDuePublications(enabled, { db: settingsDb, run: fast.run }, { deadline: c2.now + 285_000, clock: () => c2.now }); ticks.push(r.counts.published); }
  assert.deepEqual(ticks, [10, 10, 0], "20 same-slot deliveries sent in 2 ticks (30 min), all within the tolerance");
  report("scheduled sending 20 same-slot deliveries", { legacy_in_time_at_15min: inTime, with_deadline_ticks: 2, max_sends_per_tick: Math.max(...ticks) });
  // File mixte : Instagram (~290 s au pire) n'est réservé qu'en premier envoi ; jamais doublé par une plateforme plus rapide.
  const c3 = { now: T0 };
  const mixed = queue(["google_business_profile", "instagram", "facebook", "instagram"], { clock: c3 });
  const r1 = await reg.processScheduledDuePublications(enabled, { db: settingsDb, run: mixed.run }, { deadline: T0 + 285_000, clock: () => c3.now });
  assert.equal(r1.counts.published, 1, "after the GBP send, the Instagram job at the head waits for the next tick");
  assert.deepEqual(json(mixed.claims), [null, ["google_business_profile", "facebook"]], "second claim restricted to the platforms that fit");
  c3.now = T0 + TICK;
  const r2 = await reg.processScheduledDuePublications(enabled, { db: settingsDb, run: mixed.run }, { deadline: c3.now + 285_000, clock: () => c3.now });
  assert.equal(r2.counts.published, 2, "next tick: Instagram first, then Facebook; the second Instagram waits again");
  assert.deepEqual(mixed.sent.map(x => x.platform), ["google_business_profile", "instagram", "facebook"]);
  // Peu de temps restant : aucune plateforme ne tient → fin du passage (rien n'est réservé).
  const c4 = { now: T0 };
  const late = queue(Array(5).fill("facebook"), { clock: c4, sendMs: { facebook: 230_000 } });
  const r3 = await reg.processScheduledDuePublications(enabled, { db: settingsDb, run: late.run }, { deadline: T0 + 285_000, clock: () => c4.now });
  assert.equal(r3.counts.published, 1); assert.deepEqual(json(late.claims), [null], "55 s left < 60 s: no second claim at all");
  // Arrêt d'urgence et drapeau : toujours prioritaires, même avec l'échéance.
  const stopped = queue(["facebook"], { clock: { now: T0 } });
  const r4 = await reg.processScheduledDuePublications(enabled, { db: { from: () => ({ select: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { ...on, emergency_stop: true }, error: null }) }) }) }) }, run: stopped.run }, { deadline: T0 + 285_000 });
  assert.equal(r4.ok, false); assert.equal(stopped.claims.length, 0);
  assert.deepEqual(json(await reg.processScheduledDuePublications({}, { db: settingsDb, run: stopped.run }, { deadline: T0 + 285_000 })), { disabled: true });
  // Réservation refusée par la base (fonction absente, base indisponible) : le passage s'arrête au lieu d'insister.
  let staleRuns = 0;
  const rs = await reg.processScheduledDuePublications(enabled, { db: settingsDb, run: async (_w, options) => { staleRuns++; return options ? { state: "stale" } : { state: "completed", outcome: "published" }; } }, { deadline: T0 + 285_000, clock: () => T0 });
  assert.equal(staleRuns, 2); assert.equal(rs.counts.published, 1); assert.equal(rs.counts.failed, 1);
  assert.match(src("app/api/internal/scheduler/tick/route.ts"), /processScheduledDuePublications\(process\.env, undefined, \{ deadline \}\)/);
});

// 8. Moteur P10 réel + vrais publishers sous charge : API sociales en panne (5xx, délais), connexions OAuth expirées.
const model = load("lib/publications/delivery/model.ts");
const contract = load("lib/publications/delivery/publisher.ts", { "./model": model });
const vault = load("lib/publications/connections/vault.ts");
const vaultFakes = load("lib/publications/connections/fakes.ts", { "./vault": vault });
const engine = load("lib/publications/delivery/engine.ts", { "../connections/vault": vault, "./publisher": contract, "./model": model });
const meta = load("lib/publications/delivery/meta-publisher.ts", { "@/lib/integrations/publications-meta-publish": { waitMilliseconds: async () => {} } });
const gbp = load("lib/publications/delivery/gbp-publisher.ts");
const NOW = Date.parse("2029-06-01T10:00:00Z");
const kind = k => Object.assign(new Error(k), { kind: k });
async function sendAll(n, { platformOf, provider, credentialOf, refresh }) {
  const v = vaultFakes.createMemoryCredentialVault((() => { let i = 0; return () => uid("9", ++i); })());
  const refs = [];
  for (let i = 1; i <= n; i++) refs.push(await v.storeCredential(credentialOf(i)));
  const deliveries = new Map(), requests = [], writes = new Map();
  for (let i = 1; i <= n; i++) deliveries.set(uid("5", i), { i, status: "scheduled", dispatched: 0, attempts: 0, platform: platformOf(i) });
  const queueIds = [...deliveries.keys()];
  const db = {
    rpc: async (name, args) => {
      if (name === "publication_job_claim_on_time") { const id = queueIds.shift(); if (!id) return { data: null, error: null }; const d = deliveries.get(id); d.attempts++; return { data: { job_id: uid("6", d.i), delivery_id: id, attempt: d.attempts, platform: d.platform }, error: null }; }
      const d = deliveries.get(uid("5", Number(args.p_job_id.slice(-12))));
      if (name === "publication_job_context") return { data: { status: "ready", job_id: args.p_job_id, delivery_id: uid("5", d.i), attempt: d.attempts, platform: d.platform, idempotency_key: `deliver:${d.i}`, text: `Chantier ${d.i}`,
        connection_id: uid("7", d.i), account: d.platform === "google_business_profile" ? { external_account_id: "accounts/10/locations/1", parent_external_id: null } : d.platform === "instagram" ? { external_account_id: "17841400000000001", parent_external_id: "1001" } : { external_account_id: "1001", parent_external_id: null },
        assets: d.platform === "facebook" ? [] : [{ storage_path: `c/p/${d.i}.jpg`, mime_type: "image/jpeg" }] }, error: null };
      if (name === "publication_job_dispatch") { d.dispatched++; return { data: true, error: null }; }
      if (name === "publication_job_complete") { const r = args.p_outcome.result; d.status = r === "uncertain" ? "uncertain" : ["retryable", "rate_limit", "provider_unavailable"].includes(r) ? "retryable_error" : r === "auth" ? "blocked" : r; d.outcome = r; d.code = args.p_outcome.error_code ?? null; return { data: { delivery_status: d.status }, error: null }; }
      return { data: null, error: { code: "X" } };
    },
    from: () => ({ select: () => ({ eq: (_c, id) => ({ maybeSingle: async () => ({ data: { credential_reference: refs[Number(id.slice(-12)) - 1], status: "active" }, error: null }) }) }) }),
    storage: { from: () => ({ createSignedUrls: async paths => ({ data: paths.map(p => ({ path: p, signedUrl: `https://storage.example.test/${p}?token=jwt`, error: null })), error: null }) }) },
  };
  const transport = { async request(r) { requests.push(r); if (r.method === "POST") writes.set(r.path, (writes.get(r.path) ?? 0) + 1); const a = provider(r, requests.length); if (a instanceof Error) throw a; return a; } };
  const publisher = { async publish(input) {
    const p = input.platform === "google_business_profile" ? gbp.createGoogleBusinessProfilePublisher(transport, { now: () => NOW, refresh: refresh ?? null }) : meta.createMetaPublisher(transport, { sleep: async () => {}, pollAttempts: 3, now: () => NOW });
    return p.publish(input);
  } };
  const logs = [], original = console.error; console.error = (...a) => logs.push(a);
  const results = [];
  try { for (let i = 0; i < n + 1; i++) results.push(await engine.runOnePublicationJob("scheduler", { db, vault: v, publisher, maxLateSeconds: 7200 })); } finally { console.error = original; }
  return { deliveries: [...deliveries.values()], requests, results, logs };
}
const metaCredential = (expired = false) => ({ accessToken: "EAAB-user-secret", refreshToken: null, expiresAt: expired ? "2029-05-01T00:00:00.000Z" : "2029-08-01T00:00:00.000Z", scopes: [], provider: "meta", subject: "987" });
const gbpCredential = (expired = false) => ({ accessToken: "ya29.access-secret", refreshToken: "1//refresh-secret", expiresAt: expired ? "2029-06-01T09:00:00.000Z" : "2029-06-01T10:30:00.000Z", scopes: [], provider: "google_business_profile" });
test("L8 social APIs down (5xx, timeouts) and expired OAuth for 20 clients: never more than one write per delivery, nothing published twice", async () => {
  const platformOf = i => ["facebook", "instagram", "google_business_profile"][i % 3];
  // a) Plateformes en panne : Page token / conteneur (lecture) en 5xx → réessayable, aucune écriture ; écriture en délai → à vérifier.
  const down = await sendAll(20, { platformOf, credentialOf: i => platformOf(i) === "google_business_profile" ? gbpCredential() : metaCredential(),
    provider: (r, n) => r.method === "GET" && r.path === "1001" ? (n % 3 === 0 ? { status: 503, body: null } : { status: 200, body: { access_token: "EAAB-page-secret" } })
      : r.method === "POST" ? kind("timeout") : { status: 200, body: { status_code: "FINISHED" } } });
  assert.equal(down.results.filter(r => r.state === "completed").length, 20); assert.deepEqual(json(down.results.at(-1)), { state: "idle" });
  for (const d of down.deliveries) {
    assert.equal(d.dispatched, 1, "one dispatch per delivery");
    assert.ok(["uncertain", "retryable_error", "blocked"].includes(d.status), d.status);
    if (d.status === "uncertain") assert.match(d.code, /after_dispatch|5xx|transient/);
  }
  const posts = down.requests.filter(r => r.method === "POST" && !r.path.endsWith("/media"));
  assert.ok(posts.length <= 20, "at most one publishing write per delivery");
  // b) Connexions expirées : Meta → bloquée sans aucune requête ; GBP → renouvellement en mémoire refusé → bloquée, aucune écriture.
  const expired = await sendAll(20, { platformOf, credentialOf: i => platformOf(i) === "google_business_profile" ? gbpCredential(true) : metaCredential(true),
    refresh: async () => { throw kind("revoked"); }, provider: () => { throw Error("no request expected"); } });
  assert.equal(expired.requests.length, 0, "an expired token never reaches a provider");
  assert.ok(expired.deliveries.every(d => d.status === "blocked" && d.outcome === "auth"), "auth → blocked (reconnect), never retried automatically");
  assert.ok(!JSON.stringify([down.logs, expired.logs]).match(/secret|jwt/), "no credential in logs");
  report("social outage 20 deliveries", { dispatches: down.deliveries.reduce((s, d) => s + d.dispatched, 0), publishing_writes: posts.length,
    uncertain: down.deliveries.filter(d => d.status === "uncertain").length, retryable: down.deliveries.filter(d => d.status === "retryable_error").length, expired_requests: expired.requests.length });
});

// 9. Archives WhatsApp volumineuses : mémoire et temps bornés par appel, reprise exacte après interruption, doublons.
test("L9 large WhatsApp export (600 photos, duplicates): bounded batches, resumable after a crash, duplicates imported once", async () => {
  const zip = load("lib/whatsapp/zip.ts");
  const jpeg = n => Buffer.from(`JPEG-${n}-`.repeat(40));
  const files = [{ name: "_chat.txt", data: "12/01/2024 14:32 - Jean: IMG-20240112-WA0001.jpg (fichier joint)\nToiture" }];
  for (let i = 1; i <= 600; i++) files.push({ name: `IMG-20240112-WA${String(i).padStart(4, "0")}.jpg`, data: jpeg(i <= 550 ? i : i - 550) }); // 50 doublons octet pour octet
  const archive = buildZip(files);
  const fake = createFakeSupabase({ whatsapp_senders: [{ client_id: C(1), drive_folder_id: "folder_wa_client01", enabled: true, rights_confirmed: true, updated_at: "1" }], whatsapp_assets: [], whatsapp_export_imports: [], whatsapp_export_items: [] });
  let n = 0, crashAt = 0, maxRead = 0, uploads = 0;
  const reader = async () => { const r = zip.bufferReader(archive); return { size: r.size, async read(s, e) { maxRead = Math.max(maxRead, e - s); return r.read(s, e); } }; };
  const deps = { reader, signedUpload: async () => "https://project.supabase.co/upload", purge: async () => {}, storePreview: async () => true, signedPreviews: async () => new Map(),
    inspect: async b => Buffer.from(b).toString().startsWith("JPEG") ? { mime: "image/jpeg", width: 1600, height: 1200 } : null, thumbnail: async () => new Uint8Array([1]),
    driveToken: async () => "token", generateDriveId: async () => `drivefile${String(++n).padStart(6, "0")}`,
    uploadDrive: async () => { uploads++; if (crashAt && uploads === crashAt) throw Object.assign(Error("network"), { code: "drive_unavailable" }); return "created"; },
    storeThumbnail: async () => {}, audit: async () => {}, now: () => new Date("2026-10-12T08:00:00Z"), listObjects: async () => [], removeObjects: async () => {} };
  const mod = load("lib/whatsapp/export-import.ts", {
    "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client }, "@/lib/core/audit": { writeAudit: async () => {} }, sharp: () => ({}),
    "./export-storage": { archiveReader: async () => { throw Error("unused"); }, ExportStorageFailure: class extends Error {}, listExportObjects: async () => [], removeExportObjects: async () => {}, MAX_ARCHIVE_BYTES: 500 * 1024 * 1024, purgeExportFiles: async () => {}, signedArchiveUpload: async () => "", signedPreviews: async () => new Map(), storePreview: async () => true },
    "./providers": { generateDriveId: async () => "", ImportFailure: class extends Error { constructor(code) { super(code); this.code = code; } }, importDriveToken: async () => "", maxImageBytes: 8 * 1024 * 1024, thumbnail: async () => null, uploadDrive: async () => "created" },
    "./service": { storeThumbnail: async () => {} } });
  const started = await mod.startExportImport(ADMIN, C(1), archive.length, true, deps);
  assert.equal((await mod.analyzeExportArchive(ADMIN, C(1), started.importId, deps)).photos, 600);
  let analyzeCalls = 0, r, t0 = performance.now(), maxMs = 0;
  do { const s = performance.now(); r = await mod.analyzeExportBatch(C(1), started.importId, deps); maxMs = Math.max(maxMs, performance.now() - s); analyzeCalls++; } while (r.remaining);
  assert.equal(analyzeCalls, 40, "15 photos per call");
  const items = fake.tables.whatsapp_export_items;
  assert.equal(items.filter(i => i.status === "duplicate").length, 50); assert.equal(items.filter(i => i.status === "ready").length, 550);
  // Import : coupure Drive au 100e envoi, puis reprise.
  crashAt = 100; let importCalls = 0, done = false;
  while (!done && importCalls < 200) { const x = await mod.importExportBatch(ADMIN, C(1), started.importId, deps); importCalls++; if (x.ok) done = x.done; }
  const failed = fake.tables.whatsapp_export_items.filter(i => i.status === "failed");
  assert.equal(failed.length, 1, "the interrupted photo is marked failed, the batch continues");
  assert.equal(fake.tables.whatsapp_assets.filter(a => a.imported_at).length, 549);
  // La ligne de photothèque de la photo interrompue existe sans imported_at : un nouvel import la reprend (même identifiant Drive).
  const orphan = fake.tables.whatsapp_assets.find(a => !a.imported_at);
  assert.ok(orphan, "orphan row kept for an idempotent resume");
  const hashes = fake.tables.whatsapp_assets.map(a => a.sha256);
  assert.equal(new Set(hashes).size, hashes.length, "never two library rows for the same photo");
  assert.ok(maxRead <= 64 * 1024 + 1024, `range reads stay small (${maxRead} bytes): the archive is never loaded whole`);
  report("WhatsApp export 600 photos", { analyze_calls: analyzeCalls, import_calls: importCalls, photos_per_import_call: 8, max_range_read_bytes: maxRead, max_ms_per_analyze_call: Math.round(maxMs), total_ms: Math.round(performance.now() - t0) });
});

// 10. Purge des exports : des suppressions qui échouent durablement ne bloquent plus la conservation des autres.
test("L10 export purge: imports whose deletion keeps failing rotate to the back instead of blocking the 24 h retention of the others", async () => {
  const imports = [];
  for (let i = 1; i <= 25; i++) imports.push({ id: uid("a", i), client_id: C(i), drive_folder_id: "folder_wa_client01", status: "completed", storage_path: `${C(i)}/${uid("a", i)}.zip`, archive_size: 10, counts: {}, incomplete: false, error_code: null,
    expires_at: new Date(T0 - (30 - i) * 3600000).toISOString(), purged_at: null, created_at: "2026-10-10T00:00:00Z", updated_at: new Date(T0 - (30 - i) * 3600000).toISOString() });
  const fake = createFakeSupabase({ whatsapp_export_imports: imports, whatsapp_export_items: [] });
  const broken = new Set(imports.slice(0, 20).map(x => x.id)); // les 20 plus anciens : suppression en échec permanent
  let now = T0;
  const deps = { purge: async (_c, id) => { if (broken.has(id)) throw Error("storage down"); }, now: () => new Date(now), listObjects: async () => [], removeObjects: async () => {}, audit: async () => {} };
  const mod = load("lib/whatsapp/export-import.ts", {
    "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client }, "@/lib/core/audit": { writeAudit: async () => {} }, sharp: () => ({}), "./export-storage": { ExportStorageFailure: class extends Error {} },
    "./providers": { ImportFailure: class extends Error {} }, "./service": {} });
  const errors = console.error; console.error = () => {};
  let ticks = 0;
  try { while (fake.tables.whatsapp_export_imports.some(x => !broken.has(x.id) && !x.purged_at) && ticks < 5) { now += 60000; await mod.purgeExportImports(deps); ticks++; } } finally { console.error = errors; }
  assert.equal(ticks, 2, "the 5 healthy imports are purged on the second tick (before #47: never, behind 20 failing ones)");
  assert.ok(fake.tables.whatsapp_export_imports.filter(x => broken.has(x.id)).every(x => !x.purged_at), "a failed deletion is never marked purged");
  report("export purge head-of-line", { ticks_to_purge_healthy: ticks, permanently_failing: 20, limit_per_tick: 20 });
});
