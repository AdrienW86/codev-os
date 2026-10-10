import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";
const previewModule = loadTs("lib/reports/email-preview.ts");
const errors = loadTs("lib/providers/errors.ts");
const id = "11111111-1111-4111-8111-111111111111";
const report = { id, client_id: id, status: "approved", version: 2, approved_version: 2, title: "Rapport client", client_content: { summary: "Synthèse", sections: [{ title: "Résultats", lines: ["Mesures"] }] }, internal_content: { secret: "NEVER" } };
function setup({ denied = false, failure = null } = {}) {
  let claimed = false; const sent = []; const finished = [];
  const db = { from() { return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: report }) }; }, async rpc(name, input) {
    if (name === "codev_claim_report_delivery") { if (claimed) return { data: false }; claimed = true; return { data: true }; }
    finished.push(input); return { data: true };
  } };
  const service = loadTs("lib/reports/service.ts", {
    "./version-storage": { requireReportVersionStorage: async () => {} },
    "@/lib/supabase/server": { getSupabaseServerClient: () => db }, "@/lib/core/audit": { writeAudit: async () => {} }, "@/lib/actions/registry": {}, "@/lib/reports/build": {},
    "@/lib/require-admin": { requireAdmin: async () => { if (denied) throw Error("denied"); } }, "@/lib/reports/email-preview": previewModule, "@/lib/providers/errors": errors,
    "@/lib/providers/email": { emailSendingStatus: () => ({ enabled: true }), sendEmail: async (email) => { sent.push(email); if (failure) throw failure; return { id: "fake-accepted" }; } },
  });
  return { service, sent, finished };
}
const admin = { kind: "admin", userId: "test" };
const preview = { version: 2, recipient: "client@example.test", confirmed: true, digest: previewModule.reportEmailPreview(report).digest };
test("Preview whitelists client plain text and rejects ambiguous recipients", () => {
  const result = previewModule.reportEmailPreview(report);
  assert.equal(result.text.includes("NEVER"), false);
  for (const value of ["a@example.test,b@example.test", "Name <a@example.test>", "a@example.test\nBcc:x@example.test"]) assert.equal(previewModule.recipientSchema.safeParse(value).success, false);
  assert.throws(() => previewModule.reportEmailPreview({ ...report, client_content: { ...report.client_content, internal: "hidden" } }));
});
test("Simultaneous send requests claim once before provider and persist acceptance", async () => {
  const x = setup(); const results = await Promise.all([x.service.sendReport(admin, id, "email", preview), x.service.sendReport(admin, id, "email", preview)]);
  assert.equal(results.filter((r) => r.ok).length, 1); assert.equal(x.sent.length, 1); assert.equal(x.finished[0].p_state, "accepted");
  assert.equal(x.sent[0].text.includes("NEVER"), false);
  assert.equal((await x.service.sendReport(admin, id, "email", preview)).ok, false); assert.equal(x.sent.length, 1);
});
test("Stale version, changed digest, missing approval and denied admin never send", async () => {
  const x = setup();
  for (const input of [{ ...preview, version: 1 }, { ...preview, digest: "stale" }, { ...preview, confirmed: false }]) assert.equal((await x.service.sendReport(admin, id, "email", input)).ok, false);
  assert.equal(x.sent.length, 0);
  await assert.rejects(() => setup({ denied: true }).service.sendReport(admin, id, "email", preview), /denied/);
});
test("Timeout stays uncertain and cannot be repeated", async () => {
  const x = setup({ failure: new errors.ProviderError("email", "timeout") });
  assert.match((await x.service.sendReport(admin, id, "email", preview)).message, /incertain/);
  assert.equal(x.finished[0].p_state, "uncertain");
  await x.service.sendReport(admin, id, "email", preview); assert.equal(x.sent.length, 1);
});
