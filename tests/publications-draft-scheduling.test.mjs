import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTs } from "./helpers/load-ts.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";
const require = createRequire(import.meta.url);
const json = value => JSON.parse(JSON.stringify(value));
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PUB = uuid(1), REV = uuid(2), CLIENT = uuid(3), PROJECT = uuid(4), OCC_FB = uuid(5), OCC_IG = uuid(6), OCC_FB2 = uuid(7);
const validation = loadTs("lib/publications/validation.ts", { "./types": loadTs("lib/publications/types.ts") });
const editor = { platformLabels: { facebook: "Facebook", instagram: "Instagram", google_business_profile: "Google Business Profile" } };
const model = loadTs("lib/publications/draft-scheduling-model.ts", { "./validation": validation, "./editor": editor });
const form = entries => { const f = new FormData(); for (const [k, v] of Object.entries(entries)) f.append(k, v); return f; };
const occ = (id, platform, date, time, at) => ({ occurrenceId: id, projectId: PROJECT, clientId: CLIENT, platform, date, time, timezone: "Europe/Paris", scheduledFor: at });

test("only an unscheduled, unarchived project draft can be scheduled", () => {
  const base = { slot: null, occurrence_id: null, editorial_group_id: null, archived_at: null, project_id: PROJECT };
  assert.equal(model.isUnscheduledDraft(base), true);
  for (const change of [{ slot: 1 }, { occurrence_id: OCC_FB }, { editorial_group_id: uuid(9) }, { archived_at: "2026-10-12T09:00:00Z" }, { project_id: null }]) assert.equal(model.isUnscheduledDraft({ ...base, ...change }), false, JSON.stringify(change));
});
test("choices: one chronological list per draft platform, labelled in French", () => {
  const choices = json(model.scheduleChoices(["instagram", "facebook", "facebook"], [occ(OCC_FB2, "facebook", "2026-10-15", "12:00", "2026-10-15T10:00:00Z"), occ(OCC_FB, "facebook", "2026-10-13", "12:00", "2026-10-13T10:00:00Z"), occ(OCC_IG, "instagram", "2026-10-14", "18:00", "2026-10-14T16:00:00Z"), occ(uuid(8), "google_business_profile", "2026-10-13", "09:00", "2026-10-13T07:00:00Z")]));
  assert.deepEqual(choices.map(c => c.platform), ["facebook", "instagram"]);
  assert.deepEqual(choices[0].options.map(o => o.id), [OCC_FB, OCC_FB2]);
  assert.equal(choices[0].options[0].label, "mardi 13 octobre à 12:00");
  assert.equal(choices[1].label, "Instagram");
});
test("form: exactly one distinct occurrence per expected platform; duplicates and forged fields refused", () => {
  const ok = { publication_id: PUB, revision_id: REV, occurrence_facebook: OCC_FB, occurrence_instagram: OCC_IG };
  assert.deepEqual(json(model.parseScheduleForm(form(ok), ["instagram", "facebook"])), { publicationId: PUB, revisionId: REV, assignments: [{ platform: "facebook", occurrence_id: OCC_FB }, { platform: "instagram", occurrence_id: OCC_IG }] });
  // A field for a platform absent from the draft is ignored: platforms come from the server, never from the form.
  assert.deepEqual(json(model.parseScheduleForm(form({ ...ok, occurrence_google_business_profile: uuid(8) }), ["facebook"])).assignments, [{ platform: "facebook", occurrence_id: OCC_FB }]);
  for (const bad of [{ ...ok, occurrence_instagram: "" }, { ...ok, occurrence_instagram: OCC_FB }, { ...ok, publication_id: "x" }, { ...ok, revision_id: "" }]) assert.equal(model.parseScheduleForm(form(bad), ["facebook", "instagram"]), null, JSON.stringify(bad));
  const dup = form(ok); dup.append("occurrence_facebook", OCC_FB2);
  assert.equal(model.parseScheduleForm(dup, ["facebook", "instagram"]), null);
  assert.equal(model.parseScheduleForm(form(ok), []), null);
});
test("database refusals become distinct, actionable messages that say the draft is unchanged when relevant", () => {
  const cases = [["40001", "Stale draft"], ["23505", "Occurrence already has a publication"], ["23514", "Occurrence in the past"], ["23514", "Occurrence skipped"], ["23514", "Every draft platform needs one occurrence"], ["23514", "Invalid occurrence"], ["55000", "Publication already scheduled"], ["22023", "Invalid schedule"], [undefined, "network"]];
  const messages = cases.map(([code, message]) => model.scheduleErrorMessage(code, message));
  assert.equal(new Set(messages).size, messages.length);
  assert.match(model.scheduleErrorMessage(undefined, "x"), /n’a pas été modifié/);
});

