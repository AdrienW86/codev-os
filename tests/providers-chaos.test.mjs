import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { loadTs } from "./helpers/load-ts.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";

const require = createRequire(import.meta.url);
const errors = loadTs("lib/providers/errors.ts");
const api = loadTs("lib/providers/api.ts", { "@/lib/providers/errors": errors });
const netPolicy = loadTs("lib/providers/net-policy.ts", { "node:net": require("node:net") });
const parse = loadTs("lib/news/parse.ts");
const rank = loadTs("lib/news/rank.ts");
const types = loadTs("lib/runs/types.ts");

const response = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => body });
async function kindOf(promise) {
  try { await promise; return "ok"; } catch (error) { return error.kind ?? `unexpected:${error.message}`; }
}

test("provider API chaos: 401/403/404/429/500, timeout, network, malformed and empty bodies are normalised", async () => {
  const call = (fetchImpl) => api.providerJson("vercel", "https://api.vercel.com/v6/deployments", { fetchImpl });
  assert.equal(await kindOf(call(async () => response(401, ""))), "unauthorized");
  assert.equal(await kindOf(call(async () => response(403, ""))), "unauthorized");
  assert.equal(await kindOf(call(async () => response(404, ""))), "not_found");
  assert.equal(await kindOf(call(async () => response(429, ""))), "rate_limited");
  assert.equal(await kindOf(call(async () => response(502, "<html>"))), "unavailable");
  assert.equal(await kindOf(call(async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); })), "timeout");
  assert.equal(await kindOf(call(async () => { throw new TypeError("fetch failed"); })), "unavailable");
  assert.equal(await kindOf(call(async () => response(200, "{not json"))), "malformed");
  assert.deepEqual(JSON.parse(JSON.stringify(await call(async () => response(200, "")))), {});
  const retryable = Object.fromEntries(["rate_limited", "timeout", "unavailable", "unauthorized", "malformed", "blocked"].map((kind) => [kind, new errors.ProviderError("x", kind).retryable]));
  assert.deepEqual(retryable, { rate_limited: true, timeout: true, unavailable: true, unauthorized: false, malformed: false, blocked: false });
});

test("provider API never calls hosts outside the allowlist, nor plain http, nor follows redirects", async () => {
  let calls = 0;
  const spy = async (_url, init) => { calls++; assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store"); return response(200, "{}"); };
  for (const url of ["https://evil.example.com/x", "http://api.vercel.com/x", "https://api.vercel.com.evil.io/x", "https://169.254.169.254/latest", "not a url"]) {
    assert.equal(await kindOf(api.providerJson("vercel", url, { fetchImpl: spy })), "blocked", url);
  }
  assert.equal(calls, 0);
  await api.providerJson("vercel", "https://api.vercel.com/x", { fetchImpl: spy });
  assert.equal(calls, 1);
});

test("Google token exchange: missing credentials → not_configured without network; header injection refused", async () => {
  let calls = 0;
  assert.equal(await kindOf(api.googleAccessToken("search-console", { clientId: "a" }, async () => { calls++; })), "not_configured");
  assert.equal(calls, 0);
  const creds = { clientId: "a", clientSecret: "b", refreshToken: "c" };
  assert.equal(await kindOf(api.googleAccessToken("search-console", creds, async () => response(200, JSON.stringify({ access_token: "abc\r\nX-Evil: 1" })))), "malformed");
  assert.equal(await kindOf(api.googleAccessToken("search-console", creds, async () => response(400, "{\"error\":\"invalid_grant\"}"))), "rejected");
  assert.equal(await api.googleAccessToken("search-console", creds, async () => response(200, "{\"access_token\":\"ya29.ok\"}")), "ya29.ok");
});

test("SSRF policy: private, loopback, link-local, metadata, IPv4-mapped IPv6, odd ports and credentials are refused", () => {
  const refused = ["http://127.0.0.1/", "https://10.0.0.5/", "https://192.168.1.1/", "https://172.20.0.1/", "https://169.254.169.254/", "https://[::1]/", "https://[::ffff:127.0.0.1]/",
    "https://[fd00::1]/", "https://localhost/", "https://app.localhost/", "https://metadata.google.internal/", "https://exemple.fr:8443/", "https://user:pass@exemple.fr/", "file:///etc/passwd", "gopher://exemple.fr/", "https://intranet/", "https://0.0.0.0/"];
  for (const url of refused) assert.equal(netPolicy.checkPublicUrl(url).ok, false, url);
  assert.equal(netPolicy.checkPublicUrl("http://exemple.fr/").ok, false, "http refused by default");
  assert.equal(netPolicy.checkPublicUrl("http://exemple.fr/", { allowHttp: true }).ok, true);
  assert.equal(netPolicy.checkPublicUrl("https://exemple.fr/page?q=1").ok, true);
  for (const address of ["8.8.8.8", "2606:4700::1111"]) assert.equal(netPolicy.isPrivateAddress(address), false, address);
  for (const address of ["100.64.0.1", "198.18.0.1", "224.0.0.1", "::", "::1", "fe80::1", "fd12::1", "::ffff:7f00:1", "::ffff:a00:1", "0:0:0:0:0:ffff:c0a8:101", "2002:7f00:1::", "64:ff9b::a00:1", "not-an-ip"]) assert.equal(netPolicy.isPrivateAddress(address), true, address);
});

test("safe HTTP: a public hostname that RESOLVES to a private address is blocked at connect time (DNS rebinding)", async () => {
  let lookups = 0;
  const dns = { lookup: (_host, _options, callback) => { lookups++; callback(null, [{ address: "127.0.0.1", family: 4 }]); } };
  const safeHttp = loadTs("lib/providers/safe-http.ts", { "node:dns": dns, "node:http": require("node:http"), "node:https": require("node:https"), "@/lib/providers/net-policy": netPolicy, "@/lib/providers/errors": errors });
  assert.equal(await kindOf(safeHttp.safeGet("https://rebind.example.com/", { provider: "http", timeoutMs: 2000 })), "blocked");
  assert.ok(lookups >= 1, "the guarded lookup ran");
  const mixed = { lookup: (_host, _options, callback) => callback(null, [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }]) };
  const safeMixed = loadTs("lib/providers/safe-http.ts", { "node:dns": mixed, "node:http": require("node:http"), "node:https": require("node:https"), "@/lib/providers/net-policy": netPolicy, "@/lib/providers/errors": errors });
  assert.equal(await kindOf(safeMixed.safeGet("https://mixed.example.com/", { provider: "http", timeoutMs: 2000 })), "blocked", "any private record blocks the host");
  assert.equal(await kindOf(safeHttp.safeGet("https://10.1.2.3/", { provider: "http" })), "blocked");
});

