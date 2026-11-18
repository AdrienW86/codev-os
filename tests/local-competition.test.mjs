// Architecture des agents, lot 7 (version gratuite + DataForSEO facultatif) : positions Search Console et concurrence
// locale « métier ville ». Jamais de position inventée ; contenu Google Places jamais archivé dans un rapport.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const m = loadTs("lib/local-competition/model.ts");
const insights = loadTs("lib/reports/insights.ts");
const b = loadTs("lib/harness/briefing.ts");
const now = new Date("2026-11-18T10:00:00.000Z");
const plain = (value) => JSON.parse(JSON.stringify(value));

const place = (name, rating, count, site) => ({ id: `p-${name}`, displayName: { text: name }, rating, userRatingCount: count, websiteUri: site, businessStatus: "OPERATIONAL" });

test("targets: activity + first city of the area; national clients and missing data are skipped", () => {
  const t = m.competitionTarget({ id: "c1", company_name: "Couverture Catalane", activity: "Couvreur", geographic_area: "Perpignan, Cabestany et Pyrénées-Orientales", website: "https://www.couverture-catalane.fr/" });
  assert.deepEqual(plain(t), { clientId: "c1", company: "Couverture Catalane", activity: "Couvreur", city: "Perpignan", domain: "couverture-catalane.fr" });
  assert.equal(m.competitionKeyword(t), "couvreur Perpignan");
  assert.equal(m.competitionTarget({ id: "c2", company_name: "Jrenov", activity: "Couvreur", geographic_area: "Lyon et périphérie" }).city, "Lyon");
  assert.equal(m.competitionTarget({ id: "c3", company_name: "CODE-V", activity: "Programmation", geographic_area: "France" }), null);
  assert.equal(m.competitionTarget({ id: "c4", company_name: "X", activity: "", geographic_area: "Perpignan" }), null);
});

test("cadence: weekly, 24 h retry after a failure", () => {
  assert.equal(m.competitionDue({ lastAt: null, lastFailureAt: null }, now), true);
  assert.equal(m.competitionDue({ lastAt: "2026-11-14T10:00:00Z", lastFailureAt: null }, now), false);
  assert.equal(m.competitionDue({ lastAt: "2026-11-11T10:00:00Z", lastFailureAt: null }, now), true);
  assert.equal(m.competitionDue({ lastAt: "2026-11-01T10:00:00Z", lastFailureAt: "2026-11-18T02:00:00Z" }, now), false);
});

test("Places parsing, client found by domain then by name, medians of the top 5 competitors", () => {
  const body = { places: [place("Toiture Pro 66", 4.8, 120, "https://toiturepro66.fr"), { ...place("Fermé", 5, 3), businessStatus: "CLOSED_PERMANENTLY" }, place("Couvreur Martin", 4.6, 80),
    place("Couverture Catalane", 4.2, 12, "https://couverture-catalane.fr/contact"), place("Les Toits du Roussillon", 4.9, 60), place("Alpha Toiture", 4.1, 200), place("Beta Couverture", 3.9, 40)] };
  const results = m.readPlacesResults(body);
  assert.equal(results.length, 6, "permanently closed places are ignored");
  assert.deepEqual(plain(results.map((r) => r.rank)), [1, 2, 3, 4, 5, 6]);
  const target = m.competitionTarget({ id: "c1", company_name: "Couverture Catalane", activity: "Couvreur", geographic_area: "Perpignan", website: "couverture-catalane.fr" });
  const snap = m.buildCompetition("google-places", "couvreur Perpignan", results, target, now);
  assert.equal(snap.rank, 3);
  assert.deepEqual(plain(snap.client), { name: "Couverture Catalane", rating: 4.2, reviews: 12 });
  assert.equal(snap.competitors.length, 5);
  assert.equal(snap.medianReviews, 80); assert.equal(snap.medianRating, 4.6);
  const byName = m.findClient(results, { ...target, domain: null });
  assert.equal(byName.name, "Couverture Catalane");
  const absent = m.buildCompetition("google-places", "couvreur Perpignan", results.filter((r) => r.name !== "Couverture Catalane"), target, now);
  assert.equal(absent.rank, null); assert.equal(absent.client, null, "never an invented position");
});

