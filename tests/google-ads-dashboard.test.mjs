// Tableau de bord Google Ads, périmètres, rapports à périmètre figé : tests avec fournisseur SIMULÉ
// (aucun appel réseau réel ; aucune vérification sur un compte Google Ads réel).
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const clientId = "d94e386a-653e-478b-80f1-05d442baed92";
const agentId = "c7d93a42-4db1-4eb3-9b0a-3dcbeb4bd879";
const reportId = "2e3bf5a8-040e-4d12-91be-6a2da2f99ef0";
const account = { id: "1234567890", name: "Compte", currency: "EUR", timezone: "America/New_York" };
const metrics = { impressions: 1000, clicks: 20, cost: 50, conversions: 0, conversionValue: 0, ctr: 0.02, averageCpc: 2.5, costPerConversion: null };
const plain = (value) => JSON.parse(JSON.stringify(value));

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
const reportBuilder = load("lib/reports/google-ads.ts", { "@/lib/integrations/google-ads/dashboard": dashboard, "@/lib/integrations/google-ads/periods": periods });

function response(body, status = 200) { return { ok: status < 400, status, headers: new Headers(), json: async () => body }; }
function transport(respond) {
  const calls = [];
  const adsModule = load("lib/integrations/google-ads/client.ts", { "@/lib/require-admin": { requireAdmin: async () => { calls.push("auth"); } }, "./queries": queries, "./validation": validation }, {
    process: { env: { GOOGLE_ADS_CLIENT_ID: "unit-client", GOOGLE_ADS_CLIENT_SECRET: "unit-secret", GOOGLE_ADS_REFRESH_TOKEN: "unit-refresh" } },
    fetch: async (url, options) => { calls.push({ url, options }); return url.includes("oauth2") ? response({ access_token: "unit-access" }) : respond(JSON.parse(options.body).query); },
  });
  return { adsModule, client: adsModule.createGoogleAdsReadClient(), calls };
}

const inventory = [
  { id: "123", name: "Search actif", status: "ENABLED", type: "SEARCH", subType: null, budget: { amount: 10, shared: false, period: "DAILY" } },
  { id: "456", name: "Search en pause", status: "PAUSED", type: "SEARCH", subType: null, budget: { amount: 5, shared: true, period: "DAILY" } },
  { id: "789", name: "LSA", status: "ENABLED", type: "LOCAL_SERVICES", subType: null, budget: { amount: null, shared: null, period: null } },
  { id: "321", name: "Search sans diffusion", status: "ENABLED", type: "SEARCH", subType: null, budget: { amount: 3, shared: false, period: "DAILY" } },
  { id: "654", name: "Supprimée sans activité", status: "REMOVED", type: "SEARCH", subType: null, budget: { amount: 1, shared: false, period: "DAILY" } },
  { id: "987", name: "PMax", status: "ENABLED", type: "PERFORMANCE_MAX", subType: null, budget: { amount: 20, shared: false, period: "DAILY" } },
];
const rawDashboard = (previous = false) => ({
  inventory,
  current: { 123: metrics, 456: { ...metrics, impressions: 100, clicks: 2, cost: 7, conversions: 1 }, 987: { ...metrics, cost: 3, conversions: 2 } },
  previous: previous ? { 123: { ...metrics, cost: 40 } } : null,
  accountTotals: { ...metrics, impressions: 2100, clicks: 42, cost: 60, conversions: 3 }, accountPrevious: previous ? metrics : null,
  leads: { available: false, reason: "Accès refusé à la ressource des leads Local Services." },
});

