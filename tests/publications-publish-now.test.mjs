import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTs } from "./helpers/load-ts.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";

// « Rédiger et publier maintenant » (fiche client) : créneaux manuels immédiats, rédaction par l'agent limitée à ces
// créneaux, validation par l'administrateur, créneaux ignorés si rien n'est rédigé.
const json = value => JSON.parse(JSON.stringify(value));
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CLIENT = uuid(1), PROJECT = uuid(2), CH_FB = uuid(3), CH_IG = uuid(4), CH_GBP = uuid(5), CH_TT = uuid(6);
const model = loadTs("lib/publications/publish-now-model.ts");
const validation = loadTs("lib/publications/validation.ts", { "./types": loadTs("lib/publications/types.ts") });
const now = new Date("2026-11-16T11:40:20Z");

test("model: instant = now + 6 min rounded up to the minute; local parts in the channel zone; supported networks only", () => {
  assert.equal(model.publishNowInstant(now).toISOString(), "2026-11-16T11:47:00.000Z");
  assert.equal(model.publishNowInstant(new Date("2026-11-16T11:40:00Z")).toISOString(), "2026-11-16T11:46:00.000Z");
  assert.deepEqual(json(model.localParts(new Date("2026-11-16T11:47:00Z"), "Europe/Paris")), { date: "2026-11-16", time: "12:47:00" });
  assert.deepEqual(json(model.localParts(new Date("2026-07-01T22:30:00Z"), "Europe/Paris")), { date: "2026-07-02", time: "00:30:00" });
  assert.equal(model.localParts(now, "Nowhere/City"), null);
  assert.deepEqual(json(model.publishNowPlatforms(["tiktok", "google_business_profile", "facebook", "snapchat"])), ["facebook", "google_business_profile"]);
  assert.match(model.publishNowMessage(3, 3, new Date("2026-11-16T11:47:00Z"), "Europe/Paris", false), /3 publications rédigées et validées : envoi prévu à 12:47/);
  assert.match(model.publishNowMessage(0, 3, new Date("2026-11-16T11:47:00Z"), "Europe/Paris", true), /aucune photo adaptée/);
});

const tables = () => ({
  projects: [{ id: PROJECT, client_id: CLIENT, type: "publications" }],
  publication_project_channels: [
    { id: CH_FB, project_id: PROJECT, client_id: CLIENT, platform: "facebook", enabled: true },
    { id: CH_IG, project_id: PROJECT, client_id: CLIENT, platform: "instagram", enabled: true },
    { id: CH_GBP, project_id: PROJECT, client_id: CLIENT, platform: "google_business_profile", enabled: false },
    { id: CH_TT, project_id: PROJECT, client_id: CLIENT, platform: "tiktok", enabled: true },
  ],
  publication_channel_schedules: [{ project_channel_id: CH_FB, timezone: "Europe/Paris" }],
  publication_client_settings: [{ client_id: CLIENT, timezone: "Europe/Paris" }],
  publication_channel_occurrences: [], publications: [],
});
function setup(prepareScript, options = {}) {
  const fake = createFakeSupabase(tables(), { rpc: { publication_occurrence_skip: (args, t) => { const o = t.publication_channel_occurrences.find(x => x.id === args.p_occurrence_id); o.skipped_at = "now"; o.skipped_reason = args.p_reason; return o.id; } }, ...options });
  const prepared = [], approvals = [];
  const mod = loadTs("lib/publications/publish-now.ts", {
    "@/lib/require-admin": { requireAdmin: async () => ({ userId: "user_admin" }) },
    "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client },
    "./validation": validation,
    "./project-channels": { loadPublicationProjectChannels: async () => ({}) },
    "./agent-v2/service": { prepareNextPublicationsAs: async () => { throw new Error("production"); } },
    "./manual-scheduling": { approveForDelivery: async () => "failed" },
    "./publish-now-model": model,
  });
  const deps = { db: () => fake.client, now: () => now, platforms: async () => ["facebook", "instagram", "google_business_profile", "tiktok"],
    prepare: async (userId, projectId, opts) => { prepared.push(json(opts)); return prepareScript(prepared.length, opts, fake); },
    approve: async (_db, userId, p) => { approvals.push([userId, p]); return "approved"; } };
  return { mod, fake, deps, prepared, approvals };
}
const link = (fake, opts) => opts.onlyOccurrenceIds.map((id, i) => {
  const occ = fake.tables.publication_channel_occurrences.find(o => o.id === id);
  const pub = { id: uuid(100 + i), platform: occ.platform, current_revision_id: uuid(200 + i) };
  fake.tables.publications.push(pub); occ.publication_id = pub.id;
  return { id: pub.id, platform: occ.platform, label: occ.platform };
});