function service({ publication = { id: PUB, client_id: CLIENT, project_id: PROJECT, slot: null, occurrence_id: null, editorial_group_id: null, archived_at: null, current_revision_id: REV }, variants = [{ revision_id: REV, platform: "facebook" }], rpc, admin = true, occurrences } = {}) {
  const calls = [];
  const fake = createFakeSupabase({ publications: [publication], publication_variants: variants }, { rpc: { publication_schedule_draft: args => { calls.push(args); if (rpc) return rpc(args); return { mode: "in_place", publications: [{ publication_id: PUB, platform: "facebook", occurrence_id: OCC_FB, revision_id: uuid(10) }], archived_source_id: null }; } } });
  const m = loadTs("lib/publications/draft-scheduling.ts", {
    "@/lib/require-admin": { requireAdmin: async () => { if (!admin) throw Error("denied"); return { userId: "user_admin" }; } },
    "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client },
    "./validation": validation,
    "./agent-v2/open-occurrences": { getOpenOccurrencesForAgent: async (project, horizon) => { assert.equal(project, PROJECT); assert.equal(horizon, 84); return occurrences ?? [occ(OCC_FB, "facebook", "2026-10-13", "12:00", "2026-10-13T10:00:00Z"), { ...occ(uuid(11), "facebook", "2026-10-14", "12:00", "2026-10-14T10:00:00Z"), clientId: uuid(12) }]; } },
    "./draft-scheduling-model": model,
  });
  return { m, calls, fake };
}
test("options: open occurrences of the draft's own client and platforms; nothing for a scheduled publication", async () => {
  const s = service();
  const options = json(await s.m.getDraftSchedulingOptions(PUB));
  assert.equal(options.revisionId, REV);
  assert.deepEqual(options.choices.map(c => [c.platform, c.options.map(o => o.id)]), [["facebook", [OCC_FB]]]);
  assert.equal(await service({ publication: { id: PUB, client_id: CLIENT, project_id: PROJECT, slot: 1, occurrence_id: null, editorial_group_id: null, archived_at: null, current_revision_id: REV } }).m.getDraftSchedulingOptions(PUB), null);
  assert.equal(await service().m.getDraftSchedulingOptions("nope"), null);
  await assert.rejects(() => service({ admin: false }).m.getDraftSchedulingOptions(PUB), /denied/);
});
test("schedule: one RPC with server-read platforms; stale or forged input never reaches the database", async () => {
  const s = service();
  const ok = await s.m.scheduleDraft(form({ publication_id: PUB, revision_id: REV, occurrence_facebook: OCC_FB }));
  assert.equal(ok.ok, true); assert.equal(ok.mode, "in_place"); assert.match(ok.message, /soumettez-le à validation/);
  assert.deepEqual(json(s.calls), [{ p_publication_id: PUB, p_expected_revision_id: REV, p_assignments: [{ platform: "facebook", occurrence_id: OCC_FB }], p_actor_id: "user_admin" }]);
  const stale = service();
  assert.match((await stale.m.scheduleDraft(form({ publication_id: PUB, revision_id: uuid(99), occurrence_facebook: OCC_FB }))).message, /Rechargez/);
  const missing = service({ variants: [{ revision_id: REV, platform: "facebook" }, { revision_id: REV, platform: "instagram" }] });
  assert.match((await missing.m.scheduleDraft(form({ publication_id: PUB, revision_id: REV, occurrence_facebook: OCC_FB }))).message, /Sélection invalide/);
  assert.equal(stale.calls.length + missing.calls.length, 0);
  const split = service({ variants: [{ revision_id: REV, platform: "facebook" }, { revision_id: REV, platform: "instagram" }], rpc: () => ({ mode: "split", publications: [{ publication_id: uuid(20), platform: "facebook", occurrence_id: OCC_FB }, { publication_id: uuid(21), platform: "instagram", occurrence_id: OCC_IG }], archived_source_id: PUB }) });
  const r = await split.m.scheduleDraft(form({ publication_id: PUB, revision_id: REV, occurrence_facebook: OCC_FB, occurrence_instagram: OCC_IG }));
  assert.equal(r.mode, "split"); assert.equal(r.sourceArchived, true); assert.equal(r.publications.length, 2); assert.match(r.message, /archivé et reste consultable/);
  await assert.rejects(() => service({ admin: false }).m.scheduleDraft(form({ publication_id: PUB })), /denied/);
});
test("schedule: a database refusal is reported and leaves nothing half-done on the server side", async () => {
  const fake = createFakeSupabase({ publications: [{ id: PUB, client_id: CLIENT, project_id: PROJECT, current_revision_id: REV }], publication_variants: [{ revision_id: REV, platform: "facebook" }] });
  const client = { ...fake.client, rpc: async () => ({ data: null, error: { code: "23505", message: "Occurrence already has a publication" } }) };
  const m = loadTs("lib/publications/draft-scheduling.ts", { "@/lib/require-admin": { requireAdmin: async () => ({ userId: "user_admin" }) }, "@/lib/supabase/server": { getSupabaseServerClient: () => client }, "./validation": validation, "./agent-v2/open-occurrences": {}, "./draft-scheduling-model": model });
  const r = await m.scheduleDraft(form({ publication_id: PUB, revision_id: REV, occurrence_facebook: OCC_FB }));
  assert.equal(r.ok, false); assert.match(r.message, /vient d’être pris/);
});

