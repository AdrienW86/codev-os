import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";
const { buildDiagnosticIssues } = loadTs("lib/ads/diagnostics.ts", {
  "@/lib/require-admin": { requireAdmin: async () => ({ userId: "admin" }) },
  "@/lib/integrations/google-ads/service": { getGoogleAdsConnection: async () => null },
  "@/lib/providers/api": {},
});
const baseline = () => ({ conversionActions: [{ id: "1", category: "CONTACT", status: "ENABLED", primaryForGoal: true }],
  campaignGoals: [{ category: "CONTACT", origin: "WEBSITE", biddable: true }], ads: [], assets: [], unavailable: [] });

test("conversion alert requires available data and lacks a primary bid-compatible action", () => {
  assert.equal(buildDiagnosticIssues(baseline()).length, 0);
  assert.equal(buildDiagnosticIssues({ ...baseline(), conversionActions: [{ category: "CONTACT", status: "ENABLED", primaryForGoal: false }] })[0].severity, "high");
  assert.equal(buildDiagnosticIssues({ ...baseline(), conversionActions: [], unavailable: ["conversionActions"] }).length, 0);
});
test("rejected ads and ineligible call assets produce bounded actionable diagnostics", () => {
  const issues = buildDiagnosticIssues({ ...baseline(),
    ads: [{ id: "100", approval: "DISAPPROVED", policyTopics: ["PHONE_NUMBER_UNVERIFIED"] }, { id: "101", strength: "POOR" }],
    assets: [{ resourceName: "customers/1234567890/campaignAssets/5~6~CALL", fieldType: "CALL", primaryStatus: "NOT_ELIGIBLE" }],
  });
  assert.equal(issues.length, 3);
  assert.ok(issues.some(issue => issue.title.includes("Annonce refusée")));
  assert.ok(issues.some(issue => issue.title.includes("Composant CALL")));
  assert.ok(issues.every(issue => issue.recommendation.length > 0));
});
test("healthy campaign is not declared proven to generate leads", () => {
  assert.deepEqual(Array.from(buildDiagnosticIssues(baseline())), []);
});
const writes = loadTs("lib/ads/write-foundation.ts", { "@/lib/providers/api": {} });
test("ad and call asset updates use separate whitelisted resources", () => {
  const common = { customerId: "1234567890", campaignId: "55" };
  const ad = writes.prepareAdsChange({ ...common, kind: "ad_pause", adGroupId: "66", adId: "77" });
  assert.equal(ad.resource, "adGroupAds");
  assert.equal(ad.operations[0].update.status, "PAUSED");
  assert.equal(ad.operations[0].update.resourceName, "customers/1234567890/adGroupAds/66~77");
  const call = writes.prepareAdsChange({ ...common, kind: "call_asset_enable", assetId: "77" });
  assert.equal(call.resource, "campaignAssets");
  assert.equal(call.operations[0].update.resourceName, "customers/1234567890/campaignAssets/55~77~CALL");
  assert.throws(() => writes.prepareAdsChange({ ...common, kind: "call_asset_pause", assetId: "77 OR 1=1" }));
});
