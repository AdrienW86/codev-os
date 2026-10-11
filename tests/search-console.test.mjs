// Google Search Console : modèle (agrégation Google), fournisseur, OAuth (état, PKCE, coffre), synchronisation par client.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { loadTs } from "./helpers/load-ts.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";

const errors = loadTs("lib/providers/errors.ts");
const api = loadTs("lib/providers/api.ts", { "@/lib/providers/errors": errors });
const model = loadTs("lib/integrations/search-console/model.ts");
const provider = loadTs("lib/providers/search-console.ts", { "@/lib/providers/api": api, "@/lib/providers/errors": errors, "@/lib/integrations/search-console/model": model });
const publicationConfig = loadTs("lib/integrations/publications-oauth/config.ts");
const config = loadTs("lib/integrations/search-console/config.ts", { "@/lib/integrations/publications-oauth/config": publicationConfig });
const vaultModule = loadTs("lib/integrations/search-console/vault.ts");
const connection = loadTs("lib/integrations/search-console/connection.ts", {
  "@/lib/supabase/server": { getSupabaseServerClient: () => { throw new Error("production client in tests"); } },
  "@/lib/providers/api": api, "@/lib/providers/errors": errors, "@/lib/providers/search-console": provider,
  "@/lib/integrations/search-console/config": config, "@/lib/integrations/search-console/vault": vaultModule, "@/lib/integrations/search-console/model": model,
});
const synced = [];
const sync = loadTs("lib/integrations/search-console/sync.ts", {
  "@/lib/connections/sync": { recordSync: async (clientId, providerId, failure) => { synced.push([clientId, providerId, failure ? failure.kind ?? "error" : null]); } },
  "@/lib/providers/errors": errors, "@/lib/providers/search-console": provider, "@/lib/analytics/view-model": loadTs("lib/analytics/view-model.ts"),
  "@/lib/integrations/search-console/connection": connection, "@/lib/integrations/search-console/model": model,
});
const build = loadTs("lib/reports/build.ts");

const plain = (value) => JSON.parse(JSON.stringify(value));
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
const CLIENT_A = "11111111-1111-4111-8111-111111111111";
const CLIENT_B = "22222222-2222-4222-8222-222222222222";
const USER = "user_admin";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const REFRESH = "1//refresh-token-secret-value";
const env = {
  PUBLICATIONS_OAUTH_BASE_URL: "https://os.code-v.fr",
  PUBLICATION_CREDENTIALS_KEY: randomBytes(32).toString("base64"), PUBLICATION_CREDENTIALS_KEY_ID: "k1",
  GOOGLE_BUSINESS_PROFILE_CLIENT_ID: "123-gbp.apps.googleusercontent.com", GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET: "gbp-client-secret",
};

// ——— Modèle ———

test("properties: domain and URL-prefix forms are normalised; anything else is refused", () => {
  assert.equal(model.normalizeProperty(" SC-DOMAIN:Exemple.FR "), "sc-domain:exemple.fr");
  assert.equal(model.normalizeProperty("https://WWW.Exemple.fr/blog/"), "https://www.exemple.fr/blog/");
  assert.equal(model.normalizeProperty("http://exemple.fr/"), "http://exemple.fr/");
  for (const bad of ["https://exemple.fr", "https://exemple.fr/?q=1", "https://exemple.fr/../x/", "ftp://exemple.fr/", "sc-domain:", "https://user:pw@exemple.fr/", "https://exemple.fr:8443/", 42, null]) {
    assert.equal(model.normalizeProperty(bad), null, String(bad));
  }
  assert.equal(model.propertyKind("sc-domain:exemple.fr"), "domain");
  assert.equal(model.propertyKind("https://exemple.fr/"), "url");
});

