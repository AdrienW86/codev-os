import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";

const domain = loadTs("lib/reports/professional.ts");
const input = { clientId: "11111111-1111-4111-8111-111111111111", requestId: "33333333-3333-4333-8333-333333333333", family: "activity", sources: ["activity"], start: "2026-09-01", end: "2026-09-15" };
const admin = { kind: "admin", userId: "isolated-admin" };
function setup({ ready = true, denied = false } = {}) {
  let collected = 0, audited = 0;
  const store = createFakeSupabase({ reports: [] }, { unique: { reports: [["id"]] }, rpc: { codev_professional_reporting_ready: () => ready } });
  const service = loadTs("lib/reports/professional-service.ts", {
    "@/lib/supabase/server": { getSupabaseServerClient: () => store.client },
    "@/lib/require-admin": { requireAdmin: async () => { if (denied) throw Error("denied"); } },
    "@/lib/core/audit": { writeAudit: async () => { audited++; } },
    "./professional": domain,
    "./professional-sources": { gatherProfessionalSources: async () => { collected++; await Promise.resolve(); return { clientName: "Client test", sources: [{ source: "activity", state: "available", lines: ["Une action effectivement réalisée."], evidence: ["Période vérifiée."] }] }; } },
    "./version-storage": { requireReportVersionStorage: async () => {} },
  });
  return { service, store, get collected() { return collected; }, get audited() { return audited; } };
}

test("professional report creation authenticates and checks migration before collecting providers", async () => {
  const unavailable = setup({ ready: false });
  const result = await unavailable.service.generateProfessionalReport(admin, input);
  assert.equal(result.ok, false); assert.match(result.message, /migration/);
  assert.equal(unavailable.collected, 0); assert.equal(unavailable.store.tables.reports.length, 0);
  const denied = setup({ denied: true });
  await assert.rejects(() => denied.service.generateProfessionalReport(admin, input), /denied/);
  assert.equal(denied.store.calls.length, 0);
});

test("invalid report scope never reaches data sources or writes", async () => {
  for (const invalid of [{ ...input, end: "2026-02-30" }, { ...input, start: input.end, end: input.start }, { ...input, sources: ["activity", "activity"] }, { ...input, family: "ads" }, { ...input, hiddenRecipient: "external@example.test" }]) {
    const x = setup();
    assert.equal((await x.service.generateProfessionalReport(admin, invalid)).ok, false);
    assert.equal(x.collected, 0); assert.equal(x.store.calls.length, 0);
  }
});

test("request replay returns the same version without collecting or invalidating approval", async () => {
  const x = setup();
  const first = await x.service.generateProfessionalReport(admin, input);
  assert.equal(first.ok, true); assert.equal(first.id, input.requestId);
  const row = x.store.tables.reports[0];
  row.status = "approved"; row.approved_version = 1;
  const replay = await x.service.generateProfessionalReport(admin, input);
  assert.equal(replay.reused, true); assert.equal(x.collected, 1); assert.equal(x.audited, 1);
  assert.equal(row.status, "approved"); assert.equal(row.approved_version, 1);
  assert.equal((await x.service.generateProfessionalReport(admin, { ...input, end: "2026-09-16" })).ok, false);
  assert.equal((await x.service.generateProfessionalReport(admin, { ...input, clientId: "22222222-2222-4222-8222-222222222222" })).ok, false);
  assert.equal(x.collected, 1);
});

test("concurrent preparation requests persist one report and one audit", async () => {
  const x = setup();
  const results = await Promise.all(Array.from({ length: 4 }, () => x.service.generateProfessionalReport(admin, input)));
  assert.ok(results.every(result => result.ok));
  assert.equal(x.store.tables.reports.length, 1); assert.equal(x.audited, 1);
  assert.equal(results.filter(result => result.reused).length, 3);
  assert.equal(x.store.tables.reports[0].status, "ready_for_review");
  assert.equal(x.store.tables.reports[0].approved_version, undefined);
});

test("refresh uses stored sources, creates a new version, resets approval and rejects stale versions", async () => {
  const x = setup();
  await x.service.generateProfessionalReport(admin, input);
  const row = x.store.tables.reports[0]; row.status = "approved"; row.approved_version = 1;
  const refresh = await x.service.regenerateProfessionalReport(admin, input.requestId, 1);
  assert.equal(refresh.ok, true); assert.equal(refresh.version, 2);
  assert.equal(row.approved_version, null); assert.equal(row.status, "ready_for_review");
  assert.equal(JSON.stringify(row.scope), JSON.stringify(input));
  assert.equal((await x.service.regenerateProfessionalReport(admin, input.requestId, 1)).ok, false);
  row.status = "sent";
  assert.equal((await x.service.regenerateProfessionalReport(admin, input.requestId, 2)).ok, false);
  assert.equal(x.collected, 2);
});
