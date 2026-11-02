import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTs } from "./helpers/load-ts.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";

// Publication manuelle à tout moment (hors créneaux) : formulaire, refus lisibles, validation d'office sauf TikTok.
const json = value => JSON.parse(JSON.stringify(value));
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PUB = uuid(1), REV = uuid(2), CLIENT = uuid(3), PROJECT = uuid(4);
const NOW = new Date("2026-11-02T20:00:00Z");
const validation = loadTs("lib/publications/validation.ts", { "./types": loadTs("lib/publications/types.ts") });
const editor = { platformLabels: { facebook: "Facebook", instagram: "Instagram", google_business_profile: "Google Business Profile", tiktok: "TikTok", snapchat: "Snapchat" } };
const model = loadTs("lib/publications/manual-scheduling-model.ts", { "./validation": validation, "./editor": editor });
const form = entries => { const f = new FormData(); for (const [k, v] of Object.entries(entries)) f.append(k, v); return f; };

test("form: « maintenant » or a valid future instant within 12 weeks; forged or duplicated fields refused", () => {
  const base = { publication_id: PUB, revision_id: REV };
  assert.deepEqual(json(model.parseManualScheduleForm(form({ ...base, when: "now" }), NOW)), { publicationId: PUB, revisionId: REV, at: NOW.toISOString(), now: true });
  assert.deepEqual(json(model.parseManualScheduleForm(form({ ...base, when: "at", at: "2026-11-10T13:37:00.000Z" }), NOW)), { publicationId: PUB, revisionId: REV, at: "2026-11-10T13:37:00.000Z", now: false });
  assert.equal(model.parseManualScheduleForm(form({ ...base, when: "at", at: "2026-11-10T14:37:00+01:00" }), NOW).at, "2026-11-10T13:37:00.000Z");
  // Quelques minutes de retard tolérées (formulaire ouvert depuis un moment) : la base reporte à la minute suivante.
  assert.ok(model.parseManualScheduleForm(form({ ...base, when: "at", at: "2026-11-02T19:57:00Z" }), NOW));
  for (const bad of [{ ...base, when: "at", at: "2026-11-02T19:00:00Z" }, { ...base, when: "at", at: "2027-03-01T10:00:00Z" }, { ...base, when: "at", at: "demain" },
    { ...base, when: "at", at: "2026-11-10T13:37" }, { ...base, when: "at" }, { ...base, when: "later" }, { ...base }, { ...base, when: "now", publication_id: "x" }, { ...base, when: "now", revision_id: "" }])
    assert.equal(model.parseManualScheduleForm(form(bad), NOW), null, JSON.stringify(bad));
  const dup = form({ ...base, when: "now" }); dup.append("when", "at");
  assert.equal(model.parseManualScheduleForm(dup, NOW), null);
});
test("database refusals become distinct French messages", () => {
  const cases = [["40001", "Stale draft"], ["22023", "Manual date in the past"], ["22023", "Manual date too far"], ["22023", "Ambiguous local time"], ["23514", "Channel not enabled: tiktok"], ["55000", "Publication already scheduled"], ["22023", "Invalid manual schedule"], [undefined, "network"]];
  const messages = cases.map(([code, message]) => model.manualScheduleErrorMessage(code, message));
  assert.equal(new Set(messages).size, messages.length);
  assert.match(model.manualScheduleErrorMessage("23514", "Channel not enabled: tiktok"), /pas activé/);
  assert.match(model.manualScheduleErrorMessage(undefined, "x"), /n’a pas été modifié/);
});
test("labels: departure time in Paris and one line per network", () => {
  assert.equal(model.manualScheduledLabel("2026-11-10T13:37:00Z"), "mardi 10 novembre à 14:37");
  assert.match(model.manualApprovalLabel("facebook", "approved"), /^Facebook : validée/);
  assert.match(model.manualApprovalLabel("tiktok", "tiktok"), /réglages TikTok/);
  assert.match(model.manualApprovalLabel("instagram", "media"), /ajoutez un média/);
});

