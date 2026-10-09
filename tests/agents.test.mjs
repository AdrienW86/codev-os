import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";

const agentId = "c7d93a42-4db1-4eb3-9b0a-3dcbeb4bd879";
const otherAgentId = "6db41fde-df0a-4a4c-b73a-2e43ca0ba759";
const clientId = "d94e386a-653e-478b-80f1-05d442baed92";
const createdId = "dcdd86a2-66c2-4714-bc20-7e50c48288de";

function load(path, mocks = {}, logs = []) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    console: { error: (...args) => logs.push(args.join(" ")) },
    require: (name) => {
      if (name === "server-only") return {};
      if (name in mocks) return mocks[name];
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return exports;
}

function form(fields) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, String(value));
  return data;
}

const validAgent = {
  name: "  SEO Agent  ",
  description: "  Suivi SEO  ",
  status: "Actif",
  enabled: "true",
  instructions: "  Instructions internes  ",
  model: "  modèle-x  ",
  schedule: "  Chaque jour  ",
  autonomy_level: "2",
  max_monthly_budget_eur: "50.50",
};

function setup({ deny = false, agents = [], clients = [{ id: clientId }], assignments = [], updateError = null, deleteError = null, auditError = false } = {}) {
  const calls = [];
  const logs = [];
  const audits = [];
  const inserts = [];
  const updates = [];
  const deletions = [];
  const rows = { agents, clients, agent_client_assignments: assignments };
  const guard = async () => { calls.push("auth"); if (deny) throw new Error("access-denied"); return { userId: "test-admin" }; };

  function matches(row, filters) {
    return filters.every(([operator, column, value]) => operator === "eq" ? row[column] === value : row[column] !== value);
  }

  function queryFor(table) {
    const filters = [];
    let inserted;
    let updated;
    let deleting = false;
    const query = {
      select: () => query,
      eq: (column, value) => { filters.push(["eq", column, value]); calls.push(["eq", table, column, value]); return query; },
      neq: (column, value) => { filters.push(["neq", column, value]); calls.push(["neq", table, column, value]); return query; },
      order: () => query,
      insert: (input) => { inserted = input; inserts.push([table, input]); return query; },
      update: (input) => { updated = input; updates.push([table, input]); return query; },
      delete: () => { deleting = true; return query; },
      maybeSingle: async () => {
        const row = (rows[table] ?? []).find((item) => matches(item, filters));
        if (updated && updateError) return { data: null, error: updateError };
        if (deleting && deleteError) return { data: null, error: deleteError };
        if (deleting && row) { rows[table].splice(rows[table].indexOf(row), 1); deletions.push([table, filters]); }
        if (row && updated) Object.assign(row, updated);
        return { data: row ? JSON.parse(JSON.stringify(row)) : null, error: null };
      },
      single: async () => ({ data: table === "agents" && inserted ? { id: createdId, ...inserted } : { id: createdId }, error: null }),
      then: (resolve, reject) => {
        if (inserted && table === "agent_client_assignments") rows[table].push({ ...inserted });
        if (deleting) {
          const rowIndex = rows[table].findIndex((item) => matches(item, filters));
          if (rowIndex >= 0) { rows[table].splice(rowIndex, 1); deletions.push([table, filters]); }
        }
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      },
    };
    return query;
  }

  const supabase = { from: (table) => { calls.push(["from", table]); return queryFor(table); } };
  const validation = load("lib/agents/validation.ts");
  const repository = load("lib/agents/data.ts", {
    "@/lib/require-admin": { requireAdmin: guard },
    "@/lib/supabase/server": { getSupabaseServerClient: () => supabase },
    "@/lib/audit-logs": { writeAuditLog: async (entry) => { if (auditError) throw new Error("private audit failure"); audits.push(entry); } },
    "./validation": validation,
  }, logs);
  return { repository, validation, calls, inserts, updates, deletions, rows, logs, audits };
}