test("photo library usage follows each publication created by a split", async () => {
  const fake = createFakeSupabase({ whatsapp_asset_uses: [{ id: uuid(30), asset_id: uuid(31), client_id: CLIENT, publication_id: PUB, platform: "facebook", publication_asset_id: uuid(32), used_by: "user_admin" }, { id: uuid(33), asset_id: uuid(31), client_id: CLIENT, publication_id: PUB, platform: "instagram", publication_asset_id: uuid(34), used_by: "user_admin" }] });
  const library = loadTs("lib/whatsapp/library.ts", { "node:crypto": require("node:crypto"), "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client }, "@/lib/core/audit": {}, "@/lib/ai/providers": {}, "@/lib/publications/project-channels": {}, "@/lib/publications/channels": {}, "@/lib/publications/editor": {}, "@/lib/publications/media/transform": {}, "@/lib/publications/workspace": {}, "@/lib/integrations/publications-drive": {}, "@/lib/media-intelligence/model": {}, "./library-model": {}, "./originals": {}, "./providers": {}, "./service": {} });
  assert.equal(await library.recordScheduledSplit("user_admin", CLIENT, PUB, [{ publicationId: uuid(40), platform: "facebook" }, { publicationId: uuid(41), platform: "instagram" }]), 2);
  const added = fake.tables.whatsapp_asset_uses.filter(u => u.publication_id !== PUB);
  assert.deepEqual(added.map(u => [u.publication_id, u.platform, u.publication_asset_id]), [[uuid(40), "facebook", uuid(32)], [uuid(41), "instagram", uuid(34)]]);
});

test("form: one select per platform, approval warning, submission disabled when a platform has no open slot", () => {
  const { ScheduleDraftForm } = loadTs("components/publications/schedule-draft-form.tsx", { "next/link": { __esModule: true, default: ({ href, children }) => require("react").createElement("a", { href }, children) }, "@/app/(cockpit)/publications/[id]/schedule-actions": { scheduleDraftAction: async () => ({}) } });
  const html = renderToStaticMarkup(require("react").createElement(ScheduleDraftForm, { publicationId: PUB, revisionId: REV, choices: [{ platform: "facebook", label: "Facebook", options: [{ id: OCC_FB, label: "mardi 13 octobre à 12:00" }] }, { platform: "instagram", label: "Instagram", options: [] }] }));
  assert.match(html, /name="occurrence_facebook"/); assert.match(html, /name="occurrence_instagram"/);
  assert.match(html, /doit être soumise à validation, même si ce brouillon était déjà approuvé/);
  assert.match(html, /archivé et restera consultable/);
  assert.match(html, /Préparez d’abord des créneaux pour Instagram/);
  assert.match(html, /<button disabled=""/);
});
test("the scheduling code goes through the single RPC and never writes publications directly", () => {
  const source = readFileSync("lib/publications/draft-scheduling.ts", "utf8");
  assert.doesNotMatch(source, /\.(insert|update|upsert|delete)\(/);
  assert.match(source, /rpc\('publication_schedule_draft'/);
});