function service({ rpc = {}, missing = () => [] } = {}) {
  const calls = [];
  const fake = createFakeSupabase({ publications: [{ id: PUB, client_id: CLIENT, project_id: PROJECT, current_revision_id: REV }] }, { rpc: {
    publication_schedule_manual: args => { calls.push(["schedule", args]); return rpc.schedule ? rpc.schedule(args) : { mode: "split", archived_source_id: PUB, scheduled_for: "2026-11-02T20:01:00+00:00",
      publications: [{ publication_id: uuid(20), platform: "facebook", revision_id: uuid(30) }, { publication_id: uuid(21), platform: "tiktok", revision_id: uuid(31) }, { publication_id: uuid(22), platform: "instagram", revision_id: uuid(32) }] }; },
    publication_submit_manual: args => { calls.push(["submit", args.p_publication_id]); return null; },
    publication_review_manual: args => { calls.push(["review", args.p_publication_id, args.p_decision]); return null; },
  } });
  const m = loadTs("lib/publications/manual-scheduling.ts", {
    "@/lib/require-admin": { requireAdmin: async () => ({ userId: "user_admin" }) },
    "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client },
    "./media-rule": { revisionChannelsWithoutMedia: async (_db, revision) => missing(revision) },
    "./manual-scheduling-model": model,
  });
  return { m, calls };
}
test("schedule now: one RPC, then every network approved by the admin except TikTok", async () => {
  const s = service();
  const r = await s.m.scheduleManually(form({ publication_id: PUB, revision_id: REV, when: "now" }), NOW);
  assert.equal(r.ok, true); assert.equal(r.now, true); assert.equal(r.sourceArchived, true);
  assert.deepEqual(json(r.publications.map(p => [p.platform, p.approval])), [["facebook", "approved"], ["tiktok", "tiktok"], ["instagram", "approved"]]);
  assert.deepEqual(json(s.calls[0]), ["schedule", { p_publication_id: PUB, p_expected_revision_id: REV, p_at: NOW.toISOString(), p_actor_id: "user_admin" }]);
  assert.deepEqual(json(s.calls.slice(1)), [["submit", uuid(20)], ["review", uuid(20), "approved"], ["submit", uuid(22)], ["review", uuid(22), "approved"]]);
  assert.match(r.message, /restent à valider/);
});
test("a network without media is scheduled but left to validate; nothing approved behind the media rule", async () => {
  const s = service({ missing: revision => revision === uuid(30) ? ["facebook"] : [] });
  const r = await s.m.scheduleManually(form({ publication_id: PUB, revision_id: REV, when: "now" }), NOW);
  assert.equal(r.publications[0].approval, "media");
  assert.ok(!s.calls.some(c => c[1] === uuid(20)));
});
test("stale or invalid input never reaches the database; a refusal is reported", async () => {
  const stale = service();
  assert.match((await stale.m.scheduleManually(form({ publication_id: PUB, revision_id: uuid(99), when: "now" }), NOW)).message, /Rechargez/);
  assert.match((await stale.m.scheduleManually(form({ publication_id: PUB, revision_id: REV, when: "at", at: "2026-01-01T10:00:00Z" }), NOW)).message, /12 semaines/);
  assert.equal(stale.calls.length, 0);
  const refused = service({ rpc: { schedule: () => { throw Object.assign(Error("Channel not enabled: snapchat"), { code: "23514" }); } } });
  const r = await refused.m.scheduleManually(form({ publication_id: PUB, revision_id: REV, when: "now" }), NOW);
  assert.equal(r.ok, false); assert.equal(refused.calls.length, 1);
});
test("migration: manual occurrences without slot, released as skipped, 5 networks, single transactional RPC", () => {
  const sql = readFileSync("supabase/migrations/20261122000000_publications_manual_schedule.sql", "utf8");
  assert.match(sql, /add column origin text not null default 'schedule'/);
  assert.match(sql, /origin='manual' and schedule_id is null and schedule_slot_id is null/);
  assert.match(sql, /Manual occurrence in the past/);
  assert.match(sql, /skipped_reason='Publication manuelle retirée'/);
  assert.match(sql, /not between 1 and 5 then raise exception 'Invalid variants'/);
  assert.match(sql, /jsonb_array_length\(p_assignments\) not between 1 and 5/);
  assert.match(sql, /in_place:=cardinality\(platforms\)=1 and all_platforms=platforms and pub\.editorial_week is not distinct from/);
  assert.match(sql, /create function public\.publication_schedule_manual[\s\S]*publication_schedule_draft\(pub\.id/);
  assert.match(sql, /grant execute on function public\.publication_schedule_manual\(uuid,uuid,timestamptz,text\) to service_role/);
  assert.doesNotMatch(sql, /drop table|delete from|truncate/i);
  const source = readFileSync("lib/publications/manual-scheduling.ts", "utf8");
  assert.doesNotMatch(source, /\.(insert|update|upsert|delete)\(/);
  assert.match(source, /if\(p\.platform==='tiktok'\)return 'tiktok'/);
});