test("site discovery keeps validated access only, deduplicated", () => {
  const sites = model.normalizeSites({ siteEntry: [
    { siteUrl: "https://exemple.fr/", permissionLevel: "siteOwner" },
    { siteUrl: "sc-domain:exemple.fr", permissionLevel: "siteFullUser" },
    { siteUrl: "https://EXEMPLE.fr/", permissionLevel: "siteRestrictedUser" },
    { siteUrl: "https://autre.fr/", permissionLevel: "siteUnverifiedUser" },
    { siteUrl: "javascript:alert(1)", permissionLevel: "siteOwner" },
  ] });
  assert.deepEqual(plain(sites), [{ property: "sc-domain:exemple.fr", permission: "siteFullUser" }, { property: "https://exemple.fr/", permission: "siteOwner" }]);
  assert.deepEqual(plain(model.normalizeSites({})), []);
});

test("aggregation follows Google rules: CTR = Σclicks ÷ Σimpressions, position weighted by impressions", () => {
  const totals = model.aggregate([{ clicks: 10, impressions: 100, position: 2 }, { clicks: 0, impressions: 900, position: 20 }, { clicks: 0, impressions: 0, position: null }]);
  assert.equal(totals.clicks, 10);
  assert.equal(totals.impressions, 1000);
  assert.equal(totals.ctr, 0.01); // et non la moyenne des CTR (5 %)
  assert.equal(totals.position, 18.2); // et non la moyenne simple (11)
  assert.deepEqual(plain(model.aggregate([])), { clicks: 0, impressions: 0, ctr: null, position: null });
});

test("periods are aligned on the last consolidated day, with a previous period of the same length", () => {
  const aligned = model.alignPeriod({ start: "2026-10-05", end: "2026-10-11" }, "2026-10-08", "2026-10-11");
  assert.deepEqual(plain(aligned), { period: { start: "2026-10-02", end: "2026-10-08" }, previous: { start: "2026-09-25", end: "2026-10-01" }, shifted: true });
  const old = model.alignPeriod({ start: "2026-09-01", end: "2026-09-30" }, null, "2026-10-11");
  assert.equal(old.shifted, false);
  assert.deepEqual(plain(old.previous), { start: "2026-08-02", end: "2026-08-31" });
  // Sans information Google : retard prudent de 3 jours.
  assert.equal(model.alignPeriod({ start: "2026-10-01", end: "2026-10-11" }, null, "2026-10-11").period.end, "2026-10-08");
});

test("KPI deltas: % for volumes, points for CTR, places for position (lower is better)", () => {
  const snapshot = { totals: { clicks: 120, impressions: 4000, ctr: 0.03, position: 8 }, previousTotals: { clicks: 100, impressions: 5000, ctr: 0.02, position: 10 }, daily: [] };
  const kpis = Object.fromEntries(model.buildSeoKpis(snapshot).map((kpi) => [kpi.key, kpi]));
  assert.equal(kpis.clicks.delta, 20);
  assert.equal(kpis.impressions.delta, -20);
  assert.equal(kpis.ctr.delta, 1);
  assert.equal(kpis.ctr.deltaUnit, "pt");
  assert.equal(kpis.position.delta, -2);
  assert.equal(kpis.position.better, "down");
  const first = Object.fromEntries(model.buildSeoKpis({ ...snapshot, previousTotals: null }).map((kpi) => [kpi.key, kpi]));
  assert.equal(first.clicks.delta, null);
});

test("weekly series re-aggregate the days (never an average of daily CTRs)", () => {
  const daily = [
    { date: "2026-10-05", clicks: 1, impressions: 10, position: 3 },
    { date: "2026-10-06", clicks: 9, impressions: 990, position: 30 },
    { date: "2026-10-12", clicks: 5, impressions: 50, position: 4 },
  ];
  const ctr = model.seoSeries(daily, "ctr", "week");
  assert.equal(ctr.length, 2);
  assert.equal(ctr[0].value, 1); // 10 ÷ 1000 = 1 %
  assert.equal(model.seoSeries(daily, "clicks", "day").length, 3);
});

// ——— Fournisseur ———