test("creates an agent with trimmed configuration and redacted audit snapshot", async () => {
  const { repository, inserts, audits } = setup();
  const result = await repository.createAgent(form(validAgent));
  assert.equal(result.ok, true);
  assert.equal(result.id, createdId);
  const input = inserts.find(([table]) => table === "agents")[1];
  assert.equal(input.name, "SEO Agent");
  assert.equal(input.description, "Suivi SEO");
  assert.equal(input.instructions, "Instructions internes");
  assert.equal(input.autonomy_level, 2);
  assert.equal(input.max_monthly_budget_eur, 50.5);
  assert.equal(audits[0].action, "agent.created");
  assert.equal(audits[0].actor_id, "test-admin");
  assert.equal("instructions" in audits[0].after_data, false);
});

test("updates an agent and excludes global instructions from audit snapshots", async () => {
  const { repository, audits } = setup({ agents: [{ id: agentId, name: "SEO Agent", description: "Avant", status: "Actif", instructions: "Ne pas journaliser", model: "m", schedule: null, autonomy_level: 1, enabled: true, max_monthly_budget_eur: null, created_at: "2026-01-01", updated_at: "2026-01-01" }] });
  const result = await repository.updateAgent(form({ ...validAgent, id: agentId, description: "Après" }));
  assert.equal(result.ok, true);
  assert.equal(audits[0].action, "agent.updated");
  assert.equal(audits[0].before_data.autonomy_level, 1);
  assert.equal(audits[0].after_data.autonomy_level, 2);
  assert.equal("description" in audits[0].after_data, false);
  assert.equal("instructions" in audits[0].before_data, false);
});

test("rejects autonomy outside the 0 to 3 range and negative budgets", async () => {
  for (const [field, value] of [["autonomy_level", "-1"], ["autonomy_level", "4"], ["max_monthly_budget_eur", "-1"]]) {
    const { repository, calls } = setup();
    const result = await repository.createAgent(form({ ...validAgent, [field]: value }));
    assert.equal(result.ok, false);
    assert.ok(result.state.errors[field]);
    assert.equal(calls.some(([kind]) => kind === "from"), false);
  }
});

test("handles duplicate agent names without inserting or exposing database errors", async () => {
  const { repository, inserts } = setup({ agents: [{ id: agentId, name: "SEO Agent" }] });
  const result = await repository.createAgent(form(validAgent));
  assert.equal(result.ok, false);
  assert.match(result.state.errors.name, /déjà ce nom/);
  assert.equal(inserts.length, 0);
});

test("assigns an existing agent to an existing client and audits only the composite key", async () => {
  const { repository, inserts, audits } = setup({ agents: [{ id: agentId, name: "SEO Agent" }] });
  const result = await repository.assignAgentToClient(agentId, clientId, "  Brief client  ");
  assert.equal(result.ok, true);
  const input = inserts.find(([table]) => table === "agent_client_assignments")[1];
  assert.equal(input.agent_id, agentId);
  assert.equal(input.client_id, clientId);
  assert.equal(input.enabled, true);
  assert.equal(input.client_instructions, "Brief client");
  assert.equal(audits[0].action, "agent.assignment_created");
  assert.equal(audits[0].resource_id, null);
  assert.equal("client_instructions" in audits[0].after_data, false);
});

test("rejects assignments when the agent or client does not exist", async () => {
  const missingAgent = setup();
  assert.equal((await missingAgent.repository.assignAgentToClient(agentId, clientId)).ok, false);
  const missingClient = setup({ agents: [{ id: agentId, name: "SEO Agent" }], clients: [] });
  assert.equal((await missingClient.repository.assignAgentToClient(agentId, clientId)).ok, false);
  assert.equal(missingClient.inserts.length, 0);
});

test("handles duplicate agent-client assignments", async () => {
  const { repository, inserts } = setup({
    agents: [{ id: agentId, name: "SEO Agent" }],
    assignments: [{ agent_id: agentId, client_id: clientId, enabled: true, client_instructions: null }],
  });
  const result = await repository.assignAgentToClient(agentId, clientId);
  assert.equal(result.ok, false);
  assert.match(result.message, /déjà assigné/);
  assert.equal(inserts.length, 0);
});