function serviceSetup({ deny = false, connected = true, dashboardError = null } = {}) {
  const calls = [], audits = [], recommendations = [], runs = [];
  const connection = { id: "dcdd86a2-66c2-4714-bc20-7e50c48288de", client_id: clientId, provider: "google_ads", external_account_id: account.id, status: connected ? "connected" : "disconnected", metadata: { auth_strategy: "single_user", connection_version: 1, manager_customer_id: "9876543210" }, last_checked_at: null, created_at: "2026-01-01", updated_at: "2026-01-01" };
  const clientModule = transport(async () => response({}));
  const readClient = {
    getAccountSummary: async () => { calls.push("account"); return account; },
    getCampaignDashboard: async (...args) => { calls.push(["dashboard", ...plain(args)]); if (dashboardError) throw new clientModule.adsModule.GoogleAdsError(dashboardError); return rawDashboard(Boolean(args[2])); },
  };
  const supabase = { from: (table) => { calls.push(["db", table]); const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: connection, error: null }) }; return query; } };
  const service = load("lib/integrations/google-ads/service.ts", {
    "@/lib/require-admin": { requireAdmin: async () => { calls.push("auth"); if (deny) throw new Error("denied"); return { userId: "unit-admin" }; } },
    "@/lib/supabase/server": { getSupabaseServerClient: () => supabase },
    "@/lib/clients/data": { getClient: async () => ({ id: clientId }) },
    "@/lib/agents/data": { getAgentById: async () => ({ id: agentId, name: "Agent Ads", agent_type: "google-ads", status: "Actif", enabled: true }), listClientsForAgent: async () => [{ client_id: clientId, enabled: true }] },
    "@/lib/agents/validation": { isAgentUuid: (id) => /^[\da-f-]{36}$/.test(id) },
    "@/lib/audit-logs": { writeAuditLog: async (entry) => audits.push(entry) },
    "@/lib/agent-runs/data": {
      createAgentRun: async (input) => { runs.push({ ...input, status: "running" }); return { ok: true, run: { id: "run-1" } }; },
      completeAgentRun: async (_id, summary) => { runs.at(-1).status = "completed"; runs.at(-1).summary = summary; return { ok: true }; },
      failAgentRun: async () => { runs.at(-1).status = "failed"; return { ok: true }; },
    },
    "@/lib/recommendations/data": { createRecommendation: async (input) => { recommendations.push(input); return { ok: true, recommendation: { id: "reco-1" } }; } },
    "./client": { createGoogleAdsReadClient: () => readClient, GoogleAdsError: clientModule.adsModule.GoogleAdsError, normalizeMetrics: clientModule.adsModule.normalizeMetrics },
    "./validation": validation, "./periods": periods, "./scope": scopes, "./dashboard": dashboard,
    "./tracking": { loadCampaignTracking: async () => ({ available: true, revision: 0, ids: null }) },
    "@/lib/ai/providers": { selectAIProvider: () => null },
    "./ai-analysis": {},
    "./context-service": { getAdsBusinessContext: async () => ({ available: true, revision: 0, context: null }) },
    "./analysis-state": { reserveAdsAnalysis: async () => ({ acquired: true, release: async () => {} }), saveAdsAnalysisMetadata: async (_id, _client, _agent, metadata) => { runs.at(-1).metadata = plain(metadata); } },
  });
  return { service, calls, audits, recommendations, runs };
}
const filters = (overrides = {}) => ({ ...plain(dashboard.DEFAULT_FILTERS), ...overrides });
const fixedNow = new Date("2026-10-10T12:00:00Z");

// --- Périodes et fuseaux ------------------------------------------------------------------------

test("presets resolve in the account time zone; rolling periods exclude today", () => {
  const now = new Date("2026-10-10T22:30:00Z"); // Paris : 11 oct. 00:30 ; New York : 10 oct. 18:30
  assert.equal(periods.todayIn("Europe/Paris", now), "2026-10-11");
  assert.equal(periods.todayIn("America/New_York", now), "2026-10-10");
  const paris = (preset) => plain(periods.resolvePeriod({ preset }, "Europe/Paris", now));
  assert.deepEqual([paris("today").start, paris("today").end, paris("today").includesToday], ["2026-10-11", "2026-10-11", true]);
  assert.deepEqual([paris("yesterday").start, paris("yesterday").end], ["2026-10-10", "2026-10-10"]);
  assert.deepEqual([paris("last_7").start, paris("last_7").end, paris("last_7").days, paris("last_7").includesToday], ["2026-10-04", "2026-10-10", 7, false]);
  assert.deepEqual([paris("last_14").days, paris("last_30").days, paris("last_90").days], [14, 30, 90]);
  assert.deepEqual([paris("this_week").start, paris("this_week").end, paris("this_week").includesToday], ["2026-10-05", "2026-10-11", true]); // dimanche 11 → lundi 5
  assert.deepEqual([paris("last_week").start, paris("last_week").end], ["2026-09-28", "2026-10-04"]);
  assert.deepEqual([paris("this_month").start, paris("this_month").end], ["2026-10-01", "2026-10-11"]);
  assert.deepEqual([paris("last_month").start, paris("last_month").end, paris("last_month").days], ["2026-09-01", "2026-09-30", 30]);
  const newYork = plain(periods.resolvePeriod({ preset: "last_7" }, "America/New_York", now));
  assert.deepEqual([newYork.start, newYork.end], ["2026-10-03", "2026-10-09"]);
});

