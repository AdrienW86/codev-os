import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";
// Rapports complets : un document par agent (Google Ads, référencement, site, réseaux), PDF avec graphiques, e-mail générique.
const model = loadTs("lib/reports/documents/model.ts");
const preview = loadTs("lib/reports/email-preview.ts", { "./recipient": loadTs("lib/reports/recipient.ts"), "./documents/model": model });
const pdf = loadTs("lib/reports/pdf.ts", { "./email-preview": preview });
const build = loadTs("lib/reports/documents/build.ts");
const documentPdf = loadTs("lib/reports/documents/pdf.ts", { "../pdf": pdf, "./model": model });
const json = (value) => JSON.parse(JSON.stringify(value));
const period = { start: "2026-09-01", end: "2026-09-30" };
const days = build.daysOf(period);
const metrics = (cost, clicks, conversions) => ({ cost, clicks, impressions: clicks * 10, conversions, conversionValue: null, ctr: 0.1, averageCpc: cost / clicks, costPerConversion: conversions ? cost / conversions : null });
const campaign = (id, name, values, localServices = false) => ({ id, name, status: "ENABLED", type: localServices ? "LOCAL_SERVICES" : "SEARCH", subType: null, localServices, budget: { amount: null, shared: null, period: null }, hasActivity: true, metrics: values, previous: null });

test("variations: relative, points and places, with the right appreciation", () => {
  assert.deepEqual(json(build.variation(120, 100)), { change: "+20 %", trend: "up", good: true });
  assert.deepEqual(json(build.variation(25, 30, { lowerIsBetter: true })), { change: "−17 %", trend: "down", good: true });
  assert.deepEqual(json(build.variation(0.071, 0.07, { mode: "points" })), { change: "+0,1 pt", trend: "up", good: true });
  assert.deepEqual(json(build.variation(9.5, 12, { mode: "places", lowerIsBetter: true })), { change: "−2,5 places", trend: "down", good: true });
  assert.deepEqual(json(build.variation(5, null)), {}, "unknown previous period: no invented comparison");
  assert.deepEqual(json(build.variation(3, 0)), {}, "no percentage from zero");
});

test("Google Ads document: KPIs, daily charts, campaigns and Local Services leads; nothing invented", () => {
  const document = build.buildAdsDocument({ currency: "EUR", campaigns: [campaign("1", "Dératisation", metrics(400, 300, 20)), campaign("2", "Local Services", metrics(100, 10, 0), true)],
    totals: metrics(500, 310, 20), previousTotals: metrics(400, 300, 16), daily: [{ date: "2026-09-02", cost: 20, clicks: 12, impressions: 100, conversions: 1 }],
    leads: { available: true, total: 7, byType: { PHONE_CALL: 5, MESSAGE: 2 }, charged: null } }, period);
  assert.equal(model.reportDocumentSchema.safeParse(document).success, true);
  assert.equal(document.kpis.find((kpi) => kpi.label === "Leads Local Services").value, "7");
  assert.equal(document.kpis.find((kpi) => kpi.label === "Budget dépensé").change, "+25 %");
  const daily = document.charts.find((chart) => chart.title === "Budget dépensé par jour");
  assert.equal(daily.labels.length, 30); assert.equal(daily.series[0].values[1], 20); assert.equal(daily.series[0].values[0], 0, "a day without Ads row has no spend");
  const leads = document.tables.find((table) => table.title === "Leads Local Services par type");
  assert.deepEqual(json(leads.rows), [["Appels", "5"], ["Messages", "2"], ["Total", "7"]], "billing unknown: not shown as zero");
  const named = build.buildAdsDocument({ currency: "EUR", campaigns: [campaign("1", "LocalServicesCampaign:SystemGenerated:0001", metrics(100, 10, 2), true), campaign("2", "Ancienne", { ...metrics(0, 1, 0), clicks: 0, impressions: 0 })],
    totals: metrics(100, 10, 2), previousTotals: null, daily: null, leads: null }, period);
  assert.deepEqual(json(named.tables[0].rows.map((row) => row[0])), ["Annonces Local Services"], "technical names replaced, idle campaigns left out");
  assert.match(named.summary, /1 campagne active/);
  const unavailable = build.buildAdsDocument({ currency: "EUR", campaigns: [], totals: metrics(0, 1, 0), previousTotals: null, daily: null, leads: { available: false, reason: "x" } }, period);
  assert.match(unavailable.summary, /Aucune diffusion/); assert.ok(unavailable.notes.some((note) => /n’ont pas pu être récupérés/.test(note)));
});

test("Search Console document: weighted position, no comparison on partial data", () => {
  const all = [...build.daysOf(build.previousOf(period)), ...days].map((date) => ({ date, clicks: 10, impressions: 200, position: 8 }));
  const full = build.buildSearchDocument({ days: all }, period);
  assert.equal(full.kpis[0].value, "300"); assert.equal(full.kpis[0].change, "stable"); assert.equal(full.kpis[3].value, "8,0");
  const partial = build.buildSearchDocument({ days: all.filter((row) => row.date <= "2026-09-27") }, period);
  assert.equal(partial.kpis[0].change, undefined); assert.ok(partial.notes.some((note) => /27 jours sur 30/.test(note)));
  assert.equal(build.buildSearchDocument({ days: [] }, period), null, "no Search Console data: no document");
});

