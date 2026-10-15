// Agent SEO V2 : détection des opportunités (données réelles uniquement), cycle de vie, mesure, PR GitHub contrôlée, conversation.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Buffer } from "node:buffer";
import { loadTs } from "./helpers/load-ts.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";

const fake = (...args) => createFakeSupabase(...args).client;
const plain = (value) => JSON.parse(JSON.stringify(value));
const engine = loadTs("lib/seo/opportunities.ts");
const status = loadTs("lib/seo/opportunity-status.ts");
const view = loadTs("lib/seo/opportunity-view.ts", { "@/lib/seo/opportunities": engine, "@/lib/seo/opportunity-status": status });
const store = loadTs("lib/seo/opportunity-store.ts", { "@/lib/seo/opportunities": engine, "@/lib/seo/opportunity-status": status });
const measure = loadTs("lib/seo/measure.ts", { "@/lib/seo/opportunities": engine });
const context = loadTs("lib/seo/context.ts", { "@/lib/seo/opportunities": engine });
const change = loadTs("lib/seo/github-change-model.ts");
const assistant = loadTs("lib/seo/opportunity-assistant.ts", { "@/lib/seo/opportunities": engine });
const errors = loadTs("lib/providers/errors.ts");
const api = loadTs("lib/providers/api.ts", { "@/lib/providers/errors": errors });
const githubWrite = loadTs("lib/providers/github-write.ts", { "node:buffer": { Buffer }, "@/lib/providers/api": api, "@/lib/providers/errors": errors, "@/lib/seo/github-change-model": change });

const CLIENT = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const OPP = "33333333-3333-4333-8333-333333333333";
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

test("measurement compares equal windows after consolidation and stays cautious", () => {
  assert.deepEqual(plain(engine.measurementPeriods("2026-09-01", 7)), { before: { start: "2026-08-25", end: "2026-08-31" }, after: { start: "2026-09-02", end: "2026-09-08" } });
  assert.equal(engine.windowReady("2026-09-01", 7, "2026-09-07"), false);
  assert.equal(engine.windowReady("2026-09-01", 7, "2026-09-08"), true);
  const m = (clicks, impressions, position) => ({ clicks, impressions, ctr: clicks / impressions, position });
  assert.equal(engine.compareWindow(m(1, 10, 8), m(2, 20, 6)).verdict, "insufficient_data");
  assert.equal(engine.compareWindow(m(10, 500, 8), m(20, 520, 5)).verdict, "improved");
  assert.equal(engine.compareWindow(m(20, 500, 5), m(8, 480, 9)).verdict, "degraded");
  assert.equal(engine.compareWindow(m(10, 500, 6), m(10, 510, 6.2)).verdict, "stable");
  assert.equal(engine.isSignificantChange(m(5, 100, 8), m(6, 110, 7.5)), false);
  assert.equal(engine.isSignificantChange(m(5, 100, 8), m(6, 300, 7.5)), true);
  assert.equal(engine.isSignificantChange(m(5, 100, 8), m(5, 100, 4)), true);
});

test("measureInterventions fills only ready windows and never re-measures", async () => {
  const db = fake({
    seo_opportunity_interventions: [{ id: "i1", opportunity_id: OPP, client_id: CLIENT, keyword: "devis plombier", target_url: "https://x.fr/devis", deployed_at: "2026-08-01", measurements: { 7: { verdict: "stable" } } }],
    seo_keyword_opportunities: [{ id: OPP, category: "striking_distance" }],
  });
  const calls = [];
  const search = async (p, filters) => { calls.push([p, filters]); return [row("devis plombier", p.start < "2026-08-01" ? 5 : 12, 300, p.start < "2026-08-01" ? 8 : 5)]; };
  const summary = await measure.measureInterventions({ db, search, now: () => new Date("2026-10-12T00:00:00Z") }, CLIENT, "2026-10-08");
  assert.equal(summary.measured, 2, "28 and 60 days, 7 already measured");
  assert.equal(calls.length, 4);
  assert.deepEqual(plain(calls[0][1]), [{ dimension: "query", expression: "devis plombier" }, { dimension: "page", expression: "https://x.fr/devis" }]);
  const again = await measure.measureInterventions({ db, search }, CLIENT, "2026-10-08");
  assert.equal(again.measured, 0);
});

test("status lifecycle mirrors the database guard and maps to the existing recommendation statuses", () => {
  assert.equal(status.canTransitionOpportunity("detected", "done"), false);
  assert.equal(status.canTransitionOpportunity("approved", "in_progress"), true);
  assert.equal(status.canTransitionOpportunity("dismissed", "to_review"), true);
  assert.equal(status.canTransitionOpportunity("in_progress", "to_review"), false);
  assert.equal(status.recommendationStatusFor("dismissed"), "rejected");
  assert.equal(status.recommendationStatusFor("in_progress"), "accepted");
  assert.equal(status.opportunityStatusForRecommendation("accepted", "to_review"), "approved");
  assert.equal(status.opportunityStatusForRecommendation("rejected", "done"), null);
});

