// Socle Publications, lot 7 : tableau de supervision (comptes, publications, photos, tâches) et actions Reprogrammer /
// Suspendre. Les autres actions (Approuver, Refuser, Modifier, Générer maintenant) réutilisent les écrans existants.
import test from "node:test";
import assert from "node:assert/strict";
import { load, src, json, uid } from "./helpers/ts-load.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";

const C = uid("1", 1), C2 = uid("1", 2), P = uid("3", 1), PUB = n => uid("4", n), REV = n => uid("5", n), OCC = n => uid("6", n), A = n => uid("a", n), CONN = n => uid("c", n), D = n => uid("d", n);
const now = new Date("2026-10-12T08:00:00Z"), ADMIN = "user_admin";
const at = h => new Date(now.getTime() + h * 3600000).toISOString();
const model = load("lib/publications/supervision-model.ts");

test("accounts: connected only when account and connection are active and not expired", () => {
  const account = (extra = {}) => ({ id: A(1), client_id: C, platform: "facebook", display_name: "Page Martin", status: "active", enabled: true, connection_id: CONN(1), ...extra });
  const conn = (extra = {}) => ({ id: CONN(1), client_id: C, provider: "meta", status: "active", expires_at: null, ...extra });
  assert.equal(model.accountHealth(account(), [conn()], now).state, "connected");
  const cases = [[account(), [], "Aucune connexion"], [account(), [conn({ status: "expired" })], "Connexion expirée"], [account(), [conn({ status: "revoked" })], "Accès révoqué"],
    [account(), [conn({ expires_at: at(-1) })], "Connexion expirée"], [account({ status: "unavailable" }), [conn()], "Compte indisponible"], [account({ enabled: false }), [conn()], "Compte désactivé"],
    [account(), [conn({ client_id: C2 })], "Aucune connexion"]];
  for (const [a, c, reason] of cases) assert.deepEqual(json(model.accountHealth(a, c, now)), { id: A(1), clientId: C, platform: "facebook", name: "Page Martin", state: "reconnect", reason });
});

test("photos: available = what the agent may really use; rejected and to-review counted; too few flagged", () => {
  const row = (n, extra = {}) => ({ id: A(n), library_status: "validated", media_kind: "image", mime_type: "image/jpeg", size: 1, width: 1600, height: 1200, purged_at: null, imported_at: "2026-10-01T00:00:00Z", claimed_agent_v2_run_id: null, ...extra });
  const rows = [row(1), row(2), row(3, { library_status: "rejected" }), row(4, { library_status: "quarantined" }), row(5, { library_status: "received" }), row(6, { width: 300, height: 200 }), row(7, { library_status: "rejected", purged_at: "2026-10-01" })];
  const assessed = [{ asset_id: A(5), verdict: "to_review", confidential: false, sensitive: [], manual_verdict: null, description: "", topics: [], quality: "good", quality_issues: [], business_relevance: 0.5, publishability: 0.5 }];
  const s = model.photoStats(rows, assessed, [], { allowed: false, afterDays: 180 }, now);
  assert.deepEqual(json(s), { available: 2, capped: false, rejected: 1, toReview: 2 });
  assert.equal(model.tooFewPhotos(s), true);
  assert.equal(model.tooFewPhotos({ ...s, available: model.MIN_AVAILABLE_PHOTOS }), false);
});

