// Agent Veille concurrence : rapport mensuel par client local, jamais de mesure inventée, actions proposées à valider.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const lc = loadTs("lib/local-competition/model.ts");
const grounded = loadTs("lib/ai/grounded.ts");
const m = loadTs("lib/competitor-watch/model.ts", { "@/lib/local-competition/model": lc, "@/lib/ai/grounded": grounded });
const now = new Date("2026-11-28T10:00:00.000Z");
const plain = (value) => JSON.parse(JSON.stringify(value));
const target = { clientId: "c1", company: "Couverture Catalane", activity: "Couvreur", city: "Perpignan", domain: "couverture-catalane.fr" };

const snap = (checkedAt, rank, own, competitors, source = "dataforseo-maps") => ({
  version: 1, source, keyword: "couvreur perpignan", checkedAt, depth: 20, rank, client: own, competitors, medianRating: null, medianReviews: null,
});
const comp = (rank, name, reviews, domain = null, rating = 4.6) => ({ rank, name, placeId: null, rating, reviews, domain });

test("settings: defaults (active, Maps competitors) and manual lines « Nom | site »", () => {
  assert.deepEqual(plain(m.readSettings(null)), { enabled: true, competitors: [] });
  assert.deepEqual(plain(m.readSettings({ enabled: false, competitors: [{ name: "Toiture Pro", domain: "https://www.toiturepro66.fr/" }, { name: "x" }] })), { enabled: false, competitors: [{ name: "Toiture Pro", domain: "toiturepro66.fr" }] });
  const parsed = m.parseCompetitorLines("Toiture Pro 66 | toiturepro66.fr\nCouvreur Martin\n\nToiture pro 66");
  assert.deepEqual(plain(parsed), { ok: true, competitors: [{ name: "Toiture Pro 66", domain: "toiturepro66.fr" }, { name: "Couvreur Martin", domain: null }] });
  assert.equal(m.parseCompetitorLines("A | pas un site").ok, false);
  assert.equal(m.parseCompetitorLines("a\nb1\nc1\nd1\ne1\nf1").ok, false);
});

test("cadence: monthly (28 days), 24 h retry after a failure", () => {
  assert.equal(m.watchDue({ lastAt: null, lastFailureAt: null }, now), true);
  assert.equal(m.watchDue({ lastAt: "2026-11-10T10:00:00Z", lastFailureAt: null }, now), false);
  assert.equal(m.watchDue({ lastAt: "2026-10-31T10:00:00Z", lastFailureAt: null }, now), true);
  assert.equal(m.watchDue({ lastAt: null, lastFailureAt: "2026-11-28T02:00:00Z" }, now), false);
});

test("Maps pair: freshest precise source, compared to a reading at least 3 weeks older of the same source", () => {
  const rows = [
    { metric_key: "google-places", fetched_at: "2026-11-27T09:00:00Z", data: snap("2026-11-27T09:00:00Z", 4, null, [], "google-places") },
    { metric_key: "dataforseo-maps", fetched_at: "2026-11-25T09:00:00Z", data: snap("2026-11-25T09:00:00Z", 3, null, []) },
    { metric_key: "dataforseo-maps", fetched_at: "2026-11-11T09:00:00Z", data: snap("2026-11-11T09:00:00Z", 2, null, []) },
    { metric_key: "dataforseo-maps", fetched_at: "2026-10-28T09:00:00Z", data: snap("2026-10-28T09:00:00Z", 1, null, []) },
  ];
  const pair = m.pickCompetitionPair(rows, now);
  assert.equal(pair.latest.checkedAt, "2026-11-25T09:00:00Z");
  assert.equal(pair.previous.checkedAt, "2026-10-28T09:00:00Z");
  assert.deepEqual(plain(m.pickCompetitionPair([rows[3]], now)), { latest: null, previous: null }, "older than 10 days: no current reading");
});

