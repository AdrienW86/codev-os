// Socle Publications, lot 6 — reprises et garde-fous du planificateur : candidates filtrées en base, rotation des
// clients, pause après échec de l'agent, reprise sans IA de l'étape média, envoi jamais plus en retard que la tolérance,
// créneaux manqués et photos non publiables signalés, approbateur re-vérifié, tick isolé par étape avec battement.
// Scénarios D, E, G, H : côté base dans supabase/tests/publications-scheduled-after-delivery-engine.sql (P10_FULL_CHAIN),
// côté serveur ici (mocks, aucun réseau).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load, src, json, uid, root } from "./helpers/ts-load.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";
import { candidates } from "./helpers/scheduled-candidates.mjs";

const C = n => uid("1", n), P = n => uid("3", n), PUB = n => uid("4", n), REV = n => uid("5", n), OCC = n => uid("6", n), RUN = n => uid("8", n), AGENT = uid("9", 1);
const ADMIN = "user_admin", now = new Date("2026-10-12T08:00:00Z");
const NO_OPEN = "Aucune occurrence ouverte. Préparez d’abord les prochaines semaines.";
const on = { id: "00000000-0000-0000-0000-000000000001", emergency_stop: false, generation_enabled: true, automation_enabled: true, publishing_enabled: true };
const saved = (clientId, actor = ADMIN) => ({ client_id: clientId, action: "publication.client_settings_saved", actor_id: actor, after_data: { auto_prepare_enabled: true }, created_at: "2026-10-01T00:00:00Z" });
const enabled = { PUBLICATIONS_SCHEDULED_DELIVERY: "enabled" };
const hours = h => new Date(now.getTime() - h * 3600000).toISOString();

function setup(tables, { rpc = {}, prepare = { ok: false, message: NO_OPEN, publications: [], withMedia: false }, retryMedia, failOn } = {}) {
  const fake = createFakeSupabase({ publication_settings: [on], admin_notifications: [], ...tables }, { failOn, unique: { publication_scheduled_runs: [["run_id"]] }, rpc: {
    publication_channel_occurrences_ensure: () => ({ created: 0 }), publication_scheduled_delivery_candidates: candidates,
    publication_submit_manual: (a, t) => { const p = t.publications.find(x => x.id === a.p_publication_id); if (p.status !== "draft") throw Error("not a draft"); p.status = "pending_review"; },
    publication_agent_v2_media_fail: (a, t) => { const r = t.publication_agent_v2_runs.find(x => x.id === a.p_run_id); if (r.media_attempts !== a.p_attempt) throw Error("stale"); r.media_status = "needs_media"; return { media_status: "needs_media" }; },
    ...rpc } });
  const mod = load("lib/publications/automation/scheduled.ts", {
    "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client },
    "@/lib/admin-policy": { isAuthorizedAdmin: id => id === ADMIN },
    "@/lib/core/audit": { writeAudit: async () => {} },
    "../agent-v2/service": { NO_OPEN_OCCURRENCE: NO_OPEN, prepareNextPublicationsAs: async () => { throw Error("not used"); }, retryAgentV2MediaAs: async () => { throw Error("not used"); } },
    "../delivery/registry": { SCHEDULED_LATE_TOLERANCE_SECONDS: 7200, scheduledDeliveryEnabled: env => env.PUBLICATIONS_SCHEDULED_DELIVERY === "enabled" },
  });
  const prepared = [], retried = [];
  const deps = { isAdmin: id => id === ADMIN, audit: async () => {},
    prepare: async (actor, project, options) => { prepared.push([actor, project, options]); return typeof prepare === "function" ? prepare(prepared.length) : prepare; },
    retryMedia: async (actor, runId) => { retried.push([actor, runId]); if (!retryMedia) throw Error("no media retry expected"); return retryMedia(runId, fake.tables); } };
  return { fake, mod, deps, prepared, retried };
}
const notes = fake => json(fake.tables.admin_notifications.map(({ event_key, category, href }) => ({ event_key, category, href })));
const client = (n, extra = {}) => ({ client_id: C(n), auto_prepare_enabled: true, generation_enabled: true, prepare_lead_days: 3, last_auto_prepared_at: null, ...extra });

