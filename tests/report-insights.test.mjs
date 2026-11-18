// Agent Rapport (lot 2 de l'architecture) : GA4, Lighthouse, diffusions par réseau, blog, newsletters, lectures croisées.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const insights = loadTs("lib/reports/insights.ts");
const build = loadTs("lib/reports/build.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));
const period = { start: "2026-11-09", end: "2026-11-15" };
const ok = { ok: true };
const ga4 = (overrides = {}) => ({
  version: 1, property: "123456", period: { start: "2026-10-17", end: "2026-11-15" }, previousPeriod: { start: "2026-09-17", end: "2026-10-16" },
  totals: { sessions: 800, users: 600, newUsers: 500, engagedSessions: 480, keyEvents: 24, pageViews: 2000, averageSessionSeconds: 70 },
  previousTotals: { sessions: 1000, users: 700, newUsers: 600, engagedSessions: 500, keyEvents: 20, pageViews: 2400, averageSessionSeconds: 65 },
  channels: [{ key: "Organic Search", sessions: 400, engagedSessions: 260, keyEvents: 12 }, { key: "Paid Search", sessions: 200, engagedSessions: 100, keyEvents: 8 }, { key: "Organic Social", sessions: 80, engagedSessions: 40, keyEvents: 1 }, { key: "Organic Maps", sessions: 40, engagedSessions: 30, keyEvents: 3 }],
  previousChannels: [{ key: "Organic Social", sessions: 50, engagedSessions: 20, keyEvents: 0 }],
  landingPages: [{ key: "/blog/refaire-sa-toiture", channel: "Organic Search", sessions: 30, engagedSessions: 20, keyEvents: 2 }, { key: "/blog/refaire-sa-toiture?utm=x", channel: "Organic Social", sessions: 5, engagedSessions: 2, keyEvents: 0 }],
  sourceMedium: [], adsCampaigns: [], keyEvents: [{ name: "appel", count: 15 }, { name: "formulaire", count: 9 }], devices: [], thresholded: false,
  sections: { totals: ok, previousTotals: ok, channels: ok, previousChannels: ok, landingPages: ok, keyEvents: ok },
  ...overrides,
});
const extras = (overrides = {}) => ({
  analytics: insights.readReportAnalytics(ga4()),
  lighthouse: [
    { strategy: "mobile", url: "https://site.fr", analyzed_at: "2026-11-12T02:00:00Z", scores: { performance: 42, accessibility: 91, bestPractices: 100, seo: 75 }, field: { lcpMs: 3100, inpMs: 240, cls: 0.12, scope: "origin" } },
    { strategy: "mobile", url: "https://site.fr", analyzed_at: "2026-11-05T02:00:00Z", scores: { performance: 60 }, field: {} },
    { strategy: "desktop", url: "https://site.fr", analyzed_at: "2026-11-12T03:00:00Z", scores: { performance: 0.88, seo: 0.95 }, field: {} },
  ],
  deliveries: [
    { platform: "facebook", published_at: "2026-11-10T08:00:00Z", subject: "Chantier de Perpignan" },
    { platform: "instagram", published_at: "2026-11-10T08:05:00Z", subject: "Chantier de Perpignan" },
    { platform: "google_business_profile", published_at: "2026-11-12T09:00:00Z", subject: "Démoussage" },
    { platform: "facebook", published_at: "2026-11-20T09:00:00Z", subject: "Hors période" },
  ],
  articles: [{ title: "Refaire sa toiture", slug: "refaire-sa-toiture", published_at: "2026-11-11T07:00:00Z", target_query: "refaire toiture prix" }],
  newsletters: [{ subject: "Novembre chez nous", sent_at: "2026-11-13T10:00:00Z", sent_count: 120 }],
  ...overrides,
});

test("GA4 snapshot: sessions, evolution, engagement, channels and key events; unread blocks are never zeros", () => {
  const lines = insights.analyticsLines(insights.readReportAnalytics(ga4()));
  assert.match(lines[0], /Google Analytics 4 \(30 jours du 17 octobre au 15 novembre\) : 800 sessions \(−20 %\), taux d’engagement 60 %, 24 conversions \(événements clés\) \(\+20 %\)/);
  assert.match(lines[1], /recherche naturelle 50 %, Google Ads 25 %, réseaux sociaux 10 %/);
  assert.match(lines[2], /appel 15, formulaire 9/);
  assert.equal(insights.readReportAnalytics({ ...ga4(), version: 2 }), null);
  const unread = insights.readReportAnalytics(ga4({ sections: { totals: { ok: false, error: "x" } } }));
  assert.equal(unread.totals, null);
  assert.deepEqual(plain(insights.analyticsLines(unread)), []);
  assert.match(insights.analyticsLines(insights.readReportAnalytics(ga4({ keyEvents: [] }))).join(" "), /Aucun événement clé/);
});

test("Lighthouse keeps the latest audit per device, scales 0-1 scores and shows field Core Web Vitals", () => {
  const lines = insights.lighthouseLines(extras().lighthouse);
  assert.match(lines[0], /Lighthouse mobile \(audit du 12 novembre\) : performance 42\/100, accessibilité 91\/100, bonnes pratiques 100\/100, SEO 75\/100/);
  assert.match(lines[1], /LCP 3,1 s, INP 240 ms, CLS 0,12/);
  assert.match(lines[2], /Lighthouse ordinateur.*performance 88\/100, SEO 95\/100/);
});

test("deliveries are counted per network inside the period only, with dated detail", () => {
  const lines = insights.deliveryLines(extras().deliveries, period, true);
  assert.match(lines[0], /3 publications diffusées : Facebook 1, Google Business Profile 1, Instagram 1/);
  assert.match(lines[1], /10 novembre · Facebook · Chantier de Perpignan/);
  assert.equal(lines.length, 4);
  assert.equal(insights.deliveryLines(extras().deliveries, period, false).length, 1);
});

test("cross readings juxtapose measures, never claim causes, and need both sides", () => {
  const lines = insights.crossReadings({ period, extras: extras(), ads: { cost: 310.5, conversions: 7, clicks: 400 }, searchClicks: 150 });
  const text = lines.join("\n");
  assert.match(text, /Réseaux sociaux : 2 posts diffusés.*80 visites.*\(\+60 %\).*aucun lien de cause/);
  assert.match(text, /Google Business Profile : 1 post.*40 visites venues de Google Maps/);
  assert.match(text, /Article « Refaire sa toiture » : 35 visites en page d’entrée dont 30 depuis Google, 2 conversions.*requête visée « refaire toiture prix »/);
  assert.match(text, /Payant et naturel : Google Ads 310,50 € pour 7 conversions.*200 visites et 8 conversions via Google Ads contre 400 visites et 12 conversions/);
  assert.match(text, /Recherche naturelle : 150 clics.*12 conversions.*3,0 %/);
  assert.match(text, /Vitesse et engagement : performance mobile 42\/100/);
  assert.doesNotMatch(text, /grâce à|a permis|a provoqué|a entraîné/);
  assert.deepEqual(plain(insights.crossReadings({ period, extras: extras({ analytics: null }), ads: null, searchClicks: null })), []);
});

test("buildReport adds content per network, audience, Lighthouse and cross readings to both versions", () => {
  const input = { client: { id: "c", name: "Toitures" }, period, projects: [], tasks: [], publications: [], recommendations: [], actions: [], incidents: [], runs: [], siteChecks: [], metrics: [], searchConsole: null, extras: extras() };
  const report = plain(build.buildReport("weekly", input, "2026-11-16"));
  const titles = report.internal.sections.map((section) => section.title);
  for (const title of ["Contenus diffusés par réseau", "Blog et newsletters", "Audience et conversions (Google Analytics 4)", "Qualité du site (Lighthouse)", "Lectures croisées", "Priorités recommandées"]) assert.ok(titles.includes(title), title);
  assert.equal(report.internal.empty, false);
  assert.match(report.internal.highlights[0], /3 publications diffusées sur les réseaux/);
  const priorities = report.internal.sections.find((section) => section.title === "Priorités recommandées").lines.join(" ");
  assert.match(priorities, /Visites du site en baisse de 20 %/);
  assert.match(priorities, /Lighthouse mobile : performance 42\/100/);
  const client = report.client.sections;
  assert.match(client.find((section) => section.title === "Contenus publiés").lines.join(" "), /Facebook 1.*Article publié le 11 novembre.*Newsletter envoyée le 13 novembre/);
  assert.match(client.find((section) => section.title === "Résultats").lines.join(" "), /Google Analytics 4/);
  assert.ok(client.some((section) => section.title === "Lectures croisées"));
  // Sans les nouvelles sources, le rapport reste celui d'avant.
  const legacy = plain(build.buildReport("weekly", { ...input, extras: undefined }, "2026-11-16"));
  assert.equal(legacy.internal.empty, true);
});

test("report gathering reads the new sources read-only and excludes daily GA4 windows from generic metrics", () => {
  const service = readFileSync("lib/reports/service.ts", "utf8");
  assert.match(service, /\.neq\("provider", "google-analytics"\)/);
  assert.match(service, /gatherReportExtras\(clientId, period\)/);
  const extrasService = readFileSync("lib/reports/extras-service.ts", "utf8");
  assert.doesNotMatch(extrasService, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|fetch\(/);
  for (const table of ["metric_snapshots", "performance_audits", "publication_deliveries", "blog_articles", "email_newsletters", "audit_logs"]) assert.match(extrasService, new RegExp(`from\\("${table}"\\)`));
});