test("Search Analytics: property URL-encoded, web type, consolidated data, row limit capped", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return json(200, { rows: [{ keys: ["2026-10-01"], clicks: 3, impressions: 40, ctr: 0.075, position: 6.2 }] }); };
  const rows = await provider.searchAnalytics("sc-domain:exemple.fr", { startDate: "2026-10-01", endDate: "2026-10-07", dimensions: ["date"], rowLimit: 99999 }, { fetchImpl, accessToken: async () => "ya29.token" });
  assert.equal(rows.length, 1);
  assert.equal(calls[0].url, "https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Aexemple.fr/searchAnalytics/query");
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body, { startDate: "2026-10-01", endDate: "2026-10-07", dimensions: ["date"], type: "web", dataState: "final", rowLimit: 25000 });
  assert.equal(calls[0].init.headers.Authorization, "Bearer ya29.token");
  await assert.rejects(provider.searchAnalytics("https://exemple.fr", { startDate: "2026-10-01", endDate: "2026-10-07", dimensions: ["date"] }, { fetchImpl, accessToken: async () => "t" }), (error) => error.kind === "blocked");
  await assert.rejects(provider.searchAnalytics("sc-domain:exemple.fr", { startDate: "2026-10-01", endDate: "2026-10-07", dimensions: ["date"] }, { fetchImpl, env: {} }), (error) => error.kind === "not_configured");
});

// ——— Configuration ———

test("OAuth credentials: dedicated client first, Business Profile client reused otherwise, partial config never completed", () => {
  assert.equal(config.searchConsoleOAuthConfig(env).credentials, "business_profile");
  assert.equal(config.searchConsoleOAuthConfig(env).redirectUri, "https://os.code-v.fr/api/integrations/search-console/callback");
  const own = { ...env, GOOGLE_SEARCH_CONSOLE_CLIENT_ID: "456-sc.apps.googleusercontent.com", GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET: "sc-client-secret" };
  assert.equal(config.searchConsoleOAuthConfig(own).clientId, "456-sc.apps.googleusercontent.com");
  assert.equal(config.searchConsoleOAuthConfig({ ...env, GOOGLE_SEARCH_CONSOLE_CLIENT_ID: "456-sc.apps.googleusercontent.com" }), null);
  assert.deepEqual(plain(config.missingSearchConsoleConfiguration({})), ["PUBLICATIONS_OAUTH_BASE_URL", "PUBLICATION_CREDENTIALS_KEY", "PUBLICATION_CREDENTIALS_KEY_ID", "GOOGLE_SEARCH_CONSOLE_CLIENT_ID", "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET"]);
  assert.deepEqual(plain(config.missingSearchConsoleConfiguration(env)), []);
});

// ——— OAuth ———

function harness({ tables = {}, google = {} } = {}) {
  const fake = createFakeSupabase({ client_connections: [], integration_credential_secrets: [], integration_oauth_states: [], ...tables });
  const keyring = config.searchConsoleKeyring(env);
  const requests = [];
  const fetchImpl = async (url, init) => {
    const target = String(url);
    requests.push({ url: target, body: init?.body ? String(init.body) : null });
    if (target === "https://oauth2.googleapis.com/token") {
      const params = new URLSearchParams(String(init.body));
      if (params.get("grant_type") === "refresh_token") return google.refresh ? google.refresh(params) : json(200, { access_token: "ya29.refreshed", token_type: "Bearer", expires_in: 3599, scope: SCOPE });
      return google.exchange ? google.exchange(params) : json(200, { access_token: "ya29.first", refresh_token: REFRESH, token_type: "Bearer", expires_in: 3599, scope: SCOPE });
    }
    if (target.endsWith("/webmasters/v3/sites")) return json(200, { siteEntry: [{ siteUrl: "sc-domain:exemple.fr", permissionLevel: "siteOwner" }, { siteUrl: "https://autre.fr/", permissionLevel: "siteFullUser" }] });
    if (target.includes("/searchAnalytics/query")) return google.analytics ? google.analytics(target, JSON.parse(init.body)) : json(200, {});
    return json(404, {});
  };
  let clock = Date.parse("2026-10-11T10:00:00Z");
  const deps = {
    db: fake.client, env, config: config.searchConsoleOAuthConfig(env),
    vault: vaultModule.createSearchConsoleVault(vaultModule.supabaseSecretTable(fake.client), keyring),
    pkceKey: createHash("sha256").update("test-pkce").digest(), fetchImpl, now: () => clock,
    random: () => randomBytes(32).toString("base64url"),
  };
  return { fake, deps, requests, advance: (ms) => { clock += ms; } };
}