test("updates client instructions and disables an existing assignment without auditing the text", async () => {
  const { repository, updates, rows, audits } = setup({
    assignments: [{ agent_id: agentId, client_id: clientId, enabled: true, client_instructions: null }],
  });
  const result = await repository.updateAgentClientAssignment(agentId, clientId, false, "  Contexte client  ");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(updates[0][0], "agent_client_assignments");
  assert.equal(updates[0][1].enabled, false);
  assert.equal(updates[0][1].client_instructions, "Contexte client");
  assert.equal(rows.agent_client_assignments[0].enabled, false);
  assert.equal(rows.agent_client_assignments[0].client_instructions, "Contexte client");
  assert.equal(audits[0].action, "agent.assignment_updated");
  assert.equal(audits[0].metadata.client_instructions_changed, true);
  assert.equal("client_instructions" in audits[0].before_data, false);
  assert.equal("client_instructions" in audits[0].after_data, false);
});

test("removing an assignment appends an audit entry and preserves no instruction text", async () => {
  const { repository, rows, audits } = setup({ assignments: [{ agent_id: agentId, client_id: clientId, enabled: true, client_instructions: "Privé" }] });
  const result = await repository.removeAgentFromClient(agentId, clientId);
  assert.equal(result.ok, true);
  assert.equal(rows.agent_client_assignments.length, 0);
  assert.equal(audits[0].action, "agent.assignment_removed");
  assert.equal(audits[0].after_data, null);
  assert.equal("client_instructions" in audits[0].before_data, false);
});

test("non-admin cannot access or mutate Agents and assignments", async () => {
  const { repository, calls } = setup({ deny: true });
  await assert.rejects(repository.listAgents, /access-denied/);
  await assert.rejects(() => repository.getAgentById(agentId), /access-denied/);
  await assert.rejects(() => repository.createAgent(form(validAgent)), /access-denied/);
  await assert.rejects(() => repository.updateAgent(form({ ...validAgent, id: agentId })), /access-denied/);
  await assert.rejects(() => repository.deleteAgent(form({ id: agentId, confirmed: "true" })), /access-denied/);
  await assert.rejects(() => repository.listAgentsForClient(clientId), /access-denied/);
  await assert.rejects(() => repository.listClientsForAgent(agentId), /access-denied/);
  await assert.rejects(() => repository.assignAgentToClient(agentId, clientId), /access-denied/);
  await assert.rejects(() => repository.updateAgentClientAssignment(agentId, clientId, false, ""), /access-denied/);
  await assert.rejects(() => repository.removeAgentFromClient(agentId, clientId), /access-denied/);
  assert.equal(calls.some(([kind]) => kind === "from"), false);
});

test("resolves an agent assignee to the real configured agent name", () => {
  const { getTaskAssigneeLabel } = load("lib/tasks/assignee-label.ts");
  assert.equal(getTaskAssigneeLabel("agent", agentId, [{ id: agentId, name: "SEO Agent" }]), "SEO Agent");
  assert.equal(getTaskAssigneeLabel("agent", otherAgentId, [{ id: agentId, name: "SEO Agent" }]), "Agent introuvable");
});

test("agent cards expose an obvious link to their detail page", () => {
  const wrapper = ({ children }) => createElement("div", null, children);
  const { AgentCard } = load("components/agents/agent-card.tsx", {
    "react/jsx-runtime": jsxRuntime,
    "next/link": { default: ({ children, ...props }) => createElement("a", props, children) },
    "@/components/ui/icon": { Icon: () => null },
    "@/components/ui/primitives": { Panel: wrapper, Badge: wrapper },
  });
  const html = renderToStaticMarkup(createElement(AgentCard, { agent: { id: agentId, ...validAgent, name: "SEO Agent", max_monthly_budget_eur: null } }));
  assert.match(html, new RegExp(`href="/agents/${agentId}"`));
  assert.match(html, /aria-label="Ouvrir SEO Agent"[^>]*>Ouvrir<\/a>/);
});

test("updates reject duplicate names, including a database uniqueness race", async () => {
  for (const options of [
    { agents: [{ id: agentId, name: "Ancien" }, { id: otherAgentId, name: "SEO Agent" }] },
    { agents: [{ id: agentId, name: "Ancien" }], updateError: { code: "23505", message: "private SQL" } },
  ]) {
    const context = setup(options);
    const result = await context.repository.updateAgent(form({ ...validAgent, id: agentId }));
    assert.equal(result.ok, false);
    assert.match(result.state.errors.name, /déjà ce nom/);
    assert.equal(context.audits.length, 0);
    assert.doesNotMatch(JSON.stringify(result), /private SQL/);
  }
});

