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
  // Chef de projet : contrôle quotidien (étape) + à la demande ; « opérationnel » seulement si le passage est enregistré.
  assert.equal(health.agentHealth(director, base).state, "attention");
  assert.equal(health.agentHealth(director, { ...base, steps: { harness_control: { status: "ok" } } }).state, "ok");
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

test("chef de projet : réglages propres au client affichés par agent, jamais inventés", () => {
  const plan = loadTs("lib/harness/client-plan.ts", { "./charter": charter });
  const C = "22222222-2222-4222-8222-222222222222";
  const facts = {
    clientId: C, website: "https://exemple.fr",
    services: [{ key: "social", lifecycle: "active" }, { key: "seo", lifecycle: "active" }],
    assignedTypes: new Set(["seo"]), activeTypes: new Set(["report", "seo"]),
    automations: [{ run_type: "seo.analyze", client_id: C, status: "active" }, { run_type: "report.generate", client_id: null, status: "active" }],
    publication: { configured: true, autoApprove: true, pendingReview: 0, scheduledNext7Days: 4, failedDeliveries: 0, generationEnabled: true, publishingEnabled: true, slotsPerWeek: 2 },
    blog: { enabled: true, perWeek: 1, socialRelay: true, scheduledNext7Days: 1, publishedLast7Days: 0 },
    visual: { enabled: false, perWeek: 3 }, video: { enabled: true, perWeek: 2, pace: "calm" }, mediaLibrary: { classification: true, monthlyBudgetEur: 2 },
    schedules: [{ runType: "seo.analyze", label: "Analyse SEO quotidienne : tous les jours à 07:30" }],
  };
  const result = plan.buildClientPlan(facts);
  const settings = (id) => result.seats.find((seat) => seat.agent === id).settings;
  assert.deepEqual([...settings("publications")], ["2 créneau(x) par semaine", "Préparation automatique active", "Diffusion activée", "Validation automatique"]);
  assert.deepEqual([...settings("blog")], ["1 article(s) par semaine", "Relais sur les réseaux"]);
  assert.deepEqual([...settings("visual")], [], "agent désactivé : aucun réglage présenté");
  assert.deepEqual([...settings("video")], ["2 vidéo(s) par semaine", "rythme posé"]);
  assert.deepEqual([...settings("seo")], ["Analyse SEO quotidienne : tous les jours à 07:30"]);
  assert.deepEqual([...settings("prospection")], []);
});

test("semaine du client : échéances réelles groupées par jour de Paris, rien hors fenêtre", () => {
  const week = loadTs("lib/harness/week-plan.ts", { "./charter": charter });
  const now = new Date("2026-11-11T20:00:00Z"); // mercredi 21 h à Paris
  const result = week.buildWeekPlan({ now, events: [
    { at: "2026-11-12T09:00:00Z", agent: "publications", text: "Publication Facebook" },
    { at: "2026-11-12T09:00:00Z", agent: "publications", text: "Publication Facebook" },
    { at: "2026-11-12T06:30:00Z", agent: "seo", text: "Analyse SEO quotidienne" },
    { at: "2026-11-11T23:30:00Z", agent: "seo", text: "Analyse de nuit" }, // jeudi 00:30 à Paris
    { at: "2026-11-20T09:00:00Z", agent: "blog", text: "Hors fenêtre" },
    { at: "invalide", agent: "blog", text: "Date invalide" },
  ], cadence: [{ agent: "visual", text: "3 visuel(s)" }] });
  assert.equal(result.days.length, 7);
  assert.equal(result.days[0].date, "2026-11-11");
  assert.equal(result.days[0].items.length, 0);
  const thursday = result.days[1];
  assert.equal(thursday.date, "2026-11-12");
  assert.deepEqual(JSON.parse(JSON.stringify(thursday.items.map((item) => [item.time, item.text, item.count]))), [["00:30", "Analyse de nuit", 1], ["07:30", "Analyse SEO quotidienne", 1], ["10:00", "Publication Facebook", 2]]);
  assert.equal(result.total, 4);
  assert.equal(result.cadence[0].name, "Agent Visuels");
});

test("contrôle quotidien : chaque écart nommé, empreinte stable par client, une fois par jour dès 7 h", () => {
  const plan = loadTs("lib/harness/client-plan.ts", { "./charter": charter });
  const control = loadTs("lib/harness/control.ts");
  const C = "33333333-3333-4333-8333-333333333333";
  const facts = {
    clientId: C, website: null,
    services: [{ key: "social", lifecycle: "active" }, { key: "maintenance", lifecycle: "active" }],
    assignedTypes: new Set(), activeTypes: new Set(["report", "monitoring"]),
    automations: [{ run_type: "report.generate", client_id: null, status: "active" }],
    publication: { configured: true, autoApprove: true, pendingReview: 0, scheduledNext7Days: 0, failedDeliveries: 0, publishingEnabled: true },
    blog: { enabled: true, scheduledNext7Days: 0, publishedLast7Days: 0 }, visual: null, video: null, mediaLibrary: null,
  };
  const findings = control.controlFindings(facts, plan.buildClientPlan(facts));
  const codes = [...findings.map((item) => item.code)].sort();
  assert.deepEqual(codes, ["blog:idle", "publications:empty-week", "setup:monitoring"]);
  assert.equal(findings.find((item) => item.code === "publications:empty-week").severity, "high");
  assert.equal(control.controlFingerprint(C, "blog:idle"), `harness:${C}:blog:idle`);
  assert.ok(control.controlFingerprint(C, "blog:idle").startsWith(control.controlPrefix(C)));
  // Diffusion désactivée par réglage : semaine vide normale, aucune alerte.
  const off = { ...facts, publication: { ...facts.publication, publishingEnabled: false } };
  assert.ok(!control.controlFindings(off, plan.buildClientPlan(off)).some((item) => item.code === "publications:empty-week"));
  // Planification : jamais avant 7 h (Paris), une seule fois par jour.
  assert.equal(control.controlDue(new Date("2026-11-12T05:30:00Z"), null), false, "06:30 à Paris");
  assert.equal(control.controlDue(new Date("2026-11-12T06:05:00Z"), null), true, "07:05 à Paris");
  assert.equal(control.controlDue(new Date("2026-11-12T10:00:00Z"), "2026-11-12T06:05:00Z"), false, "déjà fait aujourd'hui");
  assert.equal(control.controlDue(new Date("2026-11-13T06:05:00Z"), "2026-11-12T06:05:00Z"), true, "nouveau jour");
});

test("le contrôle quotidien est branché dans le passage du planificateur et rattaché au chef de projet", () => {
  const route = readFileSync("app/api/internal/scheduler/tick/route.ts", "utf8");
  assert.match(route, /step\("harness_control", \(\) => runHarnessControl\(new Date\(\)\)/);
  const director = charter.getCharter("director");
  assert.ok(director.triggers.some((t) => t.kind === "step" && t.step === "harness_control"));
  const service = readFileSync("lib/harness/control-service.ts", "utf8");
  assert.doesNotMatch(service, /enabled:\s*true|status:\s*"active"/, "le contrôle ne réactive jamais rien");
});
