import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(path, mocks = {}, logs = []) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, URL, console: { error: (...args) => logs.push(args.join(" ")) }, require: (name) => {
    if (name === "server-only") return {};
    if (name in mocks) return mocks[name];
    throw new Error(`Unexpected import: ${name}`);
  } });
  return exports;
}

const validation = load("lib/clients/validation.ts");
const id = "d94e386a-653e-478b-80f1-05d442baed92";
const validFields = { name: "  Exemple test  ", email: " test@example.test ", website: " https://example.test ", notes: " Notes " };
function form(fields = validFields) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

function setup({ deny = false, data = null, error = null, throwStorage = false, pages } = {}) {
  const calls = [];
  const logs = [];
  const guard = async () => { calls.push("auth"); if (deny) throw new Error("access-denied"); return { userId: "user_test_admin" }; };
  let pageIndex = 0;
  const query = {
    select: () => query, order: () => query, eq: () => query,
    range: (start, end) => { calls.push(`range:${start}-${end}`); return query; },
    insert: (input) => { calls.push({ insert: input }); return query; },
    maybeSingle: async () => ({ data, error }), single: async () => ({ data, error }),
    then: (resolve) => resolve({ data: pages ? pages[pageIndex++] : data, error }),
  };
  const navigation = { notFound: () => { throw new Error("not-found"); }, redirect: (path) => { throw new Error(`redirect:${path}`); } };
  const repository = load("lib/clients/data.ts", {
    "@/lib/require-admin": { requireAdmin: guard },
    "@/lib/audit-logs": { writeAuditLog: async (entry) => calls.push({ audit: entry }) },
    "@/lib/supabase/server": { getSupabaseServerClient: () => {
      calls.push("storage");
      if (throwStorage) throw new Error("private raw error");
      return { from: (table) => { assert.equal(table, "clients"); return query; } };
    } },
    "./validation": validation, "next/navigation": navigation,
  }, logs);
  const action = load("app/(cockpit)/clients/new/actions.ts", {
    "@/lib/require-admin": { requireAdmin: guard }, "@/lib/clients/data": repository,
    "@/lib/services/domain": { ensureGlobalAgents: async (_actor, ids) => { calls.push(`global-agents:${ids.length}`); } },
    "next/navigation": navigation, "next/cache": { revalidatePath: (path) => calls.push(`revalidate:${path}`) },
  }, logs);
  return { repository, action, calls, logs };
}

test("valid inputs are trimmed; optional empty values become null", () => {
  const result = validation.validateClientForm(form());
  assert.equal(result.ok, true);
  assert.equal(result.data.name, "Exemple test");
  assert.equal(result.data.email, "test@example.test");
  assert.equal(result.data.website, "https://example.test");
  assert.equal(result.data.company_name, null);
  assert.equal(result.data.notes, "Notes");
});

test("required name, email, website protocols, lengths, files and duplicate fields", () => {
  for (const [field, value] of [["name", "   "], ["email", "invalid"], ["website", "javascript:alert(1)"], ["website", "https://user:password@example.test"], ["website", "example.test"], ["phone", "x".repeat(51)], ["notes", "x".repeat(5001)], ["name", "bad\0name"]]) {
    const result = validation.validateClientForm(form({ ...validFields, [field]: value }));
    assert.equal(result.ok, false);
    assert.ok(result.errors[field]);
  }
  const duplicate = form(); duplicate.append("name", "Other");
  assert.equal(validation.validateClientForm(duplicate).ok, false);
  const binary = form(); binary.set("email", new Blob(["test"]));
  assert.equal(validation.validateClientForm(binary).ok, false);
});

test("non-admin cannot read or write, including direct Server Action invocation", async () => {
  const { repository, action, calls } = setup({ deny: true });
  for (const run of [() => repository.listClients(), () => repository.getClient(id), () => repository.getClientOrNotFound(id), () => repository.createClientRecord(form()), () => action.createClientAction({}, form())]) {
    await assert.rejects(run, /access-denied/);
  }
  assert.equal(calls.includes("storage"), false);
});

test("unknown or malformed client ID triggers not-found, not a storage error", async () => {
  const { repository, calls } = setup();
  await assert.rejects(() => repository.getClientOrNotFound(id), /not-found/);
  assert.deepEqual(calls, ["auth", "storage"]);
  calls.length = 0;
  await assert.rejects(() => repository.getClientOrNotFound("invalid"), /not-found/);
  assert.deepEqual(calls, ["auth"]);
});

test("invalid creation does not access storage", async () => {
  const { action, calls } = setup();
  const state = await action.createClientAction({}, form({ name: "" }));
  assert.ok(state.errors.name);
  assert.equal(state.values.name, "");
  assert.equal(calls.includes("storage"), false);
});

test("valid creation inserts only allowed fields then redirects to the returned UUID", async () => {
  const { action, calls } = setup({ data: { id } });
  const input = form(); input.append("id", "attacker-input"); input.append("created_at", "invalid");
  await assert.rejects(() => action.createClientAction({}, input), new RegExp(`redirect:/clients/${id}`));
  assert.deepEqual(calls.slice(0, 3), ["auth", "auth", "storage"]);
  const insert = calls.find((call) => typeof call === "object").insert;
  assert.equal(insert.name, "Exemple test");
  assert.equal(insert.email, "test@example.test");
  assert.equal("id" in insert, false);
  assert.equal("created_at" in insert, false);
  assert.ok(calls.includes("revalidate:/clients"));
});

test("SQL/network failures produce only generic messages and sanitized logs", async () => {
  const { repository, action, logs } = setup({ error: { message: "private SQL and personal data" } });
  await assert.rejects(repository.listClients, /stockage clients est indisponible/);
  const state = await action.createClientAction({}, form());
  assert.match(state.message, /Vérifiez la liste/);
  assert.ok(logs.every((entry) => entry.startsWith("[clients] Échec du stockage")));
  assert.ok(logs.every((entry) => !entry.includes("SQL") && !entry.includes("example.test")));
  const unavailable = setup({ throwStorage: true });
  assert.match((await unavailable.action.createClientAction({}, form())).message, /Impossible/);
});

test("empty client table stays empty without a mock fallback", async () => {
  assert.equal((await setup({ data: [] }).repository.listClients()).length, 0);
});

test("client list fetches subsequent batches rather than silently truncating", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `test-${index}` }));
  const { repository, calls } = setup({ pages: [firstPage, [{ id: "last" }]] });
  const clients = await repository.listClients();
  assert.equal(clients.length, 101);
  assert.equal(clients[100].id, "last");
  assert.deepEqual(calls.slice(-2), ["range:0-99", "range:100-199"]);
});
