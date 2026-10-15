// Real pure model/orchestrator/service, simulated storage/Clerk only. No external provider or DB.
import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTs } from "./helpers/load-ts.mjs";
import { publicationsModules } from "./helpers/assistant-publications.mjs";

const model = loadTs("lib/assistant/director-model.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));
const clientA = { id: "11111111-1111-4111-8111-111111111111", name: "Protection Nuisibles" };
const clientB = { id: "22222222-2222-4222-8222-222222222222", name: "Jrenov" };
const foreign = "33333333-3333-4333-8333-333333333333";
const id = (n) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const now = "2026-10-15T10:00:00.000Z", today = "2026-10-15";
const coverage = () => ["incidents", "tasks", "actions", "recommendations", "seo"].map((source) => ({ source, status: "available", loaded: 0, total: 0, truncated: false }));
function input(overrides = {}) {
  return { today, now, clients: [clientA, clientB], clientTotal: 2, scope: "Tous les clients", coverage: coverage(), incidents: [], tasks: [], actions: [], recommendations: [], seo: [], ...overrides };
}
const incident = (overrides = {}) => ({ id: id(1), client_id: clientA.id, title: "Site indisponible", severity: "critical", source: "monitoring", status: "open", updated_at: now, recommendation_id: null, ...overrides });
const recommendation = (overrides = {}) => ({ id: id(2), client_id: clientB.id, source: "ads", title: "Examiner les zones ciblées", severity: "high", reason: "Ciblage à examiner, cause non confirmée", status: "pending", created_at: now, ...overrides });
const snapshot = (overrides = {}) => ({ id: id(3), client_id: clientB.id, period_start: "2026-10-05", period_end: "2026-10-11", fetched_at: now, data: { clicks: 30, previous_clicks: 100 }, ...overrides });

test("director ranks multi-client evidence, distinguishes facts/hypotheses and never invents gains", () => {
  const result = model.buildDirectorBriefing(input({ incidents: [incident()], recommendations: [recommendation()], seo: [snapshot()] }));
  assert.equal(result.decisions[0].priority, "critical");
  assert.equal(result.decisions[0].clientId, clientA.id);
  const rec = result.decisions.find((item) => item.source === "recommendations");
  assert.equal(rec.hypothesis, recommendation().reason);
  assert.equal(rec.confidence.level, "limited");
  const seo = result.decisions.find((item) => item.source === "seo");
  assert.match(seo.fact, /30 contre 100.*70 %.*70 clics/);
  assert.match(seo.hypothesis, /cause.*n’est pas établie/);
  assert.match(seo.impact.statement, /gain récupérable non estimé/);
  assert.equal(seo.href, `/clients/${clientB.id}?tab=health`);
  assert.ok(result.decisions.every((item) => item.validation === "human_review" && item.evidence.length));
  assert.deepEqual(plain(result), plain(model.buildDirectorBriefing(input({ incidents: [incident()], recommendations: [recommendation()], seo: [snapshot()] }))));
});

test("director refuses foreign-client IDs, unsafe links and duplicate work", () => {
  const rec = recommendation({ client_id: clientA.id });
  const result = model.buildDirectorBriefing(input({ clients: [clientA], clientTotal: 1,
    incidents: [incident({ recommendation_id: rec.id }), incident({ id: "javascript:alert(1)", client_id: clientA.id }), incident({ id: id(4), client_id: foreign })],
    recommendations: [rec, recommendation({ id: id(5), client_id: clientB.id })], seo: [snapshot()],
  }));
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].href, `/recommendations/${rec.id}`);
  assert.doesNotMatch(JSON.stringify(result.decisions), /javascript|Jrenov/);
});

test("historical cross-client recommendation references cannot misattribute links or suppress another client's proposal", () => {
  const result = model.buildDirectorBriefing(input({ incidents: [incident({ recommendation_id: recommendation().id })], recommendations: [recommendation()] }));
  assert.equal(result.decisions.length, 2);
  assert.equal(result.decisions[0].href, `/clients/${clientA.id}?tab=health`);
  assert.equal(result.decisions[1].clientId, clientB.id);
});

