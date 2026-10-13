// Socle Publications, lot 6 : préparation planifiée (Agent v2 au nom de l'admin délégué), soumission « À valider »,
// notification, diffusions préparées uniquement après approbation humaine et derrière PUBLICATIONS_SCHEDULED_DELIVERY.
import test from "node:test";
import assert from "node:assert/strict";
import { load, src, json, uid } from "./helpers/ts-load.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";
import { candidates } from "./helpers/scheduled-candidates.mjs";

const C = uid("1", 1), C2 = uid("1", 2), P = uid("3", 1), RUN = uid("8", 1), PUB = n => uid("4", n), REV = n => uid("5", n), OCC = n => uid("6", n);
const ADMIN = "user_admin", now = new Date("2026-10-12T08:00:00Z");
const NO_OPEN = "Aucune occurrence ouverte. Préparez d’abord les prochaines semaines.";
const on = { id: "00000000-0000-0000-0000-000000000001", emergency_stop: false, generation_enabled: true, automation_enabled: true, publishing_enabled: true };
const savedEvent = (clientId, actor, auto, at = "2026-10-01T00:00:00Z") => ({ client_id: clientId, action: "publication.client_settings_saved", actor_id: actor, after_data: { auto_prepare_enabled: auto }, created_at: at });

function setup(tables, rpc = {}) {
  const fake = createFakeSupabase(tables, { unique: { publication_scheduled_runs: [["run_id"]] }, rpc: { publication_channel_occurrences_ensure: () => ({ created: 0 }), publication_submit_manual: (a, t) => { const p = t.publications.find(x => x.id === a.p_publication_id); p.status = "pending_review"; },
    publication_scheduled_delivery_candidates: candidates, ...rpc } });
  const audits = [], prepared = [];
  const mod = load("lib/publications/automation/scheduled.ts", {
    "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client },
    "@/lib/admin-policy": { isAuthorizedAdmin: id => id === ADMIN },
    "@/lib/core/audit": { writeAudit: async () => {} },
    "../agent-v2/service": { NO_OPEN_OCCURRENCE: NO_OPEN, prepareNextPublicationsAs: async () => { throw Error("not used"); }, retryAgentV2MediaAs: async () => { throw Error("not used"); } },
    "../delivery/registry": { SCHEDULED_LATE_TOLERANCE_SECONDS: 7200, scheduledDeliveryEnabled: env => env.PUBLICATIONS_SCHEDULED_DELIVERY === "enabled" },
  });
  const deps = (result) => ({ isAdmin: id => id === ADMIN, audit: async (actor, entry) => { audits.push([actor, entry]); },
    retryMedia: async () => { throw Error("no media retry expected"); },
    prepare: async (actor, project, options) => { prepared.push([actor, project, options]); return typeof result === "function" ? result(prepared.length) : result; } });
  return { fake, mod, audits, prepared, deps };
}
const okRun = (withMedia) => ({ ok: true, message: "ok", runId: RUN, withMedia, mediaMissing: !withMedia, publications: [{ id: PUB(1), platform: "facebook", label: "Facebook" }, { id: PUB(2), platform: "instagram", label: "Instagram" }] });
const baseTables = (extra = {}) => ({ publication_settings: [on], publication_client_settings: [{ client_id: C, auto_prepare_enabled: true, generation_enabled: true, prepare_lead_days: 3 }],
  publication_events: [savedEvent(C, ADMIN, true)], publication_agent_projects: [{ project_id: P, client_id: C, enabled: true, rights_confirmed: true }],
  publications: [{ id: PUB(1), status: "draft", current_revision_id: REV(1) }, { id: PUB(2), status: "draft", current_revision_id: REV(2) }], admin_notifications: [], ...extra });

test("scheduled preparation: global switches closed → nothing read, nothing prepared", async () => {
  for (const settings of [{ ...on, emergency_stop: true }, { ...on, automation_enabled: false }, { ...on, generation_enabled: false }, null]) {
    const { mod, prepared, deps, fake } = setup(baseTables({ publication_settings: settings ? [settings] : [] }));
    const r = await mod.runScheduledPreparation(now, deps(okRun(true)));
    assert.equal(r.disabled, "global"); assert.equal(prepared.length, 0);
    assert.ok(!fake.calls.some(c => c[0] === "rpc"));
  }
});

