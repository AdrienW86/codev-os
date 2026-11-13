import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { loadTs } from "./helpers/load-ts.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";

const errors = loadTs("lib/providers/errors.ts");
const http = loadTs("lib/providers/api.ts", { "@/lib/providers/errors": errors });
const model = loadTs("lib/integrations/ga4/model.ts");
const api = loadTs("lib/integrations/ga4/api.ts", { "@/lib/providers/api": http, "@/lib/integrations/ga4/model": model });
const publications = loadTs("lib/integrations/publications-oauth/config.ts");
const config = loadTs("lib/integrations/ga4/config.ts", { "@/lib/integrations/publications-oauth/config": publications });
const vault = loadTs("lib/integrations/ga4/vault.ts");
const connection = loadTs("lib/integrations/ga4/connection.ts", {
  "@/lib/supabase/server": { getSupabaseServerClient() { throw new Error("No production Supabase in tests"); } },
  "@/lib/providers/api": http, "@/lib/providers/errors": errors,
  "@/lib/integrations/ga4/config": config, "@/lib/integrations/ga4/vault": vault,
  "@/lib/integrations/ga4/api": api, "@/lib/integrations/ga4/model": model,
});
const synced = [];
const sync = loadTs("lib/integrations/ga4/sync.ts", {
  "@/lib/integrations/ga4/api": api, "@/lib/integrations/ga4/connection": connection,
  "@/lib/integrations/ga4/model": model, "@/lib/providers/errors": errors,
  "@/lib/connections/sync": { recordSync: async (id, provider, error) => { synced.push([id, provider, error ? error.message : null]); } },
});
const pure = x => JSON.parse(JSON.stringify(x));
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
const ENV = {
  PUBLICATIONS_OAUTH_BASE_URL: "https://os.code-v.fr",
  PUBLICATION_CREDENTIALS_KEY: randomBytes(32).toString("base64"), PUBLICATION_CREDENTIALS_KEY_ID: "k1",
  GOOGLE_BUSINESS_PROFILE_CLIENT_ID: "123-gbp.apps.googleusercontent.com",
  GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET: "gbp-client-secret",
};
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const USER = "user_admin";
const PROPERTY_A = "564222159";
const PROPERTY_B = "565432100";

test("GA4 property normalization rejects measurement IDs, URLs and other clients' data", () => {
  assert.equal(model.normalizeGa4Property(" 564222159 "), PROPERTY_A);
  for (const invalid of ["G-REMJP2W0BK", "properties/564222159", "http://www.jrenov.com", "0", "-1", "123abc", 564222159, null]) {
    assert.equal(model.normalizeGa4Property(invalid), null, String(invalid));
  }
  const parsed = model.parseGa4AccountSummaries({ accountSummaries: [
    { account: "accounts/416256086", propertySummaries: [
      { property: "properties/564222159", displayName: "JRENOV – Site web" },
      { property: "properties/564222159", displayName: "Duplicate" },
      { property: "properties/not-valid", displayName: "Bad" },
    ] },
    { account: "accounts/401", propertySummaries: [{ property: "properties/565432100", displayName: "Autre client" }] },
  ] });
  assert.deepEqual(pure(parsed), [
    { id: PROPERTY_B, name: "Autre client", account: "accounts/401" },
    { id: PROPERTY_A, name: "JRENOV – Site web", account: "accounts/416256086" },
  ]);
  assert.equal(model.rate("0.34"), 0.34);
  assert.equal(model.rate("3.0"), null);
});

