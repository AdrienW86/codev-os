// Point de situation des agents (lot 1 de l'architecture) : modèle pur, couverture de la charte, cohérence des registres.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs, loadRegistry } from "./helpers/load-ts.mjs";

const b = loadTs("lib/harness/briefing.ts");
const charter = loadTs("lib/harness/charter.ts");
const now = new Date("2026-11-18T10:00:00.000Z");
const daysAgo = (n) => new Date(now.getTime() - n * 86_400_000).toISOString();
const plain = (value) => JSON.parse(JSON.stringify(value));
const ok = { state: "ok", lines: ["Dernier passage : exécutée."] };

test("a briefing never claims health without data: failed read is unreadable, no fact is stale", () => {
  const blog = charter.getCharter("blog");
  const unreadable = b.buildAgentBriefing(blog, ok, null, now);
  assert.equal(unreadable.state, "unavailable");
  assert.match(unreadable.gaps[0], /impossible/);
  const empty = b.buildAgentBriefing(blog, ok, { facts: [], gaps: [] }, now);
  assert.equal(empty.state, "ok");
  assert.equal(empty.stale, true);
  assert.match(empty.gaps.join(" "), /Aucun constat enregistré/);
  const old = b.buildAgentBriefing(blog, ok, { facts: [{ statement: "Article publié.", at: daysAgo(20) }], gaps: [] }, now);
  assert.equal(old.stale, true);
  const fresh = b.buildAgentBriefing(blog, ok, { facts: [{ statement: "Article publié.", at: daysAgo(2) }], gaps: [] }, now);
  assert.equal(fresh.stale, false);
  assert.equal(fresh.lastActivityAt, daysAgo(2));
  // Agent à la demande : jamais « sans activité » faute d'exécution planifiée.
  assert.equal(b.buildAgentBriefing(charter.getCharter("newsletter"), { state: "manual", lines: [] }, { facts: [], gaps: [] }, now).stale, false);
});

test("alerts rank failed first and the summary names them", () => {
  const mk = (id, state, stale = false) => ({ agent: id, name: id, team: "contenu", mission: "", state, health: [], facts: [], gaps: [], lastActivityAt: null, stale });
  const list = [mk("a", "ok"), mk("b", "attention"), mk("c", "failed"), mk("d", "ok", true), mk("e", "manual")];
  assert.deepEqual(b.briefingAlerts(list).map((item) => item.agent), ["c", "b", "d"]);
  assert.match(b.briefingsSummary(list), /5 agents consultés, 3 à examiner : c \(en échec\), b \(à vérifier\), d \(sans activité récente\)/);
  assert.match(b.briefingsSummary([mk("a", "ok")]), /aucun en échec/);
});

test("publications briefing counts per network, flags failures and states missing statistics", () => {
  const rows = [
    { platform: "facebook", status: "published", scheduled_for: daysAgo(3), published_at: daysAgo(3) },
    { platform: "instagram", status: "published", scheduled_for: daysAgo(4), published_at: daysAgo(4) },
    { platform: "facebook", status: "published", scheduled_for: daysAgo(5), published_at: daysAgo(5) },
    { platform: "tiktok", status: "blocked", scheduled_for: daysAgo(2), published_at: null },
    { platform: "google_business_profile", status: "scheduled", scheduled_for: new Date(now.getTime() + 2 * 86_400_000).toISOString(), published_at: null },
  ];
  const signals = plain(b.publicationsSignals(rows, now));
  assert.match(signals.facts[0].statement, /3 publications diffusées sur 30 jours \(Facebook 2, Instagram 1\)/);
  assert.match(signals.facts[1].statement, /1 diffusion programmée.*Google Business Profile 1/);
  assert.match(signals.facts[2].statement, /1 diffusion en échec ou bloquée.*TikTok 1/);
  assert.match(signals.gaps.join(" "), /Statistiques des publications/);
  assert.match(b.publicationsSignals([], now).gaps.join(" "), /Aucune diffusion programmée/);
});

