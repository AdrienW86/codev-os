// Agents Monitoring, Rapport et Veille : diagnostics d'expert purs (sans réseau ni base).
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";
const monitoring = loadTs("lib/monitoring/evaluate.ts");
const reports = loadTs("lib/reports/build.ts");
const rank = loadTs("lib/news/rank.ts");
const codes = (audit) => audit.issues.map((issue) => issue.code);

const goodPage = `<!doctype html><html lang="fr"><head><title>Couvreur à Lyon — Toitures Martin</title>
<meta name="description" content="Réparation, rénovation et entretien de toiture à Lyon et alentours : diagnostic, devis détaillé et conseils pour protéger votre maison.">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="canonical" href="https://toitures.fr/">
<meta property="og:title" content="Toitures"><meta property="og:image" content="https://toitures.fr/og.jpg">
<script type="application/ld+json">{"@type":"LocalBusiness"}</script></head><body><h1>Couvreur à Lyon</h1></body></html>`;
const base = { requestedUrl: "https://toitures.fr/", finalUrl: "https://toitures.fr/", status: 200, headers: { "content-type": "text/html", "strict-transport-security": "max-age=31536000" }, ms: 300 };

test("monitoring: a healthy page scores 100 with no issue", () => {
  const audit = monitoring.auditPage({ ...base, body: goodPage });
  assert.equal(audit.issues.length, 0); assert.equal(audit.score, 100);
});

test("monitoring: accidental noindex, missing title/viewport, foreign canonical, HTTP and mixed content are caught and ranked", () => {
  const bad = goodPage.replace(/<title>.*<\/title>/, "").replace(/<meta name="viewport"[^>]*>/, "<meta name=\"robots\" content=\"noindex, nofollow\">")
    .replace('href="https://toitures.fr/"', 'href="https://preprod.agence.fr/"').replace("<h1>", '<img src="http://cdn.fr/a.png"><h1>');
  const audit = monitoring.auditPage({ ...base, body: bad, ms: 5200 });
  for (const code of ["noindex_meta", "title_missing", "viewport_missing", "canonical_foreign", "mixed_content", "slow_ttfb"]) assert.ok(codes(audit).includes(code), code);
  assert.equal(audit.issues[0].severity, "critical");
  assert.ok(audit.score < 30);
  const http = monitoring.auditPage({ ...base, finalUrl: "http://toitures.fr/", headers: { "content-type": "text/html", "x-robots-tag": "noindex" }, body: goodPage });
  assert.ok(codes(http).includes("no_https") && codes(http).includes("noindex_header"));
});

test("monitoring: a non-HTML response is never reported as missing title or description", () => {
  const audit = monitoring.auditPage({ ...base, headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(codes(audit).some((code) => /title|description|viewport|h1/.test(code)), false);
});

const day = (date, clicks, impressions, position = 5) => ({ date, clicks, impressions, position });
const days = (from, count, clicks, impressions, position) => Array.from({ length: count }, (_, i) => day(new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), clicks, impressions, position));
const emptyInput = { client: { id: "c", name: "Client" }, period: { start: "2026-10-01", end: "2026-10-31" }, projects: [], tasks: [], publications: [], recommendations: [], actions: [], incidents: [], runs: [], siteChecks: [], metrics: [] };
const derived = { uptime: null, avgResponse: null, overdue: 0, pendingRecommendations: 0, pendingActions: 0, openIncidents: 0, toValidate: 0 };

test("report: priorities come only from the report's own figures, most important first", () => {
  assert.equal(reports.reportPriorities(emptyInput, emptyInput.period, derived).length, 0, "no data, no invented priority");
  const input = { ...emptyInput, searchConsole: { property: "sc", days: [...days("2026-08-31", 31, 10, 100), ...days("2026-10-01", 31, 5, 100, 4)] }, metrics: [{ provider: "pagespeed", metric_key: "x", data: { performance: 38 } }] };
  const list = reports.reportPriorities(input, input.period, { ...derived, uptime: 98.2, overdue: 2, openIncidents: 1 });
  assert.match(list[0].internal, /incident/); assert.equal(list[0].client, null, "internal-only items never reach the client version");
  assert.ok(list.some((item) => /baisse de 50 %/.test(item.internal)));
  assert.ok(list.some((item) => /CTR de 5,0 %/.test(item.internal)) === false, "a 5 % CTR at position 4 is not flagged");
  assert.ok(list.some((item) => /38\/100/.test(item.internal)));
  const built = reports.buildReport("monthly", input, "2026-11-05");
  assert.ok(built.internal.sections.some((section) => section.title === "Priorités recommandées"));
  const clientPriorities = built.client.sections.find((section) => section.title === "Nos priorités pour la suite");
  assert.ok(clientPriorities.lines.length >= 1 && clientPriorities.lines.length <= 3);
});

test("veille: actionable news (algorithm updates, deprecations) outrank events, with a why-it-matters note", () => {
  const now = new Date("2026-11-05T00:00:00Z"), at = "2026-11-04T00:00:00Z";
  const update = rank.scoreItem({ title: "Google rolls out the November core update", summary: "", publishedAt: at }, "SEO", 1, now);
  const webinar = rank.scoreItem({ title: "SEO webinar recap", summary: "", publishedAt: at }, "SEO", 1, now);
  assert.ok(update > webinar);
  assert.match(rank.impactNote({ title: "Google rolls out the November core update", summary: "" }), /algorithme/);
  assert.equal(rank.impactNote({ title: "Bonnes pratiques de rédaction", summary: "" }), null);
});
