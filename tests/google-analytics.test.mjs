// Google Analytics 4 : modèle (propriétés, rapports, signaux), fournisseur, OAuth (état, PKCE, coffre séparé),
// synchronisation par client, et branchement dans le diagnostic expert Google Ads.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { loadTs } from "./helpers/load-ts.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";

const errors = loadTs("lib/providers/errors.ts");
const api = loadTs("lib/providers/api.ts", { "@/lib/providers/errors": errors });
const model = loadTs("lib/integrations/google-analytics/model.ts");
const provider = loadTs("lib/providers/google-analytics.ts", { "@/lib/providers/api": api, "@/lib/providers/errors": errors, "@/lib/integrations/google-analytics/model": model });
const publicationConfig = loadTs("lib/integrations/publications-oauth/config.ts");
const config = loadTs("lib/integrations/google-analytics/config.ts", { "@/lib/integrations/publications-oauth/config": publicationConfig });
const vaultModule = loadTs("lib/integrations/search-console/vault.ts");
const connection = loadTs("lib/integrations/google-analytics/connection.ts", {
  "@/lib/supabase/server": { getSupabaseServerClient: () => { throw new Error("production client in tests"); } },
  "@/lib/providers/api": api, "@/lib/providers/errors": errors, "@/lib/providers/google-analytics": provider,
  "@/lib/integrations/google-analytics/config": config, "@/lib/integrations/search-console/vault": vaultModule, "@/lib/integrations/google-analytics/model": model,
});
const synced = [];
const sync = loadTs("lib/integrations/google-analytics/sync.ts", {
  "@/lib/connections/sync": { recordSync: async (clientId, providerId, failure) => { synced.push([clientId, providerId, failure ? failure.kind ?? "error" : null]); } },
  "@/lib/providers/errors": errors, "@/lib/providers/google-analytics": provider,
  "@/lib/integrations/google-analytics/connection": connection, "@/lib/integrations/google-analytics/model": model,
});
const expert = loadTs("lib/integrations/google-ads/expert.ts");
const sources = loadTs("lib/connections/sources.ts", { "@/lib/integrations/search-console/model": loadTs("lib/integrations/search-console/model.ts"), "@/lib/integrations/google-analytics/model": model });

const plain = (value) => JSON.parse(JSON.stringify(value));
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
const CLIENT = "11111111-1111-4111-8111-111111111111";
const USER = "user_admin";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const env = {
  PUBLICATIONS_OAUTH_BASE_URL: "https://os.code-v.fr",
  PUBLICATION_CREDENTIALS_KEY: randomBytes(32).toString("base64"), PUBLICATION_CREDENTIALS_KEY_ID: "k1",
  GOOGLE_BUSINESS_PROFILE_CLIENT_ID: "123-gbp.apps.googleusercontent.com", GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET: "gbp-client-secret",
};
const report = (rows) => ({ rows: rows.map(([dimensions, metrics]) => ({ dimensionValues: dimensions.map((value) => ({ value })), metricValues: metrics.map((value) => ({ value: String(value) })) })) });

// ——— Modèle ———

test("property ids: numeric or properties/<id>; anything else refused", () => {
  assert.equal(model.normalizePropertyId(" properties/123456789 "), "123456789");
  assert.equal(model.normalizePropertyId("987654"), "987654");
  for (const bad of ["UA-1234-1", "G-ABC123", "0123456", "12", "properties/abc", 42, null]) assert.equal(model.normalizePropertyId(bad), null, String(bad));
  assert.equal(sources.normalizeSourceValue("google-analytics", "properties/123456789").value, "123456789");
  assert.equal(sources.normalizeSourceValue("google-analytics", "G-ABC123").ok, false);
});

test("account summaries: GA4 properties deduplicated, labels sanitised, sorted", () => {
  const properties = model.normalizeAccountSummaries({ accountSummaries: [
    { displayName: "Zeta", propertySummaries: [{ property: "properties/2000", displayName: "Site Z" }] },
    { displayName: "Alpha <b>", propertySummaries: [{ property: "properties/1000", displayName: "Site A" }, { property: "properties/1000", displayName: "doublon" }, { property: "bad" }] },
  ] });
  assert.deepEqual(plain(properties), [{ property: "1000", name: "Site A", account: "Alpha b" }, { property: "2000", name: "Site Z", account: "Zeta" }]);
  assert.deepEqual(plain(model.storedAnalyticsProperties({ properties })), plain(properties));
});

