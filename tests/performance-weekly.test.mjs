import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const model = loadTs("lib/performance/weekly-model.ts");
const engine = loadTs("lib/performance/engine.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));
const scores = (performance, accessibility = 95, bestPractices = 100, seo = 100) => ({ performance, accessibility, bestPractices, seo });

test("readScores lit les 4 catégories et ne transforme jamais une note illisible en 0", () => {
  assert.deepEqual(plain(model.readScores({ performance: 52, accessibility: 96, bestPractices: 100, seo: 100 })), scores(52, 96, 100, 100));
  assert.deepEqual(plain(model.readScores({ performance: 0.44, "best-practices": 0.9 })), { performance: 44, accessibility: null, bestPractices: 90, seo: null });
  assert.deepEqual(plain(model.readScores(null)), { performance: null, accessibility: null, bestPractices: null, seo: null });
  assert.equal(model.readScores({ performance: "97" }).performance, null);
});

test("un score sous 50 est une alerte, « high » sous 30", () => {
  const findings = model.evaluateAudit(scores(44, 28), []);
  assert.deepEqual(plain(findings.map(({ category, kind, severity }) => [category, kind, severity])), [["performance", "low", "medium"], ["accessibility", "low", "high"]]);
  assert.equal(model.evaluateAudit(scores(50), []).length, 0);
});

test("une baisse de 10 points par rapport à la médiane des audits précédents est signalée, pas le bruit", () => {
  const history = [scores(70), scores(68), scores(90), scores(66)];
  assert.equal(model.evaluateAudit(scores(62), history).length, 0, "médiane 69 : -7 points = bruit");
  const drop = model.evaluateAudit(scores(58), history);
  assert.deepEqual(plain(drop.map(({ kind, baseline, score }) => [kind, baseline, score])), [["drop", 69, 58]]);
  assert.equal(model.evaluateAudit(scores(58), []).length, 0, "sans historique, pas de baisse");
  // Au plus 4 audits de référence, du plus récent au plus ancien.
  assert.equal(model.evaluateAudit(scores(80), [scores(85), scores(85), scores(85), scores(85), scores(100), scores(100)]).length, 0);
});

test("score faible et baisse peuvent coexister ; une catégorie illisible n'alerte jamais", () => {
  assert.deepEqual(plain(model.evaluateAudit(scores(40), [scores(70)]).map((f) => f.kind)), ["low", "drop"]);
  assert.equal(model.evaluateAudit({ performance: null, accessibility: null, bestPractices: null, seo: null }, [scores(90)]).length, 0);
});

test("cadence : hebdomadaire, 6 h d'attente après un échec, fenêtre de nuit à Paris", () => {
  const now = new Date("2026-11-22T02:00:00Z"); // 3 h à Paris
  assert.equal(model.auditDue({ lastAuditAt: null, lastFailureAt: null }, now), true);
  assert.equal(model.auditDue({ lastAuditAt: "2026-11-16T02:00:00Z", lastFailureAt: null }, now), false, "6 jours : pas encore");
  assert.equal(model.auditDue({ lastAuditAt: "2026-11-15T13:00:00Z", lastFailureAt: null }, now), true, "6,5 jours");
  assert.equal(model.auditDue({ lastAuditAt: null, lastFailureAt: "2026-11-21T22:00:00Z" }, now), false);
  assert.equal(model.auditDue({ lastAuditAt: null, lastFailureAt: "2026-11-21T19:00:00Z" }, now), true);
  assert.equal(model.inAuditWindow(now), true);
  assert.equal(model.inAuditWindow(new Date("2026-11-22T06:00:00Z")), false, "7 h à Paris");
  assert.equal(model.inAuditWindow(new Date("2026-07-01T23:30:00Z")), true, "1 h 30 en heure d'été");
  assert.deepEqual(plain(model.auditOrder([{ id: "b", lastAuditAt: "2026-11-10T00:00:00Z" }, { id: "a", lastAuditAt: null }, { id: "c", lastAuditAt: "2026-11-01T00:00:00Z" }]).map((x) => x.id)), ["a", "c", "b"]);
});

test("empreintes et titres d'incidents stables par site, support, catégorie et type", () => {
  assert.equal(model.findingFingerprint("c1", "mobile", "seo", "drop"), "lighthouse:c1:mobile:seo:drop");
  assert.equal(model.allFingerprints("c1", "desktop").length, 8);
  const [low] = model.evaluateAudit(scores(44), []);
  assert.equal(model.findingTitle("www.exemple.fr", "mobile", low), "www.exemple.fr : Performance mobile faible (44/100)");
  const [drop] = model.evaluateAudit(scores(80, 80), [scores(80, 95)]);
  assert.equal(model.findingTitle("www.exemple.fr", "desktop", drop), "www.exemple.fr : Accessibilité ordinateur en baisse (95 → 80/100)");
  assert.deepEqual(plain(model.topOpportunities([{ title: "A", savingsMs: 100 }, { title: "B", savingsMs: 900 }, { nope: 1 }, { title: "C" }], 2)), ["B", "A"]);
});

test("moteur : secret obligatoire, HTTPS, erreurs amont relayées sans fuite", async () => {
  assert.equal(engine.engineConfig({}).ok, false);
  assert.equal(engine.engineConfig({ CODEV_PERFORMANCE_SERVICE_KEY: "x".repeat(24), CODEV_PERFORMANCE_API_URL: "http://moteur.example/api" }).ok, false);
  const env = { CODEV_PERFORMANCE_SERVICE_KEY: "k".repeat(30) };
  let seen;
  const ok = await engine.runEngineAudit({ url: "https://www.exemple.fr/", strategy: "mobile" }, { env, fetchImpl: async (url, init) => { seen = { url: String(url), headers: init.headers, body: init.body }; return new Response(JSON.stringify({ url: "https://www.exemple.fr/", strategy: "mobile", analyzedAt: "2026-11-17T00:00:00Z", source: "PSI", scores: { performance: 90 }, lab: {}, field: {}, opportunities: [] }), { status: 200 }); } });
  assert.equal(ok.scores.performance, 90);
  assert.equal(seen.url, "https://www.code-v.fr/api/performance");
  assert.equal(seen.headers["x-codev-service-key"], env.CODEV_PERFORMANCE_SERVICE_KEY);
  assert.deepEqual(JSON.parse(seen.body), { url: "https://www.exemple.fr/", strategy: "mobile" });
  await assert.rejects(engine.runEngineAudit({ url: "https://x.fr/", strategy: "mobile" }, { env, fetchImpl: async () => new Response(JSON.stringify({ error: "Quota PageSpeed atteint." }), { status: 429 }) }), (error) => error.status === 429 && error.message === "Quota PageSpeed atteint.");
  await assert.rejects(engine.runEngineAudit({ url: "https://x.fr/", strategy: "mobile" }, { env, fetchImpl: async () => new Response("<html>", { status: 500 }) }), (error) => error.status === 502 && error.kind === "unreachable");
  await assert.rejects(engine.runEngineAudit({ url: "https://x.fr/", strategy: "mobile" }, { env: {} }), (error) => error.status === 503 && error.kind === "not_configured");
});

test("étape « lighthouse » : planifiée par le tick, déclarée au battement et portée par l'Agent Monitoring", () => {
  const route = readFileSync("app/api/internal/scheduler/tick/route.ts", "utf8");
  assert.match(route, /step\("lighthouse", \(\) => runLighthouseTick\(new Date\(\)\)/);
  assert.match(readFileSync("lib/scheduler/heartbeat.ts", "utf8"), /"lighthouse"/);
  const { harnessCharters } = loadTs("lib/harness/charter.ts");
  const monitoring = harnessCharters.find((item) => item.id === "monitoring");
  assert.ok(monitoring.triggers.some((t) => t.kind === "step" && t.step === "lighthouse"));
  const weekly = readFileSync("lib/performance/weekly.ts", "utf8");
  assert.doesNotMatch(weekly, /modify_site|apply_fix|prepareAction/, "l'audit ne prépare ni n'applique de correctif");
});
