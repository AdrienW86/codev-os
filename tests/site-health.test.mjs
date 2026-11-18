// Architecture des agents, lot 5 : santé technique des sites (Agent Monitoring). Règles pures : chaque contrôle donne
// « conforme », « à corriger » ou « non vérifié » ; un contrôle qui n'a pas pu tourner n'est jamais conforme.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const h = loadTs("lib/site-health/model.ts");
const insights = loadTs("lib/reports/insights.ts");
const b = loadTs("lib/harness/briefing.ts");
const now = new Date("2026-11-18T02:00:00.000Z");
const inDays = (d) => new Date(now.getTime() + d * 86_400_000).toISOString();
const plain = (value) => JSON.parse(JSON.stringify(value));
const base = (over = {}) => ({
  host: "exemple.fr", homeUrl: "https://exemple.fr/", now,
  certificate: { validTo: inDays(60), issuer: "Let's Encrypt", hostnameMatch: true },
  domainExpiry: inDays(200), dns: { apex: true, www: true, mx: true },
  robots: { status: 200, text: "User-agent: *\nDisallow: /admin\nSitemap: https://exemple.fr/sitemap.xml" },
  sitemap: { url: "https://exemple.fr/sitemap.xml", urls: ["https://exemple.fr/a", "https://exemple.fr/b"] },
  crawl: [{ url: "https://exemple.fr/a", status: 200, finalUrl: "https://exemple.fr/a" }, { url: "https://exemple.fr/b", status: 200, finalUrl: "https://exemple.fr/b" }],
  vitals: { lcpMs: 2100, inpMs: 150, cls: 0.05, scope: "url" },
  inspections: [{ url: "https://exemple.fr/", verdict: "PASS", coverage: "Envoyée et indexée", robots: "ALLOWED", indexing: "INDEXING_ALLOWED" }],
  ...over,
});
const codes = (result) => plain(result.findings.map((f) => f.code));
const state = (result, key) => result.checks.find((c) => c.key === key).state;

test("healthy site: every check passes, score 100, no finding", () => {
  const r = h.evaluateHealth(base());
  assert.deepEqual(codes(r), []);
  assert.equal(r.score, 100);
  assert.ok(r.checks.every((c) => c.state === "ok"), JSON.stringify(plain(r.checks)));
});

test("certificate, domain and DNS: expired / expiring / wrong host / unresolved are findings", () => {
  assert.deepEqual(codes(h.evaluateHealth(base({ certificate: { validTo: inDays(-2), issuer: null, hostnameMatch: true } }))), ["ssl_expired"]);
  assert.deepEqual(codes(h.evaluateHealth(base({ certificate: { validTo: inDays(5), issuer: null, hostnameMatch: false } }))), ["ssl_expiring", "ssl_hostname"]);
  assert.deepEqual(codes(h.evaluateHealth(base({ domainExpiry: inDays(10) }))), ["domain_expiring"]);
  assert.deepEqual(codes(h.evaluateHealth(base({ dns: { apex: false, www: false, mx: null } }))), ["dns_unresolved", "dns_www_missing"]);
  const unread = h.evaluateHealth(base({ certificate: null, domainExpiry: undefined, dns: null }));
  assert.deepEqual(codes(unread), [], "unreadable is never a finding");
  for (const key of ["tls", "domain", "dns"]) assert.equal(state(unread, key), "unverified", key);
});

test("robots.txt, sitemap and crawl: block-all, missing sitemap, broken pages", () => {
  assert.equal(h.readRobots("User-agent: *\nDisallow: /").blocksAll, true);
  assert.equal(h.readRobots("User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /").blocksAll, false, "Googlebot group wins");
  assert.equal(h.readRobots("User-agent: *\nDisallow: /private").blocksAll, false);
  assert.deepEqual(plain(h.readRobots("Sitemap: https://x.fr/s.xml\nUser-agent: *\nDisallow:").sitemaps), ["https://x.fr/s.xml"]);
  assert.deepEqual(codes(h.evaluateHealth(base({ robots: { status: 200, text: "User-agent: *\nDisallow: /" } }))), ["robots_block_all"]);
  assert.equal(state(h.evaluateHealth(base({ robots: { status: 404, text: null } })), "robots"), "ok");
  assert.deepEqual(codes(h.evaluateHealth(base({ sitemap: { url: null, urls: [] }, crawl: [] }))), ["sitemap_missing"]);
  const broken = h.evaluateHealth(base({ crawl: [{ url: "https://exemple.fr/a", status: 404, finalUrl: "https://exemple.fr/a" }, { url: "https://exemple.fr/b", status: 200 }] }));
  assert.deepEqual(codes(broken), ["broken_pages"]);
  assert.match(broken.findings[0].detail, /\/a \(404\)/);
  assert.deepEqual(plain(h.readSitemap("<urlset><url><loc>https://x.fr/a</loc></url><url><loc> https://x.fr/b?x=1&amp;y=2 </loc></url></urlset>").urls), ["https://x.fr/a", "https://x.fr/b?x=1&y=2"]);
  assert.equal(h.readSitemap("<sitemapindex><sitemap><loc>https://x.fr/s1.xml</loc></sitemap></sitemapindex>").index, true);
  assert.equal(h.crawlSample(Array.from({ length: 100 }, (_, i) => `u${i}`), 20).length, 20);
});

