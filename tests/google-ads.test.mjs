import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const clientId = "d94e386a-653e-478b-80f1-05d442baed92";
const agentId = "c7d93a42-4db1-4eb3-9b0a-3dcbeb4bd879";
const connectionId = "dcdd86a2-66c2-4714-bc20-7e50c48288de";
const account = { id: "1234567890", name: "Compte", currency: "USD", timezone: "America/New_York" };
const metrics = { impressions: 1000, clicks: 20, cost: 50, conversions: 0, conversionValue: 0, ctr: 0.02, averageCpc: 2.5, costPerConversion: null };
const campaign = { id: "123", name: "Campagne", status: "ENABLED", channel: "SEARCH", budget: 10, startDate: null, endDate: null, metrics };

function load(path, mocks = {}, globals = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, Date, Intl, URLSearchParams, AbortSignal, console: { error: () => {} }, ...globals, require: (name) => {
    if (name === "server-only") return {};
    if (name in mocks) return mocks[name];
    throw new Error(`Unexpected import: ${name}`);
  } });
  return exports;
}
const periods = load("lib/integrations/google-ads/periods.ts");
const validation = load("lib/integrations/google-ads/validation.ts", { "./periods": periods });
const queries = load("lib/integrations/google-ads/queries.ts", { "./validation": validation });
const dashboard = load("lib/integrations/google-ads/dashboard.ts", { "./periods": periods });
const scopes = load("lib/integrations/google-ads/scope.ts", { "./periods": periods });
function transport({ env = {}, deny = false, respond = async () => ({}) } = {}) {
  const calls = [], logs = [];
  const clientModule = load("lib/integrations/google-ads/client.ts", {
    "@/lib/require-admin": { requireAdmin: async () => { calls.push("auth"); if (deny) throw new Error("denied"); } },
    "./queries": queries, "./validation": validation,
  }, { process: { env }, console: { error: (...args) => logs.push(args) }, fetch: async (url, options) => {
    calls.push({ url, options });
    return respond(url, options);
  } });
  return { ...clientModule, client: clientModule.createGoogleAdsReadClient(), calls, logs };
}
function response(body, status = 200) { return { ok: status < 400, status, headers: new Headers(), json: async () => body }; }
const fakeEnv = { GOOGLE_ADS_CLIENT_ID: "unit-client", GOOGLE_ADS_CLIENT_SECRET: "unit-secret", GOOGLE_ADS_REFRESH_TOKEN: "unit-refresh" };

