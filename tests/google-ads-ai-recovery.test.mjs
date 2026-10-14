import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";
const api = loadTs("lib/integrations/google-ads/ai-analysis.ts", {
  "@/lib/ai/providers": {},
  "@/lib/integrations/google-ads/dashboard": {},
});
test("recover numeric or markup narratives only, retaining source identifiers", () => {
  const original = { factIds: ["scope"], hypotheses: [], recommendations: [
    { action: "verify_tracking", priority: "high", campaignIds: ["123"], evidenceIds: ["campaign:123:cost"], rationale: "CTR 1.5% and 30€ <script>" },
  ] };
  const out = api.recoverAdsAINarratives(original);
  assert.equal(out.repairs, 1);
  assert.equal(out.candidate.recommendations[0].rationale.includes("€"), false);
  assert.deepEqual(Array.from(out.candidate.recommendations[0].evidenceIds), ["campaign:123:cost"]);
  assert.equal(original.recommendations[0].rationale.includes("€"), true);
});
test("recover scope-only empty facts, but never invent campaign proof", () => {
  const out = api.recoverAdsAINarratives({ factIds: [], recommendations: [{ evidenceIds: ["unknown"] }], hypotheses: [] });
  assert.deepEqual(Array.from(out.candidate.factIds), ["scope"]);
  assert.deepEqual(Array.from(out.candidate.recommendations[0].evidenceIds), ["unknown"]);
});