test("organic SERP: organic ranks and ads by domain; failed task = null (never an empty result)", () => {
  const body = { status_code: 20000, tasks: [{ status_code: 20000, result: [{ items: [
    { type: "paid", domain: "www.toiturepro66.fr", rank_group: 1 },
    { type: "organic", rank_group: 1, domain: "toiturepro66.fr" },
    { type: "local_pack", rank_group: 1, domain: "x.fr" },
    { type: "organic", rank_group: 2, domain: "pagesjaunes.fr" },
    { type: "organic", rank_group: 3, url: "https://www.couverture-catalane.fr/toiture" },
  ] }] }] };
  assert.deepEqual(plain(m.readOrganicSerp(body)), { organic: [{ rank: 1, domain: "toiturepro66.fr" }, { rank: 2, domain: "pagesjaunes.fr" }, { rank: 3, domain: "couverture-catalane.fr" }], paid: [{ domain: "toiturepro66.fr" }] });
  assert.equal(m.readOrganicSerp({ status_code: 40100 }), null);
  assert.deepEqual(plain(m.readOrganicSerp({ status_code: 20000, tasks: [{ status_code: 40102 }] })), { organic: [], paid: [] });
});

test("keywords: « métier ville » then the top non-brand Search Console queries", () => {
  const queries = [{ key: "couverture catalane avis", impressions: 900 }, { key: "renovation toiture perpignan", impressions: 300 }, { key: "couvreur perpignan", impressions: 800 }, { key: "zinguerie 66", impressions: 120 }, { key: "toit", impressions: 5000 }];
  assert.deepEqual(plain(m.watchKeywords("couvreur perpignan", queries, "Couverture Catalane")), ["couvreur perpignan", "renovation toiture perpignan", "zinguerie 66"]);
});

test("sitemaps: entries with dates; regenerated dates are unreliable, missing dates are 'not measured'", () => {
  const xml = `<urlset><url><loc>https://a.fr/blog/1</loc><lastmod>2026-11-20</lastmod></url><url><loc>https://a.fr/blog/2</loc><lastmod>2026-11-02T08:00:00+01:00</lastmod></url><url><loc>https://a.fr/old</loc><lastmod>2025-01-01</lastmod></url><url><loc>https://a.fr/nodate</loc></url></urlset>`;
  const parsed = m.readSitemapEntries(xml);
  assert.equal(parsed.index, false); assert.equal(parsed.entries.length, 4);
  const activity = m.siteActivity(parsed.entries, now);
  assert.equal(activity.count, 2); assert.deepEqual(plain(activity.samples), ["/blog/1", "/blog/2"]);
  const fake = Array.from({ length: 25 }, (_, i) => ({ url: `https://b.fr/${i}`, lastmod: "2026-11-27T00:00:00.000Z" }));
  assert.equal(m.siteActivity(fake, now).count, null); assert.equal(m.siteActivity(fake, now).note, "dates du sitemap non fiables");
  assert.equal(m.siteActivity([{ url: "https://c.fr/", lastmod: null }], now).count, null);
  assert.equal(m.siteActivity(null, now).note, "site non lu");
  assert.deepEqual(plain(m.preferredChildSitemaps([{ url: "https://a.fr/page-sitemap.xml" }, { url: "https://a.fr/cat.xml" }, { url: "https://a.fr/post-sitemap.xml" }, { url: "https://a.fr/z.xml" }])), ["https://a.fr/post-sitemap.xml", "https://a.fr/page-sitemap.xml", "https://a.fr/cat.xml"]);
});

function fullInput(overrides = {}) {
  const latest = snap("2026-11-25T09:00:00Z", 4, { name: "Couverture Catalane", rating: 4.3, reviews: 14 }, [comp(1, "Toiture Pro 66", 140, "toiturepro66.fr"), comp(2, "Couvreur Martin", 80), comp(3, "Alpha Toiture", 60, "alpha-toiture.fr")]);
  const previous = snap("2026-10-28T09:00:00Z", 3, { name: "Couverture Catalane", rating: 4.3, reviews: 13 }, [comp(1, "Toiture Pro 66", 128, "toiturepro66.fr"), comp(2, "Couvreur Martin", 79), comp(5, "Alpha Toiture", 60, "alpha-toiture.fr")]);
  return {
    target, now, settings: { enabled: true, competitors: [] }, latest, previous, serpConfigured: true,
    serp: [
      { keyword: "couvreur perpignan", result: { organic: [{ rank: 1, domain: "toiturepro66.fr" }, { rank: 14, domain: "couverture-catalane.fr" }], paid: [{ domain: "alpha-toiture.fr" }] } },
      { keyword: "zinguerie 66", result: null },
    ],
    sites: { "toiturepro66.fr": Array.from({ length: 6 }, (_, i) => ({ url: `https://toiturepro66.fr/blog/${i}`, lastmod: "2026-11-1" + i + "T00:00:00.000Z" })), "couverture-catalane.fr": [] },
    blogPublished: 0, socialPublished: 9, hasGoogleAds: true,
    ...overrides,
  };
}