const inventory = [
  { id: "123", name: "Campagne", status: "ENABLED", type: "SEARCH", subType: null, budget: { amount: 10, shared: false, period: "DAILY" } },
  { id: "456", name: "Ancienne", status: "PAUSED", type: "SEARCH", subType: null, budget: { amount: 5, shared: true, period: "DAILY" } },
  { id: "789", name: "LSA", status: "ENABLED", type: "LOCAL_SERVICES", subType: null, budget: { amount: null, shared: null, period: null } },
];
function serviceSetup({ deny = false, connected = true, assigned = true, active = true, signal = true, googleError = false, connectionExists = true, agentType = "google-ads", dashboardError = null, recommendationFails = false } = {}) {
  const calls = [], audits = [], recommendations = [], runs = [], changes = [];
  let connection = connectionExists ? { id: connectionId, client_id: clientId, provider: "google_ads", external_account_id: account.id, status: connected ? "connected" : "disconnected", metadata: { auth_strategy: "single_user", connection_version: 1, refresh_token: "must-not-forward", manager_customer_id: "9876543210" }, last_checked_at: null, created_at: "2026-01-01", updated_at: "2026-01-01" } : null;
  const guard = async () => { calls.push("auth"); if (deny) throw new Error("denied"); return { userId: "unit-admin" }; };
  const clientModule = transport();
  const readClient = {
    getAccountSummary: async (...args) => { calls.push(["account", ...args]); if (googleError) throw new clientModule.GoogleAdsError("access"); return account; },
    getCampaignPerformance: async () => { calls.push("read_campaigns"); return { campaigns: [{ ...campaign, metrics: { ...metrics, conversions: signal ? 0 : 2 } }], totals: metrics }; },
    getCampaignDashboard: async (...args) => {
      calls.push(["dashboard", ...args]);
      if (dashboardError) throw new clientModule.GoogleAdsError(dashboardError);
      return {
        inventory, current: { 123: { ...metrics, conversions: signal ? 0 : 2 }, 456: { ...metrics, cost: 7, conversions: 1 } },
        previous: args[2] ? { 123: metrics } : null, accountTotals: { ...metrics, cost: 57 }, accountPrevious: args[2] ? metrics : null,
        leads: { available: false, reason: "Accès refusé à la ressource des leads Local Services." },
      };
    },
  };
  const supabase = { from: (table) => {
    calls.push(["db", table]);
    let change = null;
    const query = {
      select: () => query, eq: () => query,
      update: (value) => { change = value; return query; },
      insert: (value) => { change = value; return query; },
      maybeSingle: async () => {
        if (change) { changes.push(change); connection = { ...connection, ...change }; }
        return { data: connection, error: null };
      },
      single: async () => { changes.push(change); connection = { id: connectionId, client_id: clientId, ...change }; return { data: { id: connectionId }, error: null }; },
    };
    return query;
  } };
  const service = load("lib/integrations/google-ads/service.ts", {
    "@/lib/require-admin": { requireAdmin: guard },
    "@/lib/simulation/server": { getActiveScenario: async () => null },
    "@/lib/supabase/server": { getSupabaseServerClient: () => supabase },
    "@/lib/clients/data": { getClient: async () => ({ id: clientId }) },
    "@/lib/agents/data": { getAgentById: async () => ({ id: agentId, name: "Agent Ads", agent_type: agentType, status: active ? "Actif" : "En pause", enabled: active }), listClientsForAgent: async () => assigned ? [{ client_id: clientId, enabled: true }] : [] },
    "@/lib/agents/validation": { isAgentUuid: (id) => /^[\da-f-]{36}$/.test(id) },
    "@/lib/audit-logs": { writeAuditLog: async (entry) => audits.push(entry) },
    "@/lib/agent-runs/data": {
      createAgentRun: async (input) => { runs.push({ ...input, status: "running" }); return { ok: true, run: { id: connectionId } }; },
      completeAgentRun: async (_id, summary) => { runs.at(-1).status = "completed"; runs.at(-1).summary = summary; return { ok: true }; },
      failAgentRun: async () => { runs.at(-1).status = "failed"; return { ok: true }; },
    },
    "@/lib/recommendations/data": { createRecommendation: async (input) => { if (recommendationFails) return { ok: false, message: "unit" }; recommendations.push(input); return { ok: true, recommendation: { id: connectionId } }; } },
    "./client": { createGoogleAdsReadClient: () => readClient, GoogleAdsError: clientModule.GoogleAdsError, normalizeMetrics: clientModule.normalizeMetrics },
    "./validation": validation, "./periods": periods, "./scope": scopes, "./dashboard": dashboard,
    "./tracking": { loadCampaignTracking: async () => ({ available: true, revision: 0, ids: null }) },
    "@/lib/ai/providers": { selectAIProvider: () => null },
    "./ai-analysis": {},
    "./context-service": { getAdsBusinessContext: async () => ({ available: true, revision: 0, context: null }) },
    "./analysis-state": { reserveAdsAnalysis: async () => ({ acquired: true, release: async () => {} }), saveAdsAnalysisMetadata: async (_id, _client, _agent, metadata) => { runs.at(-1).metadata = JSON.parse(JSON.stringify(metadata)); } },
  });
  return { service, calls, audits, recommendations, runs, changes };
}

test("missing Google Ads configuration is refused without a request or secret exposure", async () => {
  const context = transport();
  await assert.rejects(() => context.client.getAccountSummary(account.id), /indisponible/);
  assert.equal(context.calls.filter((call) => call?.url).length, 0);
  assert.match(JSON.stringify(context.client), /^\{\}$/);
});

test("customer ids are strictly normalized and GAQL dates are bounded", () => {
  assert.equal(validation.normalizeCustomerId("123-456-7890"), account.id);
  for (const value of ["1", "1234567890 OR 1=1", "123 456 7890", {}, "12345678901"]) assert.equal(validation.normalizeCustomerId(value), null);
  const period = validation.getAdsPeriod("America/New_York", 30, new Date("2026-10-03T01:00:00Z"));
  assert.equal(period.start, "2026-09-02");
  assert.equal(period.end, "2026-10-01");
  assert.match(queries.campaignPerformanceQuery(period), /BETWEEN '2026-09-02' AND '2026-10-01'/);
  assert.throws(() => queries.campaignPerformanceQuery({ ...period, start: "' OR 1=1" }));
  assert.throws(() => validation.getAdsPeriod("UTC", 0));
});