test("director shows pending approval without approving, suppresses resolved records and completed tasks", () => {
  const rec = recommendation({ client_id: clientA.id });
  const action = { id: id(6), client_id: clientA.id, title: "Réparer le suivi", status: "pending_approval", created_at: now, recommendation_id: rec.id };
  const task = { id: id(7), client_id: clientA.id, title: "Relancer", priority: "Haute", status: "À faire", due_date: "2026-10-14", updated_at: now };
  const result = model.buildDirectorBriefing(input({
    incidents: [incident({ status: "resolved" })], recommendations: [rec],
    actions: [action, { ...action, id: id(8), status: "executed" }],
    tasks: [task, { ...task, id: id(9), status: "Terminé" }, { ...task, id: id(10), due_date: "2026-10-16" }, { ...task, id: id(11), due_date: "2026-02-30" }],
  }));
  assert.deepEqual(plain(result.decisions.map((item) => item.source)), ["tasks", "actions"]);
  assert.equal(result.decisions[1].validation, "existing_approval");
  assert.equal(result.decisions[1].href, "/work?view=review");
  assert.match(result.decisions[0].fact, /en retard.*Europe\/Paris/);
});

test("missing, failed and truncated sources never become a reassuring empty state", () => {
  const sources = coverage();
  sources[0] = { ...sources[0], status: "unavailable" };
  sources[3] = { ...sources[3], truncated: true, loaded: 200, total: 350 };
  const result = model.buildDirectorBriefing(input({ clientTotal: 170, coverage: sources, incidents: [incident()] }));
  assert.equal(result.decisions.length, 0, "an unavailable source is ignored even if a caller left stale rows");
  assert.match(result.limitations.join(" "), /incidents indisponible/);
  assert.match(result.limitations.join(" "), /200 éléments lus sur 350/);
  assert.match(result.limitations.join(" "), /2 sur 170/);
  assert.match(model.directorSummary(result), /Couverture incomplète/);
  assert.doesNotMatch(model.directorSummary(result), /Rien d’urgent|tout est stable/);
});

test("unknown exact source counts remain incomplete even when the returned rows are empty", () => {
  const sources = coverage();
  sources[0].total = null;
  const result = model.buildDirectorBriefing(input({ coverage: sources }));
  assert.match(result.limitations.join(" "), /source incidents invérifiable/);
  assert.match(model.directorSummary(result), /Couverture incomplète/);
});

test("SEO snapshots use the latest closed period per client, not the last-refetched old month", () => {
  const result = model.buildDirectorBriefing(input({ seo: [
    snapshot({ id: id(13), period_start: "2026-09-01", period_end: "2026-09-30", fetched_at: "2026-10-15T11:00:00Z", data: { clicks: 0, previous_clicks: 100 } }),
    snapshot(), snapshot({ id: id(14), period_start: "2026-10-16", period_end: "2026-10-20" }),
  ] }));
  assert.equal(result.decisions.filter((item) => item.source === "seo").length, 1);
  assert.equal(result.decisions[0].id, `seo:${id(3)}`);
  assert.match(result.decisions[0].evidence[0].statement, /2026-10-05 → 2026-10-11/);
  assert.match(result.limitations.join(" "), /ne prouve pas.*cette semaine/);
});

test("zero baselines, malformed numbers, missing comparisons and no change are not fabricated SEO drops", () => {
  for (const data of [{ clicks: 1 }, { clicks: 1, previous_clicks: 0 }, { clicks: -1, previous_clicks: 5 },
    { clicks: "2", previous_clicks: 5 }, { clicks: Infinity, previous_clicks: 5 }, { clicks: 5, previous_clicks: 5 }]) {
    const result = model.buildDirectorBriefing(input({ seo: [snapshot({ data })] }));
    assert.equal(result.decisions.length, 0, JSON.stringify(data));
    if (data.previous_clicks !== 5 || data.clicks !== 5) assert.match(result.limitations.join(" "), /Comparaison.*0 client/);
  }
});

test("stale evidence lowers confidence, preserves its dates and never claims current-week causality", () => {
  const result = model.buildDirectorBriefing(input({ incidents: [incident({ updated_at: "2026-09-01T00:00:00Z" })],
    seo: [snapshot({ period_start: "2026-09-01", period_end: "2026-09-30" })] }));
  assert.ok(result.decisions.every((item) => item.confidence.level === "limited"));
  assert.match(result.decisions.find((item) => item.source === "seo").confidence.reason, /Période ancienne/);
  assert.equal(result.decisions[0].evidence[0].at, "2026-09-01T00:00:00Z");
});

test("focused diagnostics retain only corresponding incident/recommendation families", () => {
  const result = model.buildDirectorBriefing(input({ focus: "ads", incidents: [incident(), incident({ id: id(20), source: "ads" })],
    recommendations: [recommendation(), recommendation({ id: id(21), source: "seo" })], seo: [snapshot()] }));
  assert.deepEqual(plain(result.decisions.map((item) => item.id)).sort(), [`incident:${id(20)}`, `recommendation:${id(2)}`].sort());
});