test("DataForSEO Maps parsing: maps_search items by rank_group; an error task gives null", () => {
  const body = { status_code: 20000, tasks: [{ status_code: 20000, result: [{ items: [
    { type: "maps_search", rank_group: 1, title: "Toiture Pro 66", domain: "toiturepro66.fr", rating: { value: 4.8, votes_count: 120 }, place_id: "A" },
    { type: "maps_paid_item", rank_group: 1, title: "Annonce" },
    { type: "maps_search", rank_group: 2, title: "Couverture Catalane", domain: "www.couverture-catalane.fr", rating: { value: 4.2, votes_count: 12 } },
  ] }] }] };
  const results = m.readDataForSeoResults(body);
  assert.deepEqual(plain(results.map((r) => [r.rank, r.name, r.domain])), [[1, "Toiture Pro 66", "toiturepro66.fr"], [2, "Couverture Catalane", "couverture-catalane.fr"]]);
  assert.equal(m.readDataForSeoResults({ status_code: 40100, tasks: [] }), null);
  assert.equal(m.readDataForSeoResults({ status_code: 20000, tasks: [{ status_code: 40501 }] }), null);
});

test("findings: not visible, rank drop vs the previous same-source reading, reviews and rating gaps", () => {
  const base = { version: 1, source: "dataforseo-maps", keyword: "couvreur perpignan", checkedAt: now.toISOString(), depth: 20, competitors: [], medianRating: 4.6, medianReviews: 80 };
  const codes = (snap, prev = null) => plain(m.evaluateCompetition(snap, prev).map((f) => f.code));
  assert.deepEqual(codes({ ...base, rank: null, client: null }), ["not_visible"]);
  assert.deepEqual(codes({ ...base, rank: 7, client: { name: "X", rating: 4.2, reviews: 12 } }, { ...base, checkedAt: "2026-11-11T10:00:00Z", rank: 3 }), ["rank_drop", "reviews_gap", "rating_gap"]);
  assert.deepEqual(codes({ ...base, rank: 7, client: { name: "X", rating: 4.5, reviews: 70 } }, { ...base, source: "google-places", rank: 1 }), [], "never compares two different sources");
  assert.deepEqual(codes({ ...base, rank: 2, client: { name: "X", rating: null, reviews: null } }), [], "absent data never opens a finding");
  assert.ok(m.COMPETITION_CODES.every((code) => m.competitionFingerprint("c1", code).startsWith("local-competition:c1:")));
  const back = m.readCompetition(plain(m.buildCompetition("google-places", "couvreur Perpignan", [], { clientId: "c1", company: "A", activity: "a", city: "b", domain: null }, now)));
  assert.equal(back.rank, null); assert.equal(m.readCompetition({ version: 2 }), null);
});

test("report: Search Console positions (top 3 / page 1 / page 2, moves, near page one)", () => {
  const q = (key, position, impressions, previous) => ({ key, position, impressions, clicks: 1, ctr: 0, previous: previous === undefined ? null : { position: previous, impressions: 10, clicks: 0, ctr: 0 } });
  const ranking = insights.readReportRanking({ period: { start: "2026-10-19", end: "2026-11-15" }, queries: [
    q("couvreur perpignan", 2.1, 300, 6.4), q("toiture perpignan", 8, 200, 4), q("zinguerie", 14, 120, 15), q("gouttière", 30, 10), { key: "", position: 1, impressions: 3 }] });
  assert.equal(ranking.queries.length, 4);
  const lines = insights.rankingLines(ranking);
  assert.match(lines[0], /1 requête en top 3, 2 en première page \(période précédente : 2\), 1 en deuxième page/);
  assert.match(lines.join("\n"), /Progressions : « couvreur perpignan » 6,4 → 2,1/);
  assert.match(lines.join("\n"), /Reculs : « toiture perpignan » 4 → 8/);
  assert.match(lines.join("\n"), /Aux portes de la première page : « zinguerie » \(position 14, 120 impressions\)/);
  assert.equal(insights.rankingLines(null).length, 0);
  assert.equal(insights.readReportRanking({}), null);
});

