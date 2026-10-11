import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const vm = () => loadTs("lib/analytics/view-model.ts");
const today = new Date("2026-10-11T15:00:00Z");

const data = {
  visitors: 100, pageviews: 250,
  trend: [
    { timestamp: "2026-10-05T00:00:00.000Z", visitors: 10, pageviews: 20 },
    { timestamp: "2026-10-06T00:00:00.000Z", visitors: 20, pageviews: 50 },
    { timestamp: "2026-10-13T00:00:00.000Z", visitors: 5, pageviews: 9 },
  ],
  previous: { visitors: 80, pageviews: 250, events: [{ label: "lead_form_submit", count: 2, visitors: 2 }] },
  topReferrers: [{ label: "www.google.com", visitors: 50 }, { label: "l.facebook.com", visitors: 10 }, { label: "annuaire.fr", visitors: 5 }],
  events: [{ label: "lead_form_submit", count: 4, visitors: 4 }, { label: "phone_click", count: 6, visitors: 5 }, { label: "image_view", count: 2, visitors: 2 }],
  countries: [{ label: "FR", visitors: 90 }, { label: "BE", visitors: 4 }, { label: "CH", visitors: 2 }],
};

test("period comes from the URL, defaults to 7 days and rejects invalid ranges", () => {
  const { resolvePeriod } = vm();
  assert.deepEqual({ ...resolvePeriod({}, today) }, { preset: "7", start: "2026-10-05", end: "2026-10-11" });
  assert.equal(resolvePeriod({ period: "30" }, today).start, "2026-09-12");
  assert.deepEqual({ ...resolvePeriod({ period: "custom", start: "2026-09-01", end: "2026-09-30" }, today) }, { preset: "custom", start: "2026-09-01", end: "2026-09-30" });
  assert.equal(resolvePeriod({ period: "custom", start: "2026-09-30", end: "2026-09-01" }, today).preset, "7");
  assert.equal(resolvePeriod({ period: "custom", start: "2020-01-01", end: "2026-09-01" }, today).preset, "7");
});

test("KPIs derive only from collected data: deltas, events split, no invented bounce rate", () => {
  const kpis = Object.fromEntries(vm().buildKpis(data).map((kpi) => [kpi.key, kpi]));
  assert.equal(kpis.visitors.value, 100);
  assert.equal(kpis.visitors.delta, 25);
  assert.equal(kpis.pageviews.delta, 0);
  assert.equal(kpis.pagesPerVisitor.value, 2.5);
  assert.equal(kpis.forms.value, 4);
  assert.equal(kpis.forms.delta, 100);
  assert.equal(kpis.cta.value, 6);
  assert.equal(kpis.cta.delta, null);
  assert.equal(kpis.conversions.value, 10);
  assert.equal(kpis.conversions.delta, 400);
  assert.match(kpis.conversions.hint, /10 % des visites/);
  assert.ok(!Object.keys(kpis).includes("bounceRate"));
  const empty = Object.fromEntries(vm().buildKpis({ visitors: 10, pageviews: 10 }).map((kpi) => [kpi.key, kpi]));
  assert.equal(empty.forms.value, null);
  assert.equal(empty.conversions.value, null);
  assert.equal(empty.visitors.delta, null);
});

test("referrers are grouped by channel; direct traffic is an explicit estimate", () => {
  const rows = Object.fromEntries(vm().trafficChannels(data).map((row) => [row.key, row]));
  assert.equal(rows.search.visitors, 50);
  assert.equal(rows.social.visitors, 10);
  assert.equal(rows.referral.visitors, 5);
  assert.equal(rows.direct.visitors, 35);
  assert.equal(rows.direct.estimated, true);
  assert.equal(rows.search.share, 50);
});

test("trend buckets by week and month; labels, flags and CSV export stay safe", () => {
  const { trendSeries, countryFlag, countryLabel, eventLabel, analyticsCsv, topWithOthers } = vm();
  const weeks = trendSeries(data, "visitors", "week");
  assert.deepEqual(JSON.parse(JSON.stringify(weeks.map((point) => [point.key, point.value]))), [["2026-10-05", 30], ["2026-10-12", 5]]);
  assert.equal(trendSeries(data, "visitors", "month")[0].value, 35);
  assert.equal(trendSeries(data, "conversions", "day").length, 0);
  assert.equal(countryFlag("fr"), "🇫🇷");
  assert.equal(countryLabel("FR"), "France");
  assert.equal(eventLabel("phone_click"), "Clic sur numéro de téléphone");
  assert.equal(eventLabel("customEventName"), "Custom Event Name");
  const others = topWithOthers(data.countries, "visitors", 100, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(others.map((row) => [row.label, row.value]))), [["FR", 90], ["BE", 4], ["Autres", 6]]);
  const csv = analyticsCsv({ ...data, topPages: [{ label: "=HYPERLINK(\"x\")", visitors: 1, pageviews: 1 }] }, { client: "Client; test", period: { preset: "7", start: "2026-10-05", end: "2026-10-11" } });
  assert.match(csv, /^Client;"Client; test"/);
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
});

test("the analytics page is guarded, keeps the client in the URL and reuses the existing Vercel sync", () => {
  const page = readFileSync(new URL("../app/(cockpit)/analytics/page.tsx", import.meta.url), "utf8");
  assert.match(page, /await requireAdmin\(\);/);
  assert.match(page, /redirect\(`\/analytics\?/);
  const loader = readFileSync(new URL("../lib/analytics/dashboard.ts", import.meta.url), "utf8");
  assert.match(loader, /syncVercelAnalytics/);
  assert.doesNotMatch(loader, /api\.vercel\.com/);
});