test("monitoring, snapshots, reviews and scores turn rows into dated facts or explicit gaps", () => {
  const mon = plain(b.monitoringSignals([{ ok: true, checked_at: daysAgo(1) }, { ok: false, checked_at: daysAgo(1) }], [{ strategy: "mobile", scores: { performance: 61.4 }, analyzed_at: daysAgo(3) }], now));
  assert.match(mon.facts[0].statement, /Disponibilité 50 % sur 2 contrôles/);
  assert.match(mon.facts[1].statement, /mobile.*performance 61\/100/);
  assert.match(plain(b.monitoringSignals([], [], now)).gaps.join(" "), /Aucun contrôle.*Aucun audit Lighthouse/);
  const snaps = plain(b.snapshotSignals([{ provider: "search-console", metric_key: "summary", period_end: "2026-11-16", fetched_at: daysAgo(15), data: {} }], ["search-console", "google-analytics"], now));
  assert.match(snaps.facts[0].statement, /Search Console.*2026-11-16/);
  assert.match(snaps.gaps.join(" "), /plus de 10 jours.*Google Analytics 4 : aucune donnée/);
  const reviews = plain(b.reviewSignals([{ created_at: daysAgo(1), metadata: { fact_passed: false, duplicate_passed: true } }, { created_at: daysAgo(2), metadata: { fact_passed: true, duplicate_passed: null } }], "fact", now));
  assert.match(reviews.facts[0].statement, /2 textes contrôlés sur 30 jours, 1 refusé/);
  assert.equal(plain(b.reviewSignals([{ created_at: daysAgo(1), metadata: { fact_passed: true, duplicate_passed: null } }], "duplicate", now)).facts.length, 0);
  assert.match(plain(b.scoreSignals([{ created_at: daysAgo(1), metadata: { style_score: 80 } }, { created_at: daysAgo(1), metadata: { style_score: 90 } }], "style_score", "note de naturel", now)).facts[0].statement, /Note de naturel moyenne 85\/100 sur 2 textes/);
});

test("every charter agent has a briefing reader and the Director consults them all", () => {
  const service = readFileSync("lib/harness/briefing-service.ts", "utf8");
  const block = service.slice(service.indexOf("export const briefingReaders"), service.indexOf("export async function loadAgentBriefings"));
  for (const item of charter.harnessCharters) assert.match(block, new RegExp(`(^|\\s)"?${item.id}"?: `, "m"), `reader missing for ${item.id}`);
  assert.match(service, /Record<HarnessAgentId, Reader>/);
  const director = readFileSync("lib/assistant/director.ts", "utf8");
  assert.match(director, /loadAgentBriefings\(\{ clientId: selectedId \}\)/);
});

test("the three agent registries stay consistent with the charter", () => {
  const { registry } = loadRegistry();
  const catalog = loadTs("lib/agents/catalog.ts", { "@/lib/services/catalog": loadTs("lib/services/catalog.ts") });
  const registryTypes = new Set(charter.harnessCharters.flatMap((item) => item.registryType ? [item.registryType] : []));
  // Agent Automatisation : jamais exécuté, volontairement sans charte (docs/harness.md).
  const legacy = new Set(["automation"]);
  for (const type of registryTypes) assert.ok(registry.agentDefinitions[type], `charter registryType ${type} missing from registry`);
  for (const type of Object.keys(registry.agentDefinitions)) assert.ok(legacy.has(type) || registryTypes.has(type), `registry agent ${type} has no charter`);
  const charterIds = new Set(charter.harnessCharters.map((item) => item.id));
  for (const blueprint of catalog.agentCatalog) assert.ok(legacy.has(blueprint.id) || registryTypes.has(blueprint.id) || charterIds.has(blueprint.id), `catalog agent ${blueprint.id} has no charter`);
  for (const item of charter.harnessCharters) for (const trigger of item.triggers) {
    if (trigger.kind !== "run") continue;
    assert.ok(registry.runTypes[trigger.runType], `${item.id}: run type ${trigger.runType} unknown`);
  }
});

test("agent_briefing tool is read-only and lists every charter agent", () => {
  const tools = readFileSync("lib/assistant/tools.ts", "utf8");
  assert.match(tools, /agent_briefing: \{\n\s+kind: "read"/);
  assert.match(readFileSync("lib/assistant/executor.ts", "utf8"), /case "agent_briefing": return agentBriefingTool\(input\);/);
  const tool = readFileSync("lib/assistant/agents-briefing-tool.ts", "utf8");
  assert.match(tool, /await requireAdmin\(\);\n\s+if \(await getActiveScenario\(\)\)/);
  assert.doesNotMatch(tool, /\.insert\(|\.update\(|\.delete\(|runNow|fetch\(/);
});
