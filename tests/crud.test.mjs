import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const clientId = "d94e386a-653e-478b-80f1-05d442baed92";
const projectId = "2e3bf5a8-040e-4d12-91be-6a2da2f99ef0";
const taskId = "dcdd86a2-66c2-4714-bc20-7e50c48288de";
const clientServiceId = "af3190c8-6841-454f-b46a-cf33d14f30c2";

function load(path, mocks = {}, logs = []) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    URL,
    console: { error: (...args) => logs.push(args.join(" ")) },
    require: (name) => {
      if (name === "server-only") return {};
      if (name in mocks) return mocks[name];
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return exports;
}

function loadConfirmationComponent() {
  const source = readFileSync(new URL("../components/ui/confirm-delete-form.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  let confirmed = false;
  vm.runInNewContext(code, {
    exports,
    window: { confirm: () => confirmed },
    require: (name) => {
      if (name === "react") return { useActionState: () => [{}, () => {}, false] };
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return { ConfirmDeleteForm: exports.ConfirmDeleteForm, setConfirmed: (value) => { confirmed = value; } };
}

function form(fields) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, String(value));
  return data;
}

const validClient = {
  name: "Client avant",
  company_name: "Entreprise",
  activity: "Conseil",
  email: "client@example.test",
  phone: "0102030405",
  website: "https://example.test",
  geographic_area: "Paris",
  notes: "Notes client",
  id: clientId,
};
const validProject = {
  client_id: clientId,
  name: "Projet modifié",
  type: "SEO",
  status: "En cours",
  priority: "Haute",
  due_date: "2026-11-01",
  progress: "55",
  responsible: "Adrien",
  id: projectId,
};
const validTask = {
  client_id: clientId,
  project_id: projectId,
  title: "Tâche modifiée",
  status: "En cours",
  priority: "Moyenne",
  due_date: "2026-11-03",
  assignee_type: "admin",
  id: taskId,
};

function setup({ deny = false, foreignProject = false, failDelete = null, clients } = {}) {
  const calls = [];
  const audits = [];
  const logs = [];
  const rows = {
    clients: [{ id: clientId, name: "Client avant", company_name: "Entreprise", activity: "Conseil", email: "client@example.test", phone: "0102030405", website: "https://example.test", geographic_area: "Paris", notes: "Notes client", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" }],
    projects: [{ id: projectId, client_id: foreignProject ? "8d02d712-0564-4c70-b6bd-82a81f10e984" : clientId, name: "Projet avant", type: "SEO", status: "À démarrer", priority: "Moyenne", due_date: null, progress: 10, responsible: null, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", client: { name: "Client avant" } }],
    tasks: [{ id: taskId, client_id: clientId, project_id: projectId, title: "Tâche avant", status: "À faire", priority: "Basse", due_date: null, assignee_type: "admin", assignee_id: null, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", client: { name: "Client avant" }, project: { name: "Projet avant" } }],
    client_services: [],
    agents: [],
  };
  if (clients) rows.clients = clients;
  const guard = async () => { calls.push("auth"); if (deny) throw new Error("access-denied"); return { userId: "clerk-admin-id" }; };
  const copy = (row) => row === null ? null : JSON.parse(JSON.stringify(row));

  function queryFor(table) {
    const filters = [];
    let operation = "select";
    let payload;
    const query = {
      select: () => query,
      eq: (column, value) => { filters.push([column, value]); return query; },
      order: () => query,
      insert: (values) => { operation = "insert"; payload = values; return query; },
      update: (values) => { operation = "update"; payload = values; return query; },
      delete: () => { operation = "delete"; return query; },
      maybeSingle: async () => runSingle(),
      single: async () => runSingle(),
      then: (resolve, reject) => Promise.resolve(runMany()).then(resolve, reject),
    };
    function matchingIndex() {
      return rows[table].findIndex((row) => filters.every(([column, value]) => row[column] === value));
    }
    function runSingle() {
      if (operation === "insert") {
        const row = { id: clientServiceId, created_at: "2026-10-03T10:00:00Z", ...payload };
        rows[table].push(row);
        return { data: copy(row), error: null };
      }
      const index = matchingIndex();
      if (operation === "delete" && failDelete === table) return { data: null, error: { message: "private foreign key detail" } };
      if (index < 0) return { data: null, error: null };
      const row = rows[table][index];
      if (operation === "update") Object.assign(row, payload);
      if (operation === "delete") rows[table].splice(index, 1);
      return { data: copy(operation === "delete" ? { id: row.id } : row), error: null };
    }
    function runMany() {
      return { data: rows[table].filter((row) => filters.every(([column, value]) => row[column] === value)).map(copy), error: null };
    }
    return query;
  }

  const supabase = { from: (table) => { calls.push(["from", table]); return queryFor(table); } };
  const audit = { writeAuditLog: async (entry) => audits.push(copy(entry)) };
  const commonMocks = { "@/lib/require-admin": { requireAdmin: guard }, "@/lib/supabase/server": { getSupabaseServerClient: () => supabase }, "@/lib/audit-logs": audit, "@/lib/supabase/pagination":load("lib/supabase/pagination.ts") };
  const clientRepository = load("lib/clients/data.ts", { ...commonMocks, "./validation": load("lib/clients/validation.ts"), "next/navigation": { notFound: () => { throw new Error("not-found"); } } }, logs);
  const projectRepository = load("lib/projects/data.ts", { ...commonMocks, "./validation": load("lib/projects/validation.ts") }, logs);
  const taskRepository = load("lib/tasks/data.ts", { ...commonMocks, "./validation": load("lib/tasks/validation.ts") }, logs);
  const clientServiceRepository = load("lib/client-services/data.ts", { ...commonMocks, "./validation": load("lib/client-services/validation.ts") }, logs);
  return { clientRepository, projectRepository, taskRepository, clientServiceRepository, calls, audits, logs, rows };
}

test("updates a client with validated fields and before/after audit snapshots", async () => {
  const { clientRepository, audits } = setup();
  const result = await clientRepository.updateClientRecord(form({ ...validClient, name: "  Client après  " }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.client.name, "Client après");
  assert.equal(audits[0].action, "client.updated");
  assert.equal(audits[0].actor_id, "clerk-admin-id");
  assert.equal(audits[0].before_data.name, "Client avant");
  assert.equal(audits[0].after_data.name, "Client après");
});

test("deletes a client and writes a deletion audit without mutating audit history", async () => {
  const { clientRepository, audits, rows } = setup();
  const result = await clientRepository.deleteClient(clientId);
  assert.equal(result.ok, true);
  assert.equal(rows.clients.length, 0);
  assert.equal(audits[0].action, "client.deleted");
  assert.equal(audits[0].before_data.name, "Client avant");
  assert.equal(audits[0].after_data, null);
});

test("updates a project after checking client relation and writes its audit", async () => {
  const { projectRepository, audits } = setup();
  const result = await projectRepository.updateProject(form(validProject));
  assert.equal(result.ok, true);
  assert.equal(audits[0].action, "project.updated");
  assert.equal(audits[0].before_data.name, "Projet avant");
  assert.equal(audits[0].after_data.name, "Projet modifié");
  const invalid = setup({ clients: [] });
  const rejected = await invalid.projectRepository.updateProject(form(validProject));
  assert.equal(rejected.ok, false);
  assert.equal(invalid.audits.length, 0);
});

test("deletes a project and writes a deletion audit", async () => {
  const { projectRepository, audits, rows } = setup();
  const result = await projectRepository.deleteProject(projectId);
  assert.equal(result.ok, true);
  assert.equal(rows.projects.length, 0);
  assert.equal(audits[0].action, "project.deleted");
});

test("updates a task only when its client and project relationship is valid", async () => {
  const { taskRepository, audits } = setup();
  const result = await taskRepository.updateTask(form(validTask));
  assert.equal(result.ok, true);
  assert.equal(audits[0].action, "task.updated");
  assert.equal(audits[0].before_data.title, "Tâche avant");
  assert.equal(audits[0].after_data.title, "Tâche modifiée");
  const invalid = setup({ foreignProject: true });
  const rejected = await invalid.taskRepository.updateTask(form(validTask));
  assert.equal(rejected.ok, false);
  assert.equal(invalid.audits.length, 0);
});

test("deletes a task and writes a deletion audit", async () => {
  const { taskRepository, audits, rows } = setup();
  const result = await taskRepository.deleteTask(taskId);
  assert.equal(result.ok, true);
  assert.equal(rows.tasks.length, 0);
  assert.equal(audits[0].action, "task.deleted");
});

test("FK delete errors are generic and never emit a deletion audit", async () => {
  const { clientRepository, audits, logs } = setup({ failDelete: "clients" });
  const result = await clientRepository.deleteClient(clientId);
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.message, /foreign key/i);
  assert.equal(audits.length, 0);
  assert.ok(logs.every((entry) => !entry.includes("foreign key")));
});

test("client services support create, update and confirmed removal with audits", async () => {
  const createdSetup = setup();
  const created = await createdSetup.clientServiceRepository.createClientService(form({ client_id: clientId, service_type: "  SEO  ", status: "  Actif  ", monthly_fee_eur: "120.50", notes: "  Suivi mensuel  " }));
  assert.equal(created.ok, true);
  assert.equal(created.service.service_type, "SEO");
  assert.equal(created.service.monthly_fee_eur, 120.5);
  assert.equal(createdSetup.audits[0].action, "client_service.created");

  const updatedSetup = setup();
  updatedSetup.rows.client_services.push({ id: clientServiceId, client_id: clientId, service_type: "SEO", status: "Actif", monthly_fee_eur: 120.5, notes: "Anciennes notes", created_at: "2026-09-01T00:00:00Z" });
  const updated = await updatedSetup.clientServiceRepository.updateClientService(form({ id: clientServiceId, client_id: clientId, service_type: "SEO local", status: "Actif", monthly_fee_eur: "150", notes: "Notes mises à jour" }));
  assert.equal(updated.ok, true);
  assert.equal(updated.service.service_type, "SEO local");
  assert.equal(updatedSetup.audits[0].action, "client_service.updated");
  const removed = await updatedSetup.clientServiceRepository.deleteClientService(clientServiceId, clientId);
  assert.equal(removed.ok, true);
  assert.equal(updatedSetup.rows.client_services.length, 0);
  assert.equal(updatedSetup.audits[1].action, "client_service.deleted");
});

test("client services reject negative prices and non-admin access", async () => {
  const invalid = setup();
  const result = await invalid.clientServiceRepository.createClientService(form({ client_id: clientId, service_type: "SEO", status: "Actif", monthly_fee_eur: "-1" }));
  assert.equal(result.ok, false);
  assert.equal(invalid.rows.client_services.length, 0);
  const denied = setup({ deny: true });
  await assert.rejects(() => denied.clientServiceRepository.createClientService(form({ client_id: clientId, service_type: "SEO", status: "Actif" })), /access-denied/);
  assert.equal(denied.calls.some((call) => Array.isArray(call) && call[0] === "from"), false);
});

test("client history audit query reads only summary columns", async () => {
  const calls = [];
  const guard = async () => { calls.push("auth"); };
  const query = {
    select: (columns) => { calls.push(["select", columns]); return query; },
    eq: (column, value) => { calls.push(["eq", column, value]); return query; },
    order: () => query,
    limit: () => query,
    then: (resolve) => resolve({ data: [{ id: "audit-1", action: "client.updated", actor_type: "admin", created_at: "2026-10-03T10:00:00Z" }], error: null }),
  };
  const audit = load("lib/audit-logs.ts", { "@/lib/require-admin": { requireAdmin: guard }, "@/lib/supabase/server": { getSupabaseServerClient: () => ({ from: (table) => { calls.push(["from", table]); return query; } }) } });
  const entries = await audit.listAuditLogsByResource("client", clientId, 10);
  assert.equal(entries.length, 1);
  assert.deepEqual(calls[1], ["from", "audit_logs"]);
  assert.deepEqual(calls[2], ["select", "id,action,actor_type,created_at"]);
  assert.equal("before_data" in entries[0], false);
  assert.equal("after_data" in entries[0], false);
});

test("non-admin cannot update or delete any CRUD resource", async () => {
  const { clientRepository, projectRepository, taskRepository, calls } = setup({ deny: true });
  await assert.rejects(() => clientRepository.updateClientRecord(form(validClient)), /access-denied/);
  await assert.rejects(() => clientRepository.deleteClient(clientId), /access-denied/);
  await assert.rejects(() => projectRepository.updateProject(form(validProject)), /access-denied/);
  await assert.rejects(() => projectRepository.deleteProject(projectId), /access-denied/);
  await assert.rejects(() => taskRepository.updateTask(form(validTask)), /access-denied/);
  await assert.rejects(() => taskRepository.deleteTask(taskId), /access-denied/);
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === "from"), false);
});

test("delete confirmation prevents form submission when the user cancels", () => {
  const { ConfirmDeleteForm, setConfirmed } = loadConfirmationComponent();
  const formElement = ConfirmDeleteForm({ action: async () => ({}), fields: { id: clientId }, confirmationMessage: "Confirmation" });
  let prevented = false;
  formElement.props.onSubmit({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  setConfirmed(true);
  prevented = false;
  formElement.props.onSubmit({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
});