test("GA4 API reads property reports only from authenticated official endpoint", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return json(200, { rows: [{ metricValues: [{ value: "12" }, { value: "10" }, { value: "30" }, { value: "8" }, { value: "0.67" }, { value: "0.33" }, { value: "40" }] }] });
  };
  const result = await api.ga4RunReport("ya29.token", PROPERTY_A, { dateRanges: [{ startDate: "2026-11-01", endDate: "2026-11-07" }] }, fetchImpl);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_A}:runReport`);
  assert.equal(calls[0].init.headers.Authorization, "Bearer ya29.token");
  assert.deepEqual(pure(api.parseGa4Totals(result)), { sessions: 12, activeUsers: 10, pageViews: 30, engagedSessions: 8, engagementRate: 0.67, bounceRate: 0.33, eventCount: 40 });
  await assert.rejects(api.ga4RunReport("ya29.token", "G-REMJP2W0BK", {}, fetchImpl), /Invalid GA4 property/);
  assert.equal(calls.length, 1);
});

test("GA4 config reuses OAuth client but never combines Google grants implicitly", () => {
  const cfg = config.ga4OAuthConfig(ENV);
  assert.equal(cfg.credentials, "business_profile");
  assert.equal(cfg.redirectUri, "https://os.code-v.fr/api/integrations/google-analytics/callback");
  assert.equal(config.ga4OAuthConfig({ ...ENV, GOOGLE_ANALYTICS_CLIENT_ID: "456-ga4.apps.googleusercontent.com" }), null);
  const dedicated = config.ga4OAuthConfig({ ...ENV, GOOGLE_ANALYTICS_CLIENT_ID: "456-ga4.apps.googleusercontent.com", GOOGLE_ANALYTICS_CLIENT_SECRET: "my-ga4-client-secret" });
  assert.equal(dedicated.credentials, "analytics");
});

function harness(options = {}) {
  const fake = createFakeSupabase({
    client_connections: [], integration_credential_secrets: [], integration_oauth_states: [], metric_snapshots: [], ...options.tables,
  });
  let time = Date.parse("2026-11-13T12:00:00Z");
  const requests = [];
  const fetchImpl = async (url, init) => {
    const target = String(url);
    requests.push({ url: target, init });
    if (target === "https://oauth2.googleapis.com/token") {
      const kind = new URLSearchParams(init.body).get("grant_type");
      if (kind === "refresh_token") return json(200, { access_token: "ya29.refreshed", token_type: "Bearer", expires_in: 3599 });
      return json(200, { access_token: "ya29.first", refresh_token: "1//ga4-refresh-secret", token_type: "Bearer", expires_in: 3599, scope: options.scope ?? SCOPE });
    }
    if (target.startsWith("https://analyticsadmin.googleapis.com/v1beta/accountSummaries")) return json(200, {
      accountSummaries: [{ account: "accounts/416256086", propertySummaries: [
        { property: "properties/564222159", displayName: "JRENOV" },
        { property: "properties/565432100", displayName: "Autre client" },
      ] }],
    });
    if (target.includes("analyticsdata.googleapis.com")) {
      const req = JSON.parse(init.body);
      const dimension = req.dimensions?.[0]?.name;
      if (!dimension) return json(200, { rows: [{ metricValues: ["12", "10", "27", "8", "0.6667", "0.3333", "30"].map(value => ({ value })) }] });
      if (dimension === "date") return json(200, { rows: [{ dimensionValues: [{ value: "20261112" }], metricValues: [{ value: "12" }, { value: "10" }] }] });
      if (dimension === "eventName") return json(200, { rows: [{ dimensionValues: [{ value: "callback_request" }], metricValues: [{ value: "3" }] }] });
      return json(200, { rows: [{ dimensionValues: [{ value: dimension === "landingPagePlusQueryString" ? "/services/couverture" : "mobile" }], metricValues: [{ value: "12" }, { value: "0.6667" }, { value: "0.3333" }] }] });
    }
    return json(404, {});
  };
  const deps = {
    db: fake.client, config: config.ga4OAuthConfig(ENV),
    vault: vault.createGa4Vault(vault.supabaseSecretTable(fake.client), config.ga4Keyring(ENV)),
    pkceKey: createHash("sha256").update("test-pkce").digest(),
    fetchImpl, now: () => time, random: () => randomBytes(32).toString("base64url"),
  };
  return { deps, fake, requests, move: ms => { time += ms; } };
}
async function connect(h) {
  const started = await connection.startGa4OAuth(USER, h.deps);
  assert.equal(started.ok, true);
  const params = new URL(started.url).searchParams;
  const result = await connection.completeGa4OAuth(USER, new URLSearchParams({ state: params.get("state"), code: "4/auth-code" }), h.deps);
  return { params, result };
}

test("OAuth start: independent GA4 read-only grant, one-time hashed state and S256", async () => {
  const h = harness();
  const started = await connection.startGa4OAuth(USER, h.deps);
  const url = new URL(started.url);
  assert.equal(url.searchParams.get("scope"), SCOPE);
  assert.equal(url.searchParams.get("include_granted_scopes"), "false");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(h.fake.tables.integration_oauth_states.length, 1);
  assert.equal(h.fake.tables.integration_oauth_states[0].state_hash, createHash("sha256").update(url.searchParams.get("state")).digest("hex"));
});

test("OAuth callback: stores encrypted GA4 token, isolates account property list and rejects replay", async () => {
  const h = harness();
  const { params, result } = await connect(h);
  assert.equal(result.outcome, "success");
  assert.equal(result.properties, 2);
  const row = h.fake.tables.client_connections[0];
  assert.equal(row.provider, "google-analytics");
  assert.equal(row.scope, "global");
  assert.equal(row.status, "active");
  assert.equal(row.metadata.properties.length, 2);
  const body = JSON.stringify(h.fake.tables);
  for (const secret of ["1//ga4-refresh-secret", "ya29.first", "4/auth-code", params.get("state")]) assert.equal(body.includes(secret), false);
  assert.equal((await h.deps.vault.read(row.credential_reference)).refreshToken, "1//ga4-refresh-secret");
  const count = h.requests.length;
  const replay = await connection.completeGa4OAuth(USER, new URLSearchParams({ state: params.get("state"), code: "4/auth-code" }), h.deps);
  assert.equal(replay.outcome, "invalid");
  assert.equal(h.requests.length, count);
});

test("OAuth refuses extra scopes instead of broadening Search Console or Google Ads", async () => {
  const h = harness({ scope: SCOPE + " https://www.googleapis.com/auth/webmasters" });
  const result = await connect(h);
  assert.equal(result.result.outcome, "scope");
  assert.equal(h.fake.tables.integration_credential_secrets.length, 0);
  assert.equal(h.fake.tables.client_connections.length, 0);
});

test("sync: reads only the GA4 property assigned to the requested client, never another property", async () => {
  const h = harness({ tables: { client_connections: [
    { id: A, client_id: A, provider: "google-analytics", status: "configured", metadata: { property_id: PROPERTY_A } },
    { id: B, client_id: B, provider: "google-analytics", status: "configured", metadata: { property_id: PROPERTY_B } },
  ] } });
  await connect(h);
  const result = await sync.syncGa4(A, { start: "2026-11-07", end: "2026-11-12" }, h.deps);
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.property, PROPERTY_A);
  assert.equal(result.snapshot.totals.sessions, 12);
  assert.equal(result.snapshot.events[0].name, "callback_request");
  assert.equal(result.snapshot.pages[0].bounceRate, 0.3333);
  assert.equal(h.fake.tables.metric_snapshots.length, 1);
  assert.equal(h.fake.tables.metric_snapshots[0].client_id, A);
  assert.ok(h.requests.filter(r => r.url.includes("analyticsdata.googleapis.com")).every(r => r.url.includes("/properties/" + PROPERTY_A + ":")));
  const invalid = await sync.syncGa4(B, { start: "2026-11-12", end: "2026-12-15" }, h.deps);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, "invalid");
});