async function connect(h) {
  const started = await connection.startSearchConsoleOAuth(USER, h.deps);
  assert.equal(started.ok, true);
  const state = new URL(started.url).searchParams.get("state");
  const result = await connection.completeSearchConsoleOAuth(USER, new URLSearchParams({ state, code: "4/auth-code" }), h.deps);
  return { started, state, result };
}

test("OAuth start: read-only scope only, offline consent, PKCE S256, state stored hashed", async () => {
  const h = harness();
  const started = await connection.startSearchConsoleOAuth(USER, h.deps);
  const url = new URL(started.url);
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("scope"), SCOPE);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("include_granted_scopes"), "false");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("redirect_uri"), "https://os.code-v.fr/api/integrations/search-console/callback");
  assert.equal(url.searchParams.has("client_secret"), false);
  const state = url.searchParams.get("state");
  const stored = h.fake.tables.integration_oauth_states;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].state_hash, createHash("sha256").update(state).digest("hex"));
  assert.equal(JSON.stringify(stored).includes(state), false);
});

test("OAuth callback: connects once, stores the refresh token encrypted only, discovers properties", async () => {
  const h = harness();
  const { state, result } = await connect(h);
  assert.equal(result.outcome, "success");
  assert.equal(result.properties, 2);
  const row = h.fake.tables.client_connections[0];
  assert.equal(row.client_id, null);
  assert.equal(row.status, "active");
  assert.match(row.credential_reference, /^vault:connection\/[0-9a-f-]{36}$/);
  assert.deepEqual(row.metadata.properties.map((item) => item.property), ["sc-domain:exemple.fr", "https://autre.fr/"]);
  // Aucun jeton en clair dans la base (connexion, états, coffre).
  const dump = JSON.stringify(h.fake.tables);
  for (const secret of [REFRESH, "ya29.first", "4/auth-code", state, env.GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET]) assert.equal(dump.includes(secret), false, secret);
  assert.equal((await h.deps.vault.read(row.credential_reference)).refreshToken, REFRESH);
  // Le code a été échangé avec le vérificateur PKCE correspondant au défi.
  const exchange = new URLSearchParams(h.requests.find((item) => item.url === "https://oauth2.googleapis.com/token").body);
  assert.equal(exchange.get("grant_type"), "authorization_code");
  assert.ok(exchange.get("code_verifier").length >= 43);
  // Rejeu du même état : refusé, aucun nouvel échange.
  const before = h.requests.length;
  const replay = await connection.completeSearchConsoleOAuth(USER, new URLSearchParams({ state, code: "4/auth-code" }), h.deps);
  assert.equal(replay.outcome, "invalid");
  assert.equal(h.requests.length, before);
});

test("OAuth callback: another admin, refusal, expiry and scope mismatch never store a token", async () => {
  const other = harness();
  const started = await connection.startSearchConsoleOAuth(USER, other.deps);
  const state = new URL(started.url).searchParams.get("state");
  assert.equal((await connection.completeSearchConsoleOAuth("user_other", new URLSearchParams({ state, code: "c0de-value" }), other.deps)).outcome, "invalid");

  const refused = harness();
  const refusedState = new URL((await connection.startSearchConsoleOAuth(USER, refused.deps)).url).searchParams.get("state");
  assert.equal((await connection.completeSearchConsoleOAuth(USER, new URLSearchParams({ state: refusedState, error: "access_denied" }), refused.deps)).outcome, "refused");
  assert.equal(refused.requests.length, 0);

  const expired = harness();
  const expiredState = new URL((await connection.startSearchConsoleOAuth(USER, expired.deps)).url).searchParams.get("state");
  expired.advance(11 * 60_000);
  assert.equal((await connection.completeSearchConsoleOAuth(USER, new URLSearchParams({ state: expiredState, code: "c0de-value" }), expired.deps)).outcome, "expired");

  const scope = harness({ google: { exchange: () => json(200, { access_token: "ya29.scope-test", refresh_token: REFRESH, token_type: "Bearer", expires_in: 3599, scope: "https://www.googleapis.com/auth/business.manage" }) } });
  assert.equal((await connect(scope)).result.outcome, "scope");
  for (const h of [other, refused, expired, scope]) {
    assert.equal(h.fake.tables.integration_credential_secrets.length, 0);
    assert.equal(h.fake.tables.client_connections.length, 0);
  }
});