test("scheduled preparation: horizon ensured, Agent v2 called as the delegated admin, complete drafts submitted and one review notification", async () => {
  const { mod, prepared, deps, fake, audits } = setup(baseTables());
  const r = await mod.runScheduledPreparation(now, deps(okRun(true)));
  assert.deepEqual(json(r), { clients: 1, preparations: 1, submitted: 2, notified: 1, skipped: {}, followUp: { runs: 0, attached: 0, submitted: 0, gaveUp: 0 } });
  const ensure = fake.calls.find(c => c[1] === "publication_channel_occurrences_ensure");
  assert.deepEqual(ensure[2], { p_project_id: P, p_start_date: "2026-10-12", p_end_date: "2026-10-15", p_actor_id: ADMIN });
  assert.equal(prepared[0][0], ADMIN); assert.equal(prepared[0][1], P);
  assert.equal(prepared[0][2].leadDays, 3); assert.equal(prepared[0][2].allowRealAI, true);
  assert.deepEqual(fake.tables.publications.map(p => p.status), ["pending_review", "pending_review"]);
  assert.ok(!fake.calls.some(c => /review_manual|prepare_delivery|approve/.test(String(c[1]))), "never approves nor prepares a delivery");
  assert.deepEqual(json(fake.tables.admin_notifications.map(({ event_key, category, href }) => ({ event_key, category, href }))), [{ event_key: `publication-review:${RUN}`, category: "publication_review", href: "/publications/review" }]);
  assert.deepEqual(json(audits[0][0]), { kind: "system", worker: "publications-scheduler" });
  assert.equal(audits[0][1].metadata.delegated_actor, ADMIN); assert.deepEqual(json(audits[0][1].metadata.submitted), [PUB(1), PUB(2)]);
  assert.doesNotMatch(JSON.stringify(audits), /text|caption/i);
});

test("scheduled preparation: drafts without a photo stay drafts (no submission, no review notification)", async () => {
  const { mod, deps, fake } = setup(baseTables());
  const r = await mod.runScheduledPreparation(now, deps(okRun(false)));
  assert.equal(r.submitted, 0); assert.equal(r.notified, 0);
  assert.deepEqual(fake.tables.publications.map(p => p.status), ["draft", "draft"]);
  assert.ok(!fake.calls.some(c => c[1] === "publication_submit_manual"));
});

test("scheduled preparation: no delegated admin (disabled at last save, other user, not the authorized admin) → fail closed", async () => {
  for (const events of [[], [savedEvent(C, ADMIN, false)], [savedEvent(C, "user_other", true)], [savedEvent(C, ADMIN, true, "2026-09-01T00:00:00Z"), savedEvent(C, ADMIN, false, "2026-10-02T00:00:00Z")]]) {
    const { mod, prepared, deps } = setup(baseTables({ publication_events: events }));
    const r = await mod.runScheduledPreparation(now, deps(okRun(true)));
    assert.equal(prepared.length, 0); assert.equal(r.skipped.no_delegated_admin, 1);
  }
});

test("scheduled preparation: agent project must be enabled with media rights; nothing open → no count; attempts bounded per tick", async () => {
  const off = setup(baseTables({ publication_agent_projects: [{ project_id: P, client_id: C, enabled: true, rights_confirmed: false }] }));
  assert.equal((await off.mod.runScheduledPreparation(now, off.deps(okRun(true)))).skipped.no_agent_project, 1);
  assert.equal(off.prepared.length, 0);
  const idle = setup(baseTables());
  const r = await idle.mod.runScheduledPreparation(now, idle.deps({ ok: false, message: NO_OPEN, publications: [], withMedia: false }));
  assert.equal(r.preparations, 0); assert.equal(r.skipped.nothing_to_prepare, 1);
  const projects = [1, 2, 3, 4].map(n => ({ project_id: uid("3", n), client_id: C, enabled: true, rights_confirmed: true }));
  const many = setup(baseTables({ publication_agent_projects: projects }));
  const refused = await many.mod.runScheduledPreparation(now, many.deps({ ok: false, message: "Contenu refusé", publications: [], withMedia: false }));
  assert.equal(many.prepared.length, many.mod.MAX_PREPARATIONS_PER_TICK, "refusals count: AI calls stay bounded");
  assert.equal(refused.skipped.preparation_refused, many.mod.MAX_PREPARATIONS_PER_TICK);
});

test("scheduled preparation: only clients with automatic preparation and generation enabled", async () => {
  const { mod, prepared, deps } = setup(baseTables({ publication_client_settings: [{ client_id: C, auto_prepare_enabled: false, generation_enabled: true, prepare_lead_days: 3 }, { client_id: C2, auto_prepare_enabled: true, generation_enabled: false, prepare_lead_days: 3 }] }));
  const r = await mod.runScheduledPreparation(now, deps(okRun(true)));
  assert.equal(r.clients, 0); assert.equal(prepared.length, 0);
});