// 1. Candidates : plus de 50 publications déjà diffusées ne bloquent plus les nouvelles approbations.
test("#1 delivery preparation reads database-filtered candidates: old published approvals never starve new ones", async () => {
  const publications = [], deliveries = [], occurrences = [], reviews = [];
  for (let n = 1; n <= 61; n++) {
    publications.push({ id: PUB(n), status: "approved", archived_at: null, current_revision_id: REV(n), occurrence_id: OCC(n), updated_at: String(n) });
    occurrences.push({ id: OCC(n), scheduled_for: n <= 60 ? "2026-10-10T08:00:00Z" : "2026-10-13T08:00:00Z" });
    if (n <= 60) deliveries.push({ publication_id: PUB(n), revision_id: REV(n), status: "published" });
    reviews.push({ publication_id: PUB(n), revision_id: REV(n), decision: "approved", actor_id: ADMIN, created_at: "1" });
  }
  const { mod, fake } = setup({ publications, publication_deliveries: deliveries, publication_channel_occurrences: occurrences, publication_reviews: reviews }, { rpc: { publication_prepare_delivery: () => ({ created: true }) } });
  const r = await mod.prepareApprovedDeliveries(enabled, now);
  assert.equal(r.prepared, 1);
  assert.deepEqual(fake.calls.filter(c => c[1] === "publication_prepare_delivery").map(c => c[2].p_publication_id), [PUB(61)]);
  assert.ok(!fake.calls.some(c => c[0] === "publications" && c[1] === "select"), "no unbounded approved scan in the server");
  assert.match(src("supabase/migrations/20261030000000_publications_scheduled_flow.sql"), /not exists\(select 1 from public\.publication_deliveries d where d\.publication_id=p\.id and d\.revision_id=p\.current_revision_id\)/);
});

// 2. Rotation : le client le moins récemment traité d'abord ; au-delà de 10, aucun n'est oublié.
test("#2 clients rotate fairly: never-prepared first, then the least recently prepared; every visited client is stamped", async () => {
  const settings = Array.from({ length: 12 }, (_, i) => client(i + 1, { last_auto_prepared_at: i < 10 ? new Date(Date.UTC(2026, 9, 1, i)).toISOString() : null }));
  const { mod, fake, deps } = setup({ publication_client_settings: settings });
  const r1 = await mod.runScheduledPreparation(now, deps);
  assert.equal(r1.clients, 10);
  const stamped = fake.tables.publication_client_settings.filter(s => s.last_auto_prepared_at === now.toISOString()).map(s => s.client_id);
  assert.deepEqual(stamped.sort(), [C(1), C(2), C(3), C(4), C(5), C(6), C(7), C(8), C(11), C(12)].sort(), "never-prepared clients first, then the oldest");
  const later = new Date(now.getTime() + 300000);
  await mod.runScheduledPreparation(later, deps);
  assert.deepEqual(fake.tables.publication_client_settings.filter(s => s.last_auto_prepared_at !== later.toISOString()).map(s => s.client_id).sort(), [C(11), C(12)].sort(), "the clients left out (9, 10) come first next tick");
  assert.match(src("supabase/migrations/20261030000000_publications_scheduled_flow.sql"), /add column last_auto_prepared_at timestamptz;/);
});

// 3. Pause après un échec de l'agent ; occurrence abandonnée après N échecs, signalée une fois.
const prepTables = (runs, extra = {}) => ({ publication_client_settings: [client(1)], publication_events: [saved(C(1))],
  publication_agent_projects: [{ project_id: P(1), client_id: C(1), enabled: true, rights_confirmed: true }], publication_agent_v2_runs: runs, ...extra });
test("#3 a failed Agent v2 run pauses the project for hours (no AI call); an occurrence failing repeatedly is excluded and notified once", async () => {
  const recent = setup(prepTables([{ id: RUN(1), project_id: P(1), status: "failed", occurrence_ids: [OCC(1)], created_at: hours(3), agent_id: AGENT }]));
  const r = await recent.mod.runScheduledPreparation(now, recent.deps);
  assert.equal(recent.prepared.length, 0, "no AI call during the backoff");
  assert.equal(r.skipped.failure_backoff, 1);
  assert.ok(!recent.fake.calls.some(c => c[1] === "publication_channel_occurrences_ensure"));
  const old = setup(prepTables([{ id: RUN(1), project_id: P(1), status: "failed", occurrence_ids: [OCC(1)], created_at: hours(7), agent_id: AGENT }]));
  await old.mod.runScheduledPreparation(now, old.deps);
  assert.equal(old.prepared.length, 1, "after the backoff the project is tried again");
  assert.equal(old.prepared[0][2].excludeOccurrenceIds, undefined);
  const runs = [1, 2, 3].map(n => ({ id: RUN(n), project_id: P(1), status: "failed", occurrence_ids: [OCC(9), OCC(n)], created_at: hours(30 - n), agent_id: AGENT }))
    .concat([{ id: RUN(4), project_id: P(1), status: "completed", occurrence_ids: [OCC(4)], created_at: hours(1), agent_id: AGENT }]);
  const stuck = setup(prepTables(runs, { publication_channel_occurrences: [{ id: OCC(9), publication_id: null, skipped_at: null, scheduled_for: "2026-10-13T10:00:00Z" }] }));
  const s = await stuck.mod.runScheduledPreparation(now, stuck.deps);
  assert.deepEqual(json(stuck.prepared[0][2].excludeOccurrenceIds), [OCC(9)], "the exhausted occurrence is never sent to the AI again");
  assert.deepEqual(notes(stuck.fake), [{ event_key: `publication-preparation-failed:${OCC(9)}`, category: "incident", href: `/agents/${AGENT}` }]);
  assert.equal(s.notified, 1);
  await stuck.mod.runScheduledPreparation(now, stuck.deps);
  assert.equal(stuck.fake.tables.admin_notifications.length, 1, "notified once (idempotent event key)");
  // Historique illisible : échec fermé, aucun appel IA.
  const unreadable = setup(prepTables([]), { failOn: table => table === "publication_agent_v2_runs" });
  assert.equal((await unreadable.mod.runScheduledPreparation(now, unreadable.deps)).skipped.failures_unavailable, 1);
  assert.equal(unreadable.prepared.length, 0);
});

