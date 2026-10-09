import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(path, mocks = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, Intl, Date, require: (name) => { if (name in mocks) return mocks[name]; throw new Error(`Unexpected import: ${name}`); } });
  return exports;
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const fixtures = load("lib/simulation/fixtures.ts");
const scenarios = load("lib/simulation/scenarios.ts", { "@/lib/simulation/fixtures": fixtures });
const labels = load("lib/simulation/labels.ts");
const cookie = load("lib/simulation/cookie.ts");
const today = "2026-10-09";

const pendingCount = (world) => world.work.filter((item) => ["to-review", "to-approve", "open"].includes(item.status)).length
  + world.publications.filter((item) => item.status === "to-review" || item.status === "partial").length
  + world.reports.filter((item) => item.status === "ready").length;

test("scenario catalogue: unique ids, every requested situation, focus on an existing route", () => {
  const ids = scenarios.scenarios.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ["calm", "busy", "new-client", "seo-only", "ads-seo", "social", "all-services", "to-configure", "agent-disconnected", "agent-error", "actions-pending",
    "publications-review", "publication-partial", "report-ready", "report-pending", "tasks-overdue", "site-down", "ads-anomaly", "seo-progress", "nothing"]) assert.ok(ids.includes(id), id);
  for (const scenario of scenarios.scenarios) {
    const path = scenario.focus.split("?")[0];
    const world = scenarios.buildScenarioWorld(scenario.id, today);
    if (path.startsWith("/clients/")) assert.ok(world.clients.some((client) => `/clients/${client.id}` === path), `${scenario.id} → ${path}`);
    else assert.ok(existsSync(new URL(`../app/(cockpit)${path}/page.tsx`, import.meta.url)), `${scenario.id} → ${path}`);
  }
  assert.equal(scenarios.getScenario("inconnu"), null);
});

test("worlds are deterministic, independent copies, and every reference points to an existing entity", () => {
  assert.deepEqual(plain(scenarios.buildScenarioWorld("busy", today)), plain(scenarios.buildScenarioWorld("busy", today)));
  const a = scenarios.buildScenarioWorld("normal", today);
  a.clients[0].name = "Modifié";
  assert.notEqual(scenarios.buildScenarioWorld("normal", today).clients[0].name, "Modifié");
  for (const scenario of scenarios.scenarios) {
    const world = scenarios.buildScenarioWorld(scenario.id, today);
    const clients = new Set(world.clients.map((client) => client.id));
    const projects = new Set(world.projects.map((project) => project.id));
    const work = new Set(world.work.map((item) => item.id));
    for (const item of [...world.projects, ...world.work, ...world.publications, ...world.campaigns, ...world.sites]) assert.ok(clients.has(item.clientId), `${scenario.id}: ${item.id ?? item.clientId}`);
    for (const item of [...world.work, ...world.publications]) if (item.projectId) assert.ok(projects.has(item.projectId), `${scenario.id}: ${item.id}`);
    for (const item of world.work) if (item.sourceId) assert.ok(work.has(item.sourceId), `${scenario.id}: ${item.id}`);
    for (const item of [...world.clients, ...world.projects, ...world.work, ...world.publications, ...world.reports]) assert.match(item.id, /^sim-/, "simulated ids are always prefixed");
  }
});

test("calm / busy / nothing drive the « À traiter » block as expected", () => {
  const busy = scenarios.buildScenarioWorld("busy", today);
  const calm = scenarios.buildScenarioWorld("calm", today);
  const nothing = scenarios.buildScenarioWorld("nothing", today);
  assert.ok(pendingCount(busy) > pendingCount(calm));
  assert.ok(busy.work.some((item) => item.kind === "incident" && item.status === "open"));
  assert.equal(pendingCount(nothing), 0);
  assert.equal(scenarios.buildScenarioWorld("site-down", today).sites.find((site) => site.clientId === "sim-garage").status, "down");
  assert.equal(scenarios.buildScenarioWorld("agent-disconnected", today).agents["google-ads"].status, "disconnected");
  assert.equal(scenarios.buildScenarioWorld("publication-partial", today).publications.find((item) => item.id === "sim-pub-3").status, "partial");
  assert.deepEqual(plain(scenarios.buildScenarioWorld("seo-only", today).clients.map((client) => client.id)), ["sim-toitures"]);
});

test("simulated labels are business wording, never raw states", () => {
  for (const table of [labels.workStatusLabels, labels.agentStatusLabels, labels.publicationStatusLabels, labels.reportStatusLabels, labels.connectionStatusLabels]) {
    for (const value of Object.values(table)) assert.doesNotMatch(value.label, /_|pending|approval|run\b|job|payload/i);
  }
  assert.equal(labels.workSection({ status: "to-approve" }), "review");
  assert.equal(labels.workSection({ status: "todo" }), "todo");
  assert.equal(labels.workSection({ status: "executed" }), "done");
  assert.equal(labels.formatSimDateTime("pas une date"), "—");
});

test("simulation preference cookie carries only the scenario id", () => {
  assert.equal(cookie.simulationCookieValue("busy"), "codev-simulation=busy; Path=/; SameSite=Lax");
  assert.match(cookie.simulationCookieValue(null), /Max-Age=0/);
});

test("simulation code never writes data nor calls an external service", () => {
  const files = [
    ...readdirSync(new URL("../lib/simulation/", import.meta.url)).map((file) => `lib/simulation/${file}`),
    ...readdirSync(new URL("../components/simulation/", import.meta.url), { recursive: true }).filter((file) => file.endsWith(".tsx")).map((file) => `components/simulation/${file}`),
  ];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /supabase|fetch\(|@\/app\/|useActionState|openai|nodemailer|process\.env/i, file);
  }
});

test("pages switch to the simulated view after the admin guard and before any real read", () => {
  for (const [route, view] of [["dashboard", "SimDashboard"], ["clients", "SimClients"], ["work", "SimWork"], ["agenda", "SimAgenda"], ["reports", "SimReports"], ["agents", "SimAgents"]]) {
    const source = read(`app/(cockpit)/${route}/page.tsx`);
    const guard = source.indexOf("await requireAdmin()");
    const branch = source.indexOf(`return <${view}`);
    assert.ok(guard > -1 && branch > guard, route);
    const body = source.slice(source.indexOf("export default"));
    const firstRead = body.search(/await (Promise\.all|list[A-Z])/);
    assert.ok(firstRead === -1 || body.indexOf(`return <${view}`) < firstRead, `${route}: no real read before the simulation branch`);
  }
  const client = read("app/(cockpit)/clients/[id]/page.tsx");
  assert.ok(client.indexOf("isSimulatedId(id)") < client.indexOf("getClientOrNotFound(id);\n  const search"), "simulated client ids never reach the database");
});
