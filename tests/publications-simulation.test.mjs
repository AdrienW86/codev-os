// PR #44 — simulation administrateur du pipeline Publications. Mocks et fixtures fictives uniquement : aucun réseau,
// aucune base. Prouve que les vraies règles sont appliquées, que les publishers réels et la base ne sont jamais
// chargés, et qu'aucun succès simulé ne peut passer pour une publication réelle.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { load, src, json, root, form } from "./helpers/ts-load.mjs";

const now = new Date("2026-10-12T08:00:00Z");
// Graphe des modules réellement chargés (proxy sur la table des mocks) et fetch espionné : aucun appel attendu.
const loaded = [], fetches = [];
const tracer = new Proxy({}, { has(_, name) { loaded.push(name); return false; } });
const runner = load("lib/publications/simulation/runner.ts", tracer, { fetch: (...args) => { fetches.push(args); throw Error("network forbidden"); } });
const adapters = load("lib/publications/simulation/adapters.ts");
const fixtures = load("lib/publications/simulation/fixtures.ts");
const model = load("lib/publications/simulation/model.ts");
const scenarios = runner.pipelineScenarioSummaries();
const byId = id => scenarios.find(s => s.id === id);
const run = (id, extra = {}, outcomes = byId(id).defaultOutcomes) => runner.runPublicationSimulation({ scenarioId: id, outcomes }, { now, ...extra });
const spyPublisher = (id, outcomes = byId(id).defaultOutcomes) => adapters.simulatedPublisher(outcomes, id);

test("catalogue : quatre clients d'exemple fictifs, dont un scénario négatif", () => {
  assert.deepEqual(json(scenarios.map(s => s.clientName)), ["CODE-V", "JRenov", "Couverture Catalane", "Protection Nuisibles"]);
  assert.equal(new Set(scenarios.map(s => s.id)).size, 4);
  assert.deepEqual(json(scenarios.filter(s => s.negative).map(s => s.id)), ["nuisibles-facture"]);
  for (const s of fixtures.PIPELINE_SCENARIOS) {
    for (const p of s.photos) assert.match(p.id, /^sim-photo-/);
    for (const h of s.history) assert.match(h.id, /^sim-pub-/);
    for (const platform of ["facebook", "instagram", "google_business_profile"]) assert.ok(model.SIMULATED_OUTCOMES.includes(s.defaultOutcomes[platform]));
  }
  assert.match(model.FICTITIOUS_NOTICE, /entièrement fictifs/);
});

