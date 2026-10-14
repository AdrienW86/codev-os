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

import { loadTs } from "./helpers/load-ts.mjs";
const policy = loadTs("lib/acquisition/dispatch-policy.ts");
const gate = loadTs("lib/acquisition/connector-gates.ts", {"./dispatch-policy": policy});
const draft = loadTs("lib/acquisition/draft-generator.ts", {"./model":loadTs("lib/acquisition/model.ts")});
test("dispatch requires every safety gate and rejects duplicate-key formats", () => {
 const p={emergencyStop:false,workspaceSendingEnabled:true,senderReady:true,providerApproved:true,recipientApproved:true,humanApproved:true,suppressed:false,dailyLimit:50,sentToday:0};
 const m={workspaceId:"workspace",senderId:"sender",recipient:"prospect@example.test",idempotencyKey:"unique-message-identifier-123"};
 assert.equal(gate.evaluateAcquisitionDispatch(p,m).allowed,true);
 for(const patch of [{emergencyStop:true},{workspaceSendingEnabled:false},{senderReady:false},{providerApproved:false},{recipientApproved:false},{humanApproved:false},{suppressed:true},{dailyLimit:0},{sentToday:50}]){
  assert.equal(gate.evaluateAcquisitionDispatch({...p,...patch},m).allowed,false,JSON.stringify(patch));
 }
 assert.equal(gate.evaluateAcquisitionDispatch(p,{...m,recipient:"x\nBcc:other@example.test"}).allowed,false);
 assert.equal(gate.evaluateAcquisitionDispatch(p,{...m,idempotencyKey:"short"}).allowed,false);
});
test("draft never invents a closure or defect and rejects unverified facts",()=>{
 const input={category:"site_issues",companyName:"Artisan",senderName:"CODE-V",senderCompany:"CODE-V",facts:[]};
 assert.equal(draft.createAcquisitionDraft(input),null);
 assert.equal(draft.createAcquisitionDraft({...input,facts:[{label:"Test",statement:"Entreprise confirmée",sourceUrl:"file:///etc/passwd",verifiedAt:"2026-10-14"}]}),null);
 const result=draft.createAcquisitionDraft({...input,facts:[{label:"Observation",statement:"Le site affiche une page d'information",sourceUrl:"https://example.com/info",verifiedAt:"2026-10-14T11:00:00Z"}]});
 assert.ok(result);
 assert.match(result.body,/Le site affiche une page d'information/);
 assert.doesNotMatch(result.body,/fermé|en panne|défaillant/);
});