test("revoked access (invalid_grant) marks the connection revoked; disconnect deletes the local secret", async () => {
  const h = harness();
  await connect(h);
  const reference = h.fake.tables.client_connections[0].credential_reference;
  h.advance(2 * 3600_000); // jeton d'accès expiré : rafraîchissement nécessaire
  const revoked = harness({ tables: plain(h.fake.tables), google: { refresh: () => json(400, { error: "invalid_grant" }) } });
  revoked.deps.vault = vaultModule.createSearchConsoleVault(vaultModule.supabaseSecretTable(revoked.fake.client), config.searchConsoleKeyring(env));
  revoked.advance(2 * 3600_000);
  const access = await connection.searchConsoleAccess(revoked.deps);
  await assert.rejects(access.accessToken(), (error) => error.kind === "unauthorized");
  assert.equal(revoked.fake.tables.client_connections[0].status, "revoked");
  assert.equal(await connection.searchConsoleAccess(revoked.deps), null);

  const result = await connection.disconnectSearchConsole(h.deps);
  assert.equal(result.ok, true);
  assert.equal(h.fake.tables.client_connections[0].status, "disabled");
  assert.equal(h.fake.tables.client_connections[0].credential_reference, null);
  assert.equal(h.fake.tables.integration_credential_secrets.some((row) => row.reference === reference), false);
  // Déconnexion locale : aucun appel de révocation Google (client OAuth possiblement partagé).
  assert.equal(h.requests.some((item) => item.url.includes("revoke")), false);
});

// ——— Synchronisation ———

function analyticsFor(property, today) {
  return (url, body) => {
    assert.ok(url.includes(encodeURIComponent(property)), "requête limitée à la propriété du client");
    if (body.dimensions[0] === "date") {
      if (body.endDate === today) return json(200, { rows: [{ keys: ["2026-10-08"], clicks: 1, impressions: 10, ctr: 0.1, position: 5 }] });
      // 2026-10-04 absent : jour sans impression → 0.
      const rows = [];
      for (let d = new Date(`${body.startDate}T00:00:00Z`); d.toISOString().slice(0, 10) <= body.endDate; d.setUTCDate(d.getUTCDate() + 1)) {
        const date = d.toISOString().slice(0, 10);
        if (date !== "2026-10-04") rows.push({ keys: [date], clicks: 2, impressions: 100, ctr: 0.02, position: date < "2026-10-02" ? 12 : 4 });
      }
      return json(200, { rows });
    }
    return json(200, { rows: [{ keys: [body.dimensions[0] === "page" ? "https://exemple.fr/a" : "requête"], clicks: 2, impressions: 50, ctr: 0.04, position: 3 }] });
  };
}