test("report parsing: numbers only, wrong shapes refused, thresholding flagged", () => {
  const parsed = model.parseReport({ ...report([[["Organic Search"], [10, 4, 1]]]), metadata: { subjectToThresholding: true } }, 1, 3);
  assert.deepEqual(plain(parsed), { rows: [{ dimensions: ["Organic Search"], metrics: [10, 4, 1] }], thresholded: true, otherRow: false });
  assert.equal(model.parseReport(report([[["x"], ["abc", 1, 1]]]), 1, 3), null);
  assert.equal(model.parseReport(report([[["x"], [1, 1]]]), 1, 3), null);
  assert.deepEqual(plain(model.parseReport({}, 1, 3).rows), []);
});

test("window: 30 days ending yesterday (Paris), previous 30 days", () => {
  const window = model.analyticsWindow(new Date("2026-11-16T05:00:00Z"));
  assert.deepEqual(plain(window), { period: { start: "2026-10-17", end: "2026-11-15" }, previous: { start: "2026-09-17", end: "2026-10-16" } });
  assert.equal(model.analyticsWindow(new Date("2026-11-15T23:30:00Z")).period.end, "2026-11-15", "00:30 le 16 à Paris : la veille est le 15");
});

// ——— Fournisseur ———

test("runReport: property path, date range, metrics, capped limit; bad input blocked before any call", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return json(200, report([[[], [12, 10, 4, 6, 2, 30, 61.5]]])); };
  const parsed = await provider.runAnalyticsReport("123456", { period: { start: "2026-10-01", end: "2026-10-30" }, dimensions: [], metrics: model.TOTAL_METRICS, limit: 99999 }, { fetchImpl, accessToken: async () => "ya29.token" });
  assert.equal(parsed.rows[0].metrics[0], 12);
  assert.equal(calls[0].url, "https://analyticsdata.googleapis.com/v1beta/properties/123456:runReport");
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.dateRanges, [{ startDate: "2026-10-01", endDate: "2026-10-30" }]);
  assert.equal(body.limit, "10000");
  assert.equal(calls[0].init.headers.Authorization, "Bearer ya29.token");
  for (const bad of [["properties/123456", {}], ["123456", { dimensions: ["landing page"] }], ["123456", { period: { start: "2026-10-30", end: "2026-10-01" } }]]) {
    await assert.rejects(provider.runAnalyticsReport(bad[0], { period: { start: "2026-10-01", end: "2026-10-30" }, dimensions: [], metrics: ["sessions"], ...bad[1] }, { fetchImpl, accessToken: async () => "t" }), (error) => error.kind === "blocked");
  }
  assert.equal(calls.length, 1);
  await assert.rejects(provider.runAnalyticsReport("123456", { period: { start: "2026-10-01", end: "2026-10-30" }, dimensions: [], metrics: ["sessions"] }, { fetchImpl: async () => json(403, { error: { status: "PERMISSION_DENIED" } }), accessToken: async () => "t" }), (error) => error.kind === "unauthorized");
});

// ——— Configuration et coffre ———

test("OAuth credentials: dedicated client, then Search Console client, then Business Profile; partial pair never completed", () => {
  assert.equal(config.googleAnalyticsOAuthConfig(env).credentials, "business_profile");
  assert.equal(config.googleAnalyticsOAuthConfig(env).redirectUri, "https://os.code-v.fr/api/integrations/google-analytics/callback");
  const sc = { ...env, GOOGLE_SEARCH_CONSOLE_CLIENT_ID: "456-sc.apps.googleusercontent.com", GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET: "sc-client-secret" };
  assert.equal(config.googleAnalyticsOAuthConfig(sc).credentials, "search_console");
  const own = { ...sc, GOOGLE_ANALYTICS_CLIENT_ID: "789-ga.apps.googleusercontent.com", GOOGLE_ANALYTICS_CLIENT_SECRET: "ga-client-secret" };
  assert.equal(config.googleAnalyticsOAuthConfig(own).clientId, "789-ga.apps.googleusercontent.com");
  assert.equal(config.googleAnalyticsOAuthConfig({ ...sc, GOOGLE_ANALYTICS_CLIENT_ID: "789-ga.apps.googleusercontent.com" }), null);
  assert.deepEqual(plain(config.missingGoogleAnalyticsConfiguration(env)), []);
  assert.deepEqual(plain(config.missingGoogleAnalyticsConfiguration({})), ["PUBLICATIONS_OAUTH_BASE_URL", "PUBLICATION_CREDENTIALS_KEY", "PUBLICATION_CREDENTIALS_KEY_ID", "GOOGLE_ANALYTICS_CLIENT_ID", "GOOGLE_ANALYTICS_CLIENT_SECRET"]);
});

