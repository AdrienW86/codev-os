import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTs } from "./helpers/load-ts.mjs";

// Validation automatique (défaut d'accord) : candidates lues en base, approbation au nom de l'administrateur délégué,
// jamais sans photo, jamais sans délégué, jamais quand l'arrêt général est actif.
const C1 = "11111111-1111-4111-8111-111111111111", C2 = "22222222-2222-4222-8222-222222222222";
const P = (n) => `3333333${n}-3333-4333-8333-333333333333`, R = (n) => `4444444${n}-4444-4444-8444-444444444444`;

function harness({ switches = { emergency_stop: false, publishing_enabled: true }, candidates = [], missing = {}, actors = {}, approveError = {} } = {}) {
  const calls = [];
  const db = {
    from: (table) => ({ select: () => ({ limit: () => ({ maybeSingle: async () => (table === "publication_settings" ? { data: switches, error: null } : { data: null, error: null }) }) }) }),
    rpc: async (name, args) => { calls.push([name, args]);
      if (name === "publication_auto_approval_candidates") return { data: candidates, error: null };
      if (name === "publication_auto_approve") return { data: null, error: approveError[args.p_publication_id] ?? null };
      return { data: null, error: { code: "42883" } }; },
  };
  const mod = loadTs("lib/publications/automation/auto-approval.ts", {
    "@/lib/supabase/server": { getSupabaseServerClient: () => db },
    "@/lib/admin-policy": { isAuthorizedAdmin: () => true },
    "../media-rule": { revisionChannelsWithoutMedia: async (_db, revision) => (revision in missing ? missing[revision] : []) },
    "./scheduled": { delegatedActor: async (client) => actors[client] ?? null },
  });
  return { mod, calls };
}

test("auto approval: eligible candidates are approved on behalf of the delegated admin", async () => {
  const h = harness({ candidates: [{ publication_id: P(1), revision_id: R(1), client_id: C1 }, { publication_id: P(2), revision_id: R(2), client_id: C1 }], actors: { [C1]: "user_admin" } });
  const now = new Date("2026-10-28T08:00:00Z");
  const s = await h.mod.runAutoApproval(now, { isAdmin: () => true });
  assert.deepEqual({ ...s }, { approved: 2, blocked: 0, noActor: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [
    ["publication_auto_approval_candidates", { p_now: now.toISOString(), p_limit: 20 }],
    ["publication_auto_approve", { p_publication_id: P(1), p_revision_id: R(1), p_actor_id: "user_admin" }],
    ["publication_auto_approve", { p_publication_id: P(2), p_revision_id: R(2), p_actor_id: "user_admin" }],
  ]);
});

test("auto approval: no photo, no delegated admin or a database refusal never approve", async () => {
  const h = harness({
    candidates: [{ publication_id: P(1), revision_id: R(1), client_id: C1 }, { publication_id: P(2), revision_id: R(2), client_id: C2 }, { publication_id: P(3), revision_id: R(3), client_id: C1 }, { publication_id: P(4), revision_id: R(4), client_id: C1 }],
    actors: { [C1]: "user_admin" }, missing: { [R(1)]: ["instagram"], [R(3)]: null }, approveError: { [P(4)]: { code: "55000" } },
  });
  const s = await h.mod.runAutoApproval(new Date(), { isAdmin: () => true });
  assert.deepEqual({ ...s }, { approved: 0, blocked: 3, noActor: 1 });
  assert.deepEqual(h.calls.filter(([n]) => n === "publication_auto_approve").map(([, a]) => a.p_publication_id), [P(4)]);
});

test("auto approval: emergency stop or publishing disabled → nothing is read nor approved", async () => {
  for (const switches of [{ emergency_stop: true, publishing_enabled: true }, { emergency_stop: false, publishing_enabled: false }, null]) {
    const h = harness({ switches, candidates: [{ publication_id: P(1), revision_id: R(1), client_id: C1 }], actors: { [C1]: "user_admin" } });
    const s = await h.mod.runAutoApproval(new Date(), { isAdmin: () => true });
    assert.equal(s.disabled, "global");assert.equal(h.calls.length, 0);
  }
});

test("auto approval SQL: opt-in per client, agent revisions only, never TikTok, within the window, re-checked under lock", () => {
  const sql = readFileSync("supabase/migrations/20261117000000_publications_auto_approval.sql", "utf8");
  assert.match(sql, /auto_approve_enabled boolean not null default false/);
  assert.match(sql, /p\.platform<>'tiktok'/);
  assert.match(sql, /r\.origin='generated'/);
  assert.match(sql, /o\.scheduled_for>p_now and o\.scheduled_for<=p_now\+make_interval\(hours=>s\.auto_approve_hours_before\)/);
  assert.match(sql, /for update;[\s\S]*auto_approval_eligible\(p_publication_id,now\(\)\)[\s\S]*publication_review_manual/);
  assert.doesNotMatch(sql, /grant execute[^;]*to (anon|authenticated)/);
});
