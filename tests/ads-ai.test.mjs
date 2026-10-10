import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";
const periods = loadTs("lib/integrations/google-ads/periods.ts");
const dashboard = loadTs("lib/integrations/google-ads/dashboard.ts", { "./periods": periods });
const scopes = loadTs("lib/integrations/google-ads/scope.ts", { "./periods": periods });
const validation = loadTs("lib/integrations/google-ads/validation.ts", { "./periods": periods });
const business = loadTs("lib/integrations/google-ads/business-context.ts");
const ai = loadTs("lib/integrations/google-ads/ai-analysis.ts", { "./dashboard": dashboard });
const metrics = { cost: 80, conversions: 0, clicks: 10, impressions: 200, ctr: .05, averageCpc: 8, costPerConversion: null, conversionValue: null };
const rows = [{ id: "123", name: "Search", type: "SEARCH", status: "ENABLED", metrics, hasActivity: true, localServices: false, budget: { amount: 10, shared: false, period: "DAILY" }, subType: null, previous: null }, { id: "456", name: "LSA", type: "LOCAL_SERVICES", status: "ENABLED", metrics: { ...metrics, conversions: null }, hasActivity: true, localServices: true, budget: { amount: null, shared: null, period: null }, subType: null, previous: null }];
const scope = { start: "2026-09-01", end: "2026-09-07", days: 7, status: "enabled", types: [], campaignIds: ["123", "456"], accountId: "1234567890", currency: "EUR", timezone: "Europe/Paris", campaignNames: { 123: "Search", 456: "LSA" } };
const snapshot = { global: "Respecter les objectifs.", client: "Prioriser la zone client.", business: { ...business.EMPTY_ADS_CONTEXT, objectives: "Prospects utiles", areas: "Zone test", advertisingMonthlyBudget: 500 } };
const valid = () => ({ factIds: ["campaign:123:cost"], hypotheses: [{ kind: "tracking_incomplete", campaignIds: ["123"], explanation: "Le suivi pourrait être incomplet." }], recommendations: [{ action: "verify_tracking", campaignIds: ["123"], evidenceIds: ["campaign:123:cost", "campaign:123:conversions"], rationale: "Vérifier le suivi avant de conclure sur la qualité commerciale." }] });

