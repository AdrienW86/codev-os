// Pilote automatique Google Ads : seules des exclusions évidentes, plafonnées, journalisées et annulables.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";
const plain = (value) => JSON.parse(JSON.stringify(value));
const expert = loadTs("lib/integrations/google-ads/expert.ts");
const autopilot = loadTs("lib/ads/autopilot.ts", { "@/lib/integrations/google-ads/expert": expert });
const business = loadTs("lib/integrations/google-ads/business-context.ts");

const m = (cost, conversions, clicks = 40) => ({ cost, conversions, clicks, impressions: 900, ctr: 0.04, averageCpc: cost / clicks, costPerConversion: null, conversionValue: null });
const row = (id, type = "SEARCH", status = "ENABLED") => ({ id, name: id, type, status, metrics: m(500, 10), hasActivity: true, localServices: type === "LOCAL_SERVICES", budget: {}, subType: null, previous: null });
const rows = [row("111"), row("222", "PERFORMANCE_MAX"), row("333", "LOCAL_SERVICES"), row("444", "SEARCH", "PAUSED")];
const context = { ...business.EMPTY_ADS_CONTEXT, exclusions: "emploi, formation", priorityServices: "réparation toiture, couverture", targetCostPerLead: 50 };
const term = (campaignId, text, cost, conversions = 0, status = "NONE", clicks = 5) => ({ campaignId, term: text, status, impressions: 50, clicks, cost, conversions });
const signals = { impressionShare: null, keywords: null, devices: null, searchTerms: [
  term("111", "couvreur offre d'emploi", 4),          // exclusion déclarée → oui même à faible coût
  term("111", "recette crêpes bretonnes", 150),       // hors cible et ≥ 2×50 → oui
  term("111", "réparation toiture prix", 400),        // mot protégé (service prioritaire) → jamais automatique
  term("111", "couvreur urgence nuit", 300),          // partage « couvreur » avec un terme qui convertit → non
  term("111", "couvreur lyon", 90, 3),                // convertit → protège « couvreur »
  term("111", "jardinage facile", 60),                // hors cible mais < 2× seuil → non
  term("111", "formation déjà exclue", 50, 0, "EXCLUDED"),
  term("222", "emploi pmax", 50), term("333", "emploi lsa", 50), term("444", "emploi pause", 50),
] };
const plan = (overrides = {}) => autopilot.planAutopilot({ mode: "negatives", rows, signals, business: context, clientName: "Toitures Martin", journal: [], now: new Date("2026-11-11T00:00:00Z"), ...overrides });

test("only obvious exclusions on enabled Search campaigns, exact match, never protected or converting vocabulary", () => {
  const result = plain(plan());
  assert.deepEqual(result.map((item) => [item.campaignId, item.keyword, item.matchType, item.reason]), [
    ["111", "recette crêpes bretonnes", "EXACT", "off_target_waste"],
    ["111", "couvreur offre d'emploi", "EXACT", "client_exclusion"],
  ]);
  assert.equal(plan({ mode: "off" }).length, 0, "disabled by default");
  assert.equal(plan({ signals: { ...signals, searchTerms: null } }).length, 0);
});

test("weekly cap per campaign counts the journal, and anything already handled or undone by a human is never re-added", () => {
  const recent = (keyword, status = "applied") => ({ campaignId: "111", keyword, status, createdAt: "2026-11-09T00:00:00Z" });
  assert.equal(plan({ maxPerCampaignWeek: 1 }).length, 1);
  assert.equal(plan({ maxPerCampaignWeek: 1, journal: [recent("autre chose")] }).length, 0);
  assert.equal(plan({ maxPerCampaignWeek: 1, journal: [{ ...recent("autre chose"), createdAt: "2026-10-01T00:00:00Z" }] }).length, 1, "older than 7 days does not count");
  const result = plain(plan({ journal: [recent("Recette  crêpes bretonnes", "undone")] }));
  assert.deepEqual(result.map((item) => item.keyword), ["couvreur offre d'emploi"]);
});

test("write foundation: undo removes only a campaign criterion of the same account and campaign", () => {
  const foundation = loadTs("lib/ads/write-foundation.ts", { "@/lib/providers/api": {} });
  const preview = foundation.prepareAdsChange({ kind: "negative_keyword_remove", customerId: "1234567890", campaignId: "111", resourceNames: ["customers/1234567890/campaignCriteria/111~987"] });
  assert.deepEqual(plain(preview), { resource: "campaignCriteria", operations: [{ remove: "customers/1234567890/campaignCriteria/111~987" }] });
  for (const name of ["customers/9999999999/campaignCriteria/111~987", "customers/1234567890/campaignCriteria/222~987", "customers/1234567890/adGroupCriteria/1~2"])
    assert.throws(() => foundation.prepareAdsChange({ kind: "negative_keyword_remove", customerId: "1234567890", campaignId: "111", resourceNames: [name] }));
});

test("autopilot never writes unless both server flags are true, and the weekly monitor wires it after the expert diagnosis", async () => {
  const { readFileSync } = await import("node:fs");
  const service = readFileSync(new URL("../lib/ads/autopilot-service.ts", import.meta.url), "utf8");
  assert.match(service, /CODEV_GOOGLE_ADS_WRITES_ENABLED === "true" && env\.CODEV_GOOGLE_ADS_AUTOPILOT === "true"/);
  assert.match(service, /if \(!autopilotServerEnabled\(\)\) \{ result\.skipped/);
  assert.ok(service.indexOf('from("ads_autopilot_changes").insert') < service.indexOf("executeApprovedAdsChange({ kind: \"negative_keyword_add\""), "journal before the Google Ads call");
  const run = readFileSync(new URL("../lib/ads/expert-run.ts", import.meta.url), "utf8");
  assert.match(run, /settings\.mode !== "off"/); assert.match(run, /createGoogleAdsReadClient\(authorize\)/);
  const migration = readFileSync(new URL("../supabase/migrations/20261205000000_ads_autopilot.sql", import.meta.url), "utf8");
  assert.match(migration, /mode text not null default 'off'/); assert.match(migration, /ads_autopilot_changes_active_uniq/);
});