test("one manual occurrence per active supported network, agent limited to them, every publication approved by the admin", async () => {
  const { mod, fake, deps, prepared, approvals } = setup((n, opts, f) => ({ ok: true, message: "ok", withMedia: true, publications: link(f, opts) }));
  const r = await mod.draftAndPublishNow(PROJECT, deps);
  assert.equal(r.ok, true, r.message);
  const occ = fake.tables.publication_channel_occurrences;
  assert.deepEqual(occ.map(o => o.platform), ["facebook", "instagram"], "Google disabled and TikTok unsupported are left out");
  for (const o of occ) assert.deepEqual([o.origin, o.local_date, o.local_time, o.timezone, o.scheduled_for], ["manual", "2026-11-16", "12:47:00", "Europe/Paris", "2026-11-16T11:47:00.000Z"]);
  assert.deepEqual(prepared[0].onlyOccurrenceIds, occ.map(o => o.id));
  assert.equal(prepared[0].allowRealAI, true);
  assert.deepEqual(approvals.map(([u, p]) => [u, p.platform, p.revision_id]), [["user_admin", "facebook", uuid(200)], ["user_admin", "instagram", uuid(201)]]);
  assert.match(r.message, /2 publications rédigées et validées : envoi prévu à 12:47/);
  assert.equal(r.scheduledFor, "2026-11-16T11:47:00.000Z");
});

test("refused content is regenerated with the accumulated reasons, then the empty slots are skipped and nothing is published", async () => {
  const { mod, fake, deps, prepared, approvals } = setup(n => ({ ok: false, refused: true, refusalDetail: `motif ${n}`, message: "Contenu refusé.", withMedia: false, publications: [] }));
  const r = await mod.draftAndPublishNow(PROJECT, deps);
  assert.equal(r.ok, false);
  assert.equal(prepared.length, 3, "first attempt + 2 regenerations");
  assert.equal(prepared[2].retryFeedback, "motif 1 ; motif 2");
  assert.match(r.message, /Rien n’a été publié/);
  assert.equal(approvals.length, 0);
  assert.ok(fake.tables.publication_channel_occurrences.every(o => o.skipped_at && o.skipped_reason === model.PUBLISH_NOW_SKIP_REASON), "no empty slot left in the calendar");
});

test("drafts without a photo are never approved; an occurrence insert failure creates nothing and releases what was created", async () => {
  const noPhoto = setup((n, opts, f) => ({ ok: true, message: "ok", withMedia: false, publications: link(f, opts) }));
  const r = await noPhoto.mod.draftAndPublishNow(PROJECT, noPhoto.deps);
  assert.equal(r.ok, true);
  assert.equal(noPhoto.approvals.length, 0);
  assert.match(r.message, /aucune photo adaptée/);
  let inserts = 0;
  const broken = setup(() => { throw new Error("must not run"); }, { failOn: (table, op) => table === "publication_channel_occurrences" && op === "insert" && ++inserts === 2 ? { message: "boom" } : null });
  const b = await broken.mod.draftAndPublishNow(PROJECT, broken.deps);
  assert.equal(b.ok, false);
  assert.equal(broken.prepared.length, 0, "no AI call");
  assert.equal(broken.fake.tables.publication_channel_occurrences.length, 1);
  assert.ok(broken.fake.tables.publication_channel_occurrences[0].skipped_at, "the first occurrence is released");
  assert.equal((await broken.mod.draftAndPublishNow("x", broken.deps)).message, "Projet invalide.");
});

test("wiring: the client page offers the button, the action requires an explicit confirmation, the agent filters on the given occurrences", () => {
  const page = readFileSync(new URL("../app/(cockpit)/clients/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<ClientPublishNowForm clientId=\{clientId\} projectId=\{data\.project\.id\} \/>/);
  const action = readFileSync(new URL("../app/(cockpit)/clients/[id]/publications-actions.ts", import.meta.url), "utf8");
  assert.match(action, /form\.get\("confirm"\)!=="on"/);
  assert.match(action, /getActiveScenario\(\)\)return \{ok:false,message:"Indisponible en simulation\."\}/);
  const service = readFileSync(new URL("../lib/publications/agent-v2/service.ts", import.meta.url), "utf8");
  assert.match(service, /\(!only\|\|only\.has\(o\.occurrenceId\)\)/);
});