// 4. Étape média bloquée : reprise sans IA, soumission « À valider », abandon signalé avec réservation libérée.
const followTables = (run, extra = {}) => ({ publication_client_settings: [], publication_events: [saved(C(1))],
  publication_scheduled_runs: [{ run_id: RUN(1), client_id: C(1), state: "open", created_at: hours(20) }],
  publication_agent_v2_runs: [{ id: RUN(1), client_id: C(1), project_id: P(1), status: "completed", media_status: "pending", media_attempts: 1, media_lease_until: hours(1), publication_ids: [PUB(1), PUB(2)], created_at: hours(20), ...run }],
  publications: [{ id: PUB(1), status: "draft", current_revision_id: REV(1) }, { id: PUB(2), status: "draft", current_revision_id: REV(2) }], ...extra });
test("#4 follow-up: an expired media step is retried without AI, then the drafts are submitted with one review notification", async () => {
  const { mod, deps, fake, prepared, retried } = setup(followTables({}), { retryMedia: (runId, t) => { t.publication_agent_v2_runs[0].media_status = "attached"; return "attached"; } });
  const r = await mod.runScheduledPreparation(now, deps);
  assert.deepEqual(json(retried), [[ADMIN, RUN(1)]]);
  assert.equal(prepared.length, 0, "no generation");
  assert.deepEqual(fake.tables.publications.map(p => p.status), ["pending_review", "pending_review"]);
  assert.deepEqual(notes(fake), [{ event_key: `publication-review:${RUN(1)}`, category: "publication_review", href: "/publications/review" }]);
  assert.equal(fake.tables.publication_scheduled_runs[0].state, "done");
  assert.deepEqual(json(r.followUp), { runs: 1, attached: 1, submitted: 2, gaveUp: 0 });
  assert.ok(!fake.calls.some(c => /review_manual|prepare_delivery/.test(String(c[1]))), "never approves");
  // Passage suivant : rien à refaire (pas de second essai, pas de doublon).
  await mod.runScheduledPreparation(now, deps);
  assert.equal(retried.length, 1); assert.equal(fake.tables.admin_notifications.length, 1);
});
test("#4 follow-up: lease still running → wait; failed retry → stays open; attached but still drafts → submitted without retry", async () => {
  const busy = setup(followTables({ media_lease_until: "2026-10-12T08:05:00Z" }), { retryMedia: () => "attached" });
  await busy.mod.runScheduledPreparation(now, busy.deps);
  assert.equal(busy.retried.length, 0); assert.equal(busy.fake.tables.publication_scheduled_runs[0].state, "open");
  const failing = setup(followTables({ media_status: "needs_media", media_lease_until: null }), { retryMedia: () => "needs_media" });
  await failing.mod.runScheduledPreparation(now, failing.deps);
  assert.equal(failing.retried.length, 1); assert.equal(failing.fake.tables.publication_scheduled_runs[0].state, "open");
  assert.deepEqual(failing.fake.tables.publications.map(p => p.status), ["draft", "draft"]);
  const attached = setup(followTables({ media_status: "attached", media_lease_until: null }));
  const r = await attached.mod.runScheduledPreparation(now, attached.deps);
  assert.equal(attached.retried.length, 0); assert.equal(r.followUp.submitted, 2);
  const orphan = setup(followTables({ media_status: "attached", media_lease_until: null }, { publication_events: [] }));
  const o = await orphan.mod.runScheduledPreparation(now, orphan.deps);
  assert.equal(o.skipped.follow_up_no_delegated_admin, 1); assert.deepEqual(orphan.fake.tables.publications.map(p => p.status), ["draft", "draft"]);
});
test("#4 follow-up: attempts exhausted → the claim is released, « Photo manquante » notified once, drafts left to a human", async () => {
  const pending = setup(followTables({ media_attempts: 3 }), { retryMedia: () => "attached" });
  const r = await pending.mod.runScheduledPreparation(now, pending.deps);
  assert.equal(pending.retried.length, 0);
  assert.deepEqual(pending.fake.calls.filter(c => c[1] === "publication_agent_v2_media_fail").map(c => c[2]), [{ p_run_id: RUN(1), p_attempt: 3, p_error_code: "media_unavailable", p_actor_id: ADMIN }], "pending (expired) claim released explicitly");
  assert.deepEqual(notes(pending.fake), [{ event_key: `media-missing:run:${RUN(1)}`, category: "media_missing", href: `/clients/${C(1)}?tab=media` }]);
  assert.equal(pending.fake.tables.publication_scheduled_runs[0].state, "gave_up"); assert.equal(r.followUp.gaveUp, 1);
  assert.deepEqual(pending.fake.tables.publications.map(p => p.status), ["draft", "draft"]);
  const failed = setup(followTables({ media_status: "needs_media", media_attempts: 3, media_lease_until: null }));
  await failed.mod.runScheduledPreparation(now, failed.deps);
  assert.ok(!failed.fake.calls.some(c => c[1] === "publication_agent_v2_media_fail"), "needs_media already released its claim");
  assert.equal(failed.fake.tables.publication_scheduled_runs[0].state, "gave_up");
  const stale = setup(followTables({ media_status: "needs_media", media_attempts: 1, media_lease_until: null, created_at: hours(80) }));
  await stale.mod.runScheduledPreparation(now, stale.deps);
  assert.equal(stale.retried.length, 0); assert.equal(stale.fake.tables.publication_scheduled_runs[0].state, "gave_up", "bounded in time too");
});
test("#4 a scheduled preparation whose photo is not attached yet is tracked for the follow-up (complete or photo-less ones are not)", async () => {
  const result = { ok: true, message: "ok", runId: RUN(1), withMedia: false, mediaMissing: false, publications: [{ id: PUB(1), platform: "facebook", label: "Facebook" }] };
  const tracked = setup(prepTables([], { publications: [{ id: PUB(1), status: "draft", current_revision_id: REV(1) }] }), { prepare: result });
  await tracked.mod.runScheduledPreparation(now, tracked.deps);
  assert.deepEqual(json(tracked.fake.tables.publication_scheduled_runs.map(({ run_id, client_id }) => ({ run_id, client_id }))), [{ run_id: RUN(1), client_id: C(1) }]);
  const missing = setup(prepTables([], { publications: [{ id: PUB(1), status: "draft", current_revision_id: REV(1) }] }), { prepare: { ...result, mediaMissing: true } });
  await missing.mod.runScheduledPreparation(now, missing.deps);
  assert.equal((missing.fake.tables.publication_scheduled_runs ?? []).length, 0, "no photo selected: « Photo manquante » already sent by the agent");
});