test("upcoming agent tasks: empty future slots within 14 days, preparation date from the client lead time", () => {
  const occ = (n, h, extra = {}) => ({ id: OCC(n), client_id: C, project_id: P, platform: "instagram", scheduled_for: at(h), publication_id: null, skipped_at: null, ...extra });
  const rows = [occ(1, 96), occ(2, 24), occ(3, -2), occ(4, 48, { publication_id: PUB(1) }), occ(5, 30, { skipped_at: at(-5) }), occ(6, 24 * 20), occ(7, 72, { client_id: C2 })];
  const tasks = model.upcomingTasks(rows, new Map([[C, { autoPrepare: true, leadDays: 3 }]]), now);
  assert.deepEqual(tasks.map(t => t.occurrenceId), [OCC(2), OCC(7), OCC(1)]);
  assert.equal(tasks[0].prepareFrom, now.toISOString(), "already within the lead time: now");
  assert.equal(tasks[2].prepareFrom, at(24), "96 h slot, 3 days ahead");
  assert.equal(tasks[1].automatic, false, "client without automatic preparation waits for Générer maintenant");
});

test("reschedule targets: same project and platform, free, future, 4 weeks, never the current slot", () => {
  const occ = (n, h, extra = {}) => ({ id: OCC(n), client_id: C, project_id: P, platform: "facebook", scheduled_for: at(h), publication_id: null, skipped_at: null, ...extra });
  const rows = [occ(1, 10), occ(2, 20), occ(3, -1), occ(4, 30, { platform: "instagram" }), occ(5, 40, { project_id: uid("3", 2) }), occ(6, 50, { publication_id: PUB(2) }), occ(7, 24 * 40), occ(8, 60, { skipped_at: at(-1) })];
  assert.deepEqual(model.rescheduleTargets(rows, { project_id: P, platform: "facebook", occurrence_id: OCC(1) }, now).map(o => o.id), [OCC(2)]);
});

test("delivery state of the current revision: latest live delivery decides; only unsent ones are cancellable", () => {
  const d = (n, status, extra = {}) => ({ id: D(n), publication_id: PUB(1), revision_id: REV(1), status, scheduled_for: at(5), updated_at: `2026-10-1${n}`, ...extra });
  assert.equal(model.deliveryState([], PUB(1), REV(1)).state, "none");
  assert.deepEqual(json(model.deliveryState([d(1, "cancelled"), d(2, "scheduled")], PUB(1), REV(1))), { state: "scheduled", cancellable: [D(2)] });
  assert.equal(model.deliveryState([d(1, "published")], PUB(1), REV(1)).state, "published");
  for (const status of ["failed", "uncertain", "blocked", "retryable_error"]) assert.equal(model.deliveryState([d(1, status)], PUB(1), REV(1)).state, "error");
  assert.equal(model.deliveryState([d(1, "scheduled", { revision_id: REV(9) })], PUB(1), REV(1)).state, "none", "older revision ignored");
  assert.deepEqual(json(model.deliveryState([d(1, "processing")], PUB(1), REV(1)).cancellable), [], "a send in progress is never cancellable");
  assert.match(model.formatSlot(at(4)), /14:00/, "heure de Paris"); assert.equal(model.formatSlot(null), "Créneau inconnu");
});

