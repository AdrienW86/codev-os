import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { loadTs } from "./helpers/load-ts.mjs";
const plain = (value) => JSON.parse(JSON.stringify(value));

const periods = loadTs("lib/integrations/google-ads/periods.ts");
const validation = loadTs("lib/integrations/google-ads/validation.ts", { "./periods": periods });
const queries = loadTs("lib/integrations/google-ads/queries.ts", { "./validation": validation });
const dashboard = loadTs("lib/integrations/google-ads/dashboard.ts", { "./periods": periods });
const business = loadTs("lib/integrations/google-ads/business-context.ts");
const expert = loadTs("lib/integrations/google-ads/expert.ts");
const ai = loadTs("lib/integrations/google-ads/ai-analysis.ts", { "./dashboard": dashboard, "./expert": expert });
const client = loadTs("lib/integrations/google-ads/client.ts", { "@/lib/require-admin": { requireAdmin: async () => ({}) }, "./queries": queries, "./validation": validation });

const metrics = (cost, conversions, clicks = 40, impressions = 900) => ({ cost, conversions, clicks, impressions, ctr: clicks / impressions, averageCpc: cost / clicks, costPerConversion: conversions ? cost / conversions : null, conversionValue: null });
const row = (id, name, m, type = "SEARCH") => ({ id, name, type, status: "ENABLED", metrics: m, hasActivity: true, localServices: type === "LOCAL_SERVICES", budget: { amount: 20, shared: false, period: "DAILY" }, subType: null, previous: null });
const rows = [row("111", "Toiture", metrics(450, 10)), row("222", "Dépannage", metrics(400, 0)), row("333", "LSA", metrics(100, null), "LOCAL_SERVICES")];
const context = { ...business.EMPTY_ADS_CONTEXT, exclusions: "emploi, formation\nbricolage", targetCostPerLead: 50, advertisingMonthlyBudget: 3000 };
const signals = {
  searchTerms: [
    { campaignId: "111", term: "couvreur offre d'emploi", status: "NONE", impressions: 50, clicks: 6, cost: 22, conversions: 0 },
    { campaignId: "111", term: "réparation toiture prix", status: "NONE", impressions: 120, clicks: 9, cost: 75, conversions: 0 },
    { campaignId: "111", term: "couvreur urgence", status: "NONE", impressions: 200, clicks: 20, cost: 90, conversions: 3 },
    { campaignId: "111", term: "couvreur", status: "ADDED", impressions: 400, clicks: 30, cost: 200, conversions: 5 },
    { campaignId: "111", term: "déjà exclu", status: "EXCLUDED", impressions: 5, clicks: 5, cost: 300, conversions: 0 },
    { campaignId: "333", term: "lsa ignoré", status: "NONE", impressions: 5, clicks: 5, cost: 300, conversions: 0 },
  ],
  impressionShare: [
    { campaignId: "111", impressionShare: 0.45, budgetLost: 0.35, rankLost: 0.2, topImpressionShare: 0.3 },
    { campaignId: "222", impressionShare: 0.2, budgetLost: 0.3, rankLost: 0.5, topImpressionShare: 0.1 },
  ],
  keywords: [
    { campaignId: "222", adGroupId: "1", criterionId: "9", text: "depannage toiture", matchType: "PHRASE", qualityScore: 3, adRelevance: "AVERAGE", landingPage: "BELOW_AVERAGE", expectedCtr: "BELOW_AVERAGE", cost: 120, clicks: 15, conversions: 0 },
    { campaignId: "111", adGroupId: "2", criterionId: "8", text: "couvreur", matchType: "EXACT", qualityScore: 8, adRelevance: "ABOVE_AVERAGE", landingPage: "AVERAGE", expectedCtr: "AVERAGE", cost: 200, clicks: 30, conversions: 5 },
  ],
  devices: [
    { campaignId: "111", device: "MOBILE", cost: 300, clicks: 20, conversions: 9 },
    { campaignId: "111", device: "DESKTOP", cost: 250, clicks: 15, conversions: 1 },
    { campaignId: "111", device: "TABLET", cost: 50, clicks: 5, conversions: 0 },
  ],
};
const scope = { start: "2026-10-01", end: "2026-10-30", days: 30, status: "enabled", types: [], campaignIds: ["111", "222", "333"], accountId: "1234567890", currency: "EUR", timezone: "Europe/Paris", campaignNames: { 111: "Toiture", 222: "Dépannage", 333: "LSA" } };