test("report: measured facts only, findings with proposed actions, gaps listed", () => {
  const report = m.buildWatchReport(fullInput());
  assert.equal(report.competitors.length, 3);
  assert.deepEqual(plain(report.competitors[0].maps), { rankNow: 1, rankBefore: 1, reviewsNow: 140, reviewsBefore: 128, ratingNow: 4.6 });
  assert.deepEqual(plain(report.client.maps), { rankNow: 4, rankBefore: 3, reviewsNow: 14, reviewsBefore: 13, ratingNow: 4.3 });
  assert.deepEqual(plain(report.competitors[1].organic), [{ keyword: "couvreur perpignan", rank: null }], "no site = no organic position");
  assert.equal(report.competitors[1].pages.note, "site inconnu");
  const codes = report.findings.map((f) => f.code);
  assert.ok(codes.includes("reviews_pace"), "Toiture Pro: +12 reviews vs +1");
  assert.ok(codes.includes("maps_overtaken"), "Alpha Toiture: 5th → 3rd, client 3rd → 4th");
  assert.ok(codes.includes("organic_outranked"));
  assert.ok(codes.includes("ads_gap"));
  assert.ok(codes.includes("publishing_gap"));
  const ads = report.findings.find((f) => f.code === "ads_gap");
  assert.match(ads.detail, /Alpha Toiture diffuse une annonce/); assert.match(ads.action, /Agent Google Ads/);
  assert.ok(report.gaps.some((g) => /1 recherche\(s\) sur 2 non relevée/.test(g)));
  assert.ok(report.gaps.some((g) => /réseaux sociaux/.test(g)));
  assert.equal(report.placesDerived, false);
  assert.equal(report.serp.length, 1);
});

