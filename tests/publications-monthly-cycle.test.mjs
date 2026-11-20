import test from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";

// Cycle mensuel (règle de l'utilisateur, 2026-11-20) : préparation le 1er du 16 au 15 suivant, avis le 1er au soir,
// validation par lot avant le premier lundi, images IA validées avec le lot après la date limite.
const cycle = loadTs("lib/publications/monthly-cycle.ts");
const plain = (v) => JSON.parse(JSON.stringify(v));

test("monthly batch: 16th → 15th of next month, deadline = first Monday after the 1st", () => {
  assert.deepEqual(plain(cycle.batchOfMonth("2026-12")), { key: "2026-12", preparedOn: "2026-12-01", from: "2026-12-16", to: "2027-01-15", deadline: "2026-12-07" });
  // 1er février 2027 = lundi : la date limite est le lundi suivant, jamais le jour de la préparation.
  assert.equal(cycle.batchOfMonth("2027-02").deadline, "2027-02-08");
  // 1er novembre 2026 = dimanche : lundi 2.
  assert.equal(cycle.batchOfMonth("2026-11").deadline, "2026-11-02");
  assert.equal(cycle.batchForDate("2026-12-15").key, "2026-11");
  assert.equal(cycle.batchForDate("2026-12-16").key, "2026-12");
  assert.equal(cycle.batchForDate("2027-01-03").key, "2026-12");
});

test("preparation horizon: up to the 15th of next month, the whole month's batch on the 1st, never past 46 days", () => {
  // Le 20/11, tout est préparé jusqu'au 15/12 (attente de l'utilisateur).
  assert.equal(cycle.preparationHorizonDays("2026-11-20"), 25);
  assert.equal(cycle.preparationHorizonDays("2026-11-30"), 15);
  // Le 1er décembre, l'horizon s'allonge jusqu'au 15 janvier : c'est le lot du mois.
  assert.equal(cycle.preparationHorizonDays("2026-12-01"), 45);
  for (const day of ["2026-01-01", "2026-02-28", "2026-03-01", "2026-07-31", "2026-12-31"]) {
    const n = cycle.preparationHorizonDays(day);
    assert.ok(n >= 15 && n <= cycle.MAX_PREPARATION_HORIZON_DAYS, `${day}: ${n}`);
  }
});

test("monthly notice: from the 1st at 20:00 Paris until the deadline, once per month", () => {
  assert.equal(cycle.monthlyNoticeDue("2026-12-01", 19), null);
  assert.equal(cycle.monthlyNoticeDue("2026-12-01", 20).key, "2026-12");
  assert.equal(cycle.monthlyNoticeDue("2026-12-07", 9).key, "2026-12");
  assert.equal(cycle.monthlyNoticeDue("2026-12-08", 9), null);
  assert.equal(cycle.monthlyNoticeDue("2026-11-20", 21), null, "deadline of the November batch is long past");
  assert.equal(cycle.monthlyNoticeKey(cycle.batchOfMonth("2026-12")), "monthly-review:2026-12");
});

test("AI images: auto-validated after the batch deadline, or 2 days before the slot at the latest", () => {
  assert.equal(cycle.imageAutoValidationDue("2026-12-20", "2026-12-07"), false, "December batch, deadline day");
  assert.equal(cycle.imageAutoValidationDue("2026-12-20", "2026-12-08"), true, "after the deadline");
  assert.equal(cycle.imageAutoValidationDue("2026-12-10", "2026-11-20"), true, "November batch, deadline past");
  assert.equal(cycle.imageAutoValidationDue("2026-12-18", "2026-12-03"), false);
  assert.equal(cycle.imageAutoValidationDue("2026-12-05", "2026-12-03"), true, "last call 2 days before");
});

function batchHarness({ now, pending = 0, images = [], pubs = [], actors = {}, existing = [] }) {
  const notes = [...existing], validated = [];
  const query = (table) => {
    const state = { filters: {} };
    const api = {
      select: (_cols, opts) => { state.head = opts?.head; return api; },
      eq: (k, v) => { state.filters[k] = v; return api; }, is: () => api, gte: () => api, lte: () => api, in: () => api, order: () => api,
      limit: async () => table === "publication_generated_images" ? { data: images, error: null } : { data: [], error: null },
      upsert: (row) => ({ select: async () => { if (notes.some((n) => n.event_key === row.event_key)) return { data: [], error: null }; notes.push(row); return { data: [{ id: "x" }], error: null }; } }),
      then: (resolve) => resolve(table === "publications" && state.head ? { count: pending, error: null } : table === "publications" ? { data: pubs, error: null } : { data: [], error: null }),
    };
    return api;
  };
  const mod = loadTs("lib/publications/automation/monthly-batch.ts", {
    "@/lib/supabase/server": { getSupabaseServerClient: () => ({ from: query }) },
    "@/lib/admin-policy": { isAuthorizedAdmin: () => true },
    "../calendar": loadTs("lib/publications/calendar.ts", { "./types": {} }),
    "./scheduled": { delegatedActor: async (client) => actors[client] ?? null },
    "../photo-agent/service": { autoValidateGeneratedImage: async () => "approved" },
    "../monthly-cycle": cycle,
  });
  const run = () => mod.runMonthlyBatch(new Date(now), { isAdmin: () => true, validateImage: async (id, actor) => { validated.push([id, actor]); return "approved"; } });
  return { run, notes, validated };
}

test("monthly batch tick: one notice on the 1st evening when posts await validation, never twice", async () => {
  const early = batchHarness({ now: "2026-12-01T17:00:00Z", pending: 120 }); // 18 h à Paris
  assert.equal((await early.run()).notice, "not_due");
  const h = batchHarness({ now: "2026-12-01T19:30:00Z", pending: 120 }); // 20 h 30 à Paris
  assert.equal((await h.run()).notice, "sent");
  assert.equal((await h.run()).notice, "already");
  assert.deepEqual(plain(h.notes), [{ event_key: "monthly-review:2026-12", category: "publication_review", href: "/publications/review" }]);
  const none = batchHarness({ now: "2026-12-02T08:00:00Z", pending: 0 });
  assert.equal((await none.run()).notice, "nothing_pending");
  assert.equal(none.notes.length, 0);
});

test("monthly batch tick: pending AI images validated with the batch after the deadline, as the delegated admin", async () => {
  const images = [
    { id: "img-late", client_id: "c1", publication_ids: ["p1"] },
    { id: "img-early", client_id: "c1", publication_ids: ["p2"] },
    { id: "img-no-actor", client_id: "c2", publication_ids: ["p3"] }];
  const pubs = [{ id: "p1", target_date: "2026-12-10" }, { id: "p2", target_date: "2026-12-20" }, { id: "p3", target_date: "2026-12-11" }];
  const h = batchHarness({ now: "2026-12-03T10:00:00Z", images, pubs, actors: { c1: "user_admin" } });
  const s = await h.run();
  assert.deepEqual(h.validated, [["img-late", "user_admin"]], "December batch image still waits for Monday 7");
  assert.deepEqual(plain(s.images), { approved: 1, failed: 0, noActor: 1 });
});
