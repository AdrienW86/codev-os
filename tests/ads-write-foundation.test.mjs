import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const { prepareAdsChange, executeApprovedAdsChange } = loadTs("lib/ads/write-foundation.ts", {
  "@/lib/providers/api": {
    googleAccessToken: async () => { throw new Error("Network must not be used in preview"); },
    providerJson: async () => { throw new Error("Network must not be used in preview"); },
  },
});
const base = { customerId: "1234567890", campaignId: "123" };

test("all supported Ads operations preview without network calls", async () => {
  for (const change of [
    { ...base, kind: "campaign_pause" },
    { ...base, kind: "campaign_enable" },
    { ...base, kind: "keyword_pause", adGroupId: "456", criterionId: "789" },
    { ...base, kind: "keyword_enable", adGroupId: "456", criterionId: "789" },
    { ...base, kind: "keyword_add", adGroupId: "456", keywords: [{ text: "couvreur lyon", matchType: "PHRASE" }] },
    { ...base, kind: "negative_keyword_add", keywords: [{ text: "emploi couvreur", matchType: "EXACT" }] },
  ]) {
    const preview = prepareAdsChange(change);
    assert.equal(preview.operations.length, 1);
    const dry = await executeApprovedAdsChange(change, { approved: true });
    assert.equal(dry.executed, false);
  }
});

test("rejects untrusted IDs and invalid keyword batches", () => {
  const good = { ...base, kind: "negative_keyword_add", keywords: [{ text: "aide toiture", matchType: "PHRASE" }] };
  for (const patch of [
    { customerId: "1234" }, { campaignId: "1 OR 1=1" }, { keywords: [] },
    { keywords: new Array(26).fill({ text: "test", matchType: "EXACT" }) },
    { keywords: [{ text: "test", matchType: "BROAD" }] },
    { keywords: [{ text: "test" + String.fromCharCode(10) + "other", matchType: "EXACT" }] },
    { keywords: [{ text: "same", matchType: "EXACT" }, { text: " SAME ", matchType: "EXACT" }] },
    { keywords: [{ text: null, matchType: "EXACT" }] },
  ]) assert.throws(() => prepareAdsChange({ ...good, ...patch }));
});

test("production write stays disabled by default", async () => {
  await assert.rejects(
    () => executeApprovedAdsChange({ ...base, kind: "campaign_pause" }, { approved: true, dryRun: false, env: {} }),
    /désactivée/,
  );
});