test("expert diagnosis finds waste, client exclusions, winners, budget, rank, quality, devices, target CPA and pacing", () => {
  const findings = expert.buildExpertDiagnosis(rows, signals, context, { days: 30 }, "EUR");
  const kinds = (campaignId) => findings.filter((item) => item.campaignId === campaignId).map((item) => item.kind).sort();
  assert.deepEqual(plain(kinds("111")), ["budget_limited", "converting_terms", "device_gap", "excluded_terms", "wasted_terms"].sort());
  assert.deepEqual(plain(kinds("222")), ["budget_limited_unproven", "low_quality", "rank_limited"].sort());
  assert.equal(findings.some((item) => item.campaignId === "333"), false, "Local Services never receives Search verdicts");
  const excluded = findings.find((item) => item.kind === "excluded_terms");
  assert.match(excluded.items[0], /offre d'emploi/); assert.match(excluded.items[0], /emploi/);
  const wasted = findings.find((item) => item.kind === "wasted_terms");
  assert.deepEqual(wasted.items.length, 1, "only the paid, non-converting, non-excluded term above the target CPA");
  assert.match(wasted.items[0], /réparation toiture prix/);
  assert.equal(findings.some((item) => item.items.some((line) => /déjà exclu|lsa ignoré/.test(line))), false);
  assert.match(findings.find((item) => item.kind === "converting_terms").items[0], /couvreur urgence/, "already-added keywords are not re-proposed");
  assert.match(findings.find((item) => item.kind === "low_quality").detail, /page d’atterrissage/);
  assert.match(findings.find((item) => item.kind === "device_gap").detail, /Ordinateur/);
  assert.equal(findings.find((item) => item.kind === "pacing_under").campaignId, null, "pacing is account-level");
  assert.equal(findings[0].priority, "high", "sorted by priority");
});

test("without a target CPA the waste threshold falls back to the observed CPA, and no budget raise is proposed without conversions", () => {
  const free = { ...context, targetCostPerLead: null, advertisingMonthlyBudget: null };
  assert.equal(expert.wasteThreshold(rows.filter((item) => !item.localServices), free), 85);
  const noConversions = [row("111", "Toiture", metrics(600, 0))];
  const findings = expert.buildExpertDiagnosis(noConversions, signals, free, { days: 30 }, "EUR");
  assert.equal(findings.some((item) => item.kind === "budget_limited"), false);
  assert.equal(findings.some((item) => item.kind === "budget_limited_unproven"), true);
  assert.equal(findings.some((item) => item.kind.startsWith("pacing") || item.kind.startsWith("cpa_")), false, "no target, no budget: no invented benchmark");
});

test("unavailable signals stay unavailable and produce no finding", () => {
  assert.equal(expert.buildExpertDiagnosis(rows, null, null, { days: 30 }, "EUR").length, 0);
  const coverage = expert.expertCoverage({ searchTerms: [], impressionShare: null, keywords: [], devices: null });
  assert.deepEqual(plain(coverage.read), ["termes de recherche", "Quality Score des mots-clés"]);
  assert.deepEqual(plain(coverage.missing), ["part d’impressions", "répartition par appareil", "requêtes Search Console", "Planificateur de mots-clés", "recommandations Google"]);
});

test("expert actions survive validation only with the matching expert evidence", () => {
  const findings = expert.buildExpertDiagnosis(rows, signals, context, { days: 30 }, "EUR");
  const evidence = ai.analysisEvidence(rows, scope, findings);
  const rec = (action, campaignIds, evidenceIds) => ({ action, priority: "high", campaignIds, evidenceIds, rationale: "Couper les recherches hors cible pour réorienter le budget." });
  const output = ai.validateAdsAIOutput({ factIds: ["scope"], hypotheses: [], recommendations: [
    rec("add_negative_keywords", ["111"], ["expert:wasted_terms:111"]),
    rec("increase_budget", ["111"], ["expert:budget_limited:111"]),
    rec("increase_budget", ["222"], ["campaign:222:cost"]),
    rec("adjust_device_bids", ["111"], ["campaign:111:cost"]),
    rec("align_budget_pacing", ["111"], ["expert:pacing_under"]),
  ] }, rows, evidence);
  assert.deepEqual(plain(output.recommendations.map((item) => item.action)), ["add_negative_keywords", "increase_budget", "align_budget_pacing"]);
  assert.throws(() => ai.validateAdsAIOutput({ factIds: ["scope"], hypotheses: [], recommendations: [rec("add_negative_keywords", ["222"], ["expert:wasted_terms:111"])] }, rows, evidence), /Justification hors périmètre/);
  const text = ai.formatAdsAIOutput(output, evidence);
  assert.match(text, /Ajouter des mots-clés négatifs/); assert.match(text, /réparation toiture prix/);
});

test("the AI call carries the expert playbook, expert evidence details and a larger output budget", async () => {
  let request;
  const provider = { id: "openai", model: "unit", complete: async (input) => { request = input; return { text: "", toolCalls: [{ name: "ads_analysis_result", arguments: { factIds: ["scope"], hypotheses: [], recommendations: [{ action: "add_negative_keywords", priority: "high", campaignIds: ["111"], evidenceIds: ["expert:excluded_terms:111"], rationale: "Exclure les recherches que le client refuse." }] } }] }; } };
  const result = await ai.analyzeAdsWithAI(provider, rows, scope, { global: "", client: "", business: context }, signals);
  assert.ok(request.maxTokens >= 2000);
  assert.match(request.system, /consultant Google Ads senior/); assert.match(request.system, /mots-clés négatifs/);
  const payload = JSON.parse(request.messages[0].content);
  assert.ok(payload.evidence.some((item) => item.kind === "excluded_terms" && /offre d'emploi/.test(item.detail)));
  assert.deepEqual(plain(payload.expertSignalsMissing), ["requêtes Search Console", "Planificateur de mots-clés", "recommandations Google"]);
  assert.equal(result.output.recommendations.length, 1);
  assert.ok(result.expert.length >= 5);
});

test("expert GAQL queries are bounded to validated campaign ids and Google Ads rows parse safely", () => {
  const period = { start: "2026-10-01", end: "2026-10-30", days: 30 };
  const query = queries.searchTermsQuery(period, ["111", "x; DROP", "222"]);
  assert.match(query, /campaign\.id IN \(111, 222\)/); assert.match(query, /LIMIT 500/);
  assert.throws(() => queries.deviceQuery(period, ["abc"]));
  assert.match(queries.impressionShareQuery(period, ["111"]), /search_budget_lost_impression_share/);
  assert.match(queries.keywordQualityQuery(period, ["111"]), /quality_info\.quality_score/);
  const parsed = client.parseExpertRows("impressionShare", [{ campaign: { id: "111" }, metrics: { searchImpressionShare: 0.42, searchBudgetLostImpressionShare: "0.3", searchRankLostImpressionShare: "--" } }, { campaign: { id: "bad" } }]);
  assert.deepEqual(plain(parsed), [{ campaignId: "111", impressionShare: 0.42, budgetLost: 0.3, rankLost: null, topImpressionShare: null }]);
  const terms = client.parseExpertRows("searchTerms", [{ campaign: { id: "111" }, searchTermView: { searchTerm: "couvreur", status: "ADDED" }, metrics: { costMicros: "2500000", clicks: "3", impressions: "10", conversions: 1 } }]);
  assert.equal(terms[0].cost, 2.5);
  const keywords = client.parseExpertRows("keywords", [{ campaign: { id: "111" }, adGroup: { id: "5" }, adGroupCriterion: { criterionId: "7", keyword: { text: "toit", matchType: "EXACT" }, qualityInfo: { qualityScore: 0 } }, metrics: {} }]);
  assert.equal(keywords[0].qualityScore, null, "out-of-range quality score is unknown, not zero");
});

test("Search Console × Ads: uncovered, relevant, poorly ranked queries become keyword opportunities; dominated paid queries are flagged", () => {
  const organic = [
    { query: "réparation toiture lyon", clicks: 2, impressions: 400, ctr: 0.005, position: 14.2 },
    { query: "couvreur urgence", clicks: 10, impressions: 300, ctr: 0.03, position: 12 },
    { query: "toiture formation", clicks: 0, impressions: 200, ctr: 0, position: 30 },
    { query: "recette tarte", clicks: 0, impressions: 900, ctr: 0, position: 40 },
    { query: "zinguerie toiture", clicks: 1, impressions: 10, ctr: 0.1, position: 20 },
    { query: "couvreur", clicks: 80, impressions: 300, ctr: 0.27, position: 1.8 },
  ];
  const findings = expert.buildExpertDiagnosis(rows, { ...signals, organicQueries: organic }, context, { days: 30 }, "EUR");
  const gap = findings.find((item) => item.kind === "organic_gap");
  assert.equal(gap.items.length, 1, "covered terms, exclusions, off-topic and low-volume queries are dropped");
  assert.match(gap.items[0], /réparation toiture lyon/); assert.equal(gap.priority, "high");
  const overlap = findings.find((item) => item.kind === "organic_overlap");
  assert.match(overlap.items[0], /« couvreur »/);
  assert.equal(expert.buildExpertDiagnosis(rows, { ...signals, organicQueries: null }, context, { days: 30 }, "EUR").some((item) => item.kind.startsWith("organic")), false);
  assert.ok(expert.expertCoverage({ ...signals, organicQueries: organic }).read.includes("requêtes Search Console"));
  const evidence = ai.analysisEvidence(rows, scope, findings);
  const out = ai.validateAdsAIOutput({ factIds: ["scope"], hypotheses: [], recommendations: [{ action: "add_exact_keywords", priority: "high", campaignIds: ["111"], evidenceIds: ["expert:organic_gap"], rationale: "Capter la demande déjà mesurée." }] }, rows, evidence);
  assert.equal(out.recommendations.length, 1);
});

test("organic snapshot parsing keeps only well-formed queries", () => {
  const organicModule = loadTs("lib/integrations/google-ads/organic.ts", { "@/lib/supabase/server": {}, "@/lib/integrations/search-console/model": { SEARCH_CONSOLE_PROVIDER: "search-console", SEARCH_CONSOLE_METRIC_KEY: "performance" } });
  assert.equal(organicModule.parseOrganicQueries({}), null);
  const parsed = organicModule.parseOrganicQueries({ queries: [{ key: "toit", clicks: 1, impressions: 5, ctr: 0.2, position: 3 }, { key: "", clicks: 1, impressions: 1 }, { key: "x", impressions: "9" }] });
  assert.deepEqual(plain(parsed), [{ query: "toit", clicks: 1, impressions: 5, ctr: 0.2, position: 3 }]);
});

test("keyword sources: planner ideas, Google recommendations and geo targets parsed strictly", () => {
  const ideas = client.parseKeywordIdeas({ results: [
    { text: "Démoussage Toiture", keywordIdeaMetrics: { avgMonthlySearches: "320", competition: "LOW", lowTopOfPageBidMicros: "1200000", highTopOfPageBidMicros: "3400000" } },
    { text: "démoussage toiture", keywordIdeaMetrics: { avgMonthlySearches: "999" } },
    { text: "", keywordIdeaMetrics: {} },
    { text: "toit", keywordIdeaMetrics: { competition: "WEIRD", lowTopOfPageBidMicros: "0" } },
  ] });
  assert.deepEqual(plain(ideas), [
    { text: "démoussage toiture", avgMonthlySearches: 320, competition: "LOW", lowBid: 1.2, highBid: 3.4 },
    { text: "toit", avgMonthlySearches: null, competition: null, lowBid: null, highBid: null },
  ], "duplicates dropped, unknown values stay null, never zero");
  assert.deepEqual(plain(client.parseKeywordIdeas({})), []);
  assert.throws(() => client.parseKeywordIdeas({ results: "x" }));
  const recs = client.parseRecommendedKeywords([
    { recommendation: { campaign: "customers/1/campaigns/111", keywordRecommendation: { keyword: { text: "Couvreur Perpignan", matchType: "PHRASE" } } } },
    { recommendation: { campaign: "customers/1/campaigns/999", keywordRecommendation: { keyword: { text: "hors périmètre" } } } },
  ], ["111"]);
  assert.deepEqual(plain(recs), [{ campaignId: "111", text: "couvreur perpignan", matchType: "PHRASE" }]);
  assert.equal(client.pickGeoTarget({ geoTargetConstantSuggestions: [
    { geoTargetConstant: { resourceName: "geoTargetConstants/2250", status: "ENABLED", countryCode: "FR", targetType: "Country" } },
    { geoTargetConstant: { resourceName: "geoTargetConstants/1006094", status: "ENABLED", countryCode: "FR", targetType: "City" } },
  ] }), "geoTargetConstants/1006094");
  assert.equal(client.pickGeoTarget({ geoTargetConstantSuggestions: [{ geoTargetConstant: { resourceName: "geoTargetConstants/1", status: "ENABLED", countryCode: "ES", targetType: "City" } }] }), null);
  assert.match(queries.keywordRecommendationsQuery(), /FROM recommendation WHERE recommendation\.type = 'KEYWORD'/);
});

test("keyword opportunities: relevant, uncovered, non-excluded ideas ranked by measured demand and cross-source confirmation", () => {
  const ctx = { ...context, priorityServices: "réparation toiture, démoussage" };
  const ideas = [
    { text: "démoussage toiture", avgMonthlySearches: 320, competition: "LOW", lowBid: 1.2, highBid: 3.4 },
    { text: "réparation toiture perpignan", avgMonthlySearches: 90, competition: "MEDIUM", lowBid: 2, highBid: 5 },
    { text: "formation couvreur", avgMonthlySearches: 900, competition: "LOW", lowBid: 1, highBid: 2 },
    { text: "toiture gratuit", avgMonthlySearches: 500, competition: null, lowBid: null, highBid: null },
    { text: "recette tarte", avgMonthlySearches: 9000, competition: "LOW", lowBid: 0.1, highBid: 0.2 },
    { text: "couvreur", avgMonthlySearches: 5000, competition: "HIGH", lowBid: 2, highBid: 6 },
    { text: "démoussage toit rare", avgMonthlySearches: 10, competition: "LOW", lowBid: 1, highBid: 2 },
  ];
  const recommended = [{ campaignId: "111", text: "réparation toiture perpignan", matchType: "PHRASE" }, { campaignId: "111", text: "toiture fuite", matchType: "BROAD" }];
  const organic = [{ query: "réparation toiture perpignan", clicks: 0, impressions: 60, ctr: 0, position: 15 }];
  const findings = expert.buildExpertDiagnosis(rows, { ...signals, organicQueries: organic, keywordIdeas: ideas, recommendedKeywords: recommended }, ctx, { days: 30 }, "EUR");
  const found = findings.find((item) => item.kind === "keyword_ideas");
  assert.ok(found);
  assert.equal(found.items.length, 3, "excluded, noise, off-topic, covered and low-volume ideas are dropped");
  assert.match(found.items[0], /« réparation toiture perpignan » · 90 recherches\/mois · haut de page .*2,00.*5,00.* · concurrence moyenne · recommandé par Google · 60 impressions Search Console/);
  assert.match(found.items[1], /« démoussage toiture » · 320 recherches\/mois/);
  assert.match(found.items[2], /« toiture fuite » · recommandé par Google/);
  assert.match(found.detail, /Planificateur de mots-clés, recommandations Google du compte, Search Console/);
  assert.equal(expert.buildExpertDiagnosis(rows, signals, ctx, { days: 30 }, "EUR").some((item) => item.kind === "keyword_ideas"), false, "no source read: no opportunity invented");
  const coverage = expert.expertCoverage({ ...signals, keywordIdeas: null, recommendedKeywords: recommended });
  assert.ok(coverage.read.includes("recommandations Google")); assert.ok(coverage.missing.includes("Planificateur de mots-clés"));
  const evidence = ai.analysisEvidence(rows, scope, findings);
  const out = ai.validateAdsAIOutput({ factIds: ["scope"], hypotheses: [], recommendations: [{ action: "add_exact_keywords", priority: "high", campaignIds: ["111"], evidenceIds: ["expert:keyword_ideas"], rationale: "Demande chiffrée par Google." }] }, rows, evidence);
  assert.equal(out.recommendations.length, 1);
});

test("keyword seeds: declared services, converting terms, then related Search Console queries; never an exclusion", () => {
  const seeds = expert.keywordSeeds({ ...signals, organicQueries: [{ query: "Réparation toiture Lyon", impressions: 400, clicks: 1, ctr: 0, position: 14 }, { query: "recette tarte", impressions: 900, clicks: 0, ctr: 0, position: 40 }] },
    { ...context, priorityServices: "Réparation toiture\nDémoussage, formation" });
  assert.deepEqual(plain(seeds), ["reparation toiture", "demoussage", "couvreur", "couvreur urgence", "reparation toiture lyon"]);
  assert.deepEqual(plain(expert.keywordSeeds(null, null)), []);
});

test("daily watch: new client automations run every day at 07:00; keyword sources wired into the watch and the manual analysis", () => {
  const coverage = readFileSync(new URL("../lib/agents/coverage-service.ts", import.meta.url), "utf8");
  assert.match(coverage, /runType: "ads\.monitor", clientId, frequency: "daily", schedule: \{ time: "07:00" \}/);
  assert.match(readFileSync(new URL("../lib/ads/expert-run.ts", import.meta.url), "utf8"), /withKeywordSources\(reader, summary, signals/);
  assert.match(readFileSync(new URL("../lib/integrations/google-ads/service.ts", import.meta.url), "utf8"), /withKeywordSources\(client, account, signals/);
});