function detected(patch = {}) {
  return { fingerprint: "query:devis plombier", category: "striking_distance", keyword: "devis plombier", keywords: ["devis plombier"], targetUrl: "https://x.fr/devis", targetStatus: "existing", intent: "transactional", intentBasis: "devis", priority: "high", confidence: "high", source: "search_console", verified: true, metrics: { clicks: 6, impressions: 400, ctr: 0.015, position: 6.4 }, previous: null, potentialClicks: 20, factors: ["Position 6,4"], rationale: "r", recommendedAction: "a", actionKind: "optimize_page", evidence: {}, ...patch };
}

function storeDeps(db) {
  const recommendations = [], audits = [];
  return {
    recommendations, audits,
    deps: {
      db, audit: async (entry) => { audits.push(entry); },
      recommend: async (item) => { const id = `rec-${recommendations.length + 1}`; recommendations.push({ ...item, id }); await db.from("recommendations").insert({ id, status: "pending", title: item.title }); return { id, created: true }; },
    },
  };
}

test("persistence deduplicates, sends only strong opportunities to review and keeps closed ones closed", async () => {
  const db = fake({ seo_keyword_opportunities: [], recommendations: [] }, { unique: { seo_keyword_opportunities: [["client_id", "fingerprint"]] } });
  const { deps, recommendations, audits } = storeDeps(db);
  const base = { clientId: CLIENT, agentId: AGENT, analysisId: null, period, previousPeriod };
  const first = await store.persistOpportunities(deps, { ...base, opportunities: [detected(), detected({ fingerprint: "query:fuite", keyword: "fuite", priority: "low", confidence: "medium" })] });
  assert.deepEqual(plain(first), { created: 2, updated: 0, toReview: 1, recommendations: 1, resurfaced: 0 });
  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0].payload.kind, "keyword_opportunity");
  const second = await store.persistOpportunities(deps, { ...base, opportunities: [detected()] });
  assert.equal(second.created, 0);
  assert.equal(recommendations.length, 1, "no duplicate recommendation");
  const strong = (await db.from("seo_keyword_opportunities").select("*").eq("fingerprint", "query:devis plombier")).data[0];
  assert.equal(strong.detection_count, 2);

  const weak = (await db.from("seo_keyword_opportunities").select("*").eq("fingerprint", "query:fuite")).data[0];
  const refused = await store.transitionOpportunity({ ...deps, agentId: AGENT }, { id: weak.id, to: "dismissed", reason: "  " });
  assert.equal(refused.ok, false, "dismissal requires a reason");
  const dismissed = await store.transitionOpportunity({ ...deps, agentId: AGENT }, { id: weak.id, to: "dismissed", reason: "Hors cible commerciale" });
  assert.equal(dismissed.ok, true);
  const third = await store.persistOpportunities(deps, { ...base, opportunities: [detected({ fingerprint: "query:fuite", keyword: "fuite", priority: "high", metrics: { clicks: 50, impressions: 2000, ctr: 0.025, position: 3 } })] });
  assert.equal(third.resurfaced, 1);
  const after = (await db.from("seo_keyword_opportunities").select("*").eq("id", weak.id)).data[0];
  assert.equal(after.status, "dismissed", "never relaunched automatically");
  assert.equal(after.significant_change, true);
  assert.ok(audits.some((entry) => entry.action === "seo_opportunity.significant_change"));
});

test("approving from the opportunity accepts the linked recommendation; invalid transitions are refused", async () => {
  const db = fake({ seo_keyword_opportunities: [], recommendations: [] });
  const { deps } = storeDeps(db);
  await store.persistOpportunities(deps, { clientId: CLIENT, agentId: AGENT, analysisId: null, period, previousPeriod, opportunities: [detected()] });
  const opp = (await db.from("seo_keyword_opportunities").select("*")).data[0];
  assert.equal(opp.status, "to_review");
  assert.equal((await store.transitionOpportunity({ ...deps, agentId: AGENT }, { id: opp.id, to: "done" })).ok, false);
  const approved = await store.transitionOpportunity({ ...deps, agentId: AGENT }, { id: opp.id, to: "approved" });
  assert.equal(approved.ok, true);
  assert.equal((await db.from("recommendations").select("*").eq("id", opp.recommendation_id)).data[0].status, "accepted");
});