test("large diagnosis bounds displayed proposals, preserves deterministic ties and short voice summary", () => {
  const recommendations = Array.from({ length: 30 }, (_, n) => recommendation({ id: id(n + 40) }));
  const result = model.buildDirectorBriefing(input({ recommendations }));
  assert.equal(result.decisions.length, 20);
  assert.equal(result.omitted, 10);
  assert.ok(model.directorSummary(result).length < 600);
  assert.doesNotMatch(model.directorSummary(result), /<table|Ciblage à examiner/);
});

function service({ rows = {}, fail = [], totals = {}, deny = false, simulation = false, resolved = { ok: true, ...clientA } } = {}) {
  const calls = [];
  const db = { from: (table) => {
    calls.push(["from", table]);
    const filters = [], q = {};
    for (const method of ["select", "order", "limit", "abortSignal", "in", "eq", "neq", "lte", "lt"]) q[method] = (...args) => {
      calls.push([table, method, ...args]); filters.push([method, ...args]); return q;
    };
    q.then = (resolve, reject) => {
      let data = rows[table] ?? (table === "clients" ? [clientA, clientB] : []);
      for (const [method, key, value] of filters) {
        if (method === "in") data = data.filter((item) => value.includes(item[key]));
        if (method === "eq") data = data.filter((item) => item[key] === value);
      }
      return Promise.resolve(fail.includes(table) ? { data: null, count: null, error: { message: "sb_secret_NEVER_OUTPUT", code: "42P01" } } : { data, count: totals[table] ?? data.length, error: null }).then(resolve, reject);
    };
    return q;
  } };
  const director = loadTs("lib/assistant/director.ts", {
    "@/lib/require-admin": { requireAdmin: async () => { calls.push(["requireAdmin"]); if (deny) throw new Error("unauthorized"); return { userId: "admin" }; } },
    "@/lib/simulation/server": { getActiveScenario: async () => simulation ? { id: "scenario" } : null },
    "@/lib/supabase/server": { getSupabaseServerClient: () => db },
    "@/lib/assistant/clients": { resolveClient: async () => resolved },
    "@/lib/actions/registry": { describeAction: () => "Action existante à examiner" },
    "@/lib/dashboard/home": { todayInParis: () => today },
    "@/lib/assistant/director-model": model,
  });
  return { run: director.directorBriefingTool, calls };
}

test("service authenticates before storage, refuses real reads in simulation and resolves named clients", async () => {
  const denied = service({ deny: true });
  await assert.rejects(() => denied.run({}), /unauthorized/);
  assert.equal(denied.calls.length, 1);
  const simulated = service({ simulation: true });
  assert.match((await simulated.run({})).text, /Simulation active/);
  assert.equal(simulated.calls.length, 1);
  const missing = service({ resolved: { ok: false, message: "Client ambigu" } });
  assert.equal((await missing.run({ client: "Protection" })).ok, false);
  assert.ok(!missing.calls.some(([action]) => action === "from"));
});

test("service scopes all queries, exposes partial coverage, clears stale context and leaks no action payload", async () => {
  const rec = recommendation();
  const configured = service({ rows: {
    incidents: [incident()], recommendations: [{ ...rec, agent: { agent_type: "google-ads" } }],
    actions: [{ id: id(90), client_id: clientA.id, status: "pending_approval", created_at: now, recommendation_id: null,
      action_type: "internal.test", parameters: { secret: "sb_secret_NEVER_OUTPUT" } }],
  }, fail: ["metric_snapshots"], totals: { recommendations: 340 } });
  const result = plain(await configured.run({}));
  assert.equal(result.view.type, "director_briefing");
  assert.deepEqual(result.context, {});
  assert.ok(result.view.briefing.coverage.find((source) => source.source === "recommendations").truncated);
  assert.equal(result.view.briefing.coverage.find((source) => source.source === "seo").status, "unavailable");
  assert.doesNotMatch(JSON.stringify(result), /sb_secret_|parameters|42P01/);
  for (const table of ["incidents", "tasks", "actions", "recommendations", "metric_snapshots"]) {
    assert.ok(configured.calls.some(([t, method, column, ids]) => t === table && method === "in" && column === "client_id" && ids.includes(clientA.id)));
    assert.ok(configured.calls.some(([t, method]) => t === table && method === "abortSignal"));
  }
  assert.ok(!configured.calls.some(([, method]) => /insert|update|rpc|delete/.test(method ?? "")));
});