test("Site and social documents: readable labels, comparisons only when known", () => {
  const site = build.buildSiteDocument({ visitors: 100, pageviews: 250, previous: { visitors: 80, pageviews: 200, events: [] }, trend: [{ timestamp: "2026-09-01T00:00:00.000Z", visitors: 4, pageviews: 9 }, { timestamp: "2026-09-02T00:00:00.000Z", visitors: 5, pageviews: 11 }],
    topPages: [{ label: "/contact", visitors: 20, pageviews: 30 }], devices: [{ label: "mobile", visitors: 75 }, { label: "desktop", visitors: 25 }], events: [{ label: "phone_click", count: 6 }] }, period);
  assert.equal(site.kpis[0].change, "+25 %");
  assert.deepEqual(json(site.tables.find((table) => table.title === "Appareils utilisés").rows[0]), ["Mobile", "75", "75 %"]);
  assert.equal(site.tables.find((table) => table.title === "Actions des visiteurs").rows[0][0], "Clic sur le téléphone");
  assert.equal(build.buildSiteDocument({ events: [] }, period), null);
  assert.equal(build.buildSiteDocument({ visitors: 0, pageviews: 0 }, period), null, "0 visit (expired history): no misleading document");
  const social = build.buildSocialDocument({ channels: ["facebook", "instagram"], previousCount: 2, posts: [
    { date: "2026-09-03", platform: "facebook", subject: "Toiture" }, { date: "2026-09-03", platform: "instagram", subject: "Toiture" }, { date: "2026-08-20", platform: "facebook", subject: "Ancien" }] }, period);
  assert.equal(social.kpis[0].value, "2"); assert.equal(social.tables[0].rows.length, 2, "only posts of the period are listed");
  assert.equal(build.buildSocialDocument({ channels: [], previousCount: null, posts: [] }, period), null);
  assert.equal(build.buildSocialDocument({ channels: ["facebook"], previousCount: 0, posts: [] }, period), null, "service not started yet");
  assert.match(build.buildSocialDocument({ channels: ["facebook"], previousCount: 3, posts: [] }, period).summary, /Aucune publication/);
});

test("Schema refuses inconsistent charts and tables; PDF renders charts as vectors with escaped text", () => {
  assert.equal(model.reportDocumentSchema.safeParse({ key: "site", title: "T", summary: "", kpis: [], charts: [{ type: "bar", title: "x", labels: ["a", "b"], series: [{ name: "s", values: [1] }] }], tables: [], notes: [] }).success, false);
  assert.equal(model.reportDocumentSchema.safeParse({ key: "site", title: "T", summary: "", kpis: [], charts: [], tables: [{ title: "x", columns: ["a", "b"], rows: [["1"]] }], notes: [] }).success, false);
  assert.throws(() => model.clientDocuments({ documents: [{ key: "x" }] }));
  assert.deepEqual(json(model.clientDocuments({ summary: "s" })), [], "older reports: no documents");
  const document = build.buildSocialDocument({ channels: ["facebook"], previousCount: null, posts: [{ date: "2026-09-03", platform: "facebook", subject: ") Tj /Evil (" }] }, period);
  const buffer = documentPdf.renderReportDocumentPdf({ clientName: "Client ) Tj", kindLabel: "Rapport mensuel", periodLabel: "septembre 2026", version: 2, finalized: true }, document);
  const raw = buffer.toString("latin1");
  assert.match(raw, /^%PDF-1\.4/); assert.match(raw, /%%EOF\n$/);
  assert.doesNotMatch(raw, /\/Evil|\/JavaScript|\/URI/, "content only as hex strings");
  assert.match(raw, / re f/, "vector shapes drawn");
  assert.equal(documentPdf.documentPdfFilename({ clientName: "Protection Nuisibles", version: 2 }, document, "2026-09-01"), "code-v-protection-nuisibles-reseaux-sociaux-2026-09-01-v2.pdf");
  const draft = documentPdf.renderReportDocumentPdf({ clientName: "C", kindLabel: "Rapport", periodLabel: "p", version: 1, finalized: false }, document).toString("latin1");
  assert.ok(draft.length > 0);
});

test("Generic e-mail for a full report; the legacy text e-mail is unchanged", () => {
  const document = build.buildSocialDocument({ channels: ["facebook"], previousCount: 2, posts: [] }, period);
  const email = preview.reportEmailPreview({ title: "Rapport mensuel — Jrenov — septembre 2026", version: 1, kind: "monthly", period_start: "2026-09-01", period_end: "2026-09-30", client_content: { summary: "s", sections: [], documents: [document] } });
  assert.equal(email.text, "Bonjour,\n\nVous trouverez ci-joint votre rapport mensuel de septembre 2026.\nIl comprend 1 document : Réseaux sociaux.\n\nNous restons à votre disposition pour en parler.\n\nCordialement,\nL’équipe CODE-V");
  const weekly = preview.genericReportEmail("weekly", [{ key: "google_ads" }, { key: "site" }], { start: "2026-10-19", end: "2026-10-25" });
  assert.match(weekly, /rapport hebdomadaire du 19 octobre au 25 octobre 2026\.\nIl comprend 2 documents : Google Ads, Site web\./);
  const legacy = preview.reportEmailPreview({ title: "T", version: 1, client_content: { summary: "Synthèse", sections: [{ title: "Résultats", lines: ["Mesures"] }] } });
  assert.equal(legacy.text, "Synthèse\n\nRésultats\n• Mesures");
});