test("report: without DataForSEO nor previous reading, no organic/ads finding and the gaps say why", () => {
  const report = m.buildWatchReport(fullInput({ serp: [], serpConfigured: false, previous: null }));
  assert.ok(!report.findings.some((f) => ["organic_outranked", "ads_gap", "reviews_pace", "maps_overtaken"].includes(f.code)));
  assert.ok(report.gaps.some((g) => /DataForSEO non configuré/.test(g)));
  assert.ok(report.gaps.some((g) => /pas encore de relevé Google Maps d'au moins 3 semaines/.test(g)));
});

test("manual competitors come first; Places-derived names are removed after 30 days", () => {
  const input = fullInput({ settings: { enabled: true, competitors: [{ name: "Concurrent Choisi", domain: "choisi.fr" }] } });
  const tracked = m.trackedCompetitors(input.settings, input.latest);
  assert.deepEqual(plain(tracked.map((t) => [t.name, t.origin])), [["Concurrent Choisi", "manual"], ["Toiture Pro 66", "maps"], ["Couvreur Martin", "maps"], ["Alpha Toiture", "maps"]]);
  const places = m.buildWatchReport({ ...input, latest: { ...input.latest, source: "google-places" }, previous: { ...input.previous, source: "google-places" } });
  assert.equal(places.placesDerived, true);
  const anon = m.anonymizeReport(places);
  assert.equal(anon.anonymized, true);
  assert.equal(anon.competitors[0].name, "Concurrent Choisi", "manual entries are the admin's own data");
  assert.equal(anon.competitors[1].name, "Concurrent 2"); assert.equal(anon.competitors[1].domain, null);
  assert.doesNotMatch(JSON.stringify(anon.findings), /Toiture Pro 66|Alpha Toiture|toiturepro66/);
});

test("AI synthesis: any number or site not in the measures is refused", () => {
  const report = m.buildWatchReport(fullInput());
  const good = "Toiture Pro 66 reste 1re sur Google Maps et passe de 128 à 140 avis, quand Couverture Catalane recule de la 3e à la 4e place. Alpha Toiture diffuse une annonce sur « couvreur perpignan ». Priorité : demandes d'avis systématiques puis une page dédiée.";
  assert.equal(m.validateWatchSynthesis({ summary: good }, report).ok, true);
  const invented = m.validateWatchSynthesis({ summary: `${good} Le concurrent a gagné 35 % de visibilité.` }, report);
  assert.equal(invented.ok, false); assert.match(invented.detail, /35/);
  const site = m.validateWatchSynthesis({ summary: `${good} Voir aussi toitures-roussillon.fr pour comparer les offres.` }, report);
  assert.equal(site.ok, false);
  assert.equal(m.validateWatchSynthesis({ summary: "court" }, report).ok, false);
});

test("briefing: latest reports as dated facts; stale or missing reports are gaps", () => {
  const report = m.buildWatchReport(fullInput());
  const s = m.watchSignals([{ fetched_at: "2026-11-28T10:00:00Z", data: report }], now);
  assert.match(s.facts[0].statement, /3 concurrent\(s\) suivi\(s\), 5 constat\(s\)/);
  assert.deepEqual(plain(s.gaps), []);
  assert.match(m.watchSignals([], now).gaps[0], /Aucun rapport/);
  assert.match(m.watchSignals([{ fetched_at: "2026-10-01T10:00:00Z", data: report }], now).gaps[0], /plus de 35 jours/);
});

function service(overrides = {}) {
  const audits = [], recommendations = [];
  const svc = loadTs("lib/competitor-watch/service.ts", {
    "@/lib/supabase/server": { getSupabaseServerClient: () => null },
    "@/lib/core/audit": { writeAudit: async (_a, entry) => { audits.push(entry); } },
    "@/lib/agents/outputs": {
      getAgentByType: async () => overrides.agent ?? ({ id: "a1", enabled: true, status: "Actif" }),
      clientContextDenied: async () => overrides.denied ?? null,
      recordRecommendation: async (_a, input) => { recommendations.push(input); return { id: `r${recommendations.length}`, created: true }; },
    },
    "@/lib/local-competition/model": lc,
    "@/lib/integrations/search-console/model": { SEARCH_CONSOLE_PROVIDER: "search-console" },
    "@/lib/integrations/competitor-watch": { organicSerpTransport: () => null },
    "@/lib/integrations/site-health": { fetchSitePage: async () => ({ status: null, body: "" }) },
    "@/lib/site-health/model": { readRobots: () => ({ blocksAll: false, sitemaps: [] }) },
    "@/lib/ai/models": { agentsAiConfigured: () => false },
    "@/lib/ai/metered": { structuredResponse: async () => { throw new Error("no"); }, withAiScope: (_s, w) => w() },
    "@/lib/harness/charter": loadTs("lib/harness/charter.ts"),
    "./model": m,
  });
  return { svc, audits, recommendations };
}

test("service: one due local client per tick → report saved, findings as recommendations, nothing for national clients", async () => {
  const { createFakeSupabase } = await import("./helpers/fake-supabase.mjs");
  const input = fullInput();
  const fake = createFakeSupabase({
    clients: [
      { id: "c1", name: "CC", company_name: "Couverture Catalane", activity: "Couvreur", geographic_area: "Perpignan", website: "https://couverture-catalane.fr" },
      { id: "c2", name: "CODE-V", company_name: "CODE-V", activity: "Programmation", geographic_area: "France", website: "https://code-v.fr" },
    ],
    metric_snapshots: [
      { id: "s1", client_id: "c1", provider: "local-competition", metric_key: "dataforseo-maps", period_end: "2026-11-25", fetched_at: "2026-11-25T09:00:00Z", data: input.latest },
      { id: "s2", client_id: "c1", provider: "local-competition", metric_key: "dataforseo-maps", period_end: "2026-10-28", fetched_at: "2026-10-28T09:00:00Z", data: input.previous },
    ],
    audit_logs: [], blog_articles: [], publication_deliveries: [], client_competitor_watch: [],
  }, { unique: { metric_snapshots: [["client_id", "provider", "metric_key", "period_start", "period_end"]] } });
  const { svc, audits, recommendations } = service();
  const serpCalls = [];
  const deps = {
    db: fake.client,
    serp: async (keyword) => { serpCalls.push(keyword); return { status: 200, body: { status_code: 20000, tasks: [{ status_code: 20000, result: [{ items: [{ type: "organic", rank_group: 1, domain: "toiturepro66.fr" }, { type: "paid", domain: "alpha-toiture.fr" }] }] }] } }; },
    fetchPage: async (url) => (url === "https://toiturepro66.fr/sitemap.xml" ? { status: 200, body: `<urlset>${[10, 12, 15, 18, 20].map((d) => `<url><loc>https://toiturepro66.fr/a${d}</loc><lastmod>2026-11-${d}</lastmod></url>`).join("")}</urlset>` } : { status: 404, body: "" }),
    synthesize: async () => ({ summary: null, reason: "IA non configurée" }),
  };
  const s = await svc.runCompetitorWatchTick(now, deps);
  assert.equal(s.reports, 1); assert.equal(s.pending, 0); assert.equal(s.failed, 0);
  assert.deepEqual(serpCalls, ["couvreur perpignan"]);
  const row = fake.tables.metric_snapshots.find((r) => r.provider === "competitor-watch");
  assert.equal(row.client_id, "c1"); assert.equal(row.metric_key, "monthly");
  assert.equal(row.data.competitors[0].pages.count, 5);
  assert.equal(row.data.summaryNote, "IA non configurée");
  assert.equal(recommendations.length, row.data.findings.length);
  assert.ok(recommendations.every((r) => r.title.startsWith("Veille concurrence : ") && r.payload.agent === "competitor-watch"));
  assert.equal(audits.at(-1).action, "competitor_watch.report_ready");
  const again = await svc.runCompetitorWatchTick(new Date(now.getTime() + 3_600_000), deps);
  assert.equal(again.reports, 0, "monthly: not due again an hour later");
});

test("service: paused SEO agent, disabled client, no competitor → no report; manual launch respects the setting", async () => {
  const { createFakeSupabase } = await import("./helpers/fake-supabase.mjs");
  const base = { clients: [{ id: "c1", name: "CC", company_name: "Couverture Catalane", activity: "Couvreur", geographic_area: "Perpignan", website: null }], metric_snapshots: [], audit_logs: [], blog_articles: [], publication_deliveries: [] };
  const deps = (db) => ({ db, serp: null, fetchPage: async () => ({ status: 404, body: "" }), synthesize: async () => ({ summary: null }) });
  assert.equal((await service({ agent: { id: "a1", enabled: false, status: "Pause" } }).svc.runCompetitorWatchTick(now, deps(createFakeSupabase(base).client))).disabled, "agent");
  const off = createFakeSupabase({ ...base, client_competitor_watch: [{ client_id: "c1", enabled: false, competitors: [] }] });
  assert.equal((await service().svc.runCompetitorWatchTick(now, deps(off.client), { clientId: "c1" })).reports, 0);
  const empty = service();
  const r = await empty.svc.runCompetitorWatchTick(now, deps(createFakeSupabase(base, { failOn: (table) => (table === "client_competitor_watch" ? { code: "42P01", message: "does not exist" } : false) }).client));
  assert.equal(r.failed, 1, "no competitor measured: retried in 24 h, never an empty report");
  assert.equal(empty.audits[0].action, "competitor_watch.failed"); assert.equal(empty.audits[0].metadata.kind, "no_competitor");
});

test("wiring: charter, scheduler step, launch, briefing reader, analytics tab, AI family", () => {
  const charter = loadTs("lib/harness/charter.ts");
  const c = charter.getCharter("competitor-watch");
  assert.equal(c.team, "veille"); assert.ok(c.triggers.some((t) => t.kind === "step" && t.step === "competitor_watch"));
  assert.match(readFileSync("app/api/internal/scheduler/tick/route.ts", "utf8"), /step\("competitor_watch", \(\) => runCompetitorWatchTick\(new Date\(\)\)/);
  assert.match(readFileSync("lib/scheduler/heartbeat.ts", "utf8"), /"competitor_watch"/);
  assert.ok(loadTs("lib/launch/catalog.ts").launchTask("competitor-watch").paid);
  assert.match(readFileSync("lib/harness/briefing-service.ts", "utf8"), /"competitor-watch": async/);
  assert.match(readFileSync("app/(cockpit)/analytics/page.tsx", "utf8"), /source === "competition"/);
  assert.match(readFileSync("lib/ai/models.ts", "utf8"), /"competitor-watch": "strategy"/);
  const service = readFileSync("lib/competitor-watch/service.ts", "utf8");
  assert.doesNotMatch(service, /\.insert\(\{[^}]*reviews|sendEmail|publish\(/, "read-only towards competitors: nothing sent or published");
  const migration = readFileSync("supabase/migrations/20261224300000_competitor_watch.sql", "utf8");
  assert.match(migration, /enable row level security/); assert.match(migration, /revoke all on public\.client_competitor_watch from public, anon, authenticated/);
});
