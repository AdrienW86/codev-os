import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";
const previewModule = loadTs("lib/reports/email-preview.ts", { "./recipient": loadTs("lib/reports/recipient.ts") });
const pdfModule = loadTs("lib/reports/pdf.ts", { "./email-preview": previewModule });
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
    "@/lib/require-admin": { requireAdmin: async () => { if (denied) throw Error("denied"); } }, "@/lib/reports/email-preview": previewModule, "@/lib/reports/pdf": pdfModule, "@/lib/providers/errors": errors,
    "@/lib/vercel-analytics/sync": { syncVercelAnalytics: async () => ({ ok: true }) },
    "@/lib/integrations/search-console/model": { addDays: () => "", dayCount: () => 0, normalizeProperty: () => null },
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
  assert.match(x.sent[0].attachment.filename, /\.pdf$/);
  const pdf = Buffer.from(x.sent[0].attachment.base64, "base64");
  assert.equal(pdf.subarray(0, 8).toString("latin1"), "%PDF-1.4");
  assert.doesNotMatch(pdf.toString("latin1"), /NEVER/);
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
for (const [status,kind,state] of [[401,'unauthorized','failed'],[429,'rate_limited','failed'],[500,'unavailable','uncertain']]) {
  test(`Provider ${status}: ${state}, no second attempt or secret in result`, async () => {
    const x=setup({failure:new errors.ProviderError('email',kind,status,'fake-safe-code')});
    const result=await x.service.sendReport(admin,id,'email',preview);
    assert.equal(result.ok,false);assert.equal(x.finished[0].p_state,state);
    await x.service.sendReport(admin,id,'email',preview);assert.equal(x.sent.length,1);
    assert.doesNotMatch(JSON.stringify(result),/fake-safe-code|Bearer|API_KEY/);
  });
}

test('invalid sender blocks before reservation; display-name sender remains supported',async()=>{
 const email=loadTs('lib/providers/email.ts',{'@/lib/providers/api':{},'@/lib/providers/errors':errors});
 const env={RESEND_API_KEY:'fake-only',EMAIL_FROM:'bad-address',EMAIL_SENDING_ENABLED:'true'};
 assert.equal(email.emailSendingStatus(env).enabled,false);
 assert.equal(email.emailSendingStatus({...env,EMAIL_FROM:'CODE-V <reports@example.invalid>'}).enabled,true);
 assert.equal(email.emailSendingStatus({...env,EMAIL_FROM:'CODE-V\nBcc:x@example.invalid <reports@example.invalid>'}).enabled,false);
 await assert.rejects(()=>email.sendEmail({to:'reports@example.invalid',subject:'Test',text:'Test',idempotencyKey:'fake'},env,()=>{throw Error('must not fetch');}),e=>e.kind==='not_configured');
 assert.equal(email.emailSendingStatus({...env,EMAIL_FROM:'reports@example.invalid',EMAIL_SENDING_ENABLED:'false'}).enabled,false);
});

test("Resend receives the approved report as a real base64 PDF attachment", async () => {
  let payload = null;
  const provider = loadTs("lib/providers/email.ts", {
    "@/lib/providers/api": { providerJson: async (_provider, _url, init) => { payload = JSON.parse(init.body); return { id: "fake-accepted" }; } },
    "@/lib/providers/errors": errors,
  });
  const env = { RESEND_API_KEY: "fake-testing-only", EMAIL_FROM: "CODE-V <reports@example.invalid>", EMAIL_SENDING_ENABLED: "true" };
  const attachment = { filename: "code-v-client-v2.pdf", base64: pdfModule.renderClientReportPdf({ ...report, client: { name: "Client" }, kind: "monthly", period_start: "2026-09-01", period_end: "2026-09-30", generated_at: "2026-10-15T10:00:00Z" }).toString("base64") };
  const response = await provider.sendEmail({ to: "client@example.invalid", subject: "Rapport client", text: "Synthèse client", idempotencyKey: "report-unique-v2", attachment }, env);
  assert.equal(response.id, "fake-accepted");
  assert.equal(payload.to.length, 1);
  assert.equal(payload.attachments[0].filename, attachment.filename);
  assert.equal(payload.attachments[0].content, attachment.base64);
  assert.equal(Buffer.from(payload.attachments[0].content, "base64").subarray(0, 8).toString("latin1"), "%PDF-1.4");
  const body = JSON.stringify(payload);
  assert.doesNotMatch(body, /SECRET_TO_NEVER_EXPOSE_IN_PDF|fake-testing-only/);
  await assert.rejects(() => provider.sendEmail({
    to: "client@example.invalid", subject: "Rapport client", text: "Synthèse client", idempotencyKey: "fake",
    attachment: { filename: "bad\r\nBcc:someone.pdf", base64: attachment.base64 },
  }, env), e => e.kind === "malformed");
});
