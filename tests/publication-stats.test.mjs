// Architecture des agents, lot 3 : statistiques des publications par réseau. Modèle pur, relevé avec mocks (aucun
// réseau), lecture par le rapport et le point de situation. Un réseau sans statistiques n'est jamais compté zéro.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const m = loadTs("lib/publications/stats/model.ts");
const insights = loadTs("lib/reports/insights.ts");
const b = loadTs("lib/harness/briefing.ts");
const now = new Date("2026-11-18T10:00:00.000Z");
const hoursAgo = (h) => new Date(now.getTime() - h * 3_600_000).toISOString();
const plain = (value) => JSON.parse(JSON.stringify(value));
const C = "11111111-1111-4111-8111-111111111111";
const D = (n) => `2222222${n}-2222-4222-8222-222222222222`;
const delivery = (n, over = {}) => ({ id: D(n), client_id: C, platform: "facebook", remote_id: "123_456", published_at: hoursAgo(48), scheduled_for: hoursAgo(48), publication_account_id: "acc", ...over });

test("due deliveries: published with a real id, within 30 days, daily for 14 days then weekly, never-read first", () => {
  assert.equal(m.dueForStats([delivery(1)], [], now).length, 1);
  assert.equal(m.dueForStats([delivery(1, { remote_id: "simulated-x" })], [], now).length, 0);
  assert.equal(m.dueForStats([delivery(1, { remote_id: null })], [], now).length, 0);
  assert.equal(m.dueForStats([delivery(1, { published_at: hoursAgo(31 * 24) })], [], now).length, 0, "outside the window");
  assert.equal(m.dueForStats([delivery(1)], [{ delivery_id: D(1), status: "ok", fetched_at: hoursAgo(5) }], now).length, 0, "read 5 h ago");
  assert.equal(m.dueForStats([delivery(1)], [{ delivery_id: D(1), status: "ok", fetched_at: hoursAgo(21) }], now).length, 1, "daily refresh");
  assert.equal(m.dueForStats([delivery(1)], [{ delivery_id: D(1), status: "unsupported", fetched_at: hoursAgo(200) }], now).length, 0, "unsupported is final");
  const old = delivery(1, { published_at: hoursAgo(20 * 24) });
  assert.equal(m.dueForStats([old], [{ delivery_id: D(1), status: "ok", fetched_at: hoursAgo(3 * 24) }], now).length, 0, "weekly after 14 days");
  assert.equal(m.dueForStats([old], [{ delivery_id: D(1), status: "ok", fetched_at: hoursAgo(8 * 24) }], now).length, 1);
  const order = m.dueForStats([delivery(1, { published_at: hoursAgo(30) }), delivery(2, { published_at: hoursAgo(60) })], [{ delivery_id: D(2), status: "ok", fetched_at: hoursAgo(30) }], now);
  assert.deepEqual(plain(order.map((row) => row.id)), [D(1), D(2)], "never-read deliveries come first");
  assert.equal(m.dueForStats(Array.from({ length: 30 }, (_, i) => delivery(1, { id: `${i}` })), [], now).length, m.MAX_STATS_PER_TICK);
});

test("provider answers: Facebook reactions / comments / shares, Instagram likes / comments; malformed is null, never zero", () => {
  assert.deepEqual(plain(m.readFacebookStats({ reactions: { data: [], summary: { total_count: 12 } }, comments: { summary: { total_count: 3 } }, shares: { count: 2 } })), { reactions: 12, comments: 3, shares: 2 });
  assert.deepEqual(plain(m.readFacebookStats({ reactions: { summary: { total_count: 4 } }, comments: { summary: { total_count: 0 } } })), { reactions: 4, comments: 0, shares: 0 }, "no shares field = 0 shares");
  assert.equal(m.readFacebookStats({ id: "1" }), null);
  assert.deepEqual(plain(m.readInstagramStats({ like_count: 40, comments_count: 5 })), { likes: 40, comments: 5 });
  assert.deepEqual(plain(m.readInstagramStats({ comments_count: 5 })), { comments: 5 }, "hidden likes stay absent");
  assert.equal(m.readInstagramStats({ like_count: -1 }), null);
  assert.equal(m.interactions({ reactions: 12, comments: 3, shares: 2 }), 17);
});

