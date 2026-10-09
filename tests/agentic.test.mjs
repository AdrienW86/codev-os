import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const agentId = "c7d93a42-4db1-4eb3-9b0a-3dcbeb4bd879";
const clientId = "d94e386a-653e-478b-80f1-05d442baed92";
const recommendationId = "2e3bf5a8-040e-4d12-91be-6a2da2f99ef0";
const runId = "dcdd86a2-66c2-4714-bc20-7e50c48288de";
const actionId = "f7686766-bb9f-46c6-8d65-ced2e0f94999";

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

function setup({ deny = false, missingAgent = false, missingClient = false, failActionCompletion = false } = {}) {
  const calls = [];
  const audits = [];
  const logs = [];
  const rows = {
    agents: missingAgent ? [] : [{ id: agentId, name: "SEO Agent", enabled: true, status: "Actif",agent_scope:"client",scope_review_required:true }],
    clients: missingClient ? [] : [{ id: clientId, name: "Client test" }],
    agent_client_assignments: [{ agent_id: agentId, client_id: clientId, enabled: true }],
    projects: [],
    agent_project_assignments: [],
    recommendations: [{ id: recommendationId, agent_id: agentId, client_id: clientId, title: "Piste initiale", reason: "Raison", severity: "info", status: "pending", payload: { safe: true }, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" }],
    agent_runs: [],
    agent_messages: [],
    actions: [],
  };
  const guard = async () => { calls.push("auth"); if (deny) throw new Error("access-denied"); return { userId: "clerk-admin-id" }; };
  const clone = (row) => row === null ? null : JSON.parse(JSON.stringify(row));
  const rowId = { recommendations: "8eef9078-bdb4-49be-b5d8-70939e19d733", agent_runs: runId, agent_messages: "9e90507b-4083-44ac-8207-c0dd149f5fe5", actions: actionId };

  function joined(table, row) {
    if (!row) return null;
    if (table === "recommendations") return { ...row, agent: rows.agents.find((item) => item.id === row.agent_id) ?? null, client: rows.clients.find((item) => item.id === row.client_id) ?? null };
    if (table === "agent_runs" || table === "actions") return { ...row, agent: rows.agents.find((item) => item.id === row.agent_id) ?? null, client: rows.clients.find((item) => item.id === row.client_id) ?? null, recommendation: rows.recommendations.find((item) => item.id === row.recommendation_id) ?? null };
    return row;
  }

  function queryFor(table) {
    const filters = [];
    let operation = "select";
    let payload;
    const query = {
      select: () => query,
      eq: (column, value) => { filters.push([column, value]); return query; },
      order: () => query,
      limit: () => query,
      insert: (value) => { operation = "insert"; payload = value; return query; },
      update: (value) => { operation = "update"; payload = value; return query; },
      maybeSingle: async () => runSingle(),
      single: async () => runSingle(),
      then: (resolve, reject) => Promise.resolve(runMany()).then(resolve, reject),
    };
    function findIndex() { return rows[table].findIndex((row) => filters.every(([column, value]) => row[column] === value)); }
    function runSingle() {
      if (operation === "insert") {
        const row = { id: rowId[table], ...payload };
        if (table === "agent_runs") Object.assign(row, { started_at: payload.started_at, completed_at: null, summary: null, input_tokens: null, output_tokens: null, estimated_cost_eur: null });
        if (table === "actions") Object.assign(row, { approved_at: null, executed_at: null, result: null, error_message: null });
        if (table === "agent_messages") row.created_at = "2026-10-03T10:00:00Z";
        if (table === "recommendations") Object.assign(row, { created_at: "2026-10-03T10:00:00Z", updated_at: "2026-10-03T10:00:00Z" });
        rows[table].push(row);
        return { data: clone(joined(table, row)), error: null };
      }
      const index = findIndex();
      if (index < 0) return { data: null, error: null };
      const row = rows[table][index];
      if (operation === "update" && failActionCompletion && table === "actions" && payload.status === "executed") return { data: null, error: { message: "private SQL failure" } };
      if (operation === "update") Object.assign(row, payload);
      return { data: clone(joined(table, row)), error: null };
    }
    function runMany() {
      return { data: rows[table].filter((row) => filters.every(([column, value]) => row[column] === value)).map((row) => clone(joined(table, row))), error: null };
    }
    return query;
  }

  const supabase = { from: (table) => { calls.push(["from", table]); return queryFor(table); } };
  const audit = { writeAuditLog: async (entry) => audits.push(clone(entry)) };
  const common = { "@/lib/require-admin": { requireAdmin: guard }, "@/lib/supabase/server": { getSupabaseServerClient: () => supabase }, "@/lib/audit-logs": audit };
  common["@/lib/agents/scope"]=load("lib/agents/scope.ts",common,logs);
  const agentValidation = load("lib/agents/validation.ts");
  const recommendationValidation = load("lib/recommendations/validation.ts");
  const actionValidation = load("lib/actions/validation.ts");
  const recommendationRepository = load("lib/recommendations/data.ts", { ...common, "./validation": recommendationValidation }, logs);
  const messageRepository = load("lib/agent-messages/data.ts", { ...common, "@/lib/recommendations/validation": recommendationValidation }, logs);
  const runRepository = load("lib/agent-runs/data.ts", { ...common, "@/lib/recommendations/data": recommendationRepository, "@/lib/agents/validation": agentValidation }, logs);
  const actionRepository = load("lib/actions/data.ts", { ...common, "./validation": actionValidation }, logs);
  return { recommendationRepository, messageRepository, runRepository, actionRepository, calls, audits, logs, rows };
}

const newRecommendation = { agent_id: agentId, client_id: clientId, title: "  Test deterministe  ", reason: " Raison ", severity: "info", status: "pending", payload: { internal_test: true } };

const projectId="11111111-1111-4111-8111-111111111111";
function projectContext(){const c=setup();Object.assign(c.rows.agents[0],{agent_scope:"project",scope_review_required:false});c.rows.projects.push({id:projectId,client_id:clientId});c.rows.agent_project_assignments.push({agent_id:agentId,client_id:clientId,project_id:projectId,enabled:true});return c;}
test("project runs require a confirmed scope, same-client project and both enabled assignments",async()=>{
 const c=projectContext();assert.equal((await c.runRepository.createAgentRun({agent_id:agentId,client_id:clientId,project_id:projectId})).ok,true);
 assert.equal(c.rows.agent_runs[0].project_id,projectId);assert.equal(c.audits[0].after_data.project_id,projectId);
 for(const mutate of [c=>c.rows.projects[0].client_id=runId,c=>c.rows.agent_project_assignments[0].enabled=false,c=>c.rows.agent_project_assignments=[],c=>c.rows.agent_client_assignments[0].enabled=false,c=>c.rows.agents[0].scope_review_required=true]){
  const rejected=projectContext();mutate(rejected);assert.equal((await rejected.runRepository.createAgentRun({agent_id:agentId,client_id:clientId,project_id:projectId})).ok,false);assert.equal(rejected.rows.agent_runs.length,0);
 }
 assert.equal((await projectContext().runRepository.createAgentRun({agent_id:agentId,client_id:clientId})).ok,false);
 const generalist=setup();assert.equal((await generalist.runRepository.createAgentRun({agent_id:agentId,client_id:clientId,project_id:projectId})).ok,false);
 assert.equal((await generalist.runRepository.createAgentRun({agent_id:agentId,client_id:clientId})).run.project_id,null);
});
test("project test run propagates its project into the deterministic recommendation",async()=>{
 const c=projectContext();const result=await c.runRepository.createInternalTestRun(agentId,clientId,projectId);assert.equal(result.ok,true);
 assert.equal(c.rows.agent_runs[0].project_id,projectId);assert.equal(c.rows.recommendations.at(-1).project_id,projectId);
});
test("project recommendations refuse missing, unauthorized and foreign-client projects",async()=>{
 const c=projectContext();assert.equal((await c.recommendationRepository.createRecommendation({...newRecommendation,project_id:projectId})).ok,true);
 assert.equal((await c.recommendationRepository.createRecommendation(newRecommendation)).ok,false);
 c.rows.projects[0].client_id=runId;assert.equal((await c.recommendationRepository.createRecommendation({...newRecommendation,project_id:projectId})).ok,false);
});
test("messages and actions derive project from the stored recommendation, ignoring browser context",async()=>{
 const c=projectContext();c.rows.recommendations[0].project_id=projectId;
 assert.equal((await c.messageRepository.createAdminMessage(recommendationId,"Revue")).ok,true);assert.equal(c.rows.agent_messages[0].project_id,projectId);
 assert.equal((await c.actionRepository.createAction({recommendation_id:recommendationId,action_type:"internal.test",parameters:{},project_id:runId,client_id:runId})).ok,true);
 assert.equal(c.rows.actions[0].project_id,projectId);assert.equal(c.rows.actions[0].client_id,clientId);
 assert.equal((await c.actionRepository.approveAction(actionId)).ok,true);c.rows.agent_project_assignments[0].enabled=false;
 assert.equal((await c.actionRepository.executeAction(actionId)).ok,false);assert.equal(c.rows.actions[0].status,"approved");
});
test("action execution refuses recommendation/project mismatch and changed project owner",async()=>{
 for(const mutate of [c=>c.rows.actions[0].project_id=runId,c=>c.rows.projects[0].client_id=runId]){
 const c=projectContext();c.rows.recommendations[0].project_id=projectId;await c.actionRepository.createAction({recommendation_id:recommendationId,action_type:"internal.test",parameters:{}});await c.actionRepository.approveAction(actionId);mutate(c);
 assert.equal((await c.actionRepository.executeAction(actionId)).ok,false);
 }
});

test("run metadata accepts the Google Ads read-only type and rejects arbitrary credentials", async () => {
  const context = setup();
  const created = await context.runRepository.createAgentRun({ agent_id: agentId, client_id: clientId, metadata: { run_type: "google_ads_read_only" } });
  assert.equal(created.ok, true);
  assert.equal(created.run.metadata.run_type, "google_ads_read_only");
  for (const metadata of [{ run_type: "google_ads_mutation" }, { run_type: "google_ads_read_only", refresh_token: "not-allowed" }]) {
    assert.equal((await context.runRepository.createAgentRun({ agent_id: agentId, client_id: clientId, metadata })).ok, false);
  }
  assert.equal(context.rows.agent_runs.length, 1);
});

test("creates recommendations after validating existing agent and client", async () => {
  const valid = setup();
  const created = await valid.recommendationRepository.createRecommendation(newRecommendation);
  assert.equal(created.ok, true);
  assert.equal(created.recommendation.title, "Test deterministe");
  assert.equal(valid.audits[0].action, "recommendation.created");
  assert.equal(valid.audits[0].actor_type, "system");
  assert.equal("payload" in valid.audits[0].after_data, false);
  assert.equal((await setup({ missingAgent: true }).recommendationRepository.createRecommendation(newRecommendation)).ok, false);
  assert.equal((await setup({ missingClient: true }).recommendationRepository.createRecommendation(newRecommendation)).ok, false);
});

test("recommendation statuses accept only the closed vocabulary and valid transitions", async () => {
  const { recommendationRepository, audits } = setup();
  assert.equal((await recommendationRepository.updateRecommendationStatus(recommendationId, "made-up")).ok, false);
  const updated = await recommendationRepository.updateRecommendationStatus(recommendationId, "accepted");
  assert.equal(updated.ok, true);
  assert.equal(updated.recommendation.status, "accepted");
  assert.equal(audits[0].action, "recommendation.status_changed");
  assert.equal((await recommendationRepository.updateRecommendationStatus(recommendationId, "pending")).ok, false);
});

test("admin messages derive agent and client from the reloaded recommendation", async () => {
  const { messageRepository, rows, audits } = setup();
  const result = await messageRepository.createAdminMessage(recommendationId, "  Revue demandée  ");
  assert.equal(result.ok, true);
  assert.equal(rows.agent_messages[0].agent_id, agentId);
  assert.equal(rows.agent_messages[0].client_id, clientId);
  assert.equal(rows.agent_messages[0].sender_type, "admin");
  assert.equal(rows.agent_messages[0].message, "Revue demandée");
  assert.equal(audits[0].action, "agent_message.created");
  assert.equal("message" in audits[0].after_data, false);
  assert.equal((await messageRepository.createAdminMessage(recommendationId, "   ")).ok, false);
});

test("runs can be created, completed, failed and filtered by agent or client", async () => {
  const { runRepository, audits } = setup();
  const created = await runRepository.createAgentRun({ agent_id: agentId, client_id: clientId, metadata: { internal_test: true } });
  assert.equal(created.ok, true);
  assert.equal(created.run.status, "running");
  assert.equal(audits[0].action, "agent_run.started");
  assert.equal((await runRepository.completeAgentRun(runId, "Run déterministe terminé")).run.status, "completed");
  assert.equal(audits[1].action, "agent_run.completed");
  const another = setup();
  await another.runRepository.createAgentRun({ agent_id: agentId, client_id: clientId });
  assert.equal((await another.runRepository.failAgentRun(runId)).run.status, "failed");
  assert.equal(another.audits.at(-1).action, "agent_run.failed");
  assert.equal((await runRepository.listRunsByAgent(agentId)).length, 1);
  assert.equal((await runRepository.listRunsByClient(clientId)).length, 1);
  assert.equal((await runRepository.createAgentRun({ agent_id: agentId, client_id: clientId, metadata: { secret: "not allowed" } })).ok, false);
});

test("internal test run creates a deterministic recommendation and completes", async () => {
  const { runRepository, rows, audits } = setup();
  const result = await runRepository.createInternalTestRun(agentId, clientId);
  assert.equal(result.ok, true);
  assert.equal(rows.agent_runs[0].summary, "Run de test interne");
  assert.equal(rows.recommendations[1].title, "Recommandation de test interne");
  assert.equal(rows.agent_runs[0].status, "completed");
  assert.deepEqual(audits.map((entry) => entry.action), ["agent_run.started", "recommendation.created", "agent_run.completed"]);
});

test("Agent detail Server Action returns a recommendation link target after a guarded run", async () => {
  const calls = [];
  const actions = load("app/(cockpit)/agents/[id]/actions.ts", {
    "@/lib/require-admin": { requireAdmin: async () => ({ userId: "clerk-admin-id" }) },
    "@/lib/agents/data": { updateAgent: async () => ({ ok: false, state: {} }) },
    "@/lib/agent-runs/data": { createInternalTestRun: async (submittedAgentId, submittedClientId) => {
      calls.push([submittedAgentId, submittedClientId]);
      return { ok: true, runId, recommendationId };
    } },
    "next/cache": { revalidatePath: (path) => calls.push(path) },
    "next/navigation": { redirect: () => { throw new Error("unexpected-redirect"); } },
  });
  const data = new FormData();
  data.set("agent_id", agentId);
  data.set("client_id", clientId);
  const result = await actions.createAgentTestRunAction({}, data);
  assert.equal(result.recommendationId, recommendationId);
  assert.match(result.message, /Run de test interne terminé/);
  assert.ok(calls.includes(`/recommendations/${recommendationId}`));
});

test("only internal.test with empty structured parameters can be proposed", async () => {
  const { actionRepository, rows, audits } = setup();
  const valid = await actionRepository.createAction({ recommendation_id: recommendationId, action_type: "internal.test", parameters: {} });
  assert.equal(valid.ok, true);
  assert.equal(valid.action.status, "pending_approval");
  assert.equal(valid.action.requires_approval, true);
  assert.equal(valid.action.agent_id, agentId);
  assert.equal(valid.action.client_id, clientId);
  assert.equal(audits[0].action, "action.created");
  assert.equal((await actionRepository.createAction({ recommendation_id: recommendationId, action_type: "google_ads.campaign", parameters: {} })).ok, false);
  assert.equal((await actionRepository.createAction({ recommendation_id: recommendationId, action_type: "internal.test", parameters: { command: "free text" } })).ok, false);
  assert.equal(rows.actions.length, 1);
});

test("actions require approval, cannot be replayed, and audit successful simulation", async () => {
  const { actionRepository, audits, rows } = setup();
  await actionRepository.createAction({ recommendation_id: recommendationId, action_type: "internal.test", parameters: {} });
  assert.equal((await actionRepository.executeAction(actionId)).ok, false);
  assert.equal((await actionRepository.approveAction(actionId)).ok, true);
  assert.equal(audits[1].action, "action.approved");
  const executed = await actionRepository.executeAction(actionId);
  assert.equal(executed.ok, true);
  assert.equal(executed.action.status, "executed");
  assert.equal(executed.action.result.message, "Action de test exécutée");
  assert.deepEqual(audits.slice(2).map((entry) => entry.action), ["action.execution_started", "action.executed"]);
  assert.equal((await actionRepository.executeAction(actionId)).ok, false);
  assert.equal((await actionRepository.approveAction(actionId)).ok, false);
  assert.equal(rows.actions[0].status, "executed");
});

test("failed internal execution persists failed state and generic error", async () => {
  const { actionRepository, rows, audits } = setup({ failActionCompletion: true });
  await actionRepository.createAction({ recommendation_id: recommendationId, action_type: "internal.test", parameters: {} });
  await actionRepository.approveAction(actionId);
  const result = await actionRepository.executeAction(actionId);
  assert.equal(result.ok, false);
  assert.equal(rows.actions[0].status, "failed");
  assert.equal(rows.actions[0].error_message, "Échec de l’exécution simulée.");
  assert.equal(audits.at(-1).action, "action.failed");
});

test("non-admin is rejected before every agentic data access", async () => {
  const { recommendationRepository, messageRepository, runRepository, actionRepository, calls } = setup({ deny: true });
  await assert.rejects(() => recommendationRepository.listRecommendations(), /access-denied/);
  await assert.rejects(() => recommendationRepository.createRecommendation(newRecommendation), /access-denied/);
  await assert.rejects(() => messageRepository.listMessagesByRecommendation(recommendationId), /access-denied/);
  await assert.rejects(() => messageRepository.createAdminMessage(recommendationId, "texte"), /access-denied/);
  await assert.rejects(() => runRepository.createAgentRun({ agent_id: agentId }), /access-denied/);
  await assert.rejects(() => actionRepository.createAction({ recommendation_id: recommendationId, action_type: "internal.test", parameters: {} }), /access-denied/);
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === "from"), false);
});

