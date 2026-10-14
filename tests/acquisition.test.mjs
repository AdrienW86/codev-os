import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Acquisition route requires existing single admin authentication", () => {
  const code=readFileSync("app/(cockpit)/acquisition/page.tsx","utf8");
  assert.match(code, /await requireAdmin\(\)/);
  assert.doesNotMatch(code, /sendMail|sendMessage|fetch\(.*smtp/);
});
test("Acquisition SMTP secrets stay server-only and credentials never appear in UI", () => {
  const code=readFileSync("lib/acquisition/connectors.ts","utf8");
  assert.match(code, /import "server-only"/);
  assert.doesNotMatch(readFileSync("app/(cockpit)/acquisition/page.tsx","utf8"), /ACQUISITION_SMTP_PASSWORD/);
});
test("Acquisition remains excluded from any automatic dispatch route", () => {
  const code=readFileSync("lib/acquisition/dispatch-policy.ts","utf8");
  for (const guard of ["emergency_stop","provider_not_authorized","human_approval_required","recipient_suppressed","daily_quota_reached"])
    assert.ok(code.includes(guard), guard);
});
test("Acquisition navigation and sign-in return destination are present",()=>{
  assert.match(readFileSync("components/layout/navigation.tsx","utf8"),/href: "\/acquisition"/);
  assert.match(readFileSync("lib/auth/return-path.ts","utf8"),/\|acquisition\|/);
});