// Scénario H (serveur) : reprise après une interruption entre l'attache et la soumission, sans doublon.
test("H restart between attach and submission: only the remaining draft is submitted, no new draft, no AI", async () => {
  const { mod, deps, fake, prepared } = setup(followTables({ media_status: "attached", media_lease_until: null }, {
    publications: [{ id: PUB(1), status: "pending_review", current_revision_id: REV(1) }, { id: PUB(2), status: "draft", current_revision_id: REV(2) }] }));
  const r = await mod.runScheduledPreparation(now, deps);
  assert.deepEqual(fake.calls.filter(c => c[1] === "publication_submit_manual").map(c => c[2].p_publication_id), [PUB(2)]);
  assert.equal(r.followUp.submitted, 1); assert.equal(prepared.length, 0);
  assert.equal(fake.tables.publications.length, 2, "no draft created");
});

test('submission read failure stays open and the next tick recovers without generating again',async()=>{
 let fail=true;
 const {mod,deps,fake,prepared}=setup(followTables({media_status:'attached'}),{failOn:(table,op)=>fail&&table==='publications'&&op==='select'});
 const first=await mod.runScheduledPreparation(now,deps);
 assert.equal(first.skipped.follow_up_submission_unconfirmed,1);
 assert.equal(fake.tables.publication_scheduled_runs[0].state,'open');
 assert.equal(fake.calls.filter(c=>c[1]==='publication_submit_manual').length,0);
 fail=false;await mod.runScheduledPreparation(now,deps);
 assert.equal(fake.tables.publication_scheduled_runs[0].state,'done');
 assert.deepEqual(fake.tables.publications.map(p=>p.status),['pending_review','pending_review']);
 assert.equal(prepared.length,0);assert.equal(fake.tables.admin_notifications.length,1);
});

test('partial submission retries only the remaining draft and never reopens a human decision',async()=>{
 let failSecond=true;
 const {mod,deps,fake}=setup(followTables({media_status:'attached'}),{rpc:{publication_submit_manual:(a,t)=>{
  if(a.p_publication_id===PUB(2)&&failSecond)throw Error('temporary failure');
  const p=t.publications.find(p=>p.id===a.p_publication_id);assert.equal(p.status,'draft');p.status='pending_review';
 }}});
 const first=await mod.runScheduledPreparation(now,deps);
 assert.equal(first.followUp.submitted,1);assert.equal(fake.tables.publication_scheduled_runs[0].state,'open');
 fake.tables.publications[0].status='approved';failSecond=false;
 const second=await mod.runScheduledPreparation(now,deps);
 assert.equal(second.followUp.submitted,1);assert.equal(fake.tables.publication_scheduled_runs[0].state,'done');
 assert.deepEqual(fake.tables.publications.map(p=>p.status),['approved','pending_review']);
 assert.deepEqual(fake.calls.filter(c=>c[1]==='publication_submit_manual').map(c=>c[2].p_publication_id),[PUB(1),PUB(2),PUB(2)]);
 assert.equal(fake.tables.admin_notifications.length,1);
});