test("vault: a Google Analytics secret is never readable through the Search Console domain (and vice versa)", async () => {
  const fake = createFakeSupabase({ integration_credential_secrets: [] });
  const keyring = config.googleAnalyticsKeyring(env);
  const ga = vaultModule.createSearchConsoleVault(vaultModule.supabaseSecretTable(fake.client, "google-analytics"), keyring, undefined, "google-analytics");
  const sc = vaultModule.createSearchConsoleVault(vaultModule.supabaseSecretTable(fake.client), keyring);
  const reference = await ga.store({ refreshToken: "1//ga-refresh-secret", scopes: [SCOPE] });
  assert.equal(fake.tables.integration_credential_secrets[0].provider, "google-analytics");
  assert.equal((await ga.read(reference)).refreshToken, "1//ga-refresh-secret");
  await assert.rejects(sc.read(reference));
  // Même ligne relue avec le mauvais domaine de chiffrement : authentification GCM refusée.
  fake.tables.integration_credential_secrets[0].provider = "search-console";
  await assert.rejects(sc.read(reference), (error) => error.kind === "corrupted");
});

// ——— OAuth ———

function harness({ google = {}, tables = {} } = {}) {
  const fake = createFakeSupabase({ client_connections: [], integration_credential_secrets: [], integration_oauth_states: [], metric_snapshots: [], ...tables });
  const keyring = config.googleAnalyticsKeyring(env);
  const requests = [];
  const fetchImpl = async (url, init) => {
    const target = String(url);
    requests.push({ url: target, body: init?.body ? String(init.body) : null });
    if (target === "https://oauth2.googleapis.com/token") {
      const params = new URLSearchParams(String(init.body));
      if (params.get("grant_type") === "refresh_token") return json(200, { access_token: "ya29.refreshed", token_type: "Bearer", expires_in: 3599, scope: SCOPE });
      return google.exchange ? google.exchange(params) : json(200, { access_token: "ya29.first", refresh_token: "1//ga-refresh", token_type: "Bearer", expires_in: 3599, scope: SCOPE });
    }
    if (target.startsWith("https://analyticsadmin.googleapis.com/v1beta/accountSummaries")) return json(200, { accountSummaries: [{ displayName: "CODE-V", propertySummaries: [{ property: "properties/123456", displayName: "Site client" }] }] });
    if (target.includes(":runReport")) return google.report ? google.report(JSON.parse(init.body)) : json(200, {});
    return json(404, {});
  };
  const deps = {
    db: fake.client, env, config: config.googleAnalyticsOAuthConfig(env),
    vault: vaultModule.createSearchConsoleVault(vaultModule.supabaseSecretTable(fake.client, "google-analytics"), keyring, undefined, "google-analytics"),
    pkceKey: createHash("sha256").update("test-pkce").digest(), fetchImpl, now: () => Date.parse("2026-11-16T10:00:00Z"), random: () => randomBytes(32).toString("base64url"),
  };
  return { fake, deps, requests };
}

async function connect(h) {
  const started = await connection.startGoogleAnalyticsOAuth(USER, h.deps);
  assert.equal(started.ok, true);
  const url = new URL(started.url);
  const result = await connection.completeGoogleAnalyticsOAuth(USER, new URLSearchParams({ state: url.searchParams.get("state"), code: "4/auth-code" }), h.deps);
  return { url, result };
}

test("OAuth: read-only analytics scope, PKCE, state single use, token encrypted, properties discovered", async () => {
  const h = harness();
  const { url, result } = await connect(h);
  assert.equal(url.searchParams.get("scope"), SCOPE);
  assert.equal(url.searchParams.get("include_granted_scopes"), "false");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(h.fake.tables.integration_oauth_states[0].provider, "google-analytics");
  assert.equal(result.outcome, "success");
  assert.equal(result.properties, 1);
  const row = h.fake.tables.client_connections[0];
  assert.equal(row.provider, "google-analytics");
  assert.equal(row.client_id, null);
  assert.equal(JSON.stringify(h.fake.tables).includes("1//ga-refresh"), false, "refresh token never stored in clear");
  assert.deepEqual(plain(row.metadata.properties), [{ property: "123456", name: "Site client", account: "CODE-V" }]);
  const replay = await connection.completeGoogleAnalyticsOAuth(USER, new URLSearchParams({ state: url.searchParams.get("state"), code: "4/auth-code" }), h.deps);
  assert.equal(replay.outcome, "invalid");
});