test("central audit writer only appends to audit_logs", async () => {
  const calls = [];
  const auditClient = {
    from: (table) => {
      calls.push(["from", table]);
      const query = {
        insert: (entry) => { calls.push(["insert", entry]); return query; },
        update: () => { calls.push(["update"]); return query; },
        delete: () => { calls.push(["delete"]); return query; },
        then: (resolve) => resolve({ error: null }),
      };
      return query;
    },
  };
  const writer = load("lib/audit-logs.ts", { "@/lib/require-admin": { requireAdmin: async () => ({ userId: "clerk-admin-id" }) }, "@/lib/supabase/server": { getSupabaseServerClient: () => auditClient } });
  await writer.writeAuditLog({ action: "action.created", actor_type: "admin", actor_id: "clerk-admin-id", resource_type: "action", resource_id: actionId, before_data: null, after_data: {}, metadata: {} });
  assert.deepEqual(calls.map((call) => call[0]), ["from", "insert"]);
  assert.equal(calls[0][1], "audit_logs");
});

test('audit writes deny non-admin before privileged storage',async()=>{let reads=0;const writer=load('lib/audit-logs.ts',{'@/lib/require-admin':{requireAdmin:async()=>{throw Error('denied');}},'@/lib/supabase/server':{getSupabaseServerClient:()=>{reads++;throw Error('Storage must not be called');}}});await assert.rejects(()=>writer.writeAuditLog({}),/denied/);assert.equal(reads,0);});
test("dashboard summary counts only real supplied records and actionable states", () => {
  const { summarizeDashboard } = load("lib/dashboard/summary.ts");
  const summary = summarizeDashboard({
    clients: [{ id: clientId }, { id: recommendationId }],
    projects: [{ status: "En cours" }, { status: "Terminé" }],
    tasks: [{ id: "t1", title: "Prioritaire", status: "À faire", priority: "Haute", client: { name: "Client test" } }, { id: "t2", title: "Terminé", status: "Terminé", priority: "Haute" }],
    agents: [{ status: "Actif", enabled: true }, { status: "Actif", enabled: false }],
    recommendations: [{ status: "pending" }, { status: "accepted" }],
    actions: [{ status: "pending_approval", requires_approval: true }, { status: "executed", requires_approval: true }],
  });
  assert.equal(summary.clients, 2);
  assert.equal(summary.openProjects, 1);
  assert.equal(summary.openTasks, 1);
  assert.equal(summary.activeAgents, 1);
  assert.equal(summary.pendingRecommendations, 1);
  assert.equal(summary.pendingActions, 1);
  assert.equal(summary.priorityTasks[0].id, "t1");
});

test("client components do not import Supabase or reference its server key", () => {
  const files = [
    "components/actions/action-controls.tsx",
    "components/agents/agent-form.tsx",
    "components/agents/agent-test-run-form.tsx",
    "components/agents/client-agent-assignments.tsx",
    "components/clients/client-form.tsx",
    "components/recommendations/recommendation-controls.tsx",
    "components/ui/confirm-delete-form.tsx",
    "components/work/project-form.tsx",
    "components/work/task-form.tsx",
  ];
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /SUPABASE_SECRET_KEY|@supabase\/supabase-js|createClient\(/, file);
  }
});