test("RSS/Atom parsing is tolerant and safe: entities, CDATA, scripts stripped, non-https links dropped, size bound", () => {
  const rss = `<?xml version="1.0"?><rss><channel>
    <item><title><![CDATA[Next.js 16 &amp; React]]></title><link>https://nextjs.org/blog/next-16?utm_source=rss</link><description>&lt;p&gt;Nouveautés&lt;/p&gt;<script>alert(1)</script></description><pubDate>Wed, 07 Oct 2026 10:00:00 GMT</pubDate></item>
    <item><title>Lien dangereux</title><link>javascript:alert(1)</link></item>
    <item><title>Sans date</title><link>https://exemple.fr/a</link></item>
  </channel></rss>`;
  const items = JSON.parse(JSON.stringify(parse.parseFeed(rss)));
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Next.js 16 & React");
  assert.equal(items[0].summary, "Nouveautés");
  assert.equal(items[0].publishedAt, "2026-10-07T10:00:00.000Z");
  assert.equal(items[1].publishedAt, null);
  const atom = `<feed><entry><title>Claude update</title><link rel="alternate" href="https://anthropic.com/news/x"/><updated>2026-10-08T00:00:00Z</updated><summary>agents</summary></entry></feed>`;
  assert.equal(parse.parseFeed(atom)[0].url, "https://anthropic.com/news/x");
  assert.deepEqual(JSON.parse(JSON.stringify(parse.parseFeed("<<<not xml"))), []);
  assert.deepEqual(JSON.parse(JSON.stringify(parse.parseFeed("x".repeat(3_000_001)))), []);
});

test("news ranking: tracking parameters ignored for dedupe; recent and relevant items rank higher", () => {
  assert.equal(rank.dedupeKey("https://www.Exemple.fr/a?utm_source=x#top"), rank.dedupeKey("https://exemple.fr/a"));
  assert.notEqual(rank.dedupeKey("https://exemple.fr/a?id=1"), rank.dedupeKey("https://exemple.fr/a?id=2"));
  const now = new Date("2026-10-09T00:00:00Z");
  const fresh = rank.scoreItem({ title: "New LLM agent model", summary: "", publishedAt: "2026-10-08T00:00:00Z" }, "IA", 1, now);
  const old = rank.scoreItem({ title: "New LLM agent model", summary: "", publishedAt: "2026-09-01T00:00:00Z" }, "IA", 1, now);
  const offTopic = rank.scoreItem({ title: "Cooking", summary: "", publishedAt: "2026-10-08T00:00:00Z" }, "IA", 1, now);
  assert.ok(fresh > old && fresh > offTopic);
});

test("news pipeline: partial source outage succeeds, total outage fails retryably, duplicates stored once", async () => {
  const sources = loadTs("lib/news/sources.ts");
  const feed = `<rss><item><title>React release</title><link>https://react.dev/blog/x?utm_source=a</link><pubDate>Thu, 08 Oct 2026 00:00:00 GMT</pubDate></item></rss>`;
  const run = (safeGet) => {
    const fake = createFakeSupabase({ news_items: [] }, { unique: { news_items: [["dedupe_key"]] } });
    const newsRun = loadTs("lib/news/run.ts", { "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client }, "@/lib/providers/safe-http": { safeGet }, "@/lib/news/sources": sources, "@/lib/news/parse": parse, "@/lib/news/rank": rank, "@/lib/runs/types": types });
    return { fake, handler: newsRun.fetchNewsRun };
  };
  let calls = 0;
  const partial = run(async () => { calls++; if (calls % 2) throw new errors.ProviderError("rss", "timeout"); return { status: 200, body: feed }; });
  const result = await partial.handler({ now: new Date("2026-10-09T00:00:00Z") });
  assert.equal(result.status, "succeeded");
  assert.equal(partial.fake.tables.news_items.length, 1, "same article from several sources stored once");
  assert.match(result.summary, /source\(s\) indisponible/);
  const down = run(async () => { throw new errors.ProviderError("rss", "unavailable"); });
  await assert.rejects(() => down.handler({ now: new Date() }), (error) => error.retryable !== false && /Aucune source/.test(error.message));
});
