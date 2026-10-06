import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const clientId = "d94e386a-653e-478b-80f1-05d442baed92";
const otherClientId = "8d02d712-0564-4c70-b6bd-82a81f10e984";
const projectId = "2e3bf5a8-040e-4d12-91be-6a2da2f99ef0";
const createdId = "dcdd86a2-66c2-4714-bc20-7e50c48288de";

function load(path, mocks = {}, logs = []) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
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
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

const validProject = {
  client_id: clientId,
  name: "  Refonte du site  ",
  type: "Site web",
  status: "À démarrer",
  priority: "Haute",
  due_date: "2026-10-20",
  progress: "25",
  responsible: "  Adrien  ",
};

const validTask = {
  client_id: clientId,
  project_id: projectId,
  title: "  Préparer les contenus  ",
  status: "À faire",
  priority: "Moyenne",
  due_date: "2026-10-22",
  assignee_type: "admin",
};

const { formatDate } = load("lib/format-date.ts");

test('projects and tasks paginate complete lists rather than depending on the REST row cap',async()=>{
 const projects=Array.from({length:101},(_,i)=>({id:String(i),client_id:clientId})),tasks=Array.from({length:101},(_,i)=>({id:String(i),client_id:clientId,project_id:projectId}));
 const r=setup({projects,tasks});assert.equal((await r.projectRepository.listProjects()).length,101);assert.equal((await r.taskRepository.listTasksByProject(projectId)).length,101);
 assert.equal(r.calls.filter(c=>c[0]==='range'&&c[2]===100&&c[3]===199).length,2);
});
test('invalid client/project filters stop before storage',async()=>{const r=setup();assert.equal((await r.projectRepository.listProjectsByClient('bad')).length,0);assert.equal((await r.taskRepository.listTasksByClient('bad')).length,0);assert.equal((await r.taskRepository.listTasksByProject('bad')).length,0);assert.equal(r.calls.every(c=>c==='auth'),true);});