test("report: local competition lines; Google Places competitor names never reach an archived report", () => {
  const row = (source, rank) => ({ source, keyword: "couvreur Perpignan", checkedAt: "2026-11-16T10:00:00Z", depth: 20, rank, client: { rating: 4.2, reviews: 12 },
    competitors: [{ name: "Toiture Pro 66", rating: 4.8, reviews: 120 }], medianRating: 4.6, medianReviews: 80 });
  const places = insights.competitionLines([row("google-places", 3)]).join("\n");
  assert.match(places, /« couvreur Perpignan » \(rang indicatif Google Places.*\) : 3e place/);
  assert.match(places, /la fiche : 4,2\/5 sur 12 avis ; médiane des 5 premiers concurrents : 4,6\/5 sur 80 avis/);
  assert.doesNotMatch(places, /Toiture Pro 66/);
  const maps = insights.competitionLines([row("dataforseo-maps", null)]).join("\n");
  assert.match(maps, /position Google Maps, relevé DataForSEO.*fiche absente des 20 premiers résultats/);
  assert.match(maps, /Concurrents en tête : Toiture Pro 66 \(4,8\/5, 120 avis\)/);
  const extras = { ...insights.emptyExtras(), competition: [row("dataforseo-maps", null)] };
  assert.ok(insights.extrasPriorities(extras).some((p) => /absente des 20 premiers résultats locaux/.test(p.internal)));
  const gap = insights.extrasPriorities({ ...insights.emptyExtras(), competition: [row("google-places", 2)] });
  assert.ok(gap.some((p) => /12 avis contre 80 en médiane/.test(p.internal)));
  assert.equal(insights.competitionLines(null).length, 0);
});

test("briefing: SEO agent states its local rank per source; missing data is a gap, not a zero", () => {
  const signals = b.competitionSignals([{ metric_key: "google-places", fetched_at: now.toISOString(), data: { keyword: "couvreur Perpignan", rank: null, depth: 20, client: {}, medianReviews: 80 } }]);
  assert.match(signals.facts[0].statement, /rang indicatif Google Places\) : absente des 20 premiers résultats/);
  assert.deepEqual(plain(b.competitionSignals([]).facts), []);
  assert.equal(b.competitionSignals([]).gaps.length, 1);
  assert.deepEqual(plain(b.competitionSignals(null)), { facts: [], gaps: [] });
});

test("wiring: read-only fixed endpoints, keys only from server env, no migration, Places purge, step registered", () => {
  const transport = readFileSync("lib/integrations/local-competition.ts", "utf8");
  assert.match(transport, /^import 'server-only';/);
  assert.match(transport, /https:\/\/places\.googleapis\.com\/v1\/places:searchText/);
  assert.match(transport, /https:\/\/api\.dataforseo\.com\/v3\/serp\/google\/maps\/live\/advanced/);
  assert.match(transport, /redirect:'error'/);
  assert.doesNotMatch(transport, /process\.env|console\./);
  const service = readFileSync("lib/local-competition/service.ts", "utf8");
  assert.match(service, /process\.env\.DATAFORSEO_LOGIN[\s\S]*process\.env\.DATAFORSEO_PASSWORD/);
  assert.match(service, /\.delete\(\)\.eq\('provider',COMPETITION_PROVIDER\)\.eq\('metric_key','google-places'\)\.lt\('fetched_at'/);
  assert.doesNotMatch(service, /reply|updateReview|\.from\('local_competition/);
  assert.match(readFileSync("app/api/internal/scheduler/tick/route.ts", "utf8"), /step\("local_competition", \(\) => runLocalCompetitionTick\(new Date\(\)\)/);
  assert.match(readFileSync(".env.example", "utf8"), /DATAFORSEO_LOGIN=\nDATAFORSEO_PASSWORD=/);
});
