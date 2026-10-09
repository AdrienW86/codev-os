import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(path, mocks = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require: (name) => {
      if (name in mocks) return mocks[name];
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return exports;
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const services = load("lib/services/catalog.ts");
const agents = load("lib/agents/catalog.ts", { "@/lib/services/catalog": services });
const view = load("lib/services/client-view.ts", { "@/lib/services/catalog": services, "@/lib/agents/catalog": agents });

const agent = (overrides) => ({ id: "a1", name: "Agent", status: "Actif", enabled: true, autonomy_level: 1, scope_review_required: false, ...overrides });

test("service catalog covers the seven CODE-V services; reporting is included by default", () => {
  assert.deepEqual(plain(services.serviceCatalog.map((item) => item.id)), ["website", "seo", "google-ads", "social", "maintenance", "automation", "reporting"]);
  assert.equal(services.getService("reporting").includedByDefault, true);
  for (const service of services.serviceCatalog) for (const id of service.defaultAgents) assert.ok(agents.getAgentBlueprint(id), `${service.id} → ${id}`);
});

test("free-text service labels are matched to the catalog without false positives", () => {
  const cases = { "Google Ads": "google-ads", "SEO local": "seo", "Référencement": "seo", "Réseaux sociaux": "social", "Publications Instagram": "social", "Site vitrine": "website", "Maintenance": "maintenance", "Automatisation IA": "automation", "Reporting mensuel": "reporting" };
  for (const [label, id] of Object.entries(cases)) assert.equal(services.matchServiceType(label)?.id, id, label);
  assert.equal(services.matchServiceType("Conseil stratégique"), null);
  assert.equal(services.matchServiceType("Badges"), null, "« ads » must match a whole word");
  assert.equal(services.subscriptionStatusFromRecord("Actif"), "active");
  assert.equal(services.subscriptionStatusFromRecord("Résilié"), "not-subscribed");
  assert.equal(services.subscriptionStatusFromRecord("En préparation"), "to-configure");
});

test("an agent is never shown as active without a configured, enabled and assigned agent", () => {
  const ads = agents.getAgentBlueprint("google-ads");
  assert.equal(agents.blueprintState(ads, []), "to-connect");
  assert.equal(agents.blueprintState(agents.getAgentBlueprint("seo"), []), "coming-soon");
  assert.equal(agents.blueprintState(ads, [agent({ enabled: false })]), "disabled");
  assert.equal(agents.blueprintState(ads, [agent({ scope_review_required: true })]), "config-required");
  assert.equal(agents.blueprintState(ads, [agent()]), "active");
  assert.equal(agents.clientAgentState(ads, [agent()], new Set()), "config-required", "not assigned to this client");
  assert.equal(agents.clientAgentState(ads, [agent()], new Set(["a1"])), "active");
  assert.equal(agents.capabilityState({ label: "x", existsInApp: true }, "to-connect"), "planned");
  assert.equal(agents.capabilityState({ label: "x" }, "active"), "planned");
  assert.equal(agents.capabilityState({ label: "x", existsInApp: true }, "active"), "available");
});

test("configured agents are matched to the registry; unknown ones stay listed separately", () => {
  const { byBlueprint, unmatched } = agents.matchConfiguredAgents([
    agent({ id: "p", name: "Rédacteur", publication_specialist: true }), agent({ id: "g", name: "Agent Google Ads" }),
    agent({ id: "s", name: "SEO Agent" }), agent({ id: "x", name: "Assistant interne" }),
  ]);
  assert.deepEqual(plain(byBlueprint.get("publications").map((item) => item.id)), ["p"]);
  assert.deepEqual(plain(byBlueprint.get("google-ads").map((item) => item.id)), ["g"]);
  assert.deepEqual(plain(byBlueprint.get("seo").map((item) => item.id)), ["s"]);
  assert.deepEqual(plain(unmatched.map((item) => item.id)), ["x"]);
});

test("client view: recorded services drive status, reporting is always included, unknown labels are kept", () => {
  const { services: list, otherServices } = view.buildClientServicesView({
    services: [{ service_type: "SEO local", status: "Actif" }, { service_type: "Google Ads", status: "En préparation" }, { service_type: "Conseil", status: "Actif" }],
    agents: [agent({ id: "pub", name: "Agent Publications", publication_specialist: true })],
    assignedAgentIds: new Set(["pub"]),
  });
  const byId = Object.fromEntries(list.map((item) => [item.id, item]));
  assert.equal(byId.seo.status, "active");
  assert.equal(byId["google-ads"].status, "to-configure");
  assert.equal(byId.reporting.status, "included");
  assert.equal(byId.social.status, "not-subscribed");
  assert.equal(byId.seo.agents[0].state, "coming-soon");
  assert.ok(byId.seo.agents[0].capabilities.every((capability) => capability.state === "planned"));
  assert.equal(byId.social.agents[0].state, "active");
  assert.equal(byId.reporting.agents[0].includedForAllClients, true);
  assert.deepEqual(plain(otherServices), ["Conseil"]);
  assert.deepEqual(plain(list.slice(0, 3).map((item) => item.status)), ["active", "to-configure", "included"]);
});

test("UX-only pieces perform no writes and no network calls", () => {
  for (const path of ["components/clients/services-agents-section.tsx", "components/clients/add-service-dialog.tsx", "components/dashboard/tech-news.tsx"]) {
    const source = read(path);
    assert.doesNotMatch(source, /fetch\(|@\/app\/|createClientService|supabase|useActionState/i, path);
  }
  const home = read("app/(cockpit)/dashboard/page.tsx");
  assert.match(home, /\.filter\(\(card\) => card\.count > 0\)/);
  assert.match(home, /Rien à traiter pour le moment\./);
  assert.match(read("app/(cockpit)/agents/page.tsx"), /await requireAdmin\(\);/);
});