const approvedTables = (extra = {}) => ({ publication_settings: [on],
  publications: [{ id: PUB(1), status: "approved", archived_at: null, current_revision_id: REV(1), occurrence_id: OCC(1), updated_at: "1" },
    { id: PUB(2), status: "pending_review", archived_at: null, current_revision_id: REV(2), occurrence_id: OCC(2), updated_at: "2" },
    { id: PUB(3), status: "rejected", archived_at: null, current_revision_id: REV(3), occurrence_id: OCC(3), updated_at: "3" },
    { id: PUB(4), status: "approved", archived_at: "2026-10-01", current_revision_id: REV(4), occurrence_id: OCC(4), updated_at: "4" },
    { id: PUB(5), status: "approved", archived_at: null, current_revision_id: REV(5), occurrence_id: null, updated_at: "5" }],
  publication_channel_occurrences: [1, 2, 3, 4, 5].map(n => ({ id: OCC(n), scheduled_for: "2026-10-13T08:00:00Z" })),
  publication_reviews: [{ publication_id: PUB(1), revision_id: REV(1), decision: "approved", actor_id: "user_reviewer", created_at: "2026-10-11" }],
  publication_deliveries: [], ...extra });
const enabled = { PUBLICATIONS_SCHEDULED_DELIVERY: "enabled" };
const reviewerIsAdmin = { isAdmin: id => id === "user_reviewer" };

test("delivery preparation: disabled unless the flag is exactly 'enabled' and the global switches allow publishing", async () => {
  for (const env of [{}, { PUBLICATIONS_SCHEDULED_DELIVERY: "true" }, { PUBLICATIONS_SCHEDULED_DELIVERY: "ENABLED" }]) {
    const { mod, fake } = setup(approvedTables());
    assert.equal((await mod.prepareApprovedDeliveries(env, now)).disabled, "flag");
    assert.equal(fake.calls.length, 0, "nothing read");
  }
  for (const settings of [{ ...on, emergency_stop: true }, { ...on, publishing_enabled: false }]) {
    const { mod, fake } = setup(approvedTables({ publication_settings: [settings] }));
    assert.equal((await mod.prepareApprovedDeliveries(enabled, now, reviewerIsAdmin)).disabled, "global");
    assert.ok(!fake.calls.some(c => c[0] === "rpc"));
  }
});

test("delivery preparation: only human-approved, scheduled, non-archived publications, as the approver; existing delivery reused; late ones left to a human", async () => {
  const { mod, fake } = setup(approvedTables(), { publication_prepare_delivery: () => ({ created: true }) });
  assert.deepEqual(json(await mod.prepareApprovedDeliveries(enabled, now, { isAdmin: id => id === "user_reviewer" })), { prepared: 1, blocked: 0, late: 0, photoBlocked: 0, notified: 0 });
  assert.deepEqual(fake.calls.filter(c => c[0] === "rpc" && c[1] !== "publication_scheduled_delivery_candidates"), [["rpc", "publication_prepare_delivery", { p_publication_id: PUB(1), p_actor_id: "user_reviewer" }]]);
  assert.deepEqual(fake.calls.find(c => c[1] === "publication_scheduled_delivery_candidates")[2], { p_late_before: "2026-10-12T06:00:00.000Z", p_limit: 50 }, "filtered in the database: upcoming within the 2 h tolerance");
  // Diffusion déjà vivante pour la révision courante : rien à refaire.
  const live = setup(approvedTables({ publication_deliveries: [{ publication_id: PUB(1), revision_id: REV(1), status: "failed" }] }), { publication_prepare_delivery: () => ({}) });
  assert.equal((await live.mod.prepareApprovedDeliveries(enabled, now, reviewerIsAdmin)).prepared, 0);
  assert.ok(!live.fake.calls.some(c => c[1] === "publication_prepare_delivery"), "a failed delivery waits for a manual retry");
  const cancelled = setup(approvedTables({ publication_deliveries: [{ publication_id: PUB(1), revision_id: REV(1), status: "cancelled" }] }), { publication_prepare_delivery: () => ({}) });
  assert.equal((await cancelled.mod.prepareApprovedDeliveries(enabled, now, reviewerIsAdmin)).prepared, 0);
  assert.ok(!cancelled.fake.calls.some(c => c[1] === "publication_prepare_delivery"), "a delivery cancelled by a human is never recreated for the same revision");
  // Approbation d'une ancienne révision (modifiée depuis) : aucun approbateur, rien n'est préparé.
  const stale = setup(approvedTables({ publication_reviews: [{ publication_id: PUB(1), revision_id: REV(9), decision: "approved", actor_id: "user_reviewer", created_at: "1" }] }), { publication_prepare_delivery: () => ({}) });
  assert.equal((await stale.mod.prepareApprovedDeliveries(enabled, now, reviewerIsAdmin)).blocked, 1);
  assert.ok(!stale.fake.calls.some(c => c[1] === "publication_prepare_delivery"));
  // Créneau passé depuis plus de 2 h : jamais envoyée en retard sans un humain ; signalée une fois (#6).
  const late = setup(approvedTables({ publication_channel_occurrences: [{ id: OCC(1), scheduled_for: "2026-10-12T05:00:00Z" }] }), { publication_prepare_delivery: () => ({}) });
  assert.equal((await late.mod.prepareApprovedDeliveries(enabled, now, reviewerIsAdmin)).late, 1);
  assert.ok(!late.fake.calls.some(c => c[1] === "publication_prepare_delivery"));
  assert.deepEqual(json(late.fake.tables.admin_notifications.map(({ event_key, category, href }) => ({ event_key, category, href }))), [{ event_key: `publication-missed:${PUB(1)}:${REV(1)}`, category: "delivery_failed", href: `/publications/${PUB(1)}` }]);
  assert.equal((await late.mod.prepareApprovedDeliveries(enabled, now, reviewerIsAdmin)).late, 0, "notified once: no longer a candidate");
  assert.equal(late.fake.tables.admin_notifications.length, 1);
  // Refus serveur (canal non publiable, kill switch) : compté, aucune erreur remontée.
  const refused = setup(approvedTables(), { publication_prepare_delivery: () => { throw Error("Not publishable: no_account"); } });
  assert.equal((await refused.mod.prepareApprovedDeliveries(enabled, now, reviewerIsAdmin)).blocked, 1);
});