test("view helpers sort with missing metrics last and keep filters in the URL", () => {
  const rows = [
    { keyword: "b", status: "detected", priority: "low", confidence: "low", metrics: { clicks: 1, impressions: 50, ctr: 0.02, position: 9 }, previous_metrics: null, potential_clicks: 2, first_detected_at: "2026-10-01T00:00:00Z" },
    { keyword: "a", status: "to_review", priority: "high", confidence: "medium", metrics: { clicks: 9, impressions: 900, ctr: 0.01, position: 4 }, previous_metrics: { clicks: 6, impressions: 800 }, potential_clicks: 30, first_detected_at: "2026-10-02T00:00:00Z" },
    { keyword: "c", status: "detected", priority: "medium", confidence: "low", metrics: null, previous_metrics: null, potential_clicks: null, first_detected_at: "2026-10-03T00:00:00Z" },
  ];
  assert.deepEqual(plain(view.sortOpportunities(rows, "impressions", "desc").map((item) => item.keyword)), ["a", "b", "c"]);
  assert.deepEqual(plain(view.sortOpportunities(rows, "impressions", "asc").map((item) => item.keyword)), ["b", "a", "c"]);
  assert.deepEqual(plain(view.sortOpportunities(rows, "priority", "desc").map((item) => item.keyword)), ["a", "c", "b"]);
  assert.equal(view.clickChange(rows[1]), 50);
  const filters = view.parseFilters({ client: CLIENT, category: "low_ctr", status: "nope", sort: "position" });
  assert.equal(filters.status, null);
  assert.equal(filters.dir, "asc");
  assert.equal(view.filterQuery(filters, { status: "approved" }), `?client=${CLIENT}&category=low_ctr&status=approved&sort=position`);
});

test("business context comes only from what the agency entered", () => {
  const built = context.buildBusinessContext({ name: "Dupont Plomberie", activity: "Plomberie, chauffage", geographic_area: "Lyon; Villeurbanne", website: "https://www.dupont-plomberie.fr" }, { priorityServices: "chauffe-eau\nentretien chaudière", exclusions: "formation" });
  assert.ok(built.services.includes("chauffe-eau"));
  assert.ok(built.areas.includes("Lyon") && built.areas.includes("Villeurbanne"));
  assert.ok(built.exclusions.includes("formation"));
  assert.equal(context.buildBusinessContext({ name: "X" }, null).areas.length, 0, "no area is ever guessed");
});

const SHA = "a".repeat(40);
const prepared = (patch = {}) => ({ opportunity_id: OPP, repository: "acme/site", base_branch: "main", branch: change.seoBranchName("Devis Plombier Lyon", OPP), path: "app/devis/page.tsx", base_sha: SHA, edits: [{ find: "\"Devis\"", replace: "\"Devis plombier à Lyon\"" }], pr_title: "SEO : title de /devis", pr_body: "Opportunité approuvée dans CODE-V OS.", ...patch });

test("GitHub change model only accepts a dedicated branch, a safe path and unambiguous edits", () => {
  assert.equal(change.seoBranchName("Devis Plombier Lyon", OPP), "codev-seo/devis-plombier-lyon-33333333");
  assert.equal(change.githubChangeSchema.safeParse(prepared()).success, true);
  assert.equal(change.githubChangeSchema.safeParse(prepared({ branch: "main" })).success, false);
  assert.equal(change.githubChangeSchema.safeParse(prepared({ path: ".github/workflows/ci.yml" })).success, false);
  assert.equal(change.githubChangeSchema.safeParse(prepared({ path: "../secrets" })).success, false);
  assert.equal(change.githubChangeSchema.safeParse(prepared({ path: ".env.local" })).success, false);
  assert.equal(change.applyEdits("title: \"Devis\"", [{ find: "\"Devis\"", replace: "\"Devis plombier\"" }]).ok, true);
  assert.equal(change.applyEdits("\"Devis\" \"Devis\"", [{ find: "\"Devis\"", replace: "\"X\"" }]).ok, false, "ambiguous");
  assert.equal(change.applyEdits("rien", [{ find: "\"Devis\"", replace: "\"X\"" }]).ok, false, "file changed");
  assert.deepEqual(plain(change.quotedValueEdit("export const metadata = { title: 'Devis' }", "Devis", "Devis plombier")), { find: "'Devis'", replace: "'Devis plombier'" });
  assert.equal(change.quotedValueEdit("title: 'Devis'", "Devis", "L'entreprise"), null, "never breaks the quoting");
});