test("updates refuse missing agents and invalid autonomy without writes", async () => {
  const missing = setup();
  assert.equal((await missing.repository.updateAgent(form({ ...validAgent, id: agentId }))).ok, false);
  assert.equal(missing.updates.length, 0);
  for (const value of ["-1", "4", "1.5"]) {
    const context = setup({ agents: [{ id: agentId }] });
    const result = await context.repository.updateAgent(form({ ...validAgent, id: agentId, autonomy_level: value }));
    assert.ok(result.state.errors.autonomy_level);
    assert.equal(context.updates.length, 0);
  }
});

test("confirmed deletion targets only the agent and audits a minimal snapshot", async () => {
  const context = setup({ agents: [{ id: agentId, ...validAgent, instructions: "private secret", description: "private secret" }] });
  const result = await context.repository.deleteAgent(form({ id: agentId, confirmed: "true" }));
  assert.equal(result.ok, true);
  assert.equal(context.rows.agents.length, 0);
  assert.equal(context.deletions.length, 1);
  assert.equal(context.deletions[0][0], "agents");
  assert.equal(context.calls[0], "auth");
  assert.equal(context.audits[0].action, "agent.deleted");
  assert.equal(context.audits[0].resource_id, agentId);
  assert.equal(context.audits[0].after_data, null);
  assert.doesNotMatch(JSON.stringify(context.audits), /private secret/);
});

test("deletion refuses missing confirmation, malformed identifiers and missing agents", async () => {
  for (const fields of [{ id: agentId }, { id: agentId, confirmed: "false" }, { id: "invalid", confirmed: "true" }]) {
    const context = setup();
    assert.equal((await context.repository.deleteAgent(form(fields))).ok, false);
    assert.equal(context.calls.length, 1);
  }
  const context = setup();
  assert.equal((await context.repository.deleteAgent(form({ id: agentId, confirmed: "true" }))).ok, false);
  assert.equal(context.audits.length, 0);
});

test("foreign key restrictions refuse deletion without leaking SQL or changing relations", async () => {
  const context = setup({ agents: [{ id: agentId }], deleteError: { code: "23503", message: "private SQL constraint" } });
  const result = await context.repository.deleteAgent(form({ id: agentId, confirmed: "true" }));
  assert.equal(result.ok, false);
  assert.match(result.state.message, /lié/);
  assert.doesNotMatch(JSON.stringify(result), /private SQL|23503/);
  assert.equal(context.rows.agents.length, 1);
  assert.equal(context.audits.length, 0);
  assert.equal(context.deletions.length, 0);
});

test("audit failure after deletion does not claim success or leak error details", async () => {
  const context = setup({ agents: [{ id: agentId }], auditError: true });
  const result = await context.repository.deleteAgent(form({ id: agentId, confirmed: "true" }));
  assert.equal(result.ok, false);
  assert.match(result.state.message, /vérifier/);
  assert.doesNotMatch(JSON.stringify([result, context.logs]), /private audit failure/);
});

test("successful update and deletion actions refresh affected routes and redirect", async () => {
  const refreshed = [];
  const { updateAgentAction, deleteAgentAction } = load("app/(cockpit)/agents/[id]/actions.ts", {
    "next/cache": { revalidatePath: (...args) => refreshed.push(args) },
    "next/navigation": { redirect: (url) => { throw new Error(`redirect:${url}`); } },
    "@/lib/require-admin": { requireAdmin: async () => ({}) },
    "@/lib/agents/data": { updateAgent: async () => ({ ok: true, id: agentId }), deleteAgent: async () => ({ ok: true, id: agentId }) },
    "@/lib/agent-runs/data": {},
  });
  await assert.rejects(() => updateAgentAction({}, form({})), new RegExp(`redirect:/agents/${agentId}\\?updated=1`));
  await assert.rejects(() => deleteAgentAction({}, form({})), /redirect:\/agents$/);
  assert.ok(refreshed.some(([path, type]) => path === "/clients" && type === "layout"));
});