test("isolement : ni base, ni publisher réel, ni moteur branché, ni IA réelle, ni réseau", async () => {
  for (const s of scenarios) await run(s.id);
  const forbidden = /supabase|delivery\/(registry|engine|fakes|meta-publisher|gbp-publisher|service)|integrations|openai|media-intelligence\/service|agent-v2\/(service|context|media|open-occurrences|media-runs)$|require-admin|next\/|whatsapp|oauth|connections\/(vault|service|providers|meta|google)/;
  const hits = [...new Set(loaded)].filter(name => forbidden.test(name));
  assert.deepEqual(hits, [], "no forbidden module in the simulation graph");
  for (const expected of ["@/lib/media-intelligence/model", "../agent-v2/library-pool", "../agent-v2/selection", "../delivery/model", "../delivery/publisher", "../connections/model", "../media-rule", "../transitions"])
    assert.ok(loaded.includes(expected), `real rule reused: ${expected}`);
  assert.equal(fetches.length, 0, "no fetch");
  // Sans `process` dans le contexte : toute lecture d'environnement aurait échoué.
  for (const f of readdirSync(resolve(root, "lib/publications/simulation"))) {
    const code = src(`lib/publications/simulation/${f}`).replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(code, /process\.env|\bfetch\s*\(|https?:\/\/|getSupabaseServerClient|\.rpc\(|\.from\(|server-only|delivery\/(engine|fakes|registry)|processDuePublications/, f);
    assert.doesNotMatch(code, /publication_deliveries|publication_attempts|publication_jobs|whatsapp_asset_uses|admin_notifications|insert|upsert/i, `${f}: never touches real tables`);
  }
});

test("Couverture Catalane : un quatrième démoussage est refusé par le validateur, l'idée tourne vers le faîtage", async () => {
  const r = await run("catalane-rotation");
  assert.equal(r.history.length, 3);
  assert.ok(r.history.every(h => /démoussage/i.test(h.subject)), "three démoussage in a row considered");
  assert.equal(r.attempts.length, 2);
  assert.deepEqual(json(r.attempts.map(a => [a.accepted, a.reason])), [[false, "repetition"], [true, null]]);
  assert.match(r.attempts[0].subject, /démoussage/i);
  assert.equal(r.idea.subject, "Réparation de faîtage avant les pluies");
  assert.equal(r.selected.photoId, "sim-photo-catalane-2");
  assert.match(r.selected.reason, /Faîtage en tuiles canal.*Première proposition \(« Le démoussage avant l’hiver »\) écartée/);
  assert.equal(r.photos.find(p => p.id === "sim-photo-catalane-3").exclusion, "Visage ou mineur identifiable : examen humain obligatoire avant tout usage.");
  assert.deepEqual(json(r.variants.map(v => v.platform)), ["facebook", "instagram", "google_business_profile"]);
  assert.ok(r.variants.every(v => v.ruleOk && v.slot));
  assert.equal(r.approval.possible, true);
  // Connexion Google expirée : bloquée avant envoi, publisher jamais appelé pour GBP.
  const publisher = spyPublisher("catalane-rotation");
  const again = await run("catalane-rotation", { publisher });
  assert.deepEqual(json(publisher.calls), ["facebook", "instagram"]);
  const gbp = again.deliveries.find(d => d.platform === "google_business_profile");
  assert.equal(gbp.status, "blocked"); assert.equal(gbp.publisherCalled, false); assert.match(gbp.detail, /Connexion inactive/);
});

test("Protection Nuisibles (négatif) : la facture ne peut jamais illustrer, même si le modèle la juge pertinente", async () => {
  const publisher = spyPublisher("nuisibles-facture");
  const r = await run("nuisibles-facture", { publisher });
  const invoice = r.photos.find(p => p.id === "sim-photo-nuisibles-1");
  assert.equal(invoice.modelVerdict, "Pertinent");
  assert.equal(invoice.verdict, "to_review"); assert.equal(invoice.confidential, true); assert.equal(invoice.overridden, true); assert.equal(invoice.candidate, false);
  assert.ok(invoice.publishability <= 0.1);
  assert.match(invoice.exclusion, /Confidentielle \(Facture ou devis\)/);
  assert.equal(r.photos.find(p => p.id === "sim-photo-nuisibles-2").candidate, false);
  assert.equal(r.attempts[0].reason, "invalid_media", "the invoice proposed by the model is refused by the Agent v2 validator");
  assert.equal(r.attempts[0].mediaLabel, "Facture d’intervention");
  assert.equal(r.selected.photoId, null);
  assert.match(r.selected.reason, /Aucune photo publiable.*Photo manquante/);
  assert.equal(r.approval.possible, false);
  assert.match(r.approval.message, /Média requis avant validation/);
  assert.equal(r.approval.validations.find(v => v.label === "Validation humaine").state, "blocked");
  assert.deepEqual(json(r.deliveries), [], "never delivered");
  assert.deepEqual(json(publisher.calls), [], "publisher never called");
});

test("JRenov : visage et photo récente écartés ; succès simulé, refus et panne selon les résultats choisis", async () => {
  const r = await run("jrenov-mixed");
  assert.match(r.photos.find(p => p.id === "sim-photo-jrenov-2").exclusion, /Visage/);
  assert.match(r.photos.find(p => p.id === "sim-photo-jrenov-3").exclusion, /dernières publications|Déjà utilisée/);
  assert.equal(r.selected.photoId, "sim-photo-jrenov-1");
  assert.deepEqual(json(r.deliveries.map(d => [d.platform, d.status, d.publisherCalled])),
    [["facebook", "simulated", true], ["instagram", "failed", true], ["google_business_profile", "retryable_error", true]]);
  assert.match(r.deliveries[1].detail, /Contenu refusé par le fournisseur/);
  assert.match(r.deliveries[2].nextRetry, /1 min \(tentative 2 sur 5\)/);
  assert.ok(r.deliveries.every(d => d.simulated === true && d.status !== "published"), "never a real success");
  assert.doesNotMatch(JSON.stringify(r), /"published"/);
});

test("résultats sélectionnables : connexion expirée, plateforme indisponible, refus sur CODE-V", async () => {
  const outcomes = { facebook: "expired", instagram: "down", google_business_profile: "refused" };
  const publisher = spyPublisher("codev-nominal", outcomes);
  const r = await run("codev-nominal", { publisher }, outcomes);
  assert.deepEqual(json(r.deliveries.map(d => d.status)), ["blocked", "retryable_error", "failed"]);
  assert.deepEqual(json(publisher.calls), ["instagram", "google_business_profile"], "expired connection: no send attempt");
  assert.equal(r.approval.validations.find(v => v.label === "Connexion et compte actifs").state, "blocked");
  assert.equal(r.approval.validations.find(v => v.label.startsWith("Arrêt d’urgence")).state, "info");
  const ok = await run("codev-nominal");
  assert.deepEqual(json(ok.deliveries.map(d => d.statusLabel)), ["Diffusion simulée", "Diffusion simulée", "Diffusion simulée"]);
  assert.equal(ok.slots.batch.length, 3); assert.ok(ok.slots.considered >= 3);
  assert.deepEqual(json(ok.photos.map(p => p.candidate)), [true, false, false]);
  assert.match(ok.photos[1].exclusion, /Confidentielle \(Écran\)/);
});

test("statut final : même table que publication_job_complete, jamais « publiée » depuis la simulation", () => {
  const s = o => json(runner.completedStatus(o, 1));
  assert.deepEqual(s({ result: "simulated", remoteId: "simulated-x" }), { status: "simulated", next: null });
  assert.deepEqual(s({ result: "published", remoteId: "123" }), { status: "uncertain", next: null }, "a simulated publisher never yields a real publication");
  assert.deepEqual(s({ result: "auth", errorCode: null }), { status: "blocked", next: null });
  assert.deepEqual(s({ result: "invalid_payload", errorCode: "x" }), { status: "failed", next: null });
  assert.deepEqual(s({ result: "rate_limit", errorCode: null, retryAfterSeconds: 7200 }), { status: "retryable_error", next: 7200 });
  assert.deepEqual(json(runner.completedStatus({ result: "provider_unavailable", errorCode: null }, 5)), { status: "failed", next: null }, "max attempts");
  assert.deepEqual(s({ result: "uncertain", errorCode: null }), { status: "uncertain", next: null });
});

test("déterminisme et option IA réelle : générateur injecté seulement sur demande, jamais de légende transmise", async () => {
  assert.deepEqual(json(await run("catalane-rotation")), json(await run("catalane-rotation")));
  const scenario = fixtures.getPipelineScenario("codev-nominal"), seen = [];
  const inner = adapters.mockGenerator(scenario);
  const generator = { async generate(input) { seen.push(input); return inner.generate(input); } };
  const real = await run("codev-nominal", { generator, aiMode: "real" });
  assert.equal(real.aiMode, "real");
  assert.equal(seen.length, 1);
  assert.deepEqual(json(seen[0].media.map(m => m.id)), ["sim-photo-codev-1"], "only candidate photos reach the generator");
  assert.doesNotMatch(JSON.stringify(seen[0]), /caption|tableau de bord client/, "never a sender caption");
  assert.equal((await run("codev-nominal", { aiMode: "real" })).aiMode, "mock", "no generator injected: always the mock");
  const vision = adapters.mockVision(scenario);
  await run("codev-nominal", { vision });
  assert.deepEqual(json(vision.calls), json(scenario.photos.map(p => p.id)));
});

test("formulaire : clés fermées, scénario et résultats obligatoires", () => {
  const ids = scenarios.map(s => s.id);
  const ok = { scenario: "jrenov-mixed", outcome_facebook: "success", outcome_instagram: "refused", outcome_google_business_profile: "down" };
  assert.deepEqual(json(model.parseSimulationForm(form(ok), ids)), { scenarioId: "jrenov-mixed", outcomes: { facebook: "success", instagram: "refused", google_business_profile: "down" }, realAI: false });
  assert.equal(model.parseSimulationForm(form({ ...ok, real_ai: "on" }), ids).realAI, true);
  assert.equal(model.parseSimulationForm(form({ ...ok, scenario: "inconnu" }), ids), null);
  assert.equal(model.parseSimulationForm(form({ ...ok, outcome_instagram: "published" }), ids), null);
  const { outcome_facebook, ...missing } = ok; void outcome_facebook;
  assert.equal(model.parseSimulationForm(form(missing), ids), null);
});

test("action : administrateur d'abord, modèle simulé par défaut, IA réelle seulement avec option et clé serveur", async () => {
  const code = src("app/(cockpit)/settings/simulation/actions.ts");
  assert.match(code, /^"use server";/);
  assert.match(code, /Promise<SimulationRunState>\{\n await requireAdmin\(\);/, "admin first");
  assert.doesNotMatch(code, /supabase|\.rpc\(|\.from\(|delivery\/|registry/);
  const build = (env, calls) => load("app/(cockpit)/settings/simulation/actions.ts", {
    "@/lib/require-admin": { requireAdmin: async () => { calls.push("admin"); if (env.DENY) throw Error("NEXT_NOT_FOUND"); return { userId: "user_admin" }; } },
    "@/lib/publications/agent-v2/openai-generator": { openaiAgentV2Generator: () => { calls.push("real-ai"); return adapters.mockGenerator(fixtures.getPipelineScenario("codev-nominal")); } },
  }, { process: { env } });
  const fields = { scenario: "codev-nominal", outcome_facebook: "success", outcome_instagram: "success", outcome_google_business_profile: "success" };
  let calls = [];
  let state = await build({}, calls).runPublicationSimulationAction({}, form(fields));
  assert.equal(state.report.aiMode, "mock"); assert.deepEqual(calls, ["admin"]);
  calls = [];
  state = await build({}, calls).runPublicationSimulationAction({}, form({ ...fields, real_ai: "on" }));
  assert.match(state.error, /aucune clé serveur/); assert.deepEqual(calls, ["admin"]);
  calls = [];
  state = await build({ OPENAI_API_KEY: "test-key" }, calls).runPublicationSimulationAction({}, form({ ...fields, real_ai: "on" }));
  assert.equal(state.report.aiMode, "real"); assert.deepEqual(calls, ["admin", "real-ai"]);
  assert.doesNotMatch(JSON.stringify(state), /test-key/);
  calls = [];
  await assert.rejects(build({ DENY: "1" }, calls).runPublicationSimulationAction({}, form(fields)));
  assert.deepEqual(calls, ["admin"], "nothing runs for a non-admin");
  state = await build({}, []).runPublicationSimulationAction({}, form({ ...fields, outcome_facebook: "x" }));
  assert.match(state.error, /invalide/);
});

test("page et interface : admin, rapport lisible, jetons de design uniquement, aucune action serveur importée par le composant", async () => {
  const page = src("app/(cockpit)/settings/simulation/page.tsx");
  assert.ok(page.indexOf("await requireAdmin()") < page.indexOf("process.env.OPENAI_API_KEY"), "admin before anything");
  assert.match(page, /realAIAvailable = Boolean\(process\.env\.OPENAI_API_KEY\)/, "only a boolean reaches the client");
  assert.match(page, /<PublicationPipelineLab scenarios=\{pipelineScenarioSummaries\(\)\} run=\{runPublicationSimulationAction\}/);
  const ui = src("components/simulation/publication-pipeline-lab.tsx");
  assert.doesNotMatch(ui, /#[0-9a-fA-F]{3,8}\b|\b(bg|text|border)-(red|green|blue|amber|yellow|slate|gray|zinc|neutral|emerald|rose)-\d/, "design tokens only");
  assert.doesNotMatch(ui, /@\/app\/|runner|adapters|fixtures|process\.env/);
  const lab = load("components/simulation/publication-pipeline-lab.tsx");
  const report = await run("catalane-rotation");
  const html = renderToStaticMarkup(jsx.jsx(lab.PipelineReport, { report }));
  for (const text of ["Données fictives", "Rédaction : modèle simulé", "Photos analysées", "Faîtage en tuiles canal", "Historique pris en compte", "Refusée", "Acceptée",
    "Réparation de faîtage avant les pluies", "Google Business Profile", "Diffusion simulée", "Connexion inactive", "Validation humaine", "Garanties de la simulation"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /simulated-catalane|simulation:\/\//, "no simulated remote id or internal URL displayed");
  const negative = renderToStaticMarkup(jsx.jsx(lab.PipelineReport, { report: await run("nuisibles-facture") }));
  assert.match(negative, /Le modèle disait « Pertinent » : les règles de sûreté ont primé/);
  assert.match(negative, /Aucune diffusion : la publication n’est pas approuvée/);
  const form = renderToStaticMarkup(jsx.jsx(lab.PublicationPipelineLab, { scenarios, run: async () => ({}), realAIAvailable: false }));
  assert.match(form, /Cas négatif/); assert.match(form, /Fictif/); assert.match(form, /Lancer la simulation/);
  assert.equal((form.match(/<select/g) ?? []).length, 3);
  assert.match(form, /Indisponible : aucune clé IA serveur/);
  assert.match(form, /<input type="checkbox" disabled=""[^>]*name="real_ai"/);
});
