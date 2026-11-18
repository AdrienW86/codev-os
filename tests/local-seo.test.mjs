// Architecture des agents, lot 6 : référencement local (Agent SEO). Statistiques et avis de la fiche Google Business
// Profile, en lecture seule ; jamais de réponse automatique aux avis ; jamais de zéro inventé.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const l = loadTs("lib/local-seo/model.ts");
const insights = loadTs("lib/reports/insights.ts");
const b = loadTs("lib/harness/briefing.ts");
const now = new Date("2026-11-18T10:00:00.000Z");
const plain = (value) => JSON.parse(JSON.stringify(value));
const point = (day, value) => ({ date: { year: 2026, month: Number(day.slice(5, 7)), day: Number(day.slice(8, 10)) }, value: String(value) });

test("periods and cadence: 28 days ending 3 days ago, previous 28 days, weekly with 24 h retry", () => {
  assert.deepEqual(plain(l.localPeriods(now)), { current: { start: "2026-10-19", end: "2026-11-15" }, previous: { start: "2026-09-21", end: "2026-10-18" } });
  assert.equal(l.localDue({ lastAt: null, lastFailureAt: null }, now), true);
  assert.equal(l.localDue({ lastAt: "2026-11-15T10:00:00Z", lastFailureAt: null }, now), false);
  assert.equal(l.localDue({ lastAt: "2026-11-10T10:00:00Z", lastFailureAt: "2026-11-18T01:00:00Z" }, now), false);
  assert.ok(l.LOCATION_RE.test("accounts/123/locations/456"));
});

test("daily metrics: totals per period, Maps and Search views summed across devices, absent metric stays null", () => {
  const body = { multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [
    { dailyMetric: "CALL_CLICKS", timeSeries: { datedValues: [point("2026-11-01", 4), point("2026-11-02", 1), point("2026-10-01", 9), { date: { year: 2026, month: 11, day: 3 } }] } },
    { dailyMetric: "BUSINESS_IMPRESSIONS_MOBILE_MAPS", timeSeries: { datedValues: [point("2026-11-01", 100)] } },
    { dailyMetric: "BUSINESS_IMPRESSIONS_DESKTOP_MAPS", timeSeries: { datedValues: [point("2026-11-01", 20)] } },
    { dailyMetric: "WEBSITE_CLICKS", timeSeries: {} },
  ] }] };
  const current = l.readDailyMetrics(body, { start: "2026-10-18", end: "2026-11-15" });
  assert.deepEqual(plain(current), { impressionsMaps: 120, impressionsSearch: null, calls: 5, websiteClicks: 0, directions: null, conversations: null, bookings: null });
  assert.equal(l.readDailyMetrics(body, { start: "2026-09-20", end: "2026-10-17" }).calls, 9);
  assert.equal(l.readDailyMetrics({}, { start: "2026-10-18", end: "2026-11-15" }), null);
});

test("keywords and reviews: masked volumes kept as thresholds, first name only, Google translation removed", () => {
  assert.deepEqual(plain(l.readKeywords({ searchKeywordsCounts: [{ searchKeyword: "plombier strasbourg", insightsValue: { value: "120" } }, { searchKeyword: "chauffagiste", insightsValue: { threshold: "15" } }] })),
    [{ keyword: "plombier strasbourg", impressions: 120, threshold: null }, { keyword: "chauffagiste", impressions: null, threshold: 15 }]);
  assert.deepEqual(plain(l.readKeywords({})), []);
  const reviews = l.readReviews({ averageRating: 4.66, totalReviewCount: 31, reviews: [
    { starRating: "TWO", createTime: "2026-11-10T08:00:00Z", reviewer: { displayName: "Jean Dupont" }, comment: "Retard important.\n\n(Translated by Google) ..." },
    { starRating: "FIVE", createTime: "2026-11-12T08:00:00Z", reviewer: { displayName: "Marie" }, comment: "Parfait", reviewReply: { comment: "Merci !" } },
  ] });
  assert.equal(reviews.average, 4.7); assert.equal(reviews.total, 31);
  assert.deepEqual(plain(reviews.recent[1]), { rating: 2, at: "2026-11-10T08:00:00.000Z", replied: false, author: "Jean", excerpt: "Retard important." });
  assert.equal(reviews.recent[0].replied, true);
});

