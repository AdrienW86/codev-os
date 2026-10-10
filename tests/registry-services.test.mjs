import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";
import { loadRegistry, loadTs } from "./helpers/load-ts.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));
const { services, registry } = loadRegistry();
const permissions = loadTs("lib/permissions/engine.ts", { "@/lib/agents/registry": registry });
const providers = loadTs("lib/system/providers.ts");

const CLIENT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const agentRows = () => [
  { id: "a-report", name: "Agent Rapport", agent_type: "report", enabled: true, status: "Actif" },
  { id: "a-seo", name: "Agent SEO & Site", agent_type: "seo", enabled: false, status: "En pause" },
  { id: "a-monitoring", name: "Agent Monitoring Technique", agent_type: "monitoring", enabled: true, status: "Actif" },
  { id: "a-ads", name: "Agent Google Ads", agent_type: "google-ads", enabled: true, status: "Actif" },
  { id: "a-pub", name: "Agent Publications", agent_type: "publications", enabled: true, status: "Actif" },
];

function domain(initial = {}, options = {}) {
  const fake = createFakeSupabase({ clients: [{ id: CLIENT, name: "Jrenov" }, { id: OTHER, name: "Autre" }], agents: agentRows(), client_services: [], agent_client_assignments: [], automations: [], audit_logs: [], ...initial }, {
    unique: { client_services: [["client_id", "service_key"], ["client_id", "service_type"]], agent_client_assignments: [["agent_id", "client_id"]] }, ...options,
  });
  const audit = loadTs("lib/core/audit.ts", { "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client }, "@/lib/core/actor": loadTs("lib/core/actor.ts") });
  const domainModule = loadTs("lib/services/domain.ts", {
    "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client }, "@/lib/core/audit": audit,
    "@/lib/agents/registry": registry, "@/lib/services/catalog": services,
  });
  return { ...domainModule, fake };
}
const admin = { kind: "admin", userId: "user_admin" };

test("registry: every service maps to existing agents, every run type to a capable agent", () => {
  for (const service of services.serviceCatalog) for (const type of registry.agentTypesForService(service.id)) assert.ok(registry.isAgentType(type), `${service.id} → ${type}`);
  assert.deepEqual(plain(registry.agentTypesForService("seo")), ["seo"]);
  assert.deepEqual(plain(registry.agentTypesForService("maintenance")), ["monitoring"]);
  assert.deepEqual(plain(registry.agentTypesForService("reporting")), [], "the report agent is global, never service-bound");
  assert.deepEqual(plain(registry.globalClientAgentTypes()), ["report"]);
  for (const run of Object.values(registry.runTypes)) assert.ok(registry.agentDefinitions[run.agent].capabilities.includes(run.capability), run.id);
  for (const definition of Object.values(registry.agentDefinitions)) {
    assert.ok(definition.defaultAutonomy <= 1, `${definition.type} autonomy ≤ 1 in V1`);
    for (const capability of definition.capabilities) assert.ok(registry.capabilities[capability], capability);
  }
  for (const capability of Object.values(registry.capabilities)) if (capability.externalEffect) assert.equal(capability.permission, "execute", capability.id);
  assert.equal(registry.isRunType("rm -rf"), false);
});

test("permissions: knows / allowed / autonomy are separate decisions", () => {
  const seo = { type: "seo", enabled: true, status: "Actif", autonomy: 1 };
  assert.equal(permissions.authorize({ agent: seo, capability: "analyze_search_console" }).mode, "automatic");
  assert.equal(permissions.authorize({ agent: seo, capability: "propose_site_change" }).mode, "automatic", "preparing is automatic");
  assert.equal(permissions.authorize({ agent: seo, capability: "modify_site" }).mode, "approval_required");
  assert.equal(permissions.authorize({ agent: { ...seo, autonomy: 3 }, capability: "modify_site" }).mode, "approval_required", "external effects always need approval");
  assert.equal(permissions.authorize({ agent: seo, capability: "modify_campaign" }).reason, "not_capable");
  assert.equal(permissions.authorize({ agent: seo, capability: "drop_database" }).reason, "unknown_capability");
  assert.equal(permissions.authorize({ agent: { ...seo, enabled: false }, capability: "analyze_search_console" }).reason, "agent_disabled");
  assert.equal(permissions.authorize({ agent: seo, capability: "propose_site_change", simulation: true }).reason, "simulation");
  assert.equal(permissions.authorize({ agent: seo, capability: "analyze_search_console", simulation: true }).mode, "automatic", "reads stay allowed in simulation");
  const missing = permissions.authorize({ agent: seo, capability: "analyze_search_console", isProviderConfigured: () => false });
  assert.equal(missing.reason, "provider_not_configured");
  assert.deepEqual(plain(missing.missingProviders), ["search-console"]);
  assert.equal(permissions.effectiveAutonomy(3), 1);
  assert.equal(permissions.effectiveAutonomy(Number.NaN), 0);
});

test("providers: presence only, never values; optional keys do not block", () => {
  const env = { OPENAI_API_KEY: "sk-test", CRON_SECRET: " " };
  const statuses = providers.allProviderStatuses(env);
  const openai = statuses.find((item) => item.id === "openai");
  assert.equal(openai.state, "configured");
  assert.doesNotMatch(JSON.stringify(statuses), /sk-test/);
  assert.equal(statuses.find((item) => item.id === "scheduler").state, "missing", "blank value is missing");
  assert.equal(providers.isProviderConfigured("pagespeed", {}), true, "PageSpeed works without key");
  assert.equal(providers.isProviderConfigured("google-ads", { GOOGLE_ADS_CLIENT_ID: "x" }), false);
  assert.equal(providers.isProviderConfigured("speech", env), true);
});

test("activating a service attaches its agents, the global report agent, and is idempotent", async () => {
  const { activateService, fake } = domain();
  const result = await activateService(admin, CLIENT, "seo");
  assert.equal(result.ok, true);
  assert.equal(result.lifecycle, "to_configure", "the SEO agent is paused → service to configure");
  const row = fake.tables.client_services.find((item) => item.service_key === "seo");
  assert.equal(row.lifecycle, "to_configure");
  const assignments = fake.tables.agent_client_assignments;
  assert.ok(assignments.some((item) => item.agent_id === "a-seo" && item.source === "service" && item.service_key === "seo" && item.enabled));
  assert.ok(assignments.some((item) => item.agent_id === "a-report" && item.source === "global"), "report agent auto-attached");
  assert.ok(fake.tables.audit_logs.some((entry) => entry.action === "service.activated"));
  const again = await activateService(admin, CLIENT, "seo");
  assert.equal(again.ok, true);
  assert.equal(fake.tables.client_services.length, 1, "no duplicate service");
  assert.equal(fake.tables.agent_client_assignments.length, 2, "no duplicate assignment");
  assert.equal((await activateService(admin, CLIENT, "google-ads")).lifecycle, "active", "ready agent → active service");
});

test("legacy free-text service rows are adopted; manual assignments keep their source", async () => {
  const { activateService, fake } = domain({
    client_services: [{ id: "legacy", client_id: CLIENT, service_type: "Google Ads", status: "Actif", service_key: null, lifecycle: "active" }],
    agent_client_assignments: [{ agent_id: "a-ads", client_id: CLIENT, enabled: false, source: "manual", service_key: null }],
  });
  await activateService(admin, CLIENT, "google-ads");
  assert.equal(fake.tables.client_services.length, 1);
  assert.equal(fake.tables.client_services[0].service_key, "google-ads");
  const manual = fake.tables.agent_client_assignments.find((item) => item.agent_id === "a-ads");
  assert.equal(manual.source, "manual");
  assert.equal(manual.enabled, true);
});

test("deactivating keeps history, disables service agents, pauses automations, spares shared agents", async () => {
  const { activateService, deactivateService, fake } = domain({ automations: [{ id: "auto-1", client_id: CLIENT, agent_id: "a-monitoring", status: "active" }, { id: "auto-2", client_id: OTHER, agent_id: "a-monitoring", status: "active" }] });
  await activateService(admin, CLIENT, "maintenance");
  await activateService(admin, CLIENT, "website");
  const first = await deactivateService(admin, CLIENT, "maintenance");
  assert.equal(first.ok, true);
  assert.deepEqual(plain(first.agents), [], "website still needs the monitoring agent");
  assert.ok(fake.tables.agent_client_assignments.find((item) => item.agent_id === "a-monitoring").enabled);
  const second = await deactivateService(admin, CLIENT, "website");
  assert.deepEqual(plain(second.agents.map((agent) => agent.type)), ["monitoring"]);
  assert.equal(fake.tables.agent_client_assignments.find((item) => item.agent_id === "a-monitoring").enabled, false);
  assert.equal(fake.tables.automations.find((item) => item.id === "auto-1").status, "paused");
  assert.equal(fake.tables.automations.find((item) => item.id === "auto-2").status, "active", "other clients untouched");
  assert.equal(fake.tables.client_services.length, 2, "rows kept (ended), never deleted");
  assert.ok(fake.tables.client_services.every((item) => item.lifecycle === "ended"));
  assert.ok(fake.tables.agent_client_assignments.some((item) => item.agent_id === "a-report" && item.enabled), "report agent stays attached");
  assert.equal((await deactivateService(admin, CLIENT, "website")).ok, false, "already ended");
});

test("invalid input, unknown client, included service and missing registry fail cleanly", async () => {
  const { activateService, deactivateService, fake } = domain();
  assert.equal((await activateService(admin, "not-a-uuid", "seo")).ok, false);
  assert.equal((await activateService(admin, CLIENT, "crypto-mining")).ok, false);
  assert.equal((await activateService(admin, "33333333-3333-4333-8333-333333333333", "seo")).ok, false);
  assert.equal((await deactivateService(admin, CLIENT, "reporting")).ok, false);
  const included = await activateService(admin, CLIENT, "reporting");
  assert.equal(included.ok, true);
  assert.equal(fake.tables.client_services.length, 0, "reporting is never stored as a subscription");
  const broken = domain({}, { failOn: (table, op) => table === "agents" && op === "select" });
  await assert.rejects(() => broken.activateService(admin, CLIENT, "seo"), /migration 20261015000000/);
  const failing = domain({}, { failOn: (table, op) => table === "audit_logs" && op === "insert" });
  await assert.rejects(() => failing.activateService(admin, CLIENT, "seo"), /Journalisation indisponible/);
});

test("ensureGlobalAgents attaches the report agent to every client exactly once", async () => {
  const { ensureGlobalAgents, fake } = domain();
  assert.equal((await ensureGlobalAgents(admin)).created, 2);
  assert.equal((await ensureGlobalAgents(admin)).created, 0);
  assert.equal(fake.tables.agent_client_assignments.filter((item) => item.agent_id === "a-report").length, 2);
});

test("audit redaction never stores secrets", () => {
  const audit = loadTs("lib/core/audit.ts", { "@/lib/supabase/server": { getSupabaseServerClient: () => null }, "@/lib/core/actor": loadTs("lib/core/actor.ts") });
  const redacted = plain(audit.redact({ apiKey: "sk-1", nested: { access_token: "t", ok: 1 }, list: [{ password: "p" }] }));
  assert.deepEqual(redacted, { apiKey: "[redacted]", nested: { access_token: "[redacted]", ok: 1 }, list: [{ password: "[redacted]" }] });
});