test("REST reads paginate, normalize micros and never use a Google Ads write endpoint", async () => {
  let inventoryPages = 0;
  const context = transport({ env: fakeEnv, respond: async (url, options) => {
    if (url.includes("oauth2")) return response({ access_token: "unit-access" });
    const body = JSON.parse(options.body);
    if (body.query === queries.accountSummaryQuery) return response({ results: [{ customer: { id: account.id, descriptiveName: account.name, currencyCode: account.currency, timeZone: account.timezone } }] });
    if (body.query === queries.campaignsQuery) {
      inventoryPages++;
      return inventoryPages === 1 ? response({ results: [], nextPageToken: "page-2" }) : response({ results: [{ campaign: { id: "123", name: "Campagne", status: "ENABLED", advertisingChannelType: "SEARCH", startDateTime: "2026-01-01 00:00:00" }, campaignBudget: { amountMicros: "10000000" } }] });
    }
    return response({ results: [{ campaign: { id: "123" }, metrics: { costMicros: "50000000", clicks: "20", impressions: "1000", conversions: 2, conversionsValue: 30, ctr: 0.02, averageCpc: 2500000 } }] });
  } });
  const loaded = await context.client.getAccountSummary(account.id, "9876543210");
  const data = await context.client.getCampaignPerformance(loaded, validation.getAdsPeriod(loaded.timezone));
  assert.equal(inventoryPages, 2);
  assert.equal(data.campaigns[0].budget, 10);
  assert.equal(data.campaigns[0].startDate, "2026-01-01 00:00:00");
  assert.equal(data.totals.cost, 50);
  assert.equal(data.totals.averageCpc, 2.5);
  assert.equal(data.totals.costPerConversion, 25);
  assert.equal(context.normalizeMetrics().conversions, null);
  const adsCalls = context.calls.filter((call) => call?.url?.includes("googleads"));
  assert.ok(adsCalls.every((call) => call.url.endsWith("/googleAds:search")));
  assert.ok(adsCalls.every((call) => !("developer-token" in call.options.headers)));
  assert.equal("mutate" in context.client, false);
  assert.doesNotMatch(JSON.stringify(context.logs), /unit-secret|unit-refresh|unit-access/);
});

test("Google errors do not expose response bodies or credentials", async () => {
  const context = transport({ env: fakeEnv, respond: async (url) => url.includes("oauth2") ? response({ access_token: "unit-access" }) : response({ message: "unit-secret unit-access private error" }, 403) });
  await assert.rejects(() => context.client.getAccountSummary(account.id), (error) => error.kind === "access" && !error.message.includes("unit-secret"));
  assert.doesNotMatch(JSON.stringify(context.logs), /unit-secret|unit-refresh|unit-access|private error/);
});

test("connection saves only non-sensitive metadata and tests the accessible account", async () => {
  const context = serviceSetup({ connectionExists: false });
  assert.equal((await context.service.saveGoogleAdsConnection(clientId, "bad")).ok, undefined);
  assert.equal(context.changes.length, 0);
  assert.equal((await context.service.saveGoogleAdsConnection(clientId, "123-456-7890", "987-654-3210")).ok, true);
  assert.equal(context.changes[0].status, "disconnected");
  assert.equal((await context.service.testGoogleAdsConnection(clientId)).ok, true);
  assert.equal(context.changes.at(-1).status, "connected");
  assert.equal(context.changes.at(-1).metadata.currency_code, "USD");
  assert.ok(context.changes.at(-1).last_checked_at);
  assert.doesNotMatch(JSON.stringify([context.changes, context.audits]), /refresh_token|access_token|client_secret/);
  assert.ok(context.audits.some((item) => item.action === "google_ads.connection_created"));
  assert.ok(context.audits.some((item) => item.action === "google_ads.connection_tested"));
});

test("inaccessible accounts fail a connection test with safe metadata", async () => {
  const context = serviceSetup({ googleError: true });
  const result = await context.service.testGoogleAdsConnection(clientId);
  assert.equal(result.ok, undefined);
  assert.equal(context.changes.at(-1).status, "error");
  assert.ok(context.audits.some((item) => item.action === "google_ads.connection_failed"));
  assert.doesNotMatch(JSON.stringify([context.changes, context.audits]), /must-not-forward|refresh_token/);
});