test('notification failure is recovered even when every revision was already submitted',async()=>{
 let fail=true;
 const {mod,deps,fake}=setup(followTables({media_status:'attached'}),{failOn:(table,op)=>fail&&table==='admin_notifications'&&op==='upsert'});
 await mod.runScheduledPreparation(now,deps);
 assert.equal(fake.tables.publication_scheduled_runs[0].state,'open');
 assert.deepEqual(fake.tables.publications.map(p=>p.status),['pending_review','pending_review']);
 fail=false;const second=await mod.runScheduledPreparation(now,deps);
 assert.equal(second.followUp.submitted,0);assert.equal(fake.tables.publication_scheduled_runs[0].state,'done');
 assert.equal(fake.calls.filter(c=>c[1]==='publication_submit_manual').length,2);
 assert.equal(fake.tables.admin_notifications.length,1);
});

test('missing publications or revisions are not silently treated as completed follow-up',async()=>{
 for(const publications of [[{id:PUB(1),status:'pending_review',current_revision_id:REV(1)}],[{id:PUB(1),status:'draft',current_revision_id:null},{id:PUB(2),status:'approved',current_revision_id:REV(2)}]]){
  const {mod,deps,fake}=setup(followTables({media_status:'attached'},{publications}));
  await mod.runScheduledPreparation(now,deps);assert.equal(fake.tables.publication_scheduled_runs[0].state,'open');
 }
});

test('initial successful preparation tracks notification failure for the next tick',async()=>{
 let failNotification=true;
 const result={ok:true,message:'prepared',runId:RUN(1),withMedia:true,publications:[{id:PUB(1),platform:'facebook',label:'Facebook'}]};
 const {mod,deps,fake}=setup(prepTables([{id:RUN(1),client_id:C(1),project_id:P(1),status:'completed',media_status:'attached',media_attempts:1,publication_ids:[PUB(1)],created_at:hours(1)}],{
  publications:[{id:PUB(1),status:'draft',current_revision_id:REV(1)}],
 }),{prepare:result,failOn:(table,op)=>failNotification&&table==='admin_notifications'&&op==='upsert'});
 await mod.runScheduledPreparation(now,deps);
 assert.equal(fake.tables.publications[0].status,'pending_review');
 assert.equal(fake.tables.publication_scheduled_runs.length,1,'notification failure must keep a durable follow-up');
 // Real PostgreSQL supplies these table defaults, which the in-memory double does not implement.
 Object.assign(fake.tables.publication_scheduled_runs[0],{state:'open',created_at:hours(1)});
 fake.tables.publication_client_settings[0].auto_prepare_enabled=false;
 failNotification=false;await mod.runScheduledPreparation(now,deps);
 assert.equal(fake.tables.publication_scheduled_runs[0].state,'done');
 assert.equal(fake.tables.admin_notifications.length,1);
 assert.equal(fake.calls.filter(c=>c[1]==='publication_submit_manual').length,1);
});

// 5. Envoi : le planificateur réserve « à l'heure » (tolérance), le bouton du cockpit garde la réservation humaine.
test("#5 the scheduler claim carries the lateness tolerance; the cockpit claim is unchanged", async () => {
  const engine = load("lib/publications/delivery/engine.ts", { "../editor": { IMAGE_BUCKET: "b" }, "../validation": { isPublicationUuid: () => true }, "../connections/vault": {}, "./publisher": {}, "./model": {} });
  const calls = [], db = { rpc: async (name, args) => { calls.push([name, args]); return { data: null, error: null }; } };
  assert.deepEqual(json(await engine.runOnePublicationJob("scheduler", { db, maxLateSeconds: 7200 })), { state: "idle" });
  assert.deepEqual(json(await engine.runOnePublicationJob("cockpit-user", { db })), { state: "idle" });
  assert.deepEqual(json(calls), [["publication_job_claim_on_time", { p_worker_id: "scheduler", p_lease_seconds: 120, p_max_late_seconds: 7200 }], ["publication_job_claim", { p_worker_id: "cockpit-user", p_lease_seconds: 120 }]]);
  const registry = src("lib/publications/delivery/registry.ts");
  assert.match(registry, /SCHEDULED_LATE_TOLERANCE_SECONDS=2\*3600/);
  assert.match(registry, /run:scheduledRun\}(,options:ScheduledDueOptions=\{\})?\):Promise<DueRunSummary\|\{disabled:true\}>/, "scheduler default: on-time claim");
  assert.match(registry, /processDuePublications\(deps:DueRunDeps=\{db:getSupabaseServerClient\(\) as unknown as SettingsDb,run:runOnePublicationJobInProduction\}\)/, "cockpit default unchanged");
});