function service(tables, rpc = {}) {
  const fake = createFakeSupabase(tables, { rpc });
  const mod = load("lib/publications/supervision.ts", { "@/lib/require-admin": { requireAdmin: async () => ({ userId: ADMIN }) }, "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client } });
  return { fake, mod };
}
const occRow = (n, h, extra = {}) => ({ id: OCC(n), client_id: C, project_id: P, platform: "facebook", scheduled_for: at(h), publication_id: null, skipped_at: null, ...extra });
const pubRow = (n, status, occ, extra = {}) => ({ id: PUB(n), client_id: C, project_id: P, platform: "facebook", subject: `Sujet ${n}`, status, current_revision_id: REV(n), occurrence_id: occ, archived_at: null, updated_at: `2026-10-0${n}`, ...extra });
const tables = () => ({
  publication_settings: [{ emergency_stop: true, automation_enabled: false, generation_enabled: false, publishing_enabled: false }],
  clients: [{ id: C, name: "Couverture Martin" }, { id: C2, name: "Sans publications" }],
  publication_client_settings: [{ client_id: C, auto_prepare_enabled: true, generation_enabled: true, prepare_lead_days: 2, media_reuse_allowed: false, media_reuse_after_days: 180 }],
  publication_agent_projects: [{ project_id: P, client_id: C, enabled: true, rights_confirmed: true }],
  publication_accounts: [{ id: A(1), client_id: C, platform: "facebook", display_name: "Page Martin", status: "active", enabled: true, connection_id: CONN(1), credential_reference: "vault:secret" },
    { id: A(2), client_id: C, platform: "instagram", display_name: "Insta Martin", status: "active", enabled: true, connection_id: CONN(1) }],
  client_connections: [{ id: CONN(1), client_id: C, provider: "meta", status: "expired", expires_at: null, credential_reference: "vault:secret" }],
  publications: [pubRow(1, "pending_review", OCC(1)), pubRow(2, "approved", OCC(2)), pubRow(3, "approved", OCC(3)), pubRow(4, "approved", OCC(4)), pubRow(5, "rejected", OCC(5)), pubRow(6, "draft", OCC(6), { archived_at: "2026-10-01" })],
  publication_channel_occurrences: [occRow(1, 30, { publication_id: PUB(1) }), occRow(2, 50, { publication_id: PUB(2) }), occRow(3, -30, { publication_id: PUB(3) }), occRow(4, -60, { publication_id: PUB(4) }), occRow(7, 70), occRow(8, 90)],
  publication_deliveries: [{ id: D(1), publication_id: PUB(2), revision_id: REV(2), status: "scheduled", scheduled_for: at(50), updated_at: "2026-10-11" },
    { id: D(2), publication_id: PUB(3), revision_id: REV(3), status: "failed", scheduled_for: at(-30), updated_at: "2026-10-11" },
    { id: D(3), publication_id: PUB(4), revision_id: REV(4), status: "published", scheduled_for: at(-60), updated_at: "2026-10-11T00:00:00Z" }],
  whatsapp_assets: [], whatsapp_asset_assessments: [], whatsapp_asset_uses: [],
});

test("supervision read: counts, sections, accounts to reconnect, too few photos, tasks; secrets never selected", async () => {
  const { mod, fake } = service(tables());
  const s = await mod.getSupervision(now);
  assert.deepEqual(json(s.counts), { pendingReview: 1, scheduled: 2, published: 1, errors: 1, connected: 0, reconnect: 2 });
  assert.deepEqual(s.scheduled.map(p => p.id), [PUB(1), PUB(2)]);
  assert.deepEqual(json(s.scheduled[1].cancellable), [D(1)]);
  assert.deepEqual(s.scheduled[1].targets.map(t => t.id), [OCC(7), OCC(8)]);
  assert.deepEqual(s.errors.map(p => p.id), [PUB(3)]); assert.deepEqual(s.published.map(p => p.id), [PUB(4)]);
  assert.ok(!s.scheduled.some(p => p.id === PUB(5) || p.id === PUB(6)), "refused and archived never listed as scheduled");
  assert.deepEqual(s.clients.map(c => c.id), [C], "clients without publications activity hidden");
  assert.equal(s.clients[0].tooFewPhotos, true); assert.equal(s.clients[0].accounts[0].reason, "Connexion expirée");
  assert.deepEqual(s.tasks.map(t => t.occurrenceId), [OCC(7), OCC(8)]);
  assert.equal(s.settings.emergencyStop, true);
  assert.doesNotMatch(JSON.stringify(json(s)), /vault:|secret/);
  assert.ok(!fake.calls.some(c => ["insert", "update", "upsert", "delete", "rpc"].includes(c[1]) || c[0] === "rpc"), "read only");
  assert.doesNotMatch(src("lib/publications/supervision.ts"), /credential_reference|access_token|refresh_token/);
});

test("reschedule action: one RPC as the admin, refusals in plain French, invalid input never reaches the database", async () => {
  const { mod, fake } = service({}, { publication_reschedule: () => ({ publication_id: PUB(9), status: "pending_review" }) });
  const r = await mod.reschedulePublication(PUB(1), REV(1), OCC(7));
  assert.deepEqual(json(r), { ok: true, publicationId: PUB(9), message: "Publication reprogrammée : nouvelle validation nécessaire avant diffusion." });
  assert.deepEqual(fake.calls.at(-1), ["rpc", "publication_reschedule", { p_publication_id: PUB(1), p_expected_revision_id: REV(1), p_occurrence_id: OCC(7), p_actor_id: ADMIN }]);
  const before = fake.calls.length;
  assert.equal((await mod.reschedulePublication(PUB(1), REV(1), "x")).ok, false); assert.equal(fake.calls.length, before);
  for (const [message, expected] of [["Resolve deliveries first", /en cours, envoyée ou à vérifier/], ["Occurrence already has a publication", /déjà pris/], ["Publication cannot be rescheduled", /refusée/], ["Occurrence in the past", /passé/]]) {
    const failing = service({}, { publication_reschedule: () => { throw Error(message); } });
    assert.match((await failing.mod.reschedulePublication(PUB(1), REV(1), OCC(7))).message, expected);
  }
});

test("suspend: unsent deliveries cancelled one by one; client automation off with only that setting", async () => {
  const { mod, fake } = service({ publication_deliveries: [{ id: D(1), publication_id: PUB(1), status: "scheduled" }, { id: D(2), publication_id: PUB(1), status: "published" }, { id: D(3), publication_id: PUB(1), status: "blocked" }] },
    { publication_delivery_cancel: () => ({ status: "cancelled" }), publication_client_settings_save: () => C });
  assert.equal((await mod.suspendPublicationDelivery(PUB(1))).ok, true);
  assert.deepEqual(fake.calls.filter(c => c[0] === "rpc").map(c => c[2].p_delivery_id), [D(1), D(3)]);
  assert.equal((await mod.suspendPublicationDelivery(PUB(2))).ok, false, "nothing to suspend");
  assert.equal((await mod.suspendClientAutomation(C)).ok, true);
  assert.deepEqual(fake.calls.at(-1), ["rpc", "publication_client_settings_save", { p_client_id: C, p_settings: { auto_prepare_enabled: false }, p_actor_id: ADMIN }]);
});

test("supervision page: every requested action wired to an existing or audited path, nav entry, design tokens only", () => {
  const page = src("app/(cockpit)/publications/supervision/page.tsx"), forms = src("components/publications/supervision-forms.tsx"), actions = src("app/(cockpit)/publications/supervision-actions.ts");
  assert.match(page, /await requireAdmin\(\)/);
  assert.match(page, /<ReviewQueue cards=\{cards\}/, "Approuver / Refuser / Modifier via the existing review cards");
  assert.match(page, /<AgentV2Form projectId=\{project\}/, "Générer maintenant via the existing Agent v2 form (explicit AI authorization)");
  assert.match(page, /\/publications\/\$\{p\.id\}\/edit/); assert.match(page, /<RescheduleForm/); assert.match(page, /<SuspendDeliveryForm/); assert.match(page, /<SuspendClientForm/);
  for (const label of ["Comptes connectés", "À reconnecter", "À valider", "Programmées", "Publiées", "En erreur", "Trop peu de photos", "Prochaines tâches de l’agent"]) assert.ok(page.includes(label), label);
  assert.doesNotMatch(page + forms, /#[0-9a-fA-F]{3,6}\b|rgb\(/, "design tokens only");
  assert.equal((actions.match(/await requireAdmin\(\)/g) ?? []).length, 3);
  assert.doesNotMatch(actions + page, /processDuePublications|publication_prepare_delivery|runOnePublicationJob/, "no send from the supervision page");
  assert.match(src("components/publications/publications-board.tsx"), /item\('supervision','Supervision','\/publications\/supervision'\)/);
});