test("Core Web Vitals and indexation: field data thresholds, home page not indexed is critical", () => {
  assert.deepEqual(codes(h.evaluateHealth(base({ vitals: { lcpMs: 4800, inpMs: 150, cls: 0.05 } }))), ["vitals_poor"]);
  assert.deepEqual(codes(h.evaluateHealth(base({ vitals: { lcpMs: 3000, inpMs: 150, cls: 0.05 } }))), ["vitals_weak"]);
  assert.equal(state(h.evaluateHealth(base({ vitals: { scope: "unavailable" } })), "vitals"), "unverified");
  const notIndexed = h.evaluateHealth(base({ inspections: [{ url: "https://exemple.fr/", verdict: "NEUTRAL", coverage: "Explorée, actuellement non indexée", robots: "ALLOWED", indexing: "INDEXING_ALLOWED" }, { url: "https://exemple.fr/a", verdict: "FAIL", coverage: "Introuvable (404)", robots: "ALLOWED", indexing: null }] }));
  assert.deepEqual(codes(notIndexed), ["home_not_indexed", "pages_not_indexed"]);
  assert.equal(notIndexed.findings[0].severity, "critical");
  assert.equal(state(h.evaluateHealth(base({ inspections: null })), "index"), "unverified");
  assert.deepEqual(plain(h.readInspection("https://x.fr/", { inspectionResult: { indexStatusResult: { verdict: "PASS", coverageState: "Envoyée et indexée" } } })), { url: "https://x.fr/", verdict: "PASS", coverage: "Envoyée et indexée", robots: null, indexing: null });
});

test("registry, schedule and incidents: RDAP expiration, weekly cadence, retry after a failure, low findings never open incidents", () => {
  assert.equal(h.registrableDomain("www.exemple.fr"), "exemple.fr");
  assert.equal(h.registrableDomain("boutique.exemple.co.uk"), "exemple.co.uk");
  assert.equal(h.rdapExpiration({ events: [{ eventAction: "registration", eventDate: "2020-01-01T00:00:00Z" }, { eventAction: "expiration", eventDate: "2027-01-01T00:00:00Z" }] }), "2027-01-01T00:00:00Z");
  assert.equal(h.rdapExpiration({}), null);
  assert.equal(h.healthDue({ lastCheckAt: null, lastFailureAt: null }, now), true);
  assert.equal(h.healthDue({ lastCheckAt: inDays(-3), lastFailureAt: null }, now), false);
  assert.equal(h.healthDue({ lastCheckAt: inDays(-8), lastFailureAt: null }, now), true);
  assert.equal(h.healthDue({ lastCheckAt: inDays(-8), lastFailureAt: inDays(-0.5) }, now), false, "failed 12 h ago");
  assert.equal(h.opensIncident({ severity: "low" }), false);
  assert.equal(h.healthFingerprint("c", "ssl_expired"), "site-health:c:ssl_expired");
  const service = readFileSync("lib/site-health/service.ts", "utf8");
  assert.match(service, /inAuditWindow\(now\)/, "night only");
  assert.match(service, /verified\.has\(checkOf\[code\]\)/, "an unverified check never resolves an incident");
  const route = readFileSync("app/api/internal/scheduler/tick/route.ts", "utf8");
  assert.ok(route.indexOf('step("site_health"') > route.indexOf('step("video_agent"'), "runs last");
});

test("report and briefing read the latest site health check", () => {
  const health = { checked_at: "2026-11-16T02:00:00Z", score: 70, checks: [{ key: "tls", label: "Certificat HTTPS", state: "ok", detail: "Valide encore 60 jours." }, { key: "index", label: "Indexation Google", state: "unverified", detail: "Search Console non reliée." }], findings: [{ code: "broken_pages", severity: "high", title: "Pages du sitemap en erreur", detail: "2 pages en erreur." }] };
  const lines = insights.siteHealthLines(health).join("\n");
  assert.match(lines, /Santé technique du site \(contrôle du 16 novembre\) : 70\/100, 1 point à corriger/);
  assert.match(lines, /Indexation Google : non vérifié/);
  assert.deepEqual(plain(insights.siteHealthLines(null)), []);
  const priorities = insights.extrasPriorities({ ...insights.emptyExtras(), siteHealth: health });
  assert.match(plain(priorities).map((p) => p.internal).join(" "), /Pages du sitemap en erreur/);
  const signals = b.monitoringSignals([], [], new Date("2026-11-18T10:00:00Z"), [{ score: 70, findings: health.findings, checked_at: health.checked_at }]);
  assert.match(signals.facts.map((f) => f.statement).join(" "), /1 site contrôlé .* 1 problème important/);
});