test("daylight saving changes never shift dates or day counts", () => {
  const spring = new Date("2026-03-29T00:30:00Z"); // Paris passe à l'heure d'été à 01:00 UTC
  const period = plain(periods.resolvePeriod({ preset: "last_7" }, "Europe/Paris", spring));
  assert.deepEqual([period.start, period.end, period.days], ["2026-03-22", "2026-03-28", 7]);
  const autumn = plain(periods.resolvePeriod({ preset: "custom", start: "2026-10-20", end: "2026-10-31" }, "Europe/Paris", new Date("2026-11-02T12:00:00Z")));
  assert.equal(autumn.days, 12);
  assert.deepEqual(plain(periods.previousPeriod({ start: "2026-03-01", end: "2026-03-31", days: 31 })), { start: "2026-01-29", end: "2026-02-28", days: 31 });
  assert.deepEqual(plain(periods.previousPeriod({ start: "2026-10-04", end: "2026-10-10", days: 7 })), { start: "2026-09-27", end: "2026-10-03", days: 7 });
});

test("custom periods are validated server-side with explicit bounds", () => {
  const resolve = (selection) => periods.resolvePeriod(selection, "Europe/Paris", fixedNow);
  assert.throws(() => resolve({ preset: "day", date: "2026-02-30" }), /date valide/);
  assert.throws(() => resolve({ preset: "custom", start: "2026-10-05" }), /début et une date de fin/);
  assert.throws(() => resolve({ preset: "custom", start: "2026-10-05", end: "2026-10-01" }), /précède/);
  assert.throws(() => resolve({ preset: "custom", start: "2026-10-05", end: "2026-10-11" }), /s’arrêtent aujourd’hui/);
  assert.throws(() => resolve({ preset: "custom", start: "2025-10-09", end: "2026-10-10" }), /366 jours/);
  assert.equal(plain(resolve({ preset: "custom", start: "2025-10-10", end: "2026-10-10" })).days, 366);
  assert.throws(() => resolve({ preset: "custom", start: "2023-01-01", end: "2023-01-31" }), /3 ans/);
  assert.throws(() => resolve({ preset: "bogus" }), /inconnue/);
  assert.equal(plain(resolve({ preset: "day", date: "2026-10-10" })).includesToday, true);
  assert.equal(periods.describeDates({ start: "2026-10-04", end: "2026-10-10", days: 7 }), "du 4 oct. 2026 au 10 oct. 2026");
  assert.equal(periods.describeDates({ start: "2026-10-10", end: "2026-10-10", days: 1 }), "le 10 oct. 2026");
  assert.throws(() => validation.validatePeriod({ start: "2025-01-01", end: "2026-10-10", days: 648 }));
});

// --- Filtres dans l'URL ---------------------------------------------------------------------

test("URL filters keep the tab and other params, drop the legacy ads_days and round-trip", () => {
  const current = new URLSearchParams("tab=ads&view=x&ads_days=7");
  assert.equal(dashboard.writeFilters(current, filters()).toString(), "tab=ads&view=x");
  const chosen = filters({ period: { preset: "custom", start: "2026-09-01", end: "2026-09-30" }, compare: true, status: "all", types: ["SEARCH", "LOCAL_SERVICES"], campaigns: ["123"] });
  const written = dashboard.writeFilters(current, chosen);
  assert.equal(written.get("tab"), "ads");
  assert.equal(written.get("ads_days"), null);
  assert.deepEqual(plain(dashboard.parseFilters(written)), chosen);
  assert.deepEqual(plain(dashboard.parseFilters({ tab: "ads", ads_period: "last_7" })).period, { preset: "last_7" });
});

test("invalid URL values fall back to safe defaults", () => {
  const parsed = plain(dashboard.parseFilters(new URLSearchParams("ads_period=bogus&ads_status=deleted&ads_types=SEARCH,bad-type,search&ads_campaigns=123,abc,123,1%20OR%201")));
  assert.deepEqual(parsed, { period: { preset: "last_30" }, compare: false, status: "enabled", types: ["SEARCH"], campaigns: ["123"] });
});

test("only a period or comparison change triggers a reload; stale responses are ignored", () => {
  const base = filters();
  const key = dashboard.periodKey(base);
  assert.equal(dashboard.periodKey({ ...base, status: "all", types: ["SEARCH"], campaigns: ["123"] }), key);
  assert.notEqual(dashboard.periodKey({ ...base, period: { preset: "last_7" } }), key);
  assert.notEqual(dashboard.periodKey({ ...base, compare: true }), key);
  const tracker = dashboard.createRequestTracker();
  const first = tracker.start(), second = tracker.start();
  assert.equal(tracker.isLatest(first), false);
  assert.equal(tracker.isLatest(second), true);
});

