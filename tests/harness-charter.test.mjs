import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { loadTs } from "./helpers/load-ts.mjs";

const charter = loadTs("lib/harness/charter.ts");

test("chaque agent a une charte complète, une équipe connue et des interdits", () => {
  const teams = new Set(charter.harnessTeams.map((team) => team.id));
  const ids = charter.harnessCharters.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, "identifiants uniques");
  for (const item of charter.harnessCharters) {
    assert.ok(teams.has(item.team), item.id);
    assert.ok(item.mission.length > 20 && item.expertise && item.clientSettings, item.id);
    assert.ok(item.does.length > 0 && item.never.length > 0, item.id);
    assert.ok(item.triggers.length > 0, item.id);
  }
});

test("le cadre de mission rappelle périmètre, interdits et règles communes (jamais inventer, jamais d'action non demandée)", () => {
  const text = charter.charterInstructions("blog");
  assert.match(text, /^CADRE DE MISSION — Agent Blog/);
  assert.match(text, /Interdits : /);
  for (const rule of charter.harnessRules) assert.ok(text.includes(rule));
  assert.match(text, /n’inventes jamais/);
  assert.match(text, /aucune action qui n’a pas été demandée/);
  assert.ok(charter.withCharter("video", "X").endsWith("\n\nX"));
  assert.throws(() => charter.getCharter("inconnu"));
});

test("les étapes du planificateur citées par les chartes existent", () => {
  const steps = readFileSync("lib/scheduler/heartbeat.ts", "utf8");
  for (const item of charter.harnessCharters) for (const trigger of item.triggers) if (trigger.kind === "step") assert.match(steps, new RegExp(`"${trigger.step}"`), `${item.id}:${trigger.step}`);
});

test("chaque appel IA d'un agent passe par son cadre de mission", () => {
  const calls = {
    "lib/blog-agent/service.ts": "withCharter('blog'", "lib/visual-agent/service.ts": "withCharter('visual'", "lib/video-agent/service.ts": "withCharter('video'",
    "lib/publications/agent-v2/openai-generator.ts": "withCharter('publications'", "lib/media-intelligence/service.ts": "withCharter('media-library'",
    "lib/integrations/google-ads/ai-analysis.ts": 'withCharter("google-ads"', "lib/seo/opportunity-assistant.ts": 'withCharter("seo"',
  };
  for (const [file, needle] of Object.entries(calls)) assert.ok(readFileSync(file, "utf8").includes(needle), file);
});

test("santé d'un agent : jamais opérationnel sans preuve d'exécution", () => {
  const health = loadTs("lib/harness/health.ts");
  const blog = charter.getCharter("blog"), monitoring = charter.getCharter("monitoring"), director = charter.getCharter("director");
  const base = { steps: null, lastJobs: {}, gapRunTypes: new Set(), agentEnabled: null };
  assert.equal(health.agentHealth(blog, base).state, "attention", "aucun passage enregistré");
  assert.equal(health.agentHealth(blog, { ...base, steps: { blog_agent: { status: "ok" } } }).state, "ok");
  assert.equal(health.agentHealth(blog, { ...base, steps: { blog_agent: { status: "failed" } } }).state, "failed");
  assert.equal(health.agentHealth(monitoring, { ...base, gapRunTypes: new Set(["monitoring.check_sites"]) }).state, "attention");
  assert.equal(health.agentHealth(monitoring, { ...base, lastJobs: { "monitoring.check_sites": { status: "succeeded", finishedAt: "2026-11-11T08:00:00Z" } } }).state, "ok");
  assert.equal(health.agentHealth(monitoring, { ...base, agentEnabled: false }).state, "off");
  assert.equal(health.agentHealth(director, base).state, "manual");
});

test("chef de projet : chaque agent attendu par service, et ce qui attend l'administrateur", () => {
  const plan = loadTs("lib/harness/client-plan.ts", { "./charter": charter });
  const C = "11111111-1111-4111-8111-111111111111";
  const facts = {
    clientId: C, website: null,
    services: [{ key: "social", lifecycle: "active" }, { key: "seo", lifecycle: "active" }, { key: "maintenance", lifecycle: "active" }, { key: "google-ads", lifecycle: "paused" }],
    assignedTypes: new Set(), activeTypes: new Set(["report", "veille", "publications", "monitoring"]),
    automations: [{ run_type: "report.generate", client_id: null, status: "active" }],
    publication: { configured: true, autoApprove: false, pendingReview: 3, scheduledNext7Days: 2, failedDeliveries: 1 },
    blog: { enabled: true }, visual: null, video: { enabled: false }, mediaLibrary: null,
  };
  const result = plan.buildClientPlan(facts);
  const state = (id) => result.seats.find((seat) => seat.agent === id).state;
  assert.equal(state("report"), "working");
  assert.equal(state("publications"), "working");
  assert.equal(state("blog"), "working");
  assert.equal(state("visual"), "off");
  assert.equal(state("seo"), "needs_setup", "SEO souscrit mais agent non rattaché");
  assert.equal(state("monitoring"), "needs_setup", "adresse du site absente");
  assert.equal(state("google-ads"), "not_subscribed", "service en pause = non souscrit");
  const todo = result.todo.map((item) => item.label);
  assert.ok(todo.includes("Valider 3 publication(s)"));
  assert.ok(todo.includes("Vérifier 1 diffusion(s) en échec ou bloquée(s)"));
  assert.ok(todo.includes("Activer l’Agent SEO"));
  assert.ok(todo.includes("Renseigner l’adresse du site"));
  // Validation automatique active : rien à valider à la main.
  const auto = plan.buildClientPlan({ ...facts, publication: { ...facts.publication, autoApprove: true } });
  assert.ok(!auto.todo.some((item) => item.label.startsWith("Valider")));
});