test("sync: one client's property only, aligned on consolidated data, zero-filled days, history without duplicates", async () => {
  synced.length = 0;
  const h = harness({ google: { analytics: analyticsFor("sc-domain:exemple.fr", "2026-10-11") } });
  await connect(h);
  h.fake.tables.clients = [{ id: CLIENT_A, name: "A" }, { id: CLIENT_B, name: "B" }];
  h.fake.tables.client_connections.push(
    { id: "c-a", client_id: CLIENT_A, provider: "search-console", scope: "client", status: "configured", metadata: { property: "sc-domain:exemple.fr" } },
    { id: "c-b", client_id: CLIENT_B, provider: "search-console", scope: "client", status: "configured", metadata: { property: "https://autre.fr/" } },
  );
  const result = await sync.syncSearchConsole(CLIENT_A, { start: "2026-10-05", end: "2026-10-11" }, "manual", h.deps);
  assert.equal(result.ok, true, JSON.stringify(result));
  const snapshot = result.snapshot;
  assert.equal(snapshot.property, "sc-domain:exemple.fr");
  assert.deepEqual(plain(snapshot.period), { start: "2026-10-02", end: "2026-10-08" });
  assert.deepEqual(plain(snapshot.previousPeriod), { start: "2026-09-25", end: "2026-10-01" });
  assert.equal(snapshot.daily.length, 7);
  assert.deepEqual(plain(snapshot.daily.find((row) => row.date === "2026-10-04")), { date: "2026-10-04", clicks: 0, impressions: 0, position: null });
  assert.equal(snapshot.totals.clicks, 12);
  assert.equal(snapshot.totals.ctr, 0.02);
  assert.equal(snapshot.previousTotals.position, 12);
  assert.equal(h.fake.tables.metric_snapshots.length, 1);
  assert.equal(h.fake.tables.metric_snapshots[0].period_start, "2026-10-05"); // clé = période demandée
  const history = h.fake.tables.search_console_daily_metrics;
  assert.equal(history.length, 14);
  assert.ok(history.every((row) => row.client_id === CLIENT_A && row.property === "sc-domain:exemple.fr"));
  // Seconde synchronisation : remplacement, jamais de doublon.
  await sync.syncSearchConsole(CLIENT_A, { start: "2026-10-05", end: "2026-10-11" }, "manual", h.deps);
  assert.equal(h.fake.tables.search_console_daily_metrics.length, 14);
  assert.equal(h.fake.tables.metric_snapshots.length, 1);
  assert.deepEqual(synced.at(-1), [CLIENT_A, "search-console", null]);
});

test("sync: no property, no connection and quota errors never produce data", async () => {
  const h = harness({ google: { analytics: () => json(429, { error: { status: "RESOURCE_EXHAUSTED" } }) } });
  h.fake.tables.client_connections.push({ id: "c-a", client_id: CLIENT_A, provider: "search-console", scope: "client", status: "configured", metadata: {} });
  assert.equal((await sync.syncSearchConsole(CLIENT_A, { start: "2026-09-01", end: "2026-09-30" }, "manual", h.deps)).reason, "no_property");
  h.fake.tables.client_connections[0].metadata = { property: "sc-domain:exemple.fr" };
  assert.equal((await sync.syncSearchConsole(CLIENT_A, { start: "2026-09-01", end: "2026-09-30" }, "manual", h.deps)).reason, "not_connected");
  await connect(h);
  const limited = await sync.syncSearchConsole(CLIENT_A, { start: "2026-09-01", end: "2026-09-30" }, "manual", h.deps);
  assert.equal(limited.ok, false);
  assert.equal((h.fake.tables.metric_snapshots ?? []).length, 0);
  assert.equal((h.fake.tables.search_console_daily_metrics ?? []).length, 0);
  assert.equal(h.fake.tables.search_console_sync_runs.at(-1).status, "failed");
  assert.equal(h.fake.tables.search_console_sync_runs.at(-1).error_kind, "rate_limited");
});

// ——— Rapports ———

test("report line: totals over the report period, comparison only when the previous period is complete", () => {
  const days = [];
  for (let day = 1; day <= 14; day++) days.push({ date: `2026-09-${String(day).padStart(2, "0")}`, clicks: day <= 7 ? 1 : 2, impressions: 100, position: day <= 7 ? 10 : 8 });
  const lines = build.searchConsoleReportLines({ property: "sc-domain:exemple.fr", days }, { start: "2026-09-08", end: "2026-09-14" });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /14 clics \(\+100 %\), 700 impressions \(\+0 %\), CTR 2,0 % \(\+1,0 pt\), position moyenne 8,0 \(gain de 2,0 places\)/);
  const partial = build.searchConsoleReportLines({ property: "sc-domain:exemple.fr", days: days.slice(7, 12) }, { start: "2026-09-08", end: "2026-09-14" });
  assert.match(partial[0], /10 clics, 500 impressions, CTR 2,0 %, position moyenne 8,0\.$/);
  assert.match(partial[1], /5 jours sur 7/);
  assert.deepEqual(plain(build.searchConsoleReportLines({ property: "sc-domain:exemple.fr", days: [] }, { start: "2026-09-08", end: "2026-09-14" })), []);
});