test("OAuth: a token without the analytics scope is refused and nothing is stored", async () => {
  const h = harness({ google: { exchange: () => json(200, { access_token: "ya29.scope-test", refresh_token: "1//refresh-x", token_type: "Bearer", expires_in: 3599, scope: "https://www.googleapis.com/auth/webmasters.readonly" }) } });
  const { result } = await connect(h);
  assert.equal(result.outcome, "scope");
  assert.equal(h.fake.tables.integration_credential_secrets.length, 0);
  assert.equal(h.fake.tables.client_connections.length, 0);
});

// ——— Synchronisation ———

const reports = {
  "": report([[[], [400, 300, 250, 220, 12, 900, 75]]]),
  sessionDefaultChannelGroup: report([[["Organic Search"], [200, 120, 6]], [["Paid Search"], [120, 40, 0]]]),
  "landingPage,sessionDefaultChannelGroup": report([[["/couvreur-narbonne", "Organic Search"], [90, 70, 0]], [["/", "Organic Search"], [60, 40, 6]], [["/promo?gclid=1", "Paid Search"], [80, 20, 0]], [["/promo", "Paid Search"], [40, 10, 0]]]),
  sessionSourceMedium: report([[["google / organic"], [200, 120, 6]], [["google / cpc"], [120, 40, 4]]]),
  sessionGoogleAdsCampaignName: report([[["(not set)"], [280, 220, 8]], [["Toiture Search"], [120, 40, 4]]]),
  eventName: report([[["generate_lead"], [10]], [["click_tel"], [2]], [["page_view"], [0]]]),
  deviceCategory: report([[["mobile"], [300, 200, 8]]]),
};

test("sync: snapshot written for the client's property only, blocs and key events kept as read", async () => {
  const h = harness({ google: { report: (body) => json(200, reports[body.dimensions.map((item) => item.name).join(",")] ?? {}) } });
  await connect(h);
  h.fake.tables.client_connections.push({ id: "c1", client_id: CLIENT, provider: "google-analytics", scope: "client", status: "configured", metadata: { property: "123456" }, last_sync_at: null, last_checked_at: null });
  const result = await sync.syncGoogleAnalytics(CLIENT, h.deps, new Date("2026-11-16T10:00:00Z"));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.warning, null);
  const stored = h.fake.tables.metric_snapshots[0];
  assert.equal(stored.provider, "google-analytics");
  assert.equal(stored.metric_key, "ga4");
  assert.deepEqual([stored.period_start, stored.period_end], ["2026-10-17", "2026-11-15"]);
  const snapshot = model.parseAnalyticsSnapshot(stored.data);
  assert.equal(snapshot.totals.sessions, 400);
  assert.deepEqual(plain(snapshot.keyEvents), [{ name: "generate_lead", count: 10 }, { name: "click_tel", count: 2 }]);
  assert.ok(h.requests.filter((item) => item.url.includes(":runReport")).every((item) => item.url.includes("/properties/123456:")));
  assert.deepEqual(synced.at(-1), [CLIENT, "google-analytics", null]);
});

test("sync: access refused fails the whole sync, nothing partial is written; no property means no call", async () => {
  const h = harness({ google: { report: () => json(403, { error: { status: "PERMISSION_DENIED" } }) } });
  await connect(h);
  assert.equal((await sync.syncGoogleAnalytics(CLIENT, h.deps)).reason, "no_property");
  h.fake.tables.client_connections.push({ id: "c1", client_id: CLIENT, provider: "google-analytics", scope: "client", status: "configured", metadata: { property: "123456" } });
  const result = await sync.syncGoogleAnalytics(CLIENT, h.deps);
  assert.equal(result.ok, false);
  assert.equal(result.kind, "unauthorized");
  assert.equal(h.fake.tables.metric_snapshots.length, 0);
});

test("daily scheduling: once per Paris day, retry at most every 3 hours", () => {
  const now = new Date("2026-11-16T10:00:00Z");
  assert.equal(sync.analyticsSyncDue({ last_sync_at: null, last_checked_at: null }, now), true);
  assert.equal(sync.analyticsSyncDue({ last_sync_at: "2026-11-16T05:00:00Z", last_checked_at: null }, now), false);
  assert.equal(sync.analyticsSyncDue({ last_sync_at: "2026-11-15T22:30:00Z", last_checked_at: null }, now), true, "22:30Z = 23:30 à Paris le 15 : pas encore synchronisé aujourd'hui");
  assert.equal(sync.analyticsSyncDue({ last_sync_at: "2026-11-15T10:00:00Z", last_checked_at: "2026-11-16T08:00:00Z" }, now), false);
  assert.equal(sync.analyticsSyncDue({ last_sync_at: "2026-11-15T10:00:00Z", last_checked_at: "2026-11-16T06:30:00Z" }, now), true);
});

