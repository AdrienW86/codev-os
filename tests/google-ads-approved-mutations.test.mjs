import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../lib/integrations/google-ads/approved-mutations.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
const calls = [];
vm.runInNewContext(compiled, {
  exports,
  require(name) {
    if (name === "server-only") return {};
    if (name === "@/lib/require-admin") return { requireAdmin: async () => { calls.push("admin"); } };
    if (name === "@/lib/simulation/server") return { getActiveScenario: async () => null };
    if (name === "./validation") return { normalizeCustomerId: x => typeof x === "string" && /^\d{10}$/.test(x) ? x : null };
    throw new Error("Unexpected import " + name);
  },
});
const valid = { customerId: "1234567890", campaignId: "987654", text: "aide pour toiture", matchType: "PHRASE" };

test("negative keyword preview is scoped and requires approval", () => {
  const result = exports.previewNegativeKeyword({ ...valid, text: "  aide pour toiture  " });
  assert.equal(result.text, "aide pour toiture");
  assert.equal(result.requiresApproval, true);
  assert.equal(result.campaignId, valid.campaignId);
});
test("negative keyword rejects untrusted account, campaign, and keyword", () => {
  for (const wrong of [
    { customerId: "1 OR 1=1" },
    { managerId: "not-a-manager" },
    { campaignId: "123/../../" },
    { text: "" },
    { text: "a".repeat(81) },
    { text: "test" + String.fromCharCode(10) + "other" },
    { matchType: "BROAD" },
  ]) assert.throws(() => exports.validateNegativeKeyword({ ...valid, ...wrong }));
});
test("no write path exists even with a forged approval id", async () => {
  await assert.rejects(
    () => exports.applyApprovedNegativeKeyword({ ...valid, approvalId: "forged" }),
    /désactivées/,
  );
  assert.deepEqual(calls, ["admin"]);
});