test("analysis refuses missing connections, inactive agents and inactive assignments before creating a run", async () => {
  for (const options of [{ connectionExists: false }, { connected: false }, { assigned: false }, { active: false }, { agentType: "seo" }]) {
    const context = serviceSetup(options);
    assert.equal((await context.service.runGoogleAdsAnalysis(agentId, clientId)).ok, undefined);
    assert.equal(context.runs.length, 0);
    assert.equal(context.calls.some((call) => Array.isArray(call) && call[0] === "account"), false);
  }
});

test("a read-only run creates a recommendation only for an observed signal and audits its lifecycle", async () => {
  const context = serviceSetup();
  const result = await context.service.runGoogleAdsAnalysis(agentId, clientId);
  assert.equal(result.ok, true);
  assert.equal(context.runs[0].metadata.run_type, "google_ads_read_only");
  assert.equal(context.runs[0].status, "completed");
  assert.equal(context.recommendations.length, 1);
  assert.equal(context.recommendations[0].payload.source, "google_ads_read_only");
  for (const action of ["google_ads.analysis_started", "google_ads.analysis_completed", "google_ads.recommendation_created"]) assert.ok(context.audits.some((item) => item.action === action));
  assert.doesNotMatch(JSON.stringify([context.recommendations, context.audits]), /refresh_token|must-not-forward|Authorization/);
});

test("no signal completes a run without inventing a recommendation", async () => {
  const context = serviceSetup({ signal: false });
  assert.equal((await context.service.runGoogleAdsAnalysis(agentId, clientId)).ok, true);
  assert.equal(context.recommendations.length, 0);
  assert.match(context.runs[0].summary, /aucun signal/);
  assert.equal(context.service.findAdsAnomalies([{ ...campaign, metrics: { ...metrics, conversions: null } }]).length, 0);
});

test("Google read failures are audited without a run or recommendation; later failures mark the run failed", async () => {
  for (const options of [{ googleError: true }, { dashboardError: "quota" }]) {
    const context = serviceSetup(options);
    assert.equal((await context.service.runGoogleAdsAnalysis(agentId, clientId)).ok, undefined);
    assert.equal(context.runs.length, 0);
    assert.equal(context.recommendations.length, 0);
    assert.ok(context.audits.some((item) => item.action === "google_ads.analysis_failed"));
  }
  const context = serviceSetup({ recommendationFails: true });
  assert.equal((await context.service.runGoogleAdsAnalysis(agentId, clientId)).ok, undefined);
  assert.equal(context.runs[0].status, "failed");
  assert.ok(context.audits.some((item) => item.action === "google_ads.analysis_failed" && item.metadata.run_id));
});

test("non-admin cannot reach storage or the Google Ads transport", async () => {
  const context = serviceSetup({ deny: true });
  for (const operation of [() => context.service.getGoogleAdsConnection(clientId), () => context.service.saveGoogleAdsConnection(clientId, account.id), () => context.service.testGoogleAdsConnection(clientId), () => context.service.buildGoogleAdsAnalysisContext(clientId), () => context.service.runGoogleAdsAnalysis(agentId, clientId)]) await assert.rejects(operation, /denied/);
  assert.ok(context.calls.every((call) => call === "auth"));
  const deniedTransport = transport({ deny: true, env: fakeEnv });
  await assert.rejects(() => deniedTransport.client.getAccountSummary(account.id), /denied/);
  assert.ok(deniedTransport.calls.every((call) => call === "auth"));
});

test("client components cannot import the Google Ads transport or server credentials", () => {
  function inspect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
      if (entry.isDirectory()) inspect(path);
      else if (/\.tsx?$/.test(entry.name)) {
        const source = readFileSync(path, "utf8");
        if (/^["']use client["']/.test(source)) assert.doesNotMatch(source, /GOOGLE_ADS_(CLIENT_SECRET|REFRESH_TOKEN)|integrations\/google-ads\/(client|service)|googleads\.googleapis\.com/);
      }
    }
  }
  inspect(new URL("../components/", import.meta.url));
  inspect(new URL("../app/", import.meta.url));
});