// ——— Signaux agents ———

function snapshotFrom(overrides = {}) {
  const parsed = (key, d, m) => model.parseReport(reports[key], d, m);
  return {
    version: 1, property: "123456", period: { start: "2026-10-16", end: "2026-11-14" }, previousPeriod: { start: "2026-09-16", end: "2026-10-15" },
    totals: model.totalsFrom(parsed("", 0, 7)), previousTotals: null,
    channels: model.segmentsFrom(parsed("sessionDefaultChannelGroup", 1, 3), 25), previousChannels: [],
    landingPages: model.landingFrom(parsed("landingPage,sessionDefaultChannelGroup", 2, 3), 250),
    sourceMedium: model.segmentsFrom(parsed("sessionSourceMedium", 1, 3), 30), adsCampaigns: model.segmentsFrom(parsed("sessionGoogleAdsCampaignName", 1, 3), 50),
    keyEvents: model.keyEventsFrom(parsed("eventName", 1, 1)), devices: [], thresholded: false,
    sections: { totals: { ok: true }, landingPages: { ok: true }, keyEvents: { ok: true }, adsCampaigns: { ok: true }, sourceMedium: { ok: true } }, ...overrides,
  };
}

test("SEO insights: organic pages with traffic but no key event; missing key events reported as a measurement gap", () => {
  const insights = model.seoAnalyticsInsights(snapshotFrom());
  const leak = insights.find((item) => item.id === "ga:organic_no_conversion");
  assert.ok(leak);
  assert.deepEqual(plain(leak.items), ["/couvreur-narbonne (90 sessions organiques, engagement 78 %)"]);
  const none = model.seoAnalyticsInsights(snapshotFrom({ keyEvents: [] }));
  assert.deepEqual(plain(none.map((item) => item.id)), ["ga:no_key_events"]);
  assert.deepEqual(plain(model.seoAnalyticsInsights(null)), []);
  assert.equal(model.organicLandingPages(snapshotFrom({ sections: {} })), null, "bloc non lu → null, jamais une liste vide");
});

test("Ads signals: Google Ads campaigns preferred over google / cpc; paid landing pages merged by path", () => {
  const signals = model.adsAnalyticsSignals(snapshotFrom());
  assert.deepEqual(plain(signals.paid), { sessions: 120, engagedSessions: 40, keyEvents: 4, source: "ads_campaigns" });
  assert.deepEqual(plain(signals.landings), [{ path: "/promo", sessions: 120, engagementRate: 0.25, keyEvents: 0 }]);
  const fallback = model.adsAnalyticsSignals(snapshotFrom({ adsCampaigns: [{ key: "(not set)", sessions: 1, engagedSessions: 0, keyEvents: 0 }] }));
  assert.equal(fallback.paid.source, "google_cpc");
});

test("Ads expert: GA4 key events with zero Ads conversions → tracking gap; weak paid landing pages flagged", () => {
  const rows = [{ id: "1", name: "Toiture Search", status: "ENABLED", type: "SEARCH", localServices: false, budget: { amount: 30 }, metrics: { cost: 400, clicks: 120, conversions: 0, impressions: 3000, ctr: 0.04, conversionValue: 0 } }];
  const analytics = model.adsAnalyticsSignals(snapshotFrom());
  const findings = expert.analyticsOpportunities(rows, { analytics });
  assert.deepEqual(plain(findings.map((item) => item.kind)), ["analytics_tracking_gap", "analytics_landing"]);
  assert.equal(findings[0].priority, "high");
  assert.match(findings[1].items[0], /^\/promo \(120 sessions payantes, engagement 25 %/);
  assert.deepEqual(plain(expert.analyticsOpportunities(rows, { analytics: null })), []);
  const converting = [{ ...rows[0], metrics: { ...rows[0].metrics, conversions: 8 } }];
  assert.equal(expert.analyticsOpportunities(converting, { analytics }).some((item) => item.kind === "analytics_tracking_gap"), false);
  assert.ok(expert.expertCoverage({ searchTerms: null, impressionShare: null, keywords: null, devices: null, analytics }).read.includes("Google Analytics 4"));
});