// Scénario G (serveur) : refus du réseau jamais compté comme un succès.
test("G provider refusals are never counted as successes", async () => {
  const reg = load("lib/publications/delivery/registry.ts", {
    "@/lib/require-admin": { requireAdmin: async () => ({ userId: ADMIN }) }, "@/lib/supabase/server": { getSupabaseServerClient: () => ({}) },
    "@/lib/integrations/publications-oauth/config": {}, "@/lib/integrations/publications-oauth/http": {}, "@/lib/integrations/publications-meta-publish": {}, "@/lib/integrations/publications-gbp-publish": {},
    "../oauth/service": {}, "../connections/google-business-profile": {}, "./meta-publisher": {}, "./gbp-publisher": {}, "./engine": {}, "../connections/vault": {} });
  const settings = { from: () => ({ select: () => ({ limit: () => ({ maybeSingle: async () => ({ data: on, error: null }) }) }) }) };
  for (const [result, key] of [[{ state: "completed", outcome: "permanent" }, "failed"], [{ state: "completed", outcome: "auth" }, "blocked"], [{ state: "completed", outcome: "provider_unavailable" }, "retry"],
    [{ state: "blocked", reason: "connection_inactive" }, "blocked"], [{ state: "unconfirmed" }, "uncertain"], [{ state: "completed", outcome: "uncertain" }, "uncertain"]]) {
    const r = await reg.processScheduledDuePublications(enabled, { db: settings, run: async () => result });
    assert.equal(r.counts[key], 1, key); assert.equal(r.counts.published, 0, `${result.outcome ?? result.state} never a success`);
  }
});

// 6 et 9. Créneau manqué et photo de la photothèque devenue non publiable : rien n'est préparé, signalé une fois.
const approved = (extra = {}) => ({ publications: [{ id: PUB(1), status: "approved", archived_at: null, current_revision_id: REV(1), occurrence_id: OCC(1) }],
  publication_channel_occurrences: [{ id: OCC(1), scheduled_for: "2026-10-13T08:00:00Z" }], publication_reviews: [{ publication_id: PUB(1), revision_id: REV(1), decision: "approved", actor_id: ADMIN, created_at: "1" }],
  publication_deliveries: [], ...extra });
test("#9 a library photo that is no longer publishable blocks the delivery preparation (notified once)", async () => {
  const { mod, fake } = setup(approved({ unpublishable_photos: [PUB(1)] }), { rpc: { publication_prepare_delivery: () => ({ created: true }) } });
  const r = await mod.prepareApprovedDeliveries(enabled, now);
  assert.equal(r.photoBlocked, 1); assert.equal(r.prepared, 0);
  assert.ok(!fake.calls.some(c => c[1] === "publication_prepare_delivery"));
  assert.deepEqual(notes(fake), [{ event_key: `publication-photo-unpublishable:${PUB(1)}:${REV(1)}`, category: "delivery_failed", href: `/publications/${PUB(1)}` }]);
  assert.equal((await mod.prepareApprovedDeliveries(enabled, now)).photoBlocked, 0, "reported once");
  assert.match(src("supabase/migrations/20261030000000_publications_scheduled_flow.sql"), /not publications_private\.library_asset_publishable\(a\)/);
});

// 8. L'approbateur doit toujours être l'administrateur autorisé au moment de préparer la diffusion.
test("#8 an approver who is no longer the authorized admin never gets a delivery prepared", async () => {
  const { mod, fake } = setup(approved({ publication_reviews: [{ publication_id: PUB(1), revision_id: REV(1), decision: "approved", actor_id: "user_former", created_at: "1" }] }), { rpc: { publication_prepare_delivery: () => ({ created: true }) } });
  const r = await mod.prepareApprovedDeliveries(enabled, now);
  assert.equal(r.blocked, 1); assert.ok(!fake.calls.some(c => c[1] === "publication_prepare_delivery"));
  const still = setup(approved(), { rpc: { publication_prepare_delivery: () => ({ created: true }) } });
  assert.equal((await still.mod.prepareApprovedDeliveries(enabled, now)).prepared, 1);
});

