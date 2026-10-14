import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const { extractLiveAdsPriorities } = loadTs("lib/assistant/live-ads-priorities.ts", {
  "@/lib/supabase/server": { getSupabaseServerClient: () => { throw Error("no database in pure test"); } },
});
const run = "123e4567-e89b-42d3-a456-426614174000";
const metadata = {
  run_type: "google_ads_read_only", engine: "ai",
  scope: { campaignIds: ["123"], campaignNames: { "123": "Search Jrenov" } },
  evidence: [{ id: "campaign:123:cost", campaignId: "123", text: "Search Jrenov : 70 EUR de dépenses" }],
  analysis: { recommendations: [
    { action: "verify_tracking", priority: "high", campaignIds: ["123"], evidenceIds: ["campaign:123:cost"], rationale: "Contrôler les conversions enregistrées" },
  ] },
};
test("director proposes a live action only with a campaign-scoped evidence", () => {
  const result = extractLiveAdsPriorities(metadata, run, "2026-10-14");
  assert.equal(result.length, 1);
  assert.equal(result[0].priority, "high");
  assert.equal(result[0].evidence.length, 1);
  assert.equal(result[0].href, "/advertising/analyses/" + run);
});
test("director rejects unknown evidence and out-of-scope campaigns", () => {
  assert.equal(extractLiveAdsPriorities({ ...metadata, analysis: { recommendations: [
    { ...metadata.analysis.recommendations[0], evidenceIds: ["invented"] },
  ] } }, run, "2026-10-14").length, 0);
  assert.equal(extractLiveAdsPriorities({ ...metadata, analysis: { recommendations: [
    { ...metadata.analysis.recommendations[0], campaignIds: ["999"] },
  ] } }, run, "2026-10-14").length, 0);
});
test("deterministic verified findings become actions without AI", () => {
  const result = extractLiveAdsPriorities({
    ...metadata, engine: "deterministic", analysis: null,
    findings: [{ campaignId: "123", priority: "high", title: "Dépenses sans conversion enregistrée", nextStep: "Vérifier le suivi", evidence: ["70 EUR dépensés", "0 conversion enregistrée"] }],
  }, run, "2026-10-14");
  assert.equal(result.length, 1);
  assert.equal(result[0].origin, "diagnostic");
});