function serviceWith({ deliveries, stats = [], statsError = null, answers = {}, connection = { credential_reference: "vault:connection/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "active" } }) {
  const saved = [], requests = [];
  const q = (table) => {
    const self = {
      select: () => self, eq: () => self, gte: () => self, in: () => self,
      limit: async () => table === "publication_delivery_stats" ? { data: stats, error: statsError } : { data: deliveries, error: null },
      maybeSingle: async () => table === "publication_accounts" ? { data: { connection_id: "conn", external_account_id: "123", parent_external_id: "123" }, error: null } : { data: connection, error: null },
      upsert: async (row) => { saved.push(row); return { error: null }; },
    };
    return self;
  };
  const meta = { read: async (r) => { requests.push(r); if (r.fields === "access_token") return { status: 200, body: { access_token: "PAGE-TOKEN-123456" } }; return answers[r.path] ?? { status: 500, body: null }; } };
  const vault = { readCredential: async () => ({ accessToken: "USER-TOKEN-123456", refreshToken: null, expiresAt: null, scopes: [] }) };
  const mod = loadTs("lib/publications/stats/service.ts", {
    "server-only": {}, "@/lib/supabase/server": { getSupabaseServerClient: () => null },
    "@/lib/integrations/publications-oauth/config": { metaOAuthConfig: () => null },
    "@/lib/integrations/publications-meta-stats": { metaStatsTransport: () => null },
    "../oauth/service": { productionOAuthDeps: () => ({ vault: null }) },
    "../connections/vault": { isCredentialReference: (v) => typeof v === "string" && v.startsWith("vault:connection/") },
    "./model": m,
  });
  return { run: () => mod.collectPublicationStats({ db: { from: q }, vault, meta, now }), saved, requests };
}

test("collection: reads Facebook / Instagram once per page token, marks other networks unsupported, records errors as codes", async () => {
  const s = serviceWith({
    deliveries: [delivery(1), delivery(2, { platform: "instagram", remote_id: "999" }), delivery(3, { platform: "google_business_profile", remote_id: "accounts/1/locations/2/localPosts/3" }), delivery(4, { remote_id: "123_777" })],
    answers: { "123_456": { status: 200, body: { reactions: { summary: { total_count: 9 } }, comments: { summary: { total_count: 1 } } } }, "999": { status: 200, body: { like_count: 30, comments_count: 2 } }, "123_777": { status: 400, body: { error: { code: 10 } } } },
  });
  const summary = await s.run();
  assert.deepEqual(plain(summary), { due: 4, ok: 2, unsupported: 1, failed: 1 });
  const by = Object.fromEntries(s.saved.map((row) => [row.delivery_id, row]));
  assert.deepEqual(plain(by[D(1)].metrics), { reactions: 9, comments: 1, shares: 0 });
  assert.deepEqual(plain(by[D(2)].metrics), { likes: 30, comments: 2 });
  assert.equal(by[D(3)].status, "unsupported"); assert.equal(by[D(3)].error_code, "google_no_post_insights");
  assert.equal(by[D(4)].status, "error"); assert.equal(by[D(4)].error_code, "permission_missing");
  assert.equal(s.requests.filter((r) => r.fields === "access_token").length, 1, "page token fetched once per page");
  assert.ok(s.requests.every((r) => !("method" in r)), "read-only transport");
  assert.doesNotMatch(JSON.stringify(s.saved), /TOKEN/, "no token stored");
});

test("collection: missing table = disabled, inactive connection = credential error", async () => {
  assert.equal((await serviceWith({ deliveries: [delivery(1)], statsError: { code: "42P01" } }).run()).disabled, "migration");
  const s = serviceWith({ deliveries: [delivery(1)], connection: { credential_reference: "x", status: "revoked" } });
  await s.run();
  assert.equal(s.saved[0].error_code, "credential_unavailable");
});

test("report: interactions per network, best post, unsupported networks named, no zero invented", () => {
  const period = { start: "2026-11-01", end: "2026-11-30" };
  const rows = [
    { platform: "facebook", published_at: "2026-11-05T09:00:00Z", subject: "Salle de bains", stats: { reactions: 10, comments: 2, shares: 1 }, statsStatus: "ok" },
    { platform: "facebook", published_at: "2026-11-08T09:00:00Z", subject: "Cuisine", stats: { reactions: 3, comments: 0, shares: 0 }, statsStatus: "ok" },
    { platform: "instagram", published_at: "2026-11-09T09:00:00Z", subject: "Terrasse", stats: { likes: 20, comments: 4 }, statsStatus: "ok" },
    { platform: "google_business_profile", published_at: "2026-11-09T09:00:00Z", subject: "Terrasse", stats: null, statsStatus: "unsupported" },
  ];
  const lines = insights.deliveryLines(rows, period, true).join("\n");
  assert.match(lines, /Facebook : 16 interactions relevées sur 2 posts \(réactions 13, commentaires 2, partages 1\), soit 8 par post ; le plus suivi : « Salle de bains » \(13\)/);
  assert.match(lines, /Instagram : 24 interactions relevées sur 1 post \(j’aime 20, commentaires 4\)/);
  assert.match(lines, /Statistiques non fournies par Google Business Profile/);
  assert.match(lines, /Salle de bains · 13 interactions/);
  assert.deepEqual(plain(insights.readPostStats({ likes: 3, comments: "x" })), { likes: 3 });
  assert.equal(insights.readPostStats({}), null);
  assert.doesNotMatch(insights.deliveryLines(rows.map((row) => ({ ...row, stats: null, statsStatus: null })), period, true).join("\n"), /interaction/, "no stats, no number");
});

test("briefing: Publications reports measured interactions and names networks without statistics", () => {
  const deliveries = [{ platform: "facebook", status: "published", scheduled_for: hoursAgo(48), published_at: hoursAgo(48) }];
  const stats = [
    { platform: "facebook", status: "ok", metrics: { reactions: 5, comments: 1, shares: 0 }, fetched_at: hoursAgo(3) },
    { platform: "google_business_profile", status: "unsupported", metrics: {}, fetched_at: hoursAgo(3) },
  ];
  const signals = b.publicationsSignals(deliveries, now, stats);
  assert.match(signals.facts.map((f) => f.statement).join(" "), /Interactions relevées \(30 jours\) : Facebook 6 sur 1 post/);
  assert.match(signals.gaps.join(" "), /Google Business Profile/);
  assert.doesNotMatch(signals.gaps.join(" "), /non récupérées/);
  assert.match(b.publicationsSignals(deliveries, now, null).gaps.join(" "), /non récupérées/);
});

test("stats transport: GET only, closed list of paths and fields", async () => {
  const calls = [];
  const t = loadTs("lib/integrations/publications-meta-stats.ts", { "server-only": {}, "./publications-oauth/config": { META_GRAPH_VERSION: "v26.0" }, "./publications-oauth/http": {} })
    .metaStatsTransport({ appSecret: "secret" }, async (url, init) => { calls.push([url, init]); return { status: 200, text: async () => "{\"like_count\":1}" }; });
  assert.deepEqual(plain(await t.read({ path: "999", fields: "like_count,comments_count", token: "tok" })), { status: 200, body: { like_count: 1 } });
  assert.equal(calls[0][1].method, "GET"); assert.doesNotMatch(calls[0][0], /tok/, "token never in the URL");
  await assert.rejects(t.read({ path: "999/feed", fields: "like_count,comments_count", token: "tok" }));
  await assert.rejects(t.read({ path: "999", fields: "insights", token: "tok" }));
});
