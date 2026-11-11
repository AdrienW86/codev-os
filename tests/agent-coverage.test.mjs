import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const { computeAgentCoverage, fixableGaps } = loadTs("lib/agents/coverage.ts");
const { deliveryIdOf, resolvedDeliveryNotifications } = loadTs("lib/notifications/resolution.ts");

const agent = (id, agent_type, enabled = true, status = "Actif") => ({ id, name: `Agent ${agent_type}`, agent_type, enabled, status });
const c1 = "11111111-1111-4111-8111-111111111111", c2 = "22222222-2222-4222-8222-222222222222";

test("un agent actif sans automatisation est signalé et réparable", () => {
  const gaps = computeAgentCoverage({ agents: [agent("m", "monitoring")], automations: [], assignments: [] });
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].kind, "missing_automation");
  assert.equal(gaps[0].presetId, "site-checks");
  assert.equal(fixableGaps(gaps).length, 1);
});

test("une automatisation active couvre l'agent ; archivée ou terminée ne compte pas", () => {
  const agents = [agent("v", "veille")];
  assert.equal(computeAgentCoverage({ agents, automations: [{ run_type: "news.fetch", client_id: null, status: "active" }], assignments: [] }).length, 0);
  assert.equal(computeAgentCoverage({ agents, automations: [{ run_type: "news.fetch", client_id: null, status: "archived" }], assignments: [] })[0].kind, "missing_automation");
  assert.equal(computeAgentCoverage({ agents, automations: [{ run_type: "news.fetch", client_id: null, status: "paused" }], assignments: [] })[0].kind, "paused_automation");
});

test("agent client : un écart par client rattaché actif, jamais pour un rattachement désactivé", () => {
  const gaps = computeAgentCoverage({
    agents: [agent("s", "seo")],
    automations: [{ run_type: "seo.analyze", client_id: c1, status: "active" }],
    assignments: [{ agent_id: "s", client_id: c1, enabled: true }, { agent_id: "s", client_id: c2, enabled: true }, { agent_id: "s", client_id: "x", enabled: false }],
  });
  assert.deepEqual([...gaps.map((gap) => gap.clientId)], [c2]);
});

test("agent en pause : rien si rien n'est planifié, signalé si des exécutions sont prévues", () => {
  assert.equal(computeAgentCoverage({ agents: [agent("m", "monitoring", false, "En pause")], automations: [], assignments: [] }).length, 0);
  const gaps = computeAgentCoverage({ agents: [agent("m", "monitoring", false, "En pause")], automations: [{ run_type: "monitoring.check_sites", client_id: null, status: "active" }], assignments: [] });
  assert.equal(gaps[0].kind, "agent_paused");
  assert.equal(fixableGaps(gaps).length, 0, "réactiver un agent reste une décision humaine");
});

test("types sans exécution attendue (Publications, Google Ads en attente de #164) ignorés", () => {
  assert.equal(computeAgentCoverage({ agents: [agent("p", "publications"), agent("g", "google-ads"), agent("n", null)], automations: [], assignments: [] }).length, 0);
});

test("alerte de diffusion résolue quand la diffusion est publiée", () => {
  const d1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", d2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  assert.equal(deliveryIdOf(`publication-delivery:${d1}:uncertain`), d1);
  assert.equal(deliveryIdOf("publication-review:x"), null);
  assert.equal(deliveryIdOf(`publication-delivery:${d1}:published`), null);
  const resolved = resolvedDeliveryNotifications(
    [{ id: "n1", event_key: `publication-delivery:${d1}:uncertain` }, { id: "n2", event_key: `publication-delivery:${d2}:failed` }, { id: "n3", event_key: null }],
    [{ id: d1, status: "published" }, { id: d2, status: "failed" }],
  );
  assert.deepEqual([...resolved], ["n1"]);
});