test("GitHub write opens a draft PR on a new branch and refuses when the file changed", async () => {
  const source = "export const metadata = { title: \"Devis\" };";
  const requests = [];
  const fetchImpl = (sha) => async (target, init = {}) => {
    const url = String(target);
    requests.push([init.method ?? "GET", url, init.body ? JSON.parse(init.body) : null, init.headers?.Authorization]);
    const json = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
    if (url.includes("/git/ref/heads/main")) return json({ object: { sha: "b".repeat(40) } });
    if (url.includes("/contents/") && (init.method ?? "GET") === "GET") return json({ encoding: "base64", content: Buffer.from(source).toString("base64"), sha });
    if (url.endsWith("/git/refs")) return json({ ref: "ok" });
    if (url.includes("/contents/")) return json({ commit: { sha: "c".repeat(40) } });
    if (url.endsWith("/pulls")) return json({ html_url: "https://github.com/acme/site/pull/7", number: 7 });
    throw new Error(`unexpected ${url}`);
  };
  const env = { GITHUB_SEO_WRITE_TOKEN: "ghp_write_token_value" };
  await assert.rejects(githubWrite.openSeoPullRequest(prepared(), { env: {}, fetchImpl: fetchImpl(SHA) }), (error) => error.kind === "not_configured");
  await assert.rejects(githubWrite.openSeoPullRequest(prepared(), { env, fetchImpl: fetchImpl("d".repeat(40)) }), (error) => error.kind === "rejected");
  assert.ok(!requests.some(([method]) => method !== "GET"), "nothing written when the file changed");
  requests.length = 0;
  const result = await githubWrite.openSeoPullRequest(prepared(), { env, fetchImpl: fetchImpl(SHA) });
  assert.equal(result.pullRequestUrl, "https://github.com/acme/site/pull/7");
  const writes = requests.filter(([method]) => method !== "GET");
  assert.deepEqual(writes.map(([method, url]) => `${method} ${url.replace("https://api.github.com/repos/acme/site", "")}`), ["POST /git/refs", "PUT /contents/app/devis/page.tsx", "POST /pulls"]);
  assert.equal(writes[0][2].ref, "refs/heads/codev-seo/devis-plombier-lyon-33333333");
  assert.equal(writes[1][2].branch, "codev-seo/devis-plombier-lyon-33333333");
  assert.match(Buffer.from(writes[1][2].content, "base64").toString(), /Devis plombier à Lyon/);
  assert.equal(writes[2][2].draft, true);
  assert.ok(!requests.some(([, url]) => /merge/.test(url)), "never merges");
});

const opportunityRow = { id: OPP, client_id: CLIENT, category: "striking_distance", keyword: "devis plombier", keywords: [], target_url: "https://x.fr/devis", target_status: "existing", intent: "transactional", intent_basis: "devis", priority: "high", confidence: "medium", data_source: "search_console", verified: true, period_start: period.start, period_end: period.end, metrics: { clicks: 6, impressions: 400, ctr: 0.015, position: 6.4 }, previous_metrics: { clicks: 5, impressions: 380, ctr: 0.013, position: 6.8 }, potential_clicks: 20, factors: ["Position 6,4"], rationale: "Position proche du top 3.", recommended_action: "Renforcer la page.", action_kind: "optimize_page", evidence: {}, status: "to_review" };

test("conversation answers from real data, proposes a dismissal without applying it and is honest about competitors", async () => {
  assert.equal(assistant.detectConversationIntent("Pourquoi proposes-tu cela ?"), "why");
  assert.equal(assistant.detectConversationIntent("Compare sur les trois derniers mois"), "compare");
  assert.equal(assistant.detectConversationIntent("Examine les concurrents"), "competitors");
  assert.equal(assistant.detectConversationIntent("Écarte cette opportunité, hors cible"), "dismiss");
  assert.equal(assistant.detectConversationIntent("Prépare la modification"), "prepare");
  const deps = { provider: null, search: null, today: "2026-10-12" };
  const why = await assistant.replyToMessage(opportunityRow, "Dupont", "Pourquoi ?", [], deps);
  assert.equal(why.source, "rules");
  assert.match(why.text, /400 impressions/);
  const dismiss = await assistant.replyToMessage(opportunityRow, "Dupont", "Écarte-la, ce service n'est plus proposé", [], deps);
  assert.equal(dismiss.proposal?.type, "dismiss");
  const rivals = await assistant.replyToMessage(opportunityRow, "Dupont", "Examine les concurrents", [], deps);
  assert.doesNotMatch(rivals.text, /position \d+ (?:du|de) concurrent/i);
  const compare = await assistant.replyToMessage(opportunityRow, "Dupont", "Compare sur trois mois", [], deps);
  assert.equal(compare.source, "rules");
  const failing = { complete: async () => { throw new Error("down"); } };
  const fallback = await assistant.replyToMessage(opportunityRow, "Dupont", "Et ensuite ?", [], { ...deps, provider: failing });
  assert.equal(fallback.degraded, true);
});
