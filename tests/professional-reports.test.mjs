import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

function load(path, mocks = {}) {
  const exports = {};
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, console: { error() {} }, require(name) {
      if (name === "server-only") return {};
      if (name in mocks) return mocks[name];
      throw Error(`Unexpected dependency: ${name}`);
    },
  });
  return exports;
}
const domain = load("lib/reports/professional.ts", { zod: { z } });
const reportBuild = load("lib/reports/build.ts");
const model = load("lib/integrations/search-console/model.ts");
const periods = load("lib/integrations/google-ads/periods.ts");
const dashboard = load("lib/integrations/google-ads/dashboard.ts", { "./periods": periods });
const scopes = load("lib/integrations/google-ads/scope.ts", { "./periods": periods });
const findings = load("lib/integrations/google-ads/findings.ts");
const adsBuild = load("lib/reports/google-ads.ts", { "@/lib/integrations/google-ads/dashboard": dashboard, "@/lib/integrations/google-ads/periods": periods });
const clientId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";
const input = (source = "website") => ({ clientId, requestId, family: source === "google_ads" ? "ads" : source === "search_console" ? "seo" : source, sources: [source], start: "2026-10-01", end: "2026-10-03" });
const json = value => JSON.parse(JSON.stringify(value));

test("professional schema rejects invalid calendar dates, reversed/oversized periods, duplicates and mixed dedicated families", () => {
  for (const patch of [
    { start: "2026-02-30" }, { end: "2026-99-99" }, { start: "2026-10-04" }, { start: "2025-01-01" },
    { sources: ["website", "website"] }, { sources: ["google_ads"] }, { sources: ["website", "activity"] },
    { requestId: "untrusted" }, { clientId: "untrusted" }, { recipient: "unauthorized@example.test" },
  ]) assert.equal(domain.professionalReportSchema.safeParse({ ...input(), ...patch }).success, false);
  assert.equal(domain.professionalReportSchema.safeParse({ ...input(), start: "2024-02-29", end: "2025-02-28" }).success, true);
  assert.equal(domain.professionalReportSchema.safeParse({ ...input(), family: "global", sources: ["website", "activity"] }).success, true);
});

test("professional builder keeps the ReportContent contract and internal/client separation", () => {
  const built = domain.buildProfessionalReport(input(), "Client réel", [
    { source: "website", state: "partial", lines: ["12 visiteurs"], evidence: ["Période exacte"], internalLines: ["Détail privé"], internalSections: [{ title: "Interne", lines: ["Suivi interne"] }], clientSections: [{ title: "Résultats", lines: ["Résultat client"] }] },
    { source: "google_ads", state: "available", lines: ["Source désélectionnée"], evidence: [] },
  ]);
  for (const content of [built.client, built.internal]) assert.deepEqual(Object.keys(content).sort(), ["empty", "highlights", "sections", "summary"]);
  assert.match(JSON.stringify(built.internal), /Détail privé/);
  assert.doesNotMatch(JSON.stringify(built.client), /Détail privé|Suivi interne|Source désélectionnée/);
  assert.match(JSON.stringify(built.client), /Résultat client|Partiel/);
  const missing = domain.buildProfessionalReport(input(), "Client", []);
  assert.equal(missing.client.empty, true);
  assert.match(JSON.stringify(missing.client), /Indisponible/);
  assert.doesNotMatch(JSON.stringify(missing.client), /0 visiteurs/);
});