test("the dashboard updates the URL with pushState and never navigates or submits a GET form", () => {
  const source = readFileSync(new URL("../components/google-ads/campaign-dashboard.tsx", import.meta.url), "utf8");
  assert.match(source, /history\.pushState/);
  assert.match(source, /popstate/);
  assert.doesNotMatch(source, /method="get"|router\.(push|replace)|location\.(assign|href\s*=)/);
  const panel = readFileSync(new URL("../components/clients/google-ads-panel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(panel, /ads_days|method="get"/);
  assert.match(panel, /advertising\?client=/);
});

// --- Campagnes, totaux, Search / Local Services --------------------------------------------

test("campaign rows: zero activity is explicit, Local Services metrics stay unavailable, removed campaigns without activity are dropped", () => {
  const { service } = serviceSetup();
  const rows = plain(service.buildCampaignRows(rawDashboard()));
  assert.deepEqual(rows.map((row) => row.id), ["123", "456", "789", "321", "987"]);
  const lsa = rows.find((row) => row.id === "789");
  assert.equal(lsa.localServices, true);
  assert.equal(lsa.hasActivity, false);
  assert.deepEqual([lsa.metrics.cost, lsa.metrics.clicks, lsa.metrics.conversions], [null, null, null]);
  const idle = rows.find((row) => row.id === "321");
  assert.deepEqual([idle.hasActivity, idle.metrics.cost], [false, 0]);
  assert.equal(rows.find((row) => row.id === "456").budget.shared, true);
  // Local Services est identifié par le type API, jamais par le nom.
  const renamed = plain(service.buildCampaignRows({ ...rawDashboard(), inventory: [{ ...inventory[0], name: "Local Services leads" }] }));
  assert.equal(renamed[0].localServices, false);
  const removedWithSpend = plain(service.buildCampaignRows({ ...rawDashboard(), current: { 654: metrics } }));
  assert.ok(removedWithSpend.some((row) => row.id === "654"));
});

test("filtered totals equal exactly the selected campaigns; the account total stays separate", () => {
  const { service } = serviceSetup();
  const rows = plain(service.buildCampaignRows(rawDashboard()));
  const pick = (f) => dashboard.filterCampaigns(rows, { status: "enabled", types: [], campaigns: [], ...f });
  assert.deepEqual(pick({}).map((row) => row.id), ["123", "789", "321", "987"]);
  assert.deepEqual(pick({ status: "paused" }).map((row) => row.id), ["456"]); // en pause aujourd'hui, dépenses passées
  assert.deepEqual(pick({ status: "all", types: ["SEARCH"] }).map((row) => row.id), ["123", "456", "321"]);
  assert.deepEqual(pick({ status: "all", campaigns: ["456", "987"] }).map((row) => row.id), ["456", "987"]);

  const search = plain(dashboard.sumCampaigns(pick({ types: ["SEARCH"] })));
  assert.deepEqual([search.metrics.cost, search.metrics.clicks, search.metrics.impressions], [50, 20, 1000]);
  assert.equal(search.metrics.ctr, 0.02);
  assert.deepEqual(search.incomplete, []);
  const withLsa = plain(dashboard.sumCampaigns(pick({})));
  assert.equal(withLsa.metrics.cost, 53); // 50 + 0 + 3 ; LSA indisponible n'est pas compté comme zéro…
  assert.ok(withLsa.incomplete.includes("cost")); // …et le total est signalé partiel.
  const onlyLsa = plain(dashboard.sumCampaigns(pick({ types: ["LOCAL_SERVICES"] })));
  assert.equal(onlyLsa.metrics.cost, null);

  const all = plain(dashboard.sumCampaigns(rows)).metrics;
  assert.equal(all.cost, 60);
  assert.deepEqual(plain(dashboard.reconcile({ ...metrics, impressions: 2100, clicks: 42, cost: 60, conversions: 3 }, all)), []);
  // Un écart (ex. campagne supprimée hors inventaire) est signalé, jamais masqué.
  const gaps = plain(dashboard.reconcile({ ...metrics, impressions: 2500, clicks: 42, cost: 64.5, conversions: 3 }, all));
  assert.deepEqual(gaps.map((gap) => [gap.metric, gap.difference]), [["cost", 4.5], ["impressions", 400]]);
  assert.deepEqual(plain(dashboard.reconcile(all, all)), []);
});

test("Search and Local Services are grouped separately; scope wording is explicit", () => {
  const { service } = serviceSetup();
  const rows = plain(service.buildCampaignRows(rawDashboard()));
  assert.deepEqual(plain(dashboard.groupByType(rows)).map((group) => group.label), ["Search", "Local Services", "Performance Max"]);
  const one = dashboard.filterCampaigns(rows, { status: "enabled", types: ["SEARCH"], campaigns: ["123"] });
  assert.equal(dashboard.describeScope(one, { status: "enabled", types: ["SEARCH"], campaigns: ["123"] }), "1 campagne Search active sélectionnée");
  assert.equal(dashboard.describeScope(dashboard.filterCampaigns(rows, { status: "enabled", types: ["SEARCH"], campaigns: [] }), { status: "enabled", types: ["SEARCH"], campaigns: [] }), "2 campagnes Search actives");
  assert.equal(dashboard.change(110, 100), 0.1);
  assert.equal(dashboard.change(5, 0), null);
  assert.equal(dashboard.change(null, 3), null);
});

// --- Chargement serveur -------------------------------------------------------------------------

test("dashboard loading checks admin, client and its connected account, and resolves the period in the account time zone", async () => {
  const ok = serviceSetup();
  const result = plain(await ok.service.loadCampaignDashboard(clientId, filters({ period: { preset: "last_7" } }), fixedNow));
  assert.equal(result.ok, true);
  assert.deepEqual([result.data.period.start, result.data.period.end, result.data.period.includesToday], ["2026-10-03", "2026-10-09", false]);
  assert.equal(result.data.previousPeriod, null);
  assert.equal(ok.calls[0], "auth");
  const compared = plain(await ok.service.loadCampaignDashboard(clientId, filters({ compare: true }), fixedNow));
  assert.deepEqual(compared.data.previousPeriod, { start: "2026-08-11", end: "2026-09-09", days: 30 });
  assert.equal(compared.data.campaigns.find((row) => row.id === "123").previous.cost, 40);

  assert.deepEqual(plain(await ok.service.loadCampaignDashboard("not-a-uuid", filters(), fixedNow)), { ok: false, message: "Client invalide." });
  const disconnected = serviceSetup({ connected: false });
  assert.match((await disconnected.service.loadCampaignDashboard(clientId, filters(), fixedNow)).message, /tester/);
  assert.equal(disconnected.calls.includes("account"), false);
  const future = serviceSetup();
  const refused = plain(await future.service.loadCampaignDashboard(clientId, filters({ period: { preset: "custom", start: "2026-10-01", end: "2026-10-20" } }), fixedNow));
  assert.match(refused.message, /s’arrêtent aujourd’hui/);
  assert.equal(future.calls.some((call) => Array.isArray(call) && call[0] === "dashboard"), false);
});

test("API errors return a readable message and never stale figures", async () => {
  for (const [kind, pattern] of [["quota", /Quota/], ["access", /Accès refusé/], ["authentication", /OAuth/], ["unavailable", /ne répond pas/], ["response", /inattendue/]]) {
    const context = serviceSetup({ dashboardError: kind });
    const result = plain(await context.service.loadCampaignDashboard(clientId, filters(), fixedNow));
    assert.equal(result.ok, false);
    assert.match(result.message, pattern);
    assert.equal("data" in result, false);
  }
  const denied = serviceSetup({ deny: true });
  await assert.rejects(() => denied.service.loadCampaignDashboard(clientId, filters(), fixedNow), /denied/);
  assert.deepEqual(denied.calls, ["auth"]);
});

// --- Périmètre des analyses -------------------------------------------------------------------

const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

test("scopes are strictly parsed and bound to campaigns of the client's account", () => {
  const valid = { start: "2026-09-01", end: "2026-09-30", status: "all", types: ["SEARCH"], campaignIds: ["123", "456"] };
  assert.deepEqual(plain(scopes.parseScope(valid)), valid);
  for (const invalid of [{ ...valid, extra: 1 }, { ...valid, campaignIds: [] }, { ...valid, campaignIds: ["123", "123"] }, { ...valid, campaignIds: ["12a"] },
    { ...valid, campaignIds: Array.from({ length: 51 }, (_, index) => String(index)) }, { ...valid, end: "2026-08-01" }, { ...valid, start: "2025-01-01" },
    { ...valid, status: "removed" }, { ...valid, types: ["search"] }, null, [], "scope"]) assert.equal(scopes.parseScope(invalid), null);
  const stored = plain(scopes.storeScope(valid, [{ id: "123", name: "A" }, { id: "456", name: "B" }, { id: "789", name: "C" }], { days: 30, timezone: "Europe/Paris", currency: "EUR", accountId: account.id }));
  assert.deepEqual(stored.campaignNames, { 123: "A", 456: "B" });
  assert.equal(scopes.isStoredScope(stored), true);
  assert.equal(scopes.isStoredScope({ ...stored, accountId: "x" }), false);
  assert.equal(scopes.storeScope({ ...valid, campaignIds: ["999"] }, [{ id: "123", name: "A" }], { days: 30, timezone: "UTC", currency: "EUR", accountId: account.id }), null);
});

test("a real analysis stores its exact scope in the run and the recommendation and says it is deterministic, not AI", async () => {
  const context = serviceSetup();
  const scope = { start: day(-30), end: day(-2), status: "all", types: ["SEARCH"], campaignIds: ["123", "456", "789"] };
  const result = await context.service.runGoogleAdsAnalysis(agentId, clientId, { scope });
  assert.equal(result.ok, true);
  const run = plain(context.runs[0]);
  assert.equal(run.metadata.engine, "deterministic");
  assert.deepEqual(run.metadata.scope.campaignIds, ["123", "456", "789"]);
  assert.deepEqual([run.metadata.scope.start, run.metadata.scope.end, run.metadata.scope.accountId], [scope.start, scope.end, account.id]);
  const recommendation = plain(context.recommendations[0]);
  assert.deepEqual(recommendation.payload.scope, run.metadata.scope);
  assert.deepEqual(recommendation.payload.signals.map((signal) => signal.campaignId), ["123"]); // 456 a converti ; LSA exclu
  assert.match(recommendation.reason, /sans IA/);
  assert.match(run.summary, /sans IA/);
  assert.doesNotMatch(JSON.stringify([run, recommendation]), /\bIA personnalisée|GPT|Claude/);

  const unknown = serviceSetup();
  assert.match((await unknown.service.runGoogleAdsAnalysis(agentId, clientId, { scope: { ...scope, campaignIds: ["999"] } })).message, /inconnue/);
  assert.equal(unknown.runs.length, 0);
  assert.equal(context.service.isGoogleAdsAgent({ name: "Ads Agent", agent_type: "seo" }), false);
  assert.equal(context.service.isGoogleAdsAgent({ name: "Nom libre", agent_type: "google-ads" }), true);
  assert.match(context.service.ANALYSIS_ENGINE_NOTE, /IA facultative.*instructions globales/);
});

// --- Transport : lecture seule, Local Services --------------------------------------------------

test("campaign dashboard reads use only googleAds:search, keep shared budgets and never invent Local Services leads", async () => {
  const leadsRows = [{ localServicesLead: { leadType: "PHONE_CALL" } }, { localServicesLead: { leadType: "MESSAGE" } }];
  let leadsStatus = 200;
  const { client, calls } = transport(async (query) => {
    if (query === queries.campaignInventoryQuery) return response({ results: [
      { campaign: { id: "123", name: "Search", status: "ENABLED", advertisingChannelType: "SEARCH" }, campaignBudget: { amountMicros: "12500000", explicitlyShared: true, period: "DAILY" } },
      { campaign: { id: "789", name: "LSA", status: "ENABLED", advertisingChannelType: "LOCAL_SERVICES" } },
    ] });
    if (query.includes("FROM local_services_lead")) return leadsStatus === 200 ? response({ results: leadsRows }) : response({ error: "private" }, leadsStatus);
    if (query.includes("FROM customer")) return response({ results: [{ metrics: { costMicros: "60000000", clicks: "42", impressions: "2100", conversions: 3 } }] });
    return response({ results: [{ campaign: { id: "123" }, metrics: { costMicros: "50000000", clicks: "20", impressions: "1000", conversions: 0 } }] });
  });
  const period = { start: "2026-09-01", end: "2026-09-30", days: 30 };
  const raw = plain(await client.getCampaignDashboard(account, period, null, "9876543210"));
  assert.deepEqual(raw.inventory[0].budget, { amount: 12.5, shared: true, period: "DAILY" });
  assert.deepEqual(raw.inventory[1].budget, { amount: null, shared: null, period: null });
  assert.equal(raw.current[123].cost, 50);
  assert.equal(raw.accountTotals.cost, 60);
  assert.deepEqual(raw.leads, { available: true, total: 2, byType: { PHONE_CALL: 1, MESSAGE: 1 }, charged: null });
  leadsStatus = 403;
  const denied = plain(await client.getCampaignDashboard(account, period, period, "9876543210"));
  assert.equal(denied.leads.available, false);
  assert.match(denied.leads.reason, /Accès refusé/);
  assert.ok(denied.previous);
  const urls = calls.filter((call) => call?.url).map((call) => call.url);
  assert.ok(urls.every((url) => url.endsWith("/googleAds:search") || url === "https://oauth2.googleapis.com/token"), urls.join());
  assert.doesNotMatch(JSON.stringify(calls.map((call) => call?.options?.body ?? "")), /contact_details|mutate/i);
});

test("GAQL builders only select, are date-bounded and never read lead contact details", () => {
  const period = { start: "2026-09-01", end: "2026-09-30", days: 30 };
  for (const query of [queries.campaignInventoryQuery, queries.campaignMetricsQuery(period), queries.localServicesLeadsQuery(period)]) {
    assert.match(query, /^SELECT /);
    assert.doesNotMatch(query, /contact_details|mutate/i);
  }
  assert.match(queries.localServicesLeadsQuery(period), /creation_date_time >= '2026-09-01 00:00:00' AND .* <= '2026-09-30 23:59:59'/);
  assert.throws(() => queries.localServicesLeadsQuery({ ...period, end: "2026-09-30' OR '1'='1" }));
});

test("the Google Ads integration exposes no write path", () => {
  const directory = new URL("../lib/integrations/google-ads/", import.meta.url);
  for (const file of readdirSync(directory)) {
    const source = readFileSync(new URL(file, directory), "utf8");
    assert.doesNotMatch(source, /:mutate|googleAds:mutate|campaigns:mutate|campaignBudgets|\bmutate\(/, file);
    for (const url of source.match(/https:\/\/[^\s`"']+/g) ?? []) assert.match(url, /^https:\/\/(googleads\.googleapis\.com\/v\d+\/customers\/\$\{customerId\}\/googleAds:search|oauth2\.googleapis\.com\/token)$/, `${file}: ${url}`);
  }
});

// --- Rapports à périmètre figé ------------------------------------------------------------------

const storedScope = { start: "2026-09-01", end: "2026-09-30", days: 30, status: "all", types: [], campaignIds: ["123", "789"], timezone: "Europe/Paris", currency: "EUR", accountId: account.id, campaignNames: { 123: "Search actif", 789: "LSA" } };

test("the Google Ads report content covers exactly its scope, keeps unavailable data unavailable and separates conversion value from revenue", () => {
  const { service } = serviceSetup();
  const rows = plain(service.buildCampaignRows(rawDashboard())).filter((row) => storedScope.campaignIds.includes(row.id));
  const built = plain(reportBuilder.buildGoogleAdsReport({ clientName: "Protection Test", accountName: "Compte", scope: storedScope, rows, leads: { available: false, reason: "Accès refusé" }, includesToday: false }));
  assert.match(built.title, /Rapport Google Ads — Protection Test — du 1 sept\. 2026 au 30 sept\. 2026/);
  assert.match(built.client.summary, /2 campagnes \(1 Search, 1 Local Services\)/);
  assert.match(built.client.summary, /50,00\s€/);
  const internal = JSON.stringify(built.internal);
  assert.match(internal, /Périmètre \(figé\)/);
  assert.match(internal, /Search actif \(ID 123\)/);
  assert.match(internal, /LSA \(ID 789\).*indisponibles/);
  assert.match(internal, /Leads Local Services : indisponibles \(Accès refusé\)/);
  assert.match(internal, /distincte du chiffre d’affaires/);
  assert.match(internal, /Totaux partiels/);
  assert.doesNotMatch(internal, /PMax|Search en pause/);
  assert.equal(built.client.empty, false);
});

function reportServiceSetup({ report = null, insertError = null, dashboard: loaded = null } = {}) {
  const writes = [], audits = [], loads = [];
  const result = (data, error = null) => ({ data, error });
  const supabase = { from: (table) => {
    const state = { table, op: "select", value: null, filters: [] };
    const query = {
      select: () => query, eq: (column, value) => { state.filters.push([column, value]); return query; },
      insert: (value) => { state.op = "insert"; state.value = value; writes.push(state); return query; },
      update: (value) => { state.op = "update"; state.value = value; writes.push(state); return query; },
      single: async () => state.op === "insert" && insertError ? result(null, insertError) : result({ id: reportId }),
      maybeSingle: async () => table === "clients" ? result({ name: "Protection Test" }) : result(report),
      then: (resolve) => resolve(state.op === "update" ? result([{ id: reportId }]) : result(null)),
    };
    return query;
  } };
  const defaultLoad = { ok: true, data: { account: { ...account, currency: "EUR", timezone: "Europe/Paris" }, period: { start: "2026-09-01", end: "2026-09-30", days: 30, includesToday: false }, campaigns: serviceSetup().service.buildCampaignRows(rawDashboard()), leads: null } };
  const adsModule = load("lib/reports/google-ads-service.ts", {
    "@/lib/supabase/server": { getSupabaseServerClient: () => supabase },
    "@/lib/core/audit": { writeAudit: async (_actor, entry) => audits.push(entry) },
    "@/lib/integrations/google-ads/service": { loadCampaignDashboard: async (...args) => { loads.push(plain(args)); return loaded ?? defaultLoad; } },
    "@/lib/integrations/google-ads/dashboard": dashboard,
    "@/lib/integrations/google-ads/scope": scopes,
    "./google-ads": reportBuilder,
  });
  return { adsModule, writes, audits, loads };
}
const admin = { kind: "admin", userId: "unit-admin" };

test("preparing a report stores the explicit scope on the report and its first version", async () => {
  const context = reportServiceSetup();
  const scope = { start: "2026-09-01", end: "2026-09-30", status: "enabled", types: ["SEARCH"], campaignIds: ["123"] };
  const outcome = plain(await context.adsModule.prepareGoogleAdsReport(admin, clientId, scope));
  assert.deepEqual(outcome, { ok: true, id: reportId, version: 1 });
  assert.deepEqual(context.loads[0][1].period, { preset: "custom", start: "2026-09-01", end: "2026-09-30" });
  const [report] = context.writes.map((write) => plain(write));
  assert.equal(report.table, "reports");
  assert.deepEqual([report.value.kind, report.value.period_start, report.value.period_end, report.value.status], ["google_ads", "2026-09-01", "2026-09-30", "ready_for_review"]);
  assert.deepEqual(report.value.scope.campaignIds, ["123"]);
  assert.equal(report.value.scope.accountId, account.id);
  assert.equal(context.writes.length, 1); // snapshot is created atomically by the database trigger
  assert.equal(context.audits[0].metadata.kind, "google_ads");

  const unknown = reportServiceSetup();
  assert.match((await unknown.adsModule.prepareGoogleAdsReport(admin, clientId, { ...scope, campaignIds: ["999"] })).message, /introuvable/);
  assert.equal(unknown.writes.length, 0);
  const premigration = reportServiceSetup({ insertError: { code: "23514" } });
  assert.match((await premigration.adsModule.prepareGoogleAdsReport(admin, clientId, scope)).message, /migration 20261016000000/);
  const failing = reportServiceSetup({ dashboard: { ok: false, message: "Quota de l’API Google Ads atteint : réessayez dans quelques minutes." } });
  assert.match((await failing.adsModule.prepareGoogleAdsReport(admin, clientId, scope)).message, /Quota/);
  assert.equal(failing.writes.length, 0);
});

test("regenerating reuses the STORED scope, never touches it, and refuses sent, archived or re-associated reports", async () => {
  const base = { id: reportId, client_id: clientId, kind: "google_ads", status: "approved", version: 2, scope: storedScope };
  const context = reportServiceSetup({ report: base });
  assert.deepEqual(plain(await context.adsModule.regenerateGoogleAdsReport(admin, reportId)), { ok: true, id: reportId, version: 3 });
  assert.deepEqual(context.loads[0][1].period, { preset: "custom", start: storedScope.start, end: storedScope.end });
  const [update] = context.writes.map((write) => plain(write));
  assert.equal("scope" in update.value || "period_start" in update.value || "kind" in update.value, false);
  assert.deepEqual([update.value.status, update.value.approved_version, update.value.version], ["ready_for_review", null, 3]);
  assert.deepEqual(update.filters, [["id", reportId], ["version", 2]]);
  assert.equal(context.writes.length, 1); // snapshot keeps the stored scope in the database transaction

  for (const status of ["sent", "archived"]) {
    const frozen = reportServiceSetup({ report: { ...base, status } });
    assert.match((await frozen.adsModule.regenerateGoogleAdsReport(admin, reportId)).message, /figé/);
    assert.equal(frozen.loads.length, 0);
  }
  const moved = reportServiceSetup({ report: { ...base, scope: { ...storedScope, accountId: "1111111111" } } });
  assert.match((await moved.adsModule.regenerateGoogleAdsReport(admin, reportId)).message, /a changé/);
  assert.equal(moved.writes.length, 0);
  const weekly = reportServiceSetup({ report: { ...base, kind: "weekly" } });
  assert.equal((await weekly.adsModule.regenerateGoogleAdsReport(admin, reportId)).ok, false);
});

test("recurring report generation stays limited to weekly and monthly", () => {
  const labels = load("lib/reports/labels.ts");
  assert.equal(labels.isRecurringReportKind("google_ads"), false);
  assert.equal(labels.isReportKind("google_ads"), true);
  const actions = readFileSync(new URL("../app/(cockpit)/reports/actions.ts", import.meta.url), "utf8");
  assert.match(actions, /!isRecurringReportKind\(kind\)/);
});

// --- Protection admin --------------------------------------------------------------------------

test("every Google Ads server action checks the admin session first", () => {
  for (const path of ["app/(cockpit)/clients/[id]/google-ads-actions.ts", "app/(cockpit)/agents/[id]/google-ads-actions.ts"]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source, /^"use server";/);
    const bodies = source.split(/\nexport async function /).slice(1);
    assert.ok(bodies.length >= 1, path);
    for (const body of bodies) assert.equal(body.split("\n")[1].trim(), "await requireAdmin();", `${path}: ${body.slice(0, 40)}`);
  }
});