function setup({ deny = false, clients = [{ id: clientId }], projects = [], tasks = [] } = {}) {
  const calls = [];
  const logs = [];
  const rows = { clients, projects, tasks };
  const inserts = {};
  const guard = async () => { calls.push("auth"); if (deny) throw new Error("access-denied"); };

  function queryFor(table) {
    const filters = [];
    let start=0,end=Infinity;
    const query = {
      select: (columns) => { calls.push(["select", table, columns]); return query; },
      eq: (column, value) => { filters.push([column, value]); calls.push(["eq", table, column, value]); return query; },
      order: () => query,
      range: (from,to) => {start=from;end=to;calls.push(['range',table,from,to]);return query;},
      insert: (input) => { inserts[table] = input; calls.push(["insert", table, input]); return query; },
      maybeSingle: async () => ({ data: (rows[table] ?? []).find((row) => filters.every(([column, value]) => row[column] === value)) ?? null, error: null }),
      single: async () => ({ data: { id: createdId }, error: null }),
      then: (resolve, reject) => {
        const data = (rows[table] ?? []).filter((row) => filters.every(([column, value]) => row[column] === value)).slice(start,end+1);
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return query;
  }

  const supabase = { from: (table) => { calls.push(["from", table]); return queryFor(table); } };
  const projectValidation = load("lib/projects/validation.ts");
  const taskValidation = load("lib/tasks/validation.ts");
  const commonMocks = {
    "@/lib/supabase/pagination":load('lib/supabase/pagination.ts'),
    "@/lib/require-admin": { requireAdmin: guard },
    "@/lib/audit-logs": { writeAuditLog: async (entry) => calls.push({ audit: entry }) },
    "@/lib/supabase/server": { getSupabaseServerClient: () => supabase },
  };
  const projectRepository = load("lib/projects/data.ts", { ...commonMocks, "./validation": projectValidation }, logs);
  const taskRepository = load("lib/tasks/data.ts", { ...commonMocks, "./validation": taskValidation }, logs);
  return { projectRepository, taskRepository, calls, inserts, logs };
}

test("creates a valid project with trimmed text and validated client", async () => {
  const { projectRepository, inserts } = setup();
  const result = await projectRepository.createProject(form(validProject));
  assert.equal(result.ok, true);
  assert.equal(result.id, createdId);
  assert.equal(inserts.projects.name, "Refonte du site");
  assert.equal(inserts.projects.responsible, "Adrien");
  assert.equal(inserts.projects.progress, 25);
});

test("rejects a project whose client does not exist", async () => {
  const { projectRepository, inserts } = setup({ clients: [] });
  const result = await projectRepository.createProject(form(validProject));
  assert.equal(result.ok, false);
  assert.match(result.state.errors.client_id, /n’existe pas/);
  assert.equal(inserts.projects, undefined);
});

test("rejects project progress outside the integer range", async () => {
  const { projectRepository, calls } = setup();
  const result = await projectRepository.createProject(form({ ...validProject, progress: "101" }));
  assert.equal(result.ok, false);
  assert.match(result.state.errors.progress, /entier entre 0 et 100/);
  assert.equal(calls.some(([kind]) => kind === "from"), false);
});

test("creates a valid task with a client-owned project", async () => {
  const { taskRepository, inserts } = setup({ projects: [{ id: projectId, client_id: clientId }] });
  const result = await taskRepository.createTask(form(validTask));
  assert.equal(result.ok, true);
  assert.equal(inserts.tasks.title, "Préparer les contenus");
  assert.equal(inserts.tasks.assignee_type, "admin");
  assert.equal(inserts.tasks.assignee_id, null);
});

test("rejects a task linked to another client's project", async () => {
  const { taskRepository, inserts } = setup({ projects: [{ id: projectId, client_id: otherClientId }] });
  const result = await taskRepository.createTask(form(validTask));
  assert.equal(result.ok, false);
  assert.match(result.state.errors.project_id, /n’appartient pas/);
  assert.equal(inserts.tasks, undefined);
});

test("rejects task assignee types outside admin and none", async () => {
  const { taskRepository, calls } = setup();
  const result = await taskRepository.createTask(form({ ...validTask, assignee_type: "agent" }));
  assert.equal(result.ok, false);
  assert.match(result.state.errors.assignee_type, /assignation valide/);
  assert.equal(calls.some(([kind]) => kind === "from"), false);
});

test("non-admin cannot list or create projects and tasks", async () => {
  const { projectRepository, taskRepository, calls } = setup({ deny: true });
  await assert.rejects(projectRepository.listProjects, /access-denied/);
  await assert.rejects(() => projectRepository.createProject(form(validProject)), /access-denied/);
  await assert.rejects(taskRepository.listTasks, /access-denied/);
  await assert.rejects(() => taskRepository.createTask(form(validTask)), /access-denied/);
  assert.equal(calls.some(([kind]) => kind === "from"), false);
});

test("project and task lists filter by the requested client", async () => {
  const { projectRepository, taskRepository, calls } = setup({
    projects: [{ id: projectId, client_id: clientId }, { id: "other-project", client_id: otherClientId }],
    tasks: [{ id: "task-1", client_id: clientId }, { id: "task-2", client_id: otherClientId }],
  });
  const projects = await projectRepository.listProjectsByClient(clientId);
  const tasks = await taskRepository.listTasksByClient(clientId);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].id, projectId);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, "task-1");
  assert.ok(calls.some((call) => call[0] === "eq" && call[1] === "projects" && call[2] === "client_id" && call[3] === clientId));
  assert.ok(calls.some((call) => call[0] === "eq" && call[1] === "tasks" && call[2] === "client_id" && call[3] === clientId));
});

test("date formatting handles nullable, invalid, date-only and timestamp values in UTC", () => {
  assert.equal(formatDate(null), "—");
  assert.equal(formatDate(undefined), "—");
  assert.equal(formatDate("not-a-date"), "—");
  assert.equal(formatDate("2026-02-30"), "—");
  assert.equal(formatDate("2026-10-03"), "03 oct. 2026");
  assert.equal(formatDate("2026-10-03T23:30:00-02:00"), "04 oct. 2026");
});