function fakeDb(tables, calls) {
  return { from(table) {
    const filters = [], orders = [];
    let limit, range;
    const execute = () => {
      calls.push({ table, filters: [...filters] });
      const entry = typeof tables[table] === "function" ? tables[table]({ filters, range, limit }) : tables[table];
      if (entry?.error) return { data: null, error: entry.error };
      let rows = [...(entry ?? [])];
      for (const [kind, key, value] of filters) rows = rows.filter(row => kind === "eq" ? row[key] === value : kind === "in" ? value.includes(row[key]) : kind === "gte" ? row[key] >= value : kind === "lte" ? row[key] <= value : row[key] < value);
      for (const [key, ascending] of orders.toReversed()) rows.sort((a, b) => (String(a[key]).localeCompare(String(b[key]))) * (ascending ? 1 : -1));
      if (range) rows = rows.slice(range[0], range[1] + 1);
      if (limit !== undefined) rows = rows.slice(0, limit);
      return { data: rows, error: null };
    };
    const q = {
      select() { return q; }, eq(key, value) { filters.push(["eq", key, value]); return q; }, gte(key, value) { filters.push(["gte", key, value]); return q; },
      in(key, value) { filters.push(["in", key, value]); return q; },
      lte(key, value) { filters.push(["lte", key, value]); return q; }, lt(key, value) { filters.push(["lt", key, value]); return q; },
      order(key, options = {}) { orders.push([key, options.ascending !== false]); return q; }, limit(value) { limit = value; return q; },
      range(start, end) { range = [start, end]; return q; },
      maybeSingle: async () => { const result = execute(); return { ...result, data: result.data?.[0] ?? null }; },
      then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
    };
    return q;
  } };
}

function analytics(overrides = {}) {
  return { version: 2, projectId: "prj_client", period: { start: "2026-10-01", end: "2026-10-03" }, visitors: 12, pageviews: 24,
    sections: { topPages: { ok: true }, topReferrers: { ok: true }, devices: { ok: true }, events: { ok: true } }, topPages: [{ label: "/contact", pageviews: 12 }], topReferrers: [], devices: [], events: [], ...overrides };
}
function setup(overrides = {}) {
  const calls = [], providerCalls = [], gatherCalls = [];
  const tables = {
    clients: [{ id: clientId, name: "Protection Nuisibles" }],
    client_connections: [
      { client_id: clientId, provider: "vercel", status: "configured", metadata: { project_id: "prj_client" } },
      { client_id: clientId, provider: "search-console", status: "configured", metadata: { property: "sc-domain:client.fr" } },
      { client_id: clientId, provider: "google_ads", status: "connected", external_account_id: "1234567890", metadata: {} },
    ],
    site_checks: [{ id: "one", client_id: clientId, ok: true, response_ms: 100, checked_at: "2026-10-01T00:00:00Z" }, { id: "two", client_id: clientId, ok: false, response_ms: 200, checked_at: "2026-10-03T23:59:59Z" }, { id: "foreign", client_id: otherId, ok: true, response_ms: 0, checked_at: "2026-10-02T00:00:00Z" }],
    metric_snapshots: [], search_console_daily_metrics: [], publication_deliveries: [], ...overrides.tables,
  };
  const raw = { client: { id: clientId, name: "Protection Nuisibles" }, period: input(), projects: [], tasks: [], publications: [], recommendations: [], actions: [], incidents: [], runs: [], siteChecks: [], metrics: [], ...overrides.activity };
  const repository = load("lib/reports/professional-sources.ts", {
    "@/lib/require-admin": { requireAdmin: async () => { if (overrides.denied) throw Error("denied"); } },
    "@/lib/supabase/server": { getSupabaseServerClient: () => fakeDb(tables, calls) },
    "./professional": domain, "./service": { gatherReportInput: async (...args) => { gatherCalls.push(args); if (overrides.gatherError) throw Error("private access_token=secret"); return raw; } },
    "./build": reportBuild, "./google-ads": adsBuild,
    "@/lib/integrations/google-ads/service": { loadCampaignDashboard: async (...args) => { providerCalls.push(args); return overrides.ads ?? { ok: false, message: "Google Ads indisponible." }; } },
    "@/lib/integrations/google-ads/dashboard": dashboard, "@/lib/integrations/google-ads/scope": scopes,
    "@/lib/integrations/google-ads/findings": findings,
    "@/lib/integrations/search-console/model": model,
    "@/lib/vercel-analytics/sync": { VERCEL_SNAPSHOT_VERSION: 2, syncVercelAnalytics: async (...args) => { providerCalls.push(args); return overrides.sync ?? { ok: true, data: analytics() }; } },
  });
  return { repository, calls, providerCalls, gatherCalls };
}