test("scheduled due run: disabled without the flag, one send per tick, cockpit button unchanged", async () => {
  const reg = load("lib/publications/delivery/registry.ts", {
    "@/lib/require-admin": { requireAdmin: async () => ({ userId: ADMIN }) }, "@/lib/supabase/server": { getSupabaseServerClient: () => ({}) },
    "@/lib/integrations/publications-oauth/config": {}, "@/lib/integrations/publications-oauth/http": {}, "@/lib/integrations/publications-meta-publish": {}, "@/lib/integrations/publications-gbp-publish": {},
    "../oauth/service": {}, "../connections/google-business-profile": {}, "./meta-publisher": {}, "./gbp-publisher": {}, "./engine": {}, "../connections/vault": {} });
  const settings = (row) => ({ from: () => ({ select: () => ({ limit: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }) });
  let runs = 0; const run = async (worker) => { runs++; assert.equal(worker, "scheduler"); return { state: "completed", outcome: "published" }; };
  assert.deepEqual(json(await reg.processScheduledDuePublications({}, { db: settings(on), run })), { disabled: true });
  assert.equal(runs, 0);
  const r = await reg.processScheduledDuePublications(enabled, { db: settings(on), run });
  assert.equal(runs, 1); assert.equal(r.counts.published, 1);
  runs = 0; await reg.processScheduledDuePublications(enabled, { db: settings({ ...on, emergency_stop: true }), run });
  assert.equal(runs, 0, "emergency stop still wins");
});

test("tick route wires the steps in isolated steps (own try each); notifications accept the review category and link", () => {
  const route = src("app/api/internal/scheduler/tick/route.ts");
  assert.match(route, /prepareApprovedDeliveries\(process\.env\)[\s\S]*processScheduledDuePublications\(process\.env[,)][\s\S]*runScheduledPreparation\(/);
  assert.equal((route.match(/await step\("/g) ?? []).length, 9, "every step (export purge and runTick included) goes through step(): own try/catch, deadline, heartbeat");
  const schema = load("lib/notifications/schema.ts", { zod: { z: { object: () => ({ strict: () => ({}) }), array: () => ({ max: () => ({}) }), enum: () => ({}), boolean: () => ({}), uuid: () => ({}), url: () => ({ max: () => ({ refine: () => ({}) }) }), string: () => ({ regex: () => ({}) }) } } });
  assert.ok(schema.categories.includes("publication_review"));
  assert.equal(schema.notificationLabels.publication_review, "Publication à valider");
  assert.equal(schema.safeNotificationHref("/publications/review"), "/publications/review");
  assert.equal(schema.safeNotificationHref(`/publications/${PUB(1)}`), `/publications/${PUB(1)}`);
  assert.equal(schema.safeNotificationHref("/publications/../settings"), "/notifications");
});