test("findings: unanswered negative review is high, unanswered reviews medium, drop in actions medium", () => {
  const snapshot = (over) => ({ period: { start: "2026-10-18", end: "2026-11-15" }, metrics: null, previous: null, keywords: [], reviews: null, ...over });
  const neg = l.evaluateLocal(snapshot({ reviews: { total: 10, average: 4, recent: [{ rating: 2, at: "2026-11-10T08:00:00Z", replied: false, author: null, excerpt: null }] } }), now);
  assert.deepEqual(plain(neg.map((f) => [f.code, f.severity])), [["negative_review_unanswered", "high"]]);
  assert.match(neg[0].fix, /aucune réponse n’est publiée sans validation/);
  const two = l.evaluateLocal(snapshot({ reviews: { total: 10, average: 5, recent: [{ rating: 5, at: "2026-11-10T08:00:00Z", replied: false }, { rating: 4, at: "2026-11-09T08:00:00Z", replied: false }] } }), now);
  assert.deepEqual(plain(two.map((f) => f.code)), ["reviews_unanswered"]);
  const drop = l.evaluateLocal(snapshot({ metrics: { calls: 5, websiteClicks: 5, directions: 2 }, previous: { calls: 20, websiteClicks: 10, directions: 10 } }), now);
  assert.deepEqual(plain(drop.map((f) => f.code)), ["actions_drop"]);
  assert.match(drop[0].detail, /12 sur 28 jours contre 40/);
  const service = readFileSync("lib/local-seo/service.ts", "utf8");
  assert.doesNotMatch(service, /reply|POST/, "never answers a review");
  const transport = readFileSync("lib/integrations/gbp-insights.ts", "utf8");
  assert.match(transport, /method:'GET'/); assert.doesNotMatch(transport, /method:'(POST|PUT|PATCH|DELETE)'/);
});

test("report and briefing: local lines with change, reviews, keywords; GBP cross-reading uses real actions", () => {
  const local = { location_title: "JRénov", period_start: "2026-10-18", period_end: "2026-11-15",
    metrics: { impressionsMaps: 900, impressionsSearch: 300, calls: 12, websiteClicks: 30, directions: 8 }, previous_metrics: { impressionsMaps: 800, impressionsSearch: 300, calls: 10, websiteClicks: 30, directions: 8 },
    keywords: [{ keyword: "renovation strasbourg", impressions: 80, threshold: null }, { keyword: "salle de bain", impressions: null, threshold: 15 }],
    reviews: { total: 31, average: 4.7, recent: [{ rating: 2, at: "2026-11-10T08:00:00.000Z", replied: false }] } };
  const lines = insights.localLines([local]).join("\n");
  assert.match(lines, /Fiche Google « JRénov » du 18 octobre au 15 novembre : 900 vues sur Google Maps \(\+13 %\), 300 vues dans la recherche Google \(\+0 %\), 12 appels \(\+20 %\)/);
  assert.match(lines, /Avis Google « JRénov » : note moyenne 4,7\/5 sur 31 avis, 1 nouvel avis sur la période, 1 sans réponse/);
  assert.match(lines, /« salle de bain » \(moins de 15\)/);
  const extras = { ...insights.emptyExtras(), local: [local], deliveries: [{ platform: "google_business_profile", published_at: "2026-11-05T09:00:00Z", subject: "x" }] };
  const cross = insights.crossReadings({ period: { start: "2026-11-01", end: "2026-11-30" }, extras, ads: null, searchClicks: null }).join("\n");
  assert.match(cross, /1 post sur la période, à mettre en regard de 12 appels, 30 clics vers le site et 8 demandes d’itinéraire/);
  assert.match(plain(insights.extrasPriorities(extras)).map((p) => p.internal).join(" "), /Avis Google négatif sans réponse/);
  const signals = b.localSignals([{ location_title: "JRénov", metrics: local.metrics, reviews: local.reviews, fetched_at: "2026-11-18T08:00:00Z" }]);
  assert.match(signals.facts.map((f) => f.statement).join(" "), /12 appels, 30 clics vers le site, 8 itinéraires.*4,7\/5 sur 31 avis, 1 récent\(s\) sans réponse/);
  assert.deepEqual(plain(b.localSignals(null)), { facts: [], gaps: [] });
});
