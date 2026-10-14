import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("email connector has explicitly non-operational fallback", () => {
  const code = readFileSync("lib/acquisition/provider-contracts.ts","utf8");
  assert.match(code, /unconfiguredEmailTransport/);
  assert.match(code, /Outbound sending is disabled/);
  assert.doesNotMatch(code, /nodemailer|smtp\.send|fetch\(.*mail\.infomaniak/);
});
test("dispatch requires idempotency and central policy",()=>{
  const code=readFileSync("lib/acquisition/connector-gates.ts","utf8");
  assert.match(code,/getDispatchBlockReason/);
  assert.match(code,/invalid_idempotency_key/);
});
test("no client secrets in browser code",()=>{
  const code=readFileSync("components/acquisition/workspace-tabs.tsx","utf8");
  assert.doesNotMatch(code,/SMTP_PASSWORD|IMAP_PASSWORD|SUPABASE_SECRET_KEY/);
});