// Drapeau : seule la valeur exacte « enabled » active la diffusion ; jamais d'approbation automatique.
test("PUBLICATIONS_SCHEDULED_DELIVERY: absent or any value but exactly 'enabled' → nothing prepared nor sent; .env.example keeps it off", async () => {
  const reg = load("lib/publications/delivery/registry.ts", {
    "@/lib/require-admin": { requireAdmin: async () => ({ userId: ADMIN }) }, "@/lib/supabase/server": { getSupabaseServerClient: () => ({}) },
    "@/lib/integrations/publications-oauth/config": {}, "@/lib/integrations/publications-oauth/http": {}, "@/lib/integrations/publications-meta-publish": {}, "@/lib/integrations/publications-gbp-publish": {},
    "../oauth/service": {}, "../connections/google-business-profile": {}, "./meta-publisher": {}, "./gbp-publisher": {}, "./engine": {}, "../connections/vault": {} });
  for (const env of [{}, { PUBLICATIONS_SCHEDULED_DELIVERY: "" }, { PUBLICATIONS_SCHEDULED_DELIVERY: "true" }, { PUBLICATIONS_SCHEDULED_DELIVERY: "1" }, { PUBLICATIONS_SCHEDULED_DELIVERY: "Enabled" }, { PUBLICATIONS_SCHEDULED_DELIVERY: " enabled" }, { PUBLICATIONS_SCHEDULED_DELIVERY: "enabled " }]) {
    const { mod, fake } = setup(approved(), { rpc: { publication_prepare_delivery: () => ({ created: true }) } });
    assert.equal((await mod.prepareApprovedDeliveries(env, now)).disabled, "flag");
    assert.equal(fake.calls.length, 0, "nothing read, nothing prepared");
    let runs = 0;
    assert.deepEqual(json(await reg.processScheduledDuePublications(env, { db: {}, run: async () => { runs++; return { state: "idle" }; } })), { disabled: true });
    assert.equal(runs, 0, "nothing sent");
    assert.equal(reg.scheduledDeliveryEnabled(env), false);
  }
  const example = readFileSync(`${root}/.env.example`, "utf8");
  assert.match(example, /^PUBLICATIONS_SCHEDULED_DELIVERY=$/m);
  assert.doesNotMatch(example, /PUBLICATIONS_SCHEDULED_DELIVERY=\s*enabled/i);
  for (const file of ["lib/publications/automation/scheduled.ts", "lib/publications/delivery/registry.ts", "app/api/internal/scheduler/tick/route.ts"])
    assert.doesNotMatch(src(file), /publication_review_manual|decision:\s*['"]approved['"]/, `${file} never approves`);
});

// 10. Battement du planificateur.
function heartbeatModule(fake) { return load("lib/scheduler/heartbeat.ts", { "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client } }); }
test("#10 heartbeat: one row per name, closed step statuses and integer counters only; last success survives a failure", async () => {
  const fake = createFakeSupabase({ scheduler_heartbeats: [] });
  const hb = heartbeatModule(fake);
  const start = new Date("2026-10-12T08:00:00Z"), end = new Date("2026-10-12T08:01:00Z");
  assert.equal(await hb.recordSchedulerHeartbeat({ startedAt: start }), true);
  assert.deepEqual(json(fake.tables.scheduler_heartbeats.map(({ name, started_at, finished_at }) => ({ name, started_at, finished_at }))), [{ name: "scheduler_tick", started_at: start.toISOString(), finished_at: null }]);
  await hb.recordSchedulerHeartbeat({ startedAt: start, finishedAt: end, steps: {
    automations: { status: "ok", ms: 120.4, counts: hb.stepCounts({ processed: 2, message: "Texte libre", nested: { sent: 1, label: "x" }, list: [1, 2] }) },
    push: { status: "exploded", ms: 1 }, "Bad Name": { status: "ok", ms: 1 }, publication_preparation: { status: "skipped", ms: 0 } } });
  const row = fake.tables.scheduler_heartbeats[0];
  assert.equal(row.ok, true); assert.equal(row.last_success_at, end.toISOString()); assert.equal(row.last_failure_at, undefined);
  assert.deepEqual(json(row.steps), { automations: { status: "ok", ms: 120, counts: { processed: 2, nested_sent: 1 } }, publication_preparation: { status: "skipped", ms: 0 } });
  assert.doesNotMatch(JSON.stringify(row), /Texte|Bad Name|exploded/);
  const later = new Date("2026-10-12T08:06:00Z");
  await hb.recordSchedulerHeartbeat({ startedAt: later, finishedAt: later, steps: { automations: { status: "failed", ms: 3 } } });
  assert.equal(fake.tables.scheduler_heartbeats.length, 1);
  assert.equal(row.ok, false); assert.equal(row.last_failure_at, later.toISOString()); assert.equal(row.last_success_at, end.toISOString(), "last success kept");
  const read = await hb.getSchedulerHeartbeat();
  assert.deepEqual(json(read), { name: "scheduler_tick", startedAt: later.toISOString(), finishedAt: later.toISOString(), ok: false, steps: { automations: { status: "failed", ms: 3 } }, lastSuccessAt: end.toISOString(), lastFailureAt: later.toISOString() });
  assert.deepEqual(json(hb.schedulerSteps), ["whatsapp_exports", "automations", "publication_delivery_prepare", "publication_delivery_send", "push", "search_console", "whatsapp", "media_intelligence", "publication_preparation"]);
  const down = createFakeSupabase({}, { failOn: () => true });
  assert.equal(await heartbeatModule(down).recordSchedulerHeartbeat({ startedAt: start, finishedAt: end, steps: {} }), false, "a failed write never breaks the tick");
});

function routeWith(fake, overrides = {}) {
  const ran = [];
  const mark = (name, value) => async (...args) => { ran.push(name); if (typeof value === "function") return value(...args); return value; };
  const route = load("app/api/internal/scheduler/tick/route.ts", {
    "next/server": { NextResponse: { json: (body, init) => ({ body, init }) } },
    "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client },
    "@/lib/scheduler/cron-auth": { checkCronAuthorization: (header, secret) => header === `Bearer ${secret}` ? { ok: true } : { ok: false, status: 401 } },
    "@/lib/scheduler/engine": { runTick: mark("automations", overrides.runTick ?? { enqueued: 0, processed: 1 }) },
    "@/lib/services/domain": { ensureGlobalAgents: async () => {} },
    "@/lib/notifications/push": { flushPushNotifications: mark("push", { sent: 1 }) },
    "@/lib/integrations/search-console/sync": { syncDueSearchConsole: mark("search_console", { synced: 0 }) },
    "@/lib/whatsapp/service": { ingestionEnabled: () => false, processMediaBatch: mark("whatsapp", {}), purgeExpiredPersonalData: async () => ({}) },
    "@/lib/media-intelligence/service": { runMediaIntelligenceTick: mark("media_intelligence", overrides.media ?? { classified: 1 }) },
    "@/lib/publications/automation/scheduled": { prepareApprovedDeliveries: mark("publication_delivery_prepare", env => ({ disabled: env.PUBLICATIONS_SCHEDULED_DELIVERY === "enabled" ? undefined : "flag", prepared: 0 })),
      runScheduledPreparation: mark("publication_preparation", { clients: 1, skipped: { no_delegated_admin: 1 } }) },
    "@/lib/publications/delivery/registry": { processScheduledDuePublications: mark("publication_delivery_send", { disabled: true }) },
    "@/lib/whatsapp/export-import": { purgeExportImports: mark("whatsapp_exports", { purged: 0, failed: 0, orphans: 0 }) },
  }, { process: { env: { CRON_SECRET: "secret" } } });
  return { route, ran };
}
const request = auth => ({ headers: { get: () => auth } });
test("#10 tick: a failing runTick no longer skips the other steps; heartbeat records each step without content", async () => {
  const fake = createFakeSupabase({ scheduler_heartbeats: [] });
  const { route, ran } = routeWith(fake, { runTick: () => { throw Error("Texte sensible du job"); } });
  const res = await route.POST(request("Bearer secret"));
  assert.equal(res.init.status, 500);
  assert.deepEqual(ran, ["whatsapp_exports", "automations", "publication_delivery_prepare", "publication_delivery_send", "push", "search_console", "media_intelligence", "publication_preparation"]);
  const row = fake.tables.scheduler_heartbeats[0];
  assert.equal(row.ok, false);
  assert.deepEqual(json(Object.fromEntries(Object.entries(row.steps).map(([k, v]) => [k, v.status]))), { whatsapp_exports: "ok", automations: "failed", publication_delivery_prepare: "disabled", publication_delivery_send: "disabled", push: "ok",
    search_console: "ok", whatsapp: "disabled", media_intelligence: "ok", publication_preparation: "ok" });
  assert.deepEqual(json(row.steps.publication_preparation.counts), { clients: 1, skipped_no_delegated_admin: 1 });
  assert.doesNotMatch(JSON.stringify(fake.tables.scheduler_heartbeats), /Texte|sensible/);
  const denied = await route.GET(request("Bearer wrong"));
  assert.equal(denied.init.status, 401);
});
test("#10 tick: shared deadline (maxDuration) skips the heavy later steps when too little time remains", async () => {
  const fake = createFakeSupabase({ scheduler_heartbeats: [] });
  const realNow = Date.now;
  const { route, ran } = routeWith(fake, { runTick: () => { const t = realNow(); Date.now = () => t + 250_000; return { processed: 1 }; } });
  try { await route.GET(request("Bearer secret")); } finally { Date.now = realNow; }
  assert.deepEqual(ran, ["whatsapp_exports", "automations", "publication_delivery_prepare", "push"], "35 s left: only the light steps run");
  const statuses = Object.fromEntries(Object.entries(fake.tables.scheduler_heartbeats[0].steps).map(([k, v]) => [k, v.status]));
  assert.deepEqual(json(statuses), { whatsapp_exports: "ok", automations: "ok", publication_delivery_prepare: "disabled", publication_delivery_send: "skipped", push: "ok", search_console: "skipped", whatsapp: "skipped", media_intelligence: "skipped", publication_preparation: "skipped" });
  assert.equal(fake.tables.scheduler_heartbeats[0].ok, true, "skipped is not a failure");
});