test("collector rejects non-admin before storage and validates request before provider calls", async () => {
  const denied = setup({ denied: true });
  await assert.rejects(() => denied.repository.gatherProfessionalSources(input()), /denied/);
  assert.equal(denied.calls.length, 0);
  const invalid = setup();
  await assert.rejects(() => invalid.repository.gatherProfessionalSources({ ...input(), start: "2026-02-30" }));
  assert.equal(invalid.calls.length, 0);
  assert.equal(invalid.providerCalls.length, 0);
});

test("website source includes exact analytics and measured check ratio without invented business conversions", async () => {
  const { repository, calls } = setup();
  const result = await repository.gatherProfessionalSources(input());
  assert.equal(result.clientName, "Protection Nuisibles");
  assert.equal(result.sources[0].state, "available");
  const content = result.sources[0].lines.join("\n");
  assert.match(content, /12 visiteurs et 24 pages vues/);
  assert.match(content, /1\/2 réussis \(50 %/);
  assert.match(content, /pas une mesure d’uptime continu/);
  assert.match(content, /ne prouve pas l’absence de contacts ou de conversions/);
  assert.doesNotMatch(content, /0 conversions|taux de rebond : 0/);
  assert.ok(calls.every(call => call.filters.some(([kind, key, value]) => kind === "eq" && (key === "client_id" || key === "id") && value === clientId)));
  assert.ok(!calls.some(call => call.table === "search_console_daily_metrics"));
});

test("website never uses an old project or a different period as fallback", async () => {
  for (const data of [analytics({ projectId: "prj_foreign" }), analytics({ period: { start: "2026-09-01", end: "2026-09-03" } })]) {
    const { repository } = setup({ sync: { ok: false }, tables: { metric_snapshots: [{ client_id: clientId, provider: "vercel", metric_key: "web_analytics", period_start: input().start, period_end: input().end, fetched_at: "2026-10-04T00:00:00Z", data }] } });
    const result = await repository.gatherProfessionalSources(input());
    assert.equal(result.sources[0].state, "partial");
    assert.doesNotMatch(result.sources[0].lines.join("\n"), /12 visiteurs/);
    assert.match(result.sources[0].lines.join("\n"), /Aucun instantané Vercel vérifiable/);
  }
});

test("a source failure is explicit and does not discard another selected source or disclose provider errors", async () => {
  const { repository } = setup({ gatherError: true });
  const result = await repository.gatherProfessionalSources({ ...input(), family: "global", sources: ["website", "activity"] });
  assert.equal(result.sources[0].state, "available");
  assert.equal(result.sources[1].state, "unavailable");
  assert.doesNotMatch(JSON.stringify(result), /access_token|secret/);
});

test("Search Console aggregates only the linked property and selected days, with complete previous comparison", async () => {
  const dates = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"];
  const rows = dates.map((date, index) => ({ client_id: clientId, property: "sc-domain:client.fr", date, clicks: index < 3 ? 1 : 2, impressions: 10, position: 5, fetched_at: "2026-10-05T00:00:00Z" }));
  rows.push({ ...rows[0], client_id: otherId, date: "2026-10-01", clicks: 1000 });
  rows.push({ ...rows[0], property: "sc-domain:foreign.fr", date: "2026-10-01", clicks: 1000 });
  const { repository } = setup({ tables: { search_console_daily_metrics: rows } });
  const result = await repository.gatherProfessionalSources(input("search_console"));
  assert.equal(result.sources[0].state, "partial");
  assert.match(result.sources[0].lines.join("\n"), /6 clics \(\+100 %\), 30 impressions/);
  assert.match(result.sources[0].evidence.join("\n"), /3\/3 jours synchronisés/);
});

test("SEO dimensions and opportunities require the exact period and current linked property's analysis", async () => {
  const rows = [1, 2, 3].map(day => ({ client_id: clientId, property: "sc-domain:client.fr", date: `2026-10-0${day}`, clicks: 2, impressions: 10, position: 5, fetched_at: "2026-10-05T00:00:00Z" }));
  const snapshot = { version: 1, property: "sc-domain:client.fr", period: { start: input().start, end: input().end }, sections: { queries: { ok: true }, pages: { ok: true } }, queries: [{ key: "dératisation client", clicks: 6, impressions: 30, position: 5 }], pages: [{ key: "https://client.fr/deratisation", clicks: 5, impressions: 25, position: 4 }] };
  const tables = {
    search_console_daily_metrics: rows,
    metric_snapshots: [{ client_id: clientId, provider: "search-console", metric_key: "performance", period_start: input().start, period_end: input().end, fetched_at: "2026-10-05T00:00:00Z", data: snapshot }],
    seo_opportunity_analyses: [{ id: "valid-analysis", client_id: clientId, property: "sc-domain:client.fr", status: "succeeded", period_start: input().start, period_end: input().end }],
    seo_keyword_opportunities: [
      { client_id: clientId, period_start: input().start, period_end: input().end, last_analysis_id: "valid-analysis", status: "to_review", keyword: "dératisation", priority: "high", confidence: "high", verified: true, metrics: { clicks: 6, impressions: 30 }, rationale: "Position mesurée à améliorer.", recommended_action: "Vérifier le contenu de la page." },
      { client_id: clientId, period_start: input().start, period_end: input().end, last_analysis_id: "old-property-analysis", status: "to_review", keyword: "DONNÉE ANCIENNE PROPRIÉTÉ", priority: "high", confidence: "high", verified: true },
    ],
  };
  const result = await setup({ tables }).repository.gatherProfessionalSources(input("search_console"));
  assert.equal(result.sources[0].state, "available");
  assert.match(result.sources[0].lines.join("\n"), /Requêtes principales.*dératisation client/);
  assert.match(result.sources[0].lines.join("\n"), /Opportunité SEO.*Preuves Search Console : 6 clics, 30 impressions/);
  assert.doesNotMatch(JSON.stringify(result), /ANCIENNE PROPRIÉTÉ/);
  for (const patch of [{ property: "sc-domain:foreign.fr" }, { period: { start: "2026-09-29", end: "2026-10-01" } }]) {
    const changed = structuredClone(tables);
    changed.metric_snapshots[0].data = { ...snapshot, ...patch };
    const invalid = await setup({ tables: changed }).repository.gatherProfessionalSources(input("search_console"));
    assert.equal(invalid.sources[0].state, "partial");
    assert.doesNotMatch(invalid.sources[0].lines.join("\n"), /dératisation client/);
    assert.match(invalid.sources[0].lines.join("\n"), /aucun instantané vérifiable/);
  }
});

test("missing Search Console history and partially synchronized days are visible without fabricated zeros", async () => {
  const missing = setup({ tables: { search_console_daily_metrics: { error: { code: "42P01", message: "private sql" } } } });
  const absent = await missing.repository.gatherProfessionalSources(input("search_console"));
  assert.equal(absent.sources[0].state, "unavailable");
  assert.doesNotMatch(JSON.stringify(absent), /0 clics|private sql/);
  const partial = setup({ tables: { search_console_daily_metrics: [{ client_id: clientId, property: "sc-domain:client.fr", date: "2026-10-02", clicks: 2, impressions: 10, position: 3, fetched_at: "2026-10-05T00:00:00Z" }] } });
  const result = await partial.repository.gatherProfessionalSources(input("search_console"));
  assert.equal(result.sources[0].state, "partial");
  assert.match(result.sources[0].lines.join("\n"), /1 jour sur 3/);
  assert.match(result.sources[0].lines.join("\n"), /comparaison non calculée/);
});

test("activity reuses the existing builder without syncing unselected website or attributing undated tasks and approvals", async () => {
  const { repository, gatherCalls, providerCalls } = setup({ activity: {
    tasks: [{ title: "Sans date", status: "Terminé", completed_at: null, created_at: "2026-10-02T00:00:00Z" }, { title: "Réalisé", status: "Terminé", completed_at: "2026-10-03T00:00:00Z" }],
    publications: [{ subject: "Validation seulement", status: "approved", updated_at: "2026-10-02T00:00:00Z" }],
    metrics: [{ provider: "google-ads", data: { cost: 99999 } }],
  }, tables: { publication_deliveries: [{ id: "d1", publication_id: "p1", client_id: clientId, status: "published", platform: "facebook", published_at: "2026-10-02T00:00:00Z" }, { id: "d2", publication_id: "p2", client_id: clientId, status: "published", platform: "facebook", published_at: "2026-10-04T00:00:00Z" }] } });
  const result = await repository.gatherProfessionalSources(input("activity"));
  assert.deepEqual(json(gatherCalls[0][2]), { syncWebsite: false });
  assert.equal(providerCalls.length, 0);
  const source = result.sources[0];
  assert.equal(source.state, "partial");
  assert.match(source.lines.join("\n"), /1 tâche\(s\).*1 diffusion/s);
  assert.match(source.lines.join("\n"), /sans date de réalisation : exclue/);
  assert.doesNotMatch(JSON.stringify(source.clientSections), /Sans date|Validation seulement|99999/);
  assert.match(JSON.stringify(source.clientSections), /Réalisé/);
});

test("Google Ads report reads all campaigns only on the linked account and retains Search/Local Services separation", async () => {
  const metric = { cost: 10, impressions: 20, clicks: 2, conversions: 1, conversionValue: null, ctr: .1, averageCpc: 5, costPerConversion: 10 };
  const rows = [{ id: "1", name: "Search réel", status: "ENABLED", type: "SEARCH", localServices: false, hasActivity: true, metrics: metric }, { id: "2", name: "LSA réel", status: "PAUSED", type: "LOCAL_SERVICES", localServices: true, hasActivity: false, metrics: { ...metric, cost: null, clicks: null, conversions: null, impressions: null } }];
  const ads = { ok: true, data: { account: { id: "1234567890", name: "Compte réel", currency: "EUR", timezone: "Europe/Paris" }, campaigns: rows, period: { start: input().start, end: input().end, days: 3, includesToday: false }, leads: { available: false, reason: "Droits insuffisants" }, fetchedAt: "2026-10-05T00:00:00Z" } };
  const { repository, providerCalls } = setup({ ads });
  const result = await repository.gatherProfessionalSources(input("google_ads"));
  assert.equal(result.sources[0].state, "partial");
  assert.equal(providerCalls[0][0], clientId);
  assert.equal(providerCalls[0][1].status, "all");
  assert.equal(providerCalls[0][1].includeUntracked, true);
  const client = JSON.stringify(result.sources[0].clientSections);
  assert.match(client, /Search/);
  assert.match(client, /Local Services/);
  assert.match(client, /indisponible/);
  assert.match(JSON.stringify(result.sources[0].evidence), /1234567890/);
  const changed = setup({ ads: { ...ads, data: { ...ads.data, account: { ...ads.data.account, id: "9999999999" } } } });
  const rejected = await changed.repository.gatherProfessionalSources(input("google_ads"));
  assert.equal(rejected.sources[0].state, "unavailable");
  assert.doesNotMatch(JSON.stringify(rejected.sources[0]), /Search réel|9999999999/);
});

test("query caps are visible and activity is not reported as complete at its known cap", async () => {
  const tasks = Array.from({ length: 500 }, (_, index) => ({ title: `Tâche ${index}`, status: "Terminé", completed_at: "2026-10-02T00:00:00Z" }));
  const { repository } = setup({ activity: { tasks } });
  const result = await repository.gatherProfessionalSources(input("activity"));
  assert.equal(result.sources[0].state, "partial");
  assert.match(result.sources[0].lines.join("\n"), /Limites de collecte atteintes \(tasks\)/);
});
