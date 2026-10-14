// SEO V2: pure, read-only detector tests.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";
const engine = loadTs("lib/seo/opportunities.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));

const period = { start: "2026-09-12", end: "2026-10-09" };
const previousPeriod = { start: "2026-08-15", end: "2026-09-11" };
const row = (keys, clicks, impressions, position) => ({ keys: Array.isArray(keys) ? keys : [keys], clicks, impressions, ctr: impressions ? clicks / impressions : 0, position });
const ctx = { brandTerms: ["dupont"], services: ["plomberie", "chauffe-eau"], areas: ["Lyon", "Villeurbanne"], exclusions: ["formation"] };
const input = (patch = {}) => ({ period, previousPeriod, queries: [], previousQueries: [], queryPages: [], pages: [], previousPages: [], context: ctx, depth: "daily", ...patch });

test("intent is estimated from the query and the declared business context, never from invented data", () => {
  assert.equal(engine.classifyIntent("devis plombier", ctx).intent, "transactional");
  assert.equal(engine.classifyIntent("devis plombier lyon", ctx).intent, "local", "a declared area wins");
  assert.equal(engine.classifyIntent("plombier villeurbanne", ctx).intent, "local");
  assert.equal(engine.classifyIntent("dupont plomberie", ctx).intent, "navigational");
  assert.equal(engine.classifyIntent("comment purger un radiateur", ctx).intent, "informational");
  assert.equal(engine.classifyIntent("formation plombier", ctx).excluded, true);
  assert.ok(engine.expectedCtr(1) > engine.expectedCtr(5));
  assert.ok(engine.expectedCtr(5) > engine.expectedCtr(15));
});

test("striking distance, page two, low CTR and emerging queries come from measured Search Console rows", () => {
  const found = engine.detectOpportunities(input({
    queries: [row("devis plombier lyon", 14, 400, 6.4), row("chauffe-eau lyon", 1, 220, 14.2), row("plombier urgence lyon", 4, 900, 2.1), row("reparation chauffe-eau villeurbanne", 3, 150, 25)],
    previousQueries: [row("devis plombier lyon", 5, 380, 6.8), row("plombier urgence lyon", 8, 850, 2.3)],
    queryPages: [row(["devis plombier lyon", "https://x.fr/devis"], 14, 400, 6.4), row(["chauffe-eau lyon", "https://x.fr/chauffe-eau"], 1, 220, 14.2), row(["plombier urgence lyon", "https://x.fr/urgence"], 4, 900, 2.1), row(["reparation chauffe-eau villeurbanne", "https://x.fr/chauffe-eau"], 3, 150, 25)],
  }));
  const byKeyword = Object.fromEntries(found.map((item) => [item.keyword, item]));
  assert.equal(byKeyword["devis plombier lyon"].category, "striking_distance");
  assert.equal(byKeyword["chauffe-eau lyon"].category, "page_two");
  assert.equal(byKeyword["plombier urgence lyon"].category, "low_ctr");
  assert.equal(byKeyword["reparation chauffe-eau villeurbanne"].category, "emerging_query");
  for (const item of found) {
    assert.equal(item.verified, true);
    assert.equal(item.source, "search_console");
    assert.ok(item.metrics.impressions > 0);
    assert.ok(item.factors.length > 0, "priority explained");
    assert.ok(["high", "medium", "low"].includes(item.priority));
    assert.ok(item.rationale && item.recommendedAction);
  }
  assert.equal(byKeyword["devis plombier lyon"].targetUrl, "https://x.fr/devis");
  assert.deepEqual(plain(byKeyword["devis plombier lyon"].previous), { clicks: 5, impressions: 380, ctr: 5 / 380, position: 6.8 });
});

test("cannibalization needs several pages sharing impressions; content gaps are hypotheses without metrics", () => {
  const found = engine.detectOpportunities(input({
    depth: "weekly",
    queries: [row("plombier lyon", 10, 1200, 7)],
    queryPages: [row(["plombier lyon", "https://x.fr/"], 5, 600, 6), row(["plombier lyon", "https://x.fr/plomberie"], 5, 600, 8)],
    sitePages: [{ url: "https://x.fr/plomberie", title: "Plomberie à Lyon", h1: "Plomberie", description: null }],
  }));
  const cannibal = found.find((item) => item.category === "cannibalization");
  assert.ok(cannibal, "cannibalization detected");
  assert.equal(cannibal.targetStatus, "multiple");
  const gap = found.find((item) => item.category === "content_gap" && /chauffe/.test(item.keyword));
  assert.ok(gap, "declared service without page nor query");
  assert.equal(gap.verified, false);
  assert.equal(gap.source, "business_context");
  assert.equal(gap.metrics, null);
  assert.equal(gap.potentialClicks, null);
  assert.ok(found.filter((item) => item.category === "local_gap").length <= 3, "no mass local pages");
  assert.ok(found.every((item) => !item.verified || item.metrics), "verified opportunities carry metrics");
});

test("daily analysis never invents content gaps; fingerprints are stable and deduplicate", () => {
  const found = engine.detectOpportunities(input({ queries: [] }));
  assert.equal(found.filter((item) => !item.verified).length, 0);
  assert.equal(engine.opportunityFingerprint("low_ctr", "Plombier  Lyon"), engine.opportunityFingerprint("striking_distance", "plombier lyon"));
  assert.notEqual(engine.opportunityFingerprint("declining_page", "/a", "https://x.fr/a"), engine.opportunityFingerprint("low_ctr", "/a"));
});


test("missing GSC page is not a drop; observed decline is", () => {
  const previousPages = [row("https://example.fr/toiture", 100, 1200, 4)];
  assert.equal(engine.detectOpportunities(input({ pages: [], previousPages })).some((x) => x.category === "declining_page"), false);
  const observed = engine.detectOpportunities(input({ pages: [row("https://example.fr/toiture", 20, 800, 9)], previousPages }));
  assert.equal(observed.filter((x) => x.category === "declining_page").length, 1);
});
test("context-only hypotheses contain no fabricated metrics", () => {
  const found = engine.detectOpportunities(input({ depth: "weekly", context: { brandTerms: [], services: ["couverture", "zinguerie"], areas: ["Lyon"], exclusions: [] } }));
  assert.ok(found.some((x) => x.category === "content_gap"));
  assert.ok(found.filter((x) => !x.verified).every((x) => x.source === "business_context" && x.metrics === null && x.previous === null && x.potentialClicks === null));
});
test("result limits and ordering are deterministic", () => {
  const queries = Array.from({ length: 10 }, (_, i) => row(`devis couverture secteur${i}`, 2, 180 + i, 7));
  const data = input({ queries, context: { brandTerms: [], services: ["couverture"], areas: [], exclusions: [] }, limit: 3 });
  const first = engine.detectOpportunities(data), second = engine.detectOpportunities(data);
  assert.equal(first.length, 3);
  assert.deepEqual(first.map((x) => x.fingerprint), second.map((x) => x.fingerprint));
});