test("AI output only cites provided facts and campaign scope, and never merges Search with Local Services", () => {
  const evidence = ai.analysisEvidence(rows, scope);
  assert.equal(ai.validateAdsAIOutput(valid(), rows, evidence).recommendations.length, 1);
  for (const mutate of [
    (v) => { v.factIds = ["keywords:invented"]; },
    (v) => { v.recommendations[0].campaignIds = ["999"]; },
    (v) => { v.recommendations[0].campaignIds = ["123", "456"]; },
    (v) => { v.recommendations[0].rationale = "Vous avez dépensé 900 euros."; },
    (v) => { v.recommendations[0].rationale = "<script>alert('x')</script>"; },
    (v) => { v.recommendations[0].evidenceIds = ["campaign:456:cost"]; },
    (v) => { v.extra = "SQL"; },
  ]) { const value = valid(); mutate(value); assert.throws(() => ai.validateAdsAIOutput(value, rows, evidence)); }
  assert.equal(evidence.some((item) => item.id === "campaign:456:conversions"), false, "missing conversion is never zero");
});
test("one bounded AI call uses existing provider, instructions and a non-executable strict result tool", async () => {
  let calls = 0, request;
  const provider = { id: "openai", model: "simulated", complete: async (input) => { calls++; request = input; return { text: "", toolCalls: [{ name: "ads_analysis_result", arguments: valid() }] }; } };
  const result = await ai.analyzeAdsWithAI(provider, rows, scope, snapshot);
  assert.equal(calls, 1);
  assert.equal(request.tools.length, 1); assert.equal(request.tools[0].strict, true);
  assert.ok(request.signal instanceof AbortSignal);
  const data = JSON.parse(request.messages[0].content);
  assert.equal(data.instructions.business.advertisingMonthlyBudget, 500);
  assert.equal(data.instructions.client, snapshot.client);
  assert.match(result.text, /80 EUR/); assert.match(result.text, /Hypothèses à vérifier/); assert.match(result.text, /distincte du chiffre d’affaires/);
  await assert.rejects(ai.analyzeAdsWithAI(provider, rows, scope, { ...snapshot, global: "x".repeat(40001) }));
  assert.equal(calls, 1, "oversize input never calls the provider");
});
test("business context keeps absent budgets null, rejects extra fields and isolates storage by client", async () => {
  assert.equal(business.adsBusinessSchema.parse(business.EMPTY_ADS_CONTEXT).advertisingMonthlyBudget, null);
  assert.equal(business.adsBusinessSchema.safeParse({ ...business.EMPTY_ADS_CONTEXT, token: "secret" }).success, false);
  assert.equal(business.adsBusinessSchema.safeParse({ ...business.EMPTY_ADS_CONTEXT, targetCostPerLead: -1 }).success, false);
  const fake = createFakeSupabase({ client_ads_context: [{ client_id: "aaaaaaaa-0000-4000-8000-0000000000a1", revision: 2, context: snapshot.business }] });
  const service = loadTs("lib/integrations/google-ads/context-service.ts", { "@/lib/require-admin": { requireAdmin: async () => ({ userId: "admin" }) }, "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client }, "@/lib/agents/validation": { isAgentUuid: (id) => /^[a-f0-9-]{36}$/.test(id) }, "./business-context": business, "@/lib/audit-logs": { writeAuditLog: async () => {} } });
  assert.equal((await service.getAdsBusinessContext("aaaaaaaa-0000-4000-8000-0000000000b1")).context, null);
});

function runSetup({ failure = false, unavailable = false, simulation = false, mode = "ai" } = {}) {
  const clientId = "aaaaaaaa-0000-4000-8000-0000000000a1", agentId = "cccccccc-0000-4000-8000-0000000000a1", runId = "dddddddd-0000-4000-8000-0000000000a1";
  const fake = createFakeSupabase({ client_connections: [{ id: "eeeeeeee-0000-4000-8000-0000000000a1", client_id: clientId, provider: "google_ads", external_account_id: scope.accountId, status: "connected", metadata: {}, updated_at: "2026-01-01" }] });
  let metadata, released = 0, calls = 0; const recommendations = [];
  const provider = { id: "openai", model: "unit-model", complete: async () => { calls++; if (failure) throw new Error("provider_secret_do_not_log"); return { text: "", toolCalls: [{ name: "ads_analysis_result", arguments: valid() }] }; } };
  const transport = { getAccountSummary: async () => ({ id: scope.accountId, currency: "EUR", timezone: "Europe/Paris" }), getCampaignDashboard: async () => ({ inventory: rows, current: { 123: metrics, 456: rows[1].metrics }, previous: null }) };
  const service = loadTs("lib/integrations/google-ads/service.ts", {
    "@/lib/require-admin": { requireAdmin: async () => ({ userId: "admin" }) }, "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client },
    "@/lib/simulation/server": { getActiveScenario: async () => simulation ? "fixture" : null },
    "@/lib/clients/data": { getClient: async () => ({ id: clientId }) }, "@/lib/agents/data": { getAgentById: async () => ({ id: agentId, agent_type: "google-ads", status: "Actif", enabled: true, instructions: snapshot.global }), listClientsForAgent: async () => [{ client_id: clientId, enabled: true, client_instructions: snapshot.client }] },
    "@/lib/agents/validation": { isAgentUuid: (id) => /^[a-f0-9-]{36}$/.test(id) }, "@/lib/audit-logs": { writeAuditLog: async () => {} },
    "@/lib/agent-runs/data": { createAgentRun: async (input) => { metadata = input.metadata; return { ok: true, run: { id: runId } }; }, completeAgentRun: async () => ({ ok: true }), failAgentRun: async () => ({ ok: true }) },
    "@/lib/recommendations/data": { createRecommendation: async (input) => { recommendations.push(input); return { ok: true, recommendation: { id: "reco-unit" } }; } },
    "./client": { createGoogleAdsReadClient: () => transport, normalizeMetrics: () => ({}), GoogleAdsError: class extends Error {} }, "./validation": validation, "./periods": periods, "./scope": scopes, "./dashboard": dashboard,
    "./tracking": { loadCampaignTracking: async () => ({ available: true, ids: ["123"], revision: 1 }) },
    "@/lib/ai/providers": { selectAIProvider: () => unavailable ? null : provider }, "./ai-analysis": ai,
    "./context-service": { getAdsBusinessContext: async () => ({ available: true, context: snapshot.business }) },
    "./analysis-state": { reserveAdsAnalysis: async () => ({ acquired: true, release: async () => { released++; } }), saveAdsAnalysisMetadata: async (_id, _client, _agent, value) => { metadata = value; } },
  });
  return { run: () => service.runGoogleAdsAnalysis(agentId, clientId, { scope: { start: scope.start, end: scope.end, status: scope.status, types: scope.types, campaignIds: scope.campaignIds }, mode }), get: () => ({ metadata, recommendations, released, calls }) };
}
test("successful AI run stores the exact scope, instruction snapshot, provider/model and validated result", async () => {
  const s = runSetup(); const result = await s.run(); const state = s.get();
  assert.equal(result.ok, true); assert.equal(state.metadata.engine, "ai");
  assert.deepEqual(JSON.parse(JSON.stringify(state.metadata.scope)), scope);
  assert.equal(state.metadata.instruction_snapshot.client, snapshot.client);
  assert.equal(state.metadata.provider, "openai"); assert.equal(state.metadata.model, "unit-model");
  assert.equal(state.released, 1); assert.equal(state.calls, 1);
});

test("Simulation cannot start a real analysis, provider request or run", async () => {
  const s = runSetup({ simulation: true }); const result = await s.run(); const state = s.get();
  assert.match(result.message, /Simulation active/); assert.equal(state.calls, 0); assert.equal(state.metadata, undefined); assert.equal(state.released, 0);
});
test("failed or missing AI provider is an explicit deterministic fallback, never a claimed AI success", async () => {
  for (const options of [{ failure: true }, { unavailable: true }]) {
    const s = runSetup(options); const result = await s.run(); const state = s.get();
    assert.equal(result.ok, true); assert.match(result.message, /IA indisponible.*repli déterministe/);
    assert.equal(state.metadata.engine, "deterministic_fallback"); assert.equal(state.metadata.requested_mode, "ai");
    assert.equal(state.released, 1); assert.equal(state.recommendations[0].payload.engine, "deterministic");
    assert.doesNotMatch(JSON.stringify(state.metadata), /provider_secret/);
  }
});