test("service handles unavailable clients without claiming a healthy agency, and skips empty IN lists", async () => {
  const missing = await service({ fail: ["clients"] }).run({});
  assert.equal(missing.ok, false);
  assert.match(missing.text, /indisponible/);
  const empty = service({ rows: { clients: [] } });
  const result = await empty.run({});
  assert.equal(result.view.briefing.clientCount, 0);
  assert.deepEqual(empty.calls.filter(([method]) => method === "from"), [["from", "clients"]]);
});

test("service named-client diagnostic revalidates the client and never includes another client's evidence", async () => {
  const scoped = service({ rows: { incidents: [incident(), incident({ id: id(92), client_id: clientB.id })] } });
  const result = await scoped.run({ client: "Protection Nuisibles" });
  assert.equal(result.view.briefing.clientCount, 1);
  assert.equal(result.context.clientId, clientA.id);
  assert.equal(result.view.briefing.decisions.length, 1);
  assert.equal(result.view.briefing.decisions[0].clientId, clientA.id);
});

const text = loadTs("lib/assistant/text.ts");
const publications = publicationsModules(text);
const adsIntents = loadTs("lib/assistant/ads-intents.ts", { "@/lib/assistant/text": text });
const tools = loadTs("lib/assistant/tools.ts", { "@/lib/integrations/google-ads/periods": loadTs("lib/integrations/google-ads/periods.ts"), ...publications.mocks });
const intents = loadTs("lib/assistant/intents.ts", { "@/lib/assistant/text": text, "@/lib/assistant/ads-intents": adsIntents, ...publications.mocks });
const orchestrator = loadTs("lib/assistant/orchestrator.ts", { "@/lib/assistant/tools": tools, "@/lib/assistant/intents": intents, "@/lib/assistant/ads-intents": adsIntents, ...publications.mocks });

test("French executive requests use the registered read tool; preparation requests keep their confirmation flow", async () => {
  for (const [message, expected] of [
    ["Analyse tous mes clients et identifie les urgences", {}], ["Quelles actions dois-je prioriser aujourd’hui ?", {}],
    ["Quels clients ont perdu de la visibilité cette semaine ?", { focus: "seo" }],
    ["Quelles campagnes nécessitent une optimisation ?", { focus: "ads" }],
    ["Prépare un plan d’optimisation pour Couverture Catalane", { client: "Couverture Catalane" }],
    ["Explique-moi pourquoi les performances de Jrenov évoluent", { client: "Jrenov" }],
  ]) {
    const result = intents.parseIntent(message, today);
    assert.deepEqual(plain(result), { tool: "director_briefing", input: expected }, message);
  }
  assert.equal(tools.toolDefinitions.director_briefing.kind, "read");
  assert.equal(tools.parseToolInput("director_briefing", { approve: true }).ok, false);
  const calls = [];
  const deps = { today, provider: { id: "openai", complete: () => { throw new Error("LLM must not replace the registered diagnosis"); } },
    execute: async (name, params) => { calls.push([name, params]); return { ok: true, text: "Preuves dans le panneau", view: { type: "director_briefing", title: "Diagnostic", briefing: model.buildDirectorBriefing(input()) } }; } };
  const result = await orchestrator.respond([{ role: "user", content: "Analyse tous mes clients" }], deps);
  assert.equal(result.source, "rules");
  assert.equal(result.view.type, "director_briefing");
  assert.deepEqual(plain(calls), [["director_briefing", {}]]);
  assert.equal((await orchestrator.proposeFromView("director_briefing", {}, deps)).proposal, undefined);
  const task = await orchestrator.proposeFromView("create_task", { client: clientA.name, title: "Examiner le constat" }, deps);
  assert.equal(task.proposal.tool, "create_task");
  assert.equal(calls.length, 1, "the task is only proposed, not inserted");
});

test("director cards render facts, confidence and required review as escaped responsive markup", () => {
  const views = loadTs("lib/assistant/views.ts");
  const component = loadTs("components/assistant/director-briefing.tsx", {
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "@/lib/assistant/views": views,
  });
  const briefing = model.buildDirectorBriefing(input({ recommendations: [recommendation({ title: "<script>alert(1)</script>" })], seo: [snapshot()] }));
  const markup = renderToStaticMarkup(React.createElement(component.DirectorBriefing, { briefing, propose: async () => { throw new Error("render must not propose"); } }));
  assert.match(markup, /Fait enregistré/);
  assert.match(markup, /Hypothèse ou justification à confirmer/);
  assert.match(markup, /Confiance/);
  assert.match(markup, /Sources consultées/);
  assert.match(markup, /Preuves datées/);
  assert.match(markup, /Proposer une tâche/);
  assert.match(markup, /&lt;script&gt;/);
  assert.doesNotMatch(markup, /<script|<table|Approuver|Exécuter maintenant/);
});
