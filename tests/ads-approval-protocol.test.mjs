import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const { adsChangeFingerprint } = loadTs("lib/ads/approval-protocol.ts");
const base = { kind: "negative_keyword_add", customerId: "1234567890", campaignId: "123", keywords: [{ text: "emploi couvreur", matchType: "PHRASE" }] };

test("Ads approval fingerprint is stable across property order", () => {
  const rearranged = { keywords: base.keywords, campaignId: base.campaignId, customerId: base.customerId, kind: base.kind };
  assert.equal(adsChangeFingerprint(base), adsChangeFingerprint(rearranged));
});
test("Ads approval fingerprint binds account campaign operation and keywords", () => {
  const hash = adsChangeFingerprint(base);
  for (const update of [
    { customerId: "9999999999" },
    { campaignId: "999" },
    { kind: "keyword_add" },
    { keywords: [{ text: "formation couvreur", matchType: "PHRASE" }] },
    { keywords: [{ text: "emploi couvreur", matchType: "EXACT" }] },
  ]) assert.notEqual(hash, adsChangeFingerprint({ ...base, ...update }));
});
test("Ads fingerprint normalizes only keyword whitespace", () => {
  assert.equal(adsChangeFingerprint(base), adsChangeFingerprint({ ...base, keywords: [{ text: " emploi   couvreur ", matchType: "PHRASE" }] }));
});
