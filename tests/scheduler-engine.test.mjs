import assert from "node:assert/strict";
import { test } from "node:test";
import * as zod from "zod";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";
import { loadRegistry, loadTs } from "./helpers/load-ts.mjs";

const { registry } = loadRegistry();
const permissions = loadTs("lib/permissions/engine.ts", { "@/lib/agents/registry": registry });
const recurrence = loadTs("lib/scheduler/recurrence.ts", { zod });
const types = loadTs("lib/runs/types.ts");
const actorModule = loadTs("lib/core/actor.ts");
const cronAuth = loadTs("lib/scheduler/cron-auth.ts");

const REPORT = "a-report", MONITORING = "a-monitoring", CLIENT = "11111111-1111-4111-8111-111111111111";
const agents = () => [
  { id: REPORT, name: "Agent Rapport", agent_type: "report", enabled: true, status: "Actif", autonomy_level: 0, created_at: "1" },
  { id: MONITORING, name: "Agent Monitoring Technique", agent_type: "monitoring", enabled: true, status: "Actif", autonomy_level: 1, created_at: "1" },
  { id: "a-seo", name: "Agent SEO & Site", agent_type: "seo", enabled: false, status: "En pause", autonomy_level: 1, created_at: "1" },
];

function claimRpc(args, tables) {
  const now = new Date().toISOString();
  for (const job of tables.jobs) if (job.status === "running" && job.lease_expires_at && job.lease_expires_at < now) Object.assign(job, { status: job.attempts >= job.max_attempts ? "failed" : "queued", worker_id: null, lease_expires_at: null });
  const due = tables.jobs.filter((job) => job.status === "queued" && job.scheduled_for <= now).slice(0, args.p_limit);
  for (const job of due) Object.assign(job, { status: "running", worker_id: args.p_worker, attempts: job.attempts + 1, lease_expires_at: new Date(Date.now() + args.p_lease_seconds * 1000).toISOString() });
  return JSON.parse(JSON.stringify(due));
}

function enqueueRpc(args, tables) {
  const a = tables.automations.find(row => row.id === args.p_automation && row.status === "active" && row.next_run_at === args.p_due);
  if (!a) return null;
  const id = `job-${tables.jobs.length + 1}`;
  tables.jobs.push({ id, automation_id: a.id, run_type: a.run_type, agent_id: a.agent_id, client_id: a.client_id, project_id: a.project_id, payload: a.config, scheduled_for: args.p_due, idempotency_key: `auto:${a.id}:${args.p_due}`, trigger: "schedule" });
  Object.assign(a, { next_run_at: args.p_next, last_run_at: args.p_now, status: args.p_next ? "active" : "completed" });
  return id;
}

const assigned = (agentId, clientId = CLIENT) => ({ agent_id: agentId, client_id: clientId, enabled: true });
function setup({ automations = [], jobs = [], handlers = {}, configured = () => true, initialAgents = agents(), assignments = [assigned(REPORT), assigned(MONITORING)], beforeJobClaim, finishRunHook, failOn, handlerLoaderHook } = {}) {
  const fake = createFakeSupabase({ agents: initialAgents, agent_client_assignments: assignments, automations, jobs: jobs.map((job) => ({ status: "queued", attempts: 0, max_attempts: 3, scheduled_for: "2000-01-01T00:00:00Z", payload: {}, worker_id: null, ...job })), agent_runs: [], audit_logs: [] }, {
    unique: { jobs: [["idempotency_key"]] }, rpc: { codev_claim_jobs: claimRpc, codev_enqueue_automation: enqueueRpc }, failOn,
  });
  const from = fake.client.from;
  fake.client.from = (table) => {
    const query = from(table);
    if (table === "jobs" && beforeJobClaim) {
      const update = query.update;
      query.update = (patch) => { if (patch.status === "running") beforeJobClaim(fake, patch); return update(patch); };
    }
    return query;
  };
  const server = { getSupabaseServerClient: () => fake.client };
  const audit = loadTs("lib/core/audit.ts", { "@/lib/supabase/server": server, "@/lib/core/actor": actorModule });
  const outputs = loadTs("lib/agents/outputs.ts", { "@/lib/supabase/server": server, "@/lib/core/audit": audit, "@/lib/permissions/engine": permissions, "@/lib/agents/registry": registry, "@/lib/actions/registry": loadTs("lib/actions/registry.ts", { zod, "@/lib/seo/github-change-model": loadTs("lib/seo/github-change-model.ts", { zod }) }) });
  const engine = loadTs("lib/scheduler/engine.ts", {
    "@/lib/supabase/server": server, "@/lib/core/audit": audit, "@/lib/permissions/engine": permissions, "@/lib/agents/registry": registry,
    "@/lib/system/providers": { isProviderConfigured: configured }, "@/lib/agents/outputs": {
      ...outputs,
      finishRun: async (...args) => { if (finishRunHook) await finishRunHook(fake, ...args); return outputs.finishRun(...args); },
    },
    "@/lib/runs/handlers": { runHandlers: Object.fromEntries(Object.keys(registry.runTypes).map((type) => [type, async () => { if (handlerLoaderHook) await handlerLoaderHook(fake, type); return handlers[type] ?? (async () => ({ status: "succeeded", summary: "ok" })); }])) },
    "@/lib/reports/recurring/service": { enqueueDueAdsReports: async () => 0 },
    "@/lib/runs/types": types, "@/lib/scheduler/recurrence": recurrence,
  });
  return { engine, fake };
}
const system = { kind: "system", worker: "test" };
const weekly = (overrides = {}) => ({ id: "auto-1", name: "Rapports", client_id: null, project_id: null, agent_id: REPORT, run_type: "report.generate", timezone: "Europe/Paris", frequency: "weekly", schedule: { time: "08:00", weekdays: [1] }, next_run_at: "2026-10-12T06:00:00.000Z", status: "active", config: { kind: "weekly" }, consecutive_failures: 0, ...overrides });

test("due automation → exactly one job, next run advanced; a second or concurrent tick adds nothing", async () => {
  const { engine, fake } = setup({ automations: [weekly()] });
  const now = new Date("2026-10-12T06:00:30Z");
  const [first, second] = await Promise.all([engine.enqueueDueAutomations(system, now), engine.enqueueDueAutomations(system, now)]);
  assert.equal(first.enqueued + second.enqueued, 1, "concurrent ticks enqueue once");
  assert.equal(fake.tables.jobs.length, 1);
  assert.equal(fake.tables.jobs[0].idempotency_key, "auto:auto-1:2026-10-12T06:00:00.000Z");
  assert.equal(fake.tables.automations[0].next_run_at, "2026-10-19T06:00:00.000Z");
  assert.equal((await engine.enqueueDueAutomations(system, now)).enqueued, 0);
});

test("missed runs collapse into one execution; once-automations complete", async () => {
  const { engine, fake } = setup({ automations: [weekly({ next_run_at: "2026-09-07T06:00:00.000Z" }), weekly({ id: "auto-once", frequency: "once", schedule: { runAt: "2026-10-01T07:00:00Z" }, next_run_at: "2026-10-01T07:00:00.000Z" })] });
  const result = await engine.enqueueDueAutomations(system, new Date("2026-10-12T06:00:30Z"));
  assert.equal(result.enqueued, 2);
  assert.equal(fake.tables.automations.find((item) => item.id === "auto-1").next_run_at, "2026-10-19T06:00:00.000Z", "no catch-up storm");
  assert.equal(fake.tables.automations.find((item) => item.id === "auto-once").status, "completed");
});

test("invalid schedule or unknown run type puts the automation in error, never runs it", async () => {
  const { engine, fake } = setup({ automations: [weekly({ id: "bad-tz", timezone: "Mars/Olympus" }), weekly({ id: "bad-type", run_type: "shell.exec" })] });
  const result = await engine.enqueueDueAutomations(system, new Date("2026-10-12T07:00:00Z"));
  assert.equal(result.invalid, 2);
  assert.equal(fake.tables.jobs.length, 0);
  assert.ok(fake.tables.automations.every((item) => item.status === "error"));
  assert.equal(fake.tables.audit_logs.filter((entry) => entry.action === "automation.invalid").length, 2);
});

test("successful client job: run recorded, job succeeded, audited", async () => {
  const { engine, fake } = setup({ jobs: [{ id: "job-1", run_type: "report.generate", idempotency_key: "k1", automation_id: null, client_id: CLIENT }] });
  const summary = await engine.processJobs(system, "worker-1");
  assert.equal(summary.succeeded, 1);
  const job = fake.tables.jobs[0];
  assert.equal(job.status, "succeeded");
  assert.ok(job.agent_run_id);
  assert.equal(fake.tables.agent_runs[0].status, "completed");
  assert.ok(fake.tables.audit_logs.some((entry) => entry.action === "job.succeeded"));
});

test("retryable failure → backoff then failure after max attempts; automation goes to error after 3 failures", async () => {
  let calls = 0;
  const handlers = { "monitoring.check_sites": async () => { calls++; throw new types.RunError("Fournisseur indisponible."); } };
  const { engine, fake } = setup({ automations: [weekly({ id: "auto-m", agent_id: MONITORING, run_type: "monitoring.check_sites", consecutive_failures: 2 })], jobs: [{ id: "job-r", run_type: "monitoring.check_sites", idempotency_key: "kr", automation_id: "auto-m", max_attempts: 2, client_id: CLIENT }], handlers });
  assert.equal((await engine.processJobs(system, "w")).retried, 1);
  const job = fake.tables.jobs[0];
  assert.equal(job.status, "queued");
  assert.ok(job.scheduled_for > new Date().toISOString(), "backoff in the future");
  job.scheduled_for = "2000-01-01T00:00:00Z";
  assert.equal((await engine.processJobs(system, "w")).failed, 1, "attempts exhausted");
  assert.equal(job.status, "failed");
  assert.equal(calls, 2);
  assert.equal(fake.tables.automations[0].status, "error");
  assert.equal(fake.tables.agent_runs.filter((run) => run.status === "failed").length, 2);
});

test("global job (no client) runs without an agent_runs row; the job is the trace", async () => {
  const { engine, fake } = setup({ jobs: [{ id: "g", run_type: "report.generate", idempotency_key: "g" }] });
  assert.equal((await engine.processJobs(system, "w")).succeeded, 1);
  assert.equal(fake.tables.agent_runs.length, 0);
  assert.equal(fake.tables.jobs[0].status, "succeeded");
  assert.equal(fake.tables.jobs[0].agent_run_id, null);
});

test("client job for an unassigned or project-scoped agent is skipped with the reason (scope guard)", async () => {
  const projectScoped = agents().map((agent) => agent.id === MONITORING ? { ...agent, agent_scope: "project" } : agent);
  const { engine, fake } = setup({ initialAgents: projectScoped, assignments: [assigned(MONITORING)], jobs: [
    { id: "na", run_type: "report.generate", idempotency_key: "na", client_id: CLIENT },
    { id: "ps", run_type: "monitoring.check_sites", idempotency_key: "ps", client_id: CLIENT },
  ] });
  const summary = await engine.processJobs(system, "w", 10);
  assert.equal(summary.skipped, 2);
  assert.equal(fake.tables.agent_runs.length, 0, "no write the database guard would reject");
  assert.match(fake.tables.jobs.find((job) => job.id === "na").last_error, /pas rattaché à ce client/);
  assert.match(fake.tables.jobs.find((job) => job.id === "ps").last_error, /niveau projet/);
});

test("non-retryable failure fails immediately; unknown run type and incompatible agent fail cleanly", async () => {
  const handlers = { "report.generate": async () => { throw new types.RunError("Données invalides.", false); } };
  const { engine, fake } = setup({ jobs: [
    { id: "j1", run_type: "report.generate", idempotency_key: "a" },
    { id: "j2", run_type: "shell.exec", idempotency_key: "b" },
    { id: "j3", run_type: "report.generate", idempotency_key: "c", agent_id: MONITORING },
  ], handlers });
  const summary = await engine.processJobs(system, "w", 10);
  assert.equal(summary.failed, 3);
  assert.match(fake.tables.jobs.find((job) => job.id === "j2").last_error, /inconnu/);
  assert.match(fake.tables.jobs.find((job) => job.id === "j3").last_error, /incompatible/);
});

test("paused agent or missing provider → skipped with the reason, no run, no failure", async () => {
  const { engine, fake } = setup({ jobs: [{ id: "j-seo", run_type: "seo.analyze", idempotency_key: "s", client_id: CLIENT }, { id: "j-ads", run_type: "monitoring.check_sites", idempotency_key: "m" }], configured: (provider) => provider !== "http" });
  const summary = await engine.processJobs(system, "w", 10);
  assert.equal(summary.skipped, 2);
  assert.equal(fake.tables.agent_runs.length, 0);
  assert.match(fake.tables.jobs.find((job) => job.id === "j-seo").last_error, /en pause/);
  assert.match(fake.tables.jobs.find((job) => job.id === "j-ads").last_error, /Connexion requise : http/);
});

test("a worker that lost its lease cannot overwrite the result (fencing)", async () => {
  let fakeRef;
  const handlers = { "report.generate": async () => { const job = fakeRef.tables.jobs[0]; job.worker_id = "other-worker"; return { status: "succeeded", summary: "trop tard" }; } };
  const { engine, fake } = setup({ jobs: [{ id: "j", run_type: "report.generate", idempotency_key: "f" }], handlers });
  fakeRef = fake;
  const summary = await engine.processJobs(system, "w");
  assert.equal(summary.processed, 1);
  assert.equal(summary.succeeded, 0, "result discarded");
  assert.equal(fake.tables.jobs[0].status, "running");
});

test("an expired lease cannot report success even before another worker reclaims it", async () => {
  let fakeRef;
  const handlers = { "report.generate": async () => {
    fakeRef.tables.jobs[0].lease_expires_at = "2000-01-01T00:00:00Z";
    return { status: "succeeded", summary: "succès tardif" };
  } };
  const { engine, fake } = setup({ jobs: [{ id: "expired", run_type: "report.generate", client_id: CLIENT, idempotency_key: "expired" }], handlers });
  fakeRef = fake;
  const summary = await engine.processJobs(system, "w");
  assert.equal(summary.succeeded, 0);
  assert.equal(fake.tables.jobs[0].status, "running");
  assert.equal(fake.tables.agent_runs[0].status, "failed");
  assert.match(fake.tables.agent_runs[0].summary, /Bail perdu/);
  assert.equal(fake.tables.audit_logs.some(row => row.action === "job.succeeded"), false);
});

test("a stale preclaimed job cannot start a handler or an agent run", async () => {
  let called = false;
  const { engine, fake } = setup({ jobs: [{ id: "stale", run_type: "report.generate", idempotency_key: "stale", status: "running", worker_id: "w", lease_expires_at: "2000-01-01T00:00:00Z", client_id: CLIENT }], handlers: { "report.generate": async () => { called = true; return { status: "succeeded", summary: "bad" }; } } });
  assert.equal(await engine.runJob(system, "w", structuredClone(fake.tables.jobs[0])), "lost");
  assert.equal(called, false);
  assert.equal(fake.tables.agent_runs.length, 0);
});

test("a hanging handler times out and is retried", async () => {
  const handlers = { "report.generate": () => new Promise(() => {}) };
  const { engine, fake } = setup({ jobs: [{ id: "j", run_type: "report.generate", idempotency_key: "t" }], handlers });
  const summary = await engine.processJobs(system, "w", 5, 50);
  assert.equal(summary.retried, 1);
  assert.match(fake.tables.jobs[0].last_error, /Délai/);
});

test("manual jobs are deduplicated within the same minute", async () => {
  const { engine, fake } = setup();
  const first = await engine.enqueueJob({ kind: "admin", userId: "u" }, { runType: "news.fetch", trigger: "manual" });
  const second = await engine.enqueueJob({ kind: "admin", userId: "u" }, { runType: "news.fetch", trigger: "manual" });
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(fake.tables.jobs.length, 1);
  assert.equal((await engine.enqueueJob({ kind: "admin", userId: "u" }, { runType: "rm -rf", trigger: "manual" })).ok, false);
});

test("cron authorization: secret required, constant-time comparison, no prefix tricks", () => {
  const secret = "s3cret-value-long-enough";
  assert.deepEqual(JSON.parse(JSON.stringify(cronAuth.checkCronAuthorization(`Bearer ${secret}`, secret))), { ok: true });
  assert.equal(cronAuth.checkCronAuthorization(`Bearer ${secret}x`, secret).status, 401);
  assert.equal(cronAuth.checkCronAuthorization(secret, secret).status, 401);
  assert.equal(cronAuth.checkCronAuthorization(null, secret).status, 401);
  assert.equal(cronAuth.checkCronAuthorization(`Bearer ${secret}`, undefined).status, 503);
  assert.equal(cronAuth.checkCronAuthorization("Bearer short", "short").status, 503, "weak secret refused");
});

 test("recurring transport can record missing approval even before email setup; external transport remains inside its guarded handler", async () => {
 let ran=false;
 const {engine}=setup({jobs:[{id:"job-recurring",run_type:"ads.report.send",client_id:CLIENT,idempotency_key:"recurring"}],configured:()=>false,handlers:{"ads.report.send":async()=>{ran=true;return{status:"skipped",summary:"Envoi bloqué : validation nécessaire."};}}});
 const result=await engine.processJobs(system,"worker-A");assert.equal(result.skipped,1);assert.equal(ran,true);
 });


test("manual claim runs exactly the requested job and retains its automation history", async () => {
  let unrelatedRan = false;
  const { engine, fake } = setup({ jobs: [
    { id: "other-send", run_type: "ads.report.send", idempotency_key: "other-send" },
    { id: "manual", run_type: "report.generate", idempotency_key: "manual", automation_id: "auto-1", client_id: CLIENT },
  ], handlers: { "ads.report.send": async () => { unrelatedRan = true; return { status: "succeeded", summary: "mail" }; } } });
  const otherBefore = structuredClone(fake.tables.jobs[0]);
  assert.equal(await engine.processJob(system, "manual-worker", "manual"), "succeeded");
  assert.equal(unrelatedRan, false);
  assert.deepEqual(fake.tables.jobs[0], otherBefore);
  const job = fake.tables.jobs[1];
  assert.equal(job.status, "succeeded");
  assert.equal(job.automation_id, "auto-1");
  assert.equal(job.attempts, 1);
  assert.equal(job.worker_id, "manual-worker");
  assert.ok(job.started_at);
  assert.equal(fake.tables.agent_runs[0].metadata.job_id, "manual");
  assert.equal(fake.calls.some(call => call[0] === "rpc"), false, "manual execution requires no RPC or new migration");
});

test("manual enqueue preserves automation_id without changing ordinary manual jobs", async () => {
  const { engine, fake } = setup();
  await engine.enqueueJob(system, { runType: "report.generate", trigger: "manual", automationId: "auto-1", dedupeKey: "automation" });
  await engine.enqueueJob(system, { runType: "report.generate", trigger: "manual", dedupeKey: "ordinary" });
  assert.equal(fake.tables.jobs[0].automation_id, "auto-1");
  assert.equal(fake.tables.jobs[1].automation_id, null);
});

test("concurrent manual requests claim the same job once with one 300-second lease", async () => {
  let calls = 0;
  const { engine, fake } = setup({ jobs: [{ id: "manual", run_type: "report.generate", idempotency_key: "manual" }], handlers: {
    "report.generate": async () => { calls++; return { status: "succeeded", summary: "ok" }; },
  } });
  const before = Date.now();
  const results = await Promise.all(Array.from({ length: 4 }, (_, index) => engine.processJob(system, `worker-${index}`, "manual")));
  assert.equal(results.filter(result => result === "succeeded").length, 1);
  assert.equal(results.filter(result => result === null).length, 3);
  assert.equal(calls, 1);
  assert.equal(fake.tables.jobs[0].attempts, 1);
  const claim = fake.calls.find(call => call[0] === "jobs" && call[1] === "update" && call[2].status === "running")[2];
  const lease = Date.parse(claim.lease_expires_at);
  assert.ok(lease >= before + engine.LEASE_SECONDS * 1000);
  assert.ok(lease <= Date.now() + engine.LEASE_SECONDS * 1000);
});

test("manual claim ignores missing, future, running, failed and exhausted jobs without reclaiming expired leases", async () => {
  let calls = 0;
  const { engine, fake } = setup({ jobs: [
    { id: "future", scheduled_for: "2999-01-01T00:00:00Z" },
    { id: "running", status: "running", attempts: 1, worker_id: "existing", lease_expires_at: "2000-01-01T00:00:00Z" },
    { id: "failed", status: "failed" },
    { id: "exhausted", attempts: 3 },
  ].map(job => ({ run_type: "report.generate", idempotency_key: job.id, ...job })), handlers: {
    "report.generate": async () => { calls++; return { status: "succeeded", summary: "bad" }; },
  } });
  const before = structuredClone(fake.tables.jobs);
  for (const id of ["missing", "future", "running", "failed", "exhausted"]) assert.equal(await engine.processJob(system, "manual", id), null);
  assert.equal(calls, 0);
  assert.deepEqual(fake.tables.jobs, before);
  assert.equal(fake.calls.some(call => call[0] === "jobs" && call[1] === "update"), false);
  assert.equal(fake.calls.some(call => call[0] === "rpc"), false);
});

test("manual compare-and-swap rejects a lost claim, newer attempt, changed attempt budget and future schedule", async () => {
  for (const mutation of [
    job => { job.status = "running"; job.worker_id = "scheduler"; job.attempts++; },
    job => { job.attempts++; },
    job => { job.max_attempts = 1; },
    job => { job.scheduled_for = "2999-01-01T00:00:00Z"; },
  ]) {
    let calls = 0;
    const { engine, fake } = setup({ jobs: [{ id: "manual", run_type: "report.generate", idempotency_key: "manual" }],
      beforeJobClaim: fake => mutation(fake.tables.jobs[0]),
      handlers: { "report.generate": async () => { calls++; return { status: "succeeded", summary: "bad" }; } },
    });
    assert.equal(await engine.processJob(system, "manual-worker", "manual"), null);
    assert.equal(calls, 0);
    assert.equal(fake.tables.agent_runs.length, 0);
    assert.equal(fake.calls.some(call => call[0] === "rpc"), false);
  }
});

test("manual retries increment the existing attempt and retain the original start", async () => {
  const started = "2026-01-01T00:00:00.000Z";
  const { engine, fake } = setup({ jobs: [{ id: "retry", run_type: "report.generate", idempotency_key: "retry", attempts: 1, max_attempts: 3, started_at: started }],
    handlers: { "report.generate": async () => { throw new types.RunError("Retry me"); } },
  });
  assert.equal(await engine.processJob(system, "manual-worker", "retry"), "retried");
  assert.equal(fake.tables.jobs[0].attempts, 2);
  assert.equal(fake.tables.jobs[0].started_at, started);
  assert.equal(await engine.processJob(system, "manual-worker", "retry"), null, "backoff remains scheduled");
  fake.tables.jobs[0].scheduled_for = "2000-01-01T00:00:00Z";
  assert.equal(await engine.processJob(system, "manual-worker", "retry"), "failed");
  assert.equal(fake.tables.jobs[0].attempts, 3);
  assert.equal(await engine.processJob(system, "manual-worker", "retry"), null);
});

test("a completed agent run is recorded only after its job result is accepted", async () => {
  const observed = [];
  const { engine } = setup({ jobs: [{ id: "manual", run_type: "report.generate", idempotency_key: "manual", client_id: CLIENT }],
    finishRunHook: (fake, runId, status) => observed.push([fake.tables.jobs[0].status, status]),
  });
  assert.equal(await engine.processJob(system, "manual-worker", "manual"), "succeeded");
  assert.deepEqual(observed, [["succeeded", "completed"]]);
});

test("a lost lease cannot publish a failed retry or affect automation failures", async () => {
  let fakeRef;
  const { engine, fake } = setup({ automations: [weekly()], jobs: [{ id: "manual", run_type: "report.generate", idempotency_key: "manual", automation_id: "auto-1", client_id: CLIENT }],
    handlers: { "report.generate": async () => {
      fakeRef.tables.jobs[0].lease_expires_at = "2000-01-01T00:00:00Z";
      throw new types.RunError("too late");
    } },
  });
  fakeRef = fake;
  assert.equal(await engine.processJob(system, "manual-worker", "manual"), "lost");
  assert.equal(fake.tables.jobs[0].status, "running");
  assert.equal(fake.tables.automations[0].consecutive_failures, 0);
  assert.equal(fake.tables.audit_logs.some(row => row.action === "job.retry_scheduled" || row.action === "job.failed"), false);
});

test("manual claim read and write errors propagate without any global fallback", async () => {
  for (const operation of ["select", "update"]) {
    const { engine, fake } = setup({ jobs: [{ id: "manual", run_type: "report.generate", idempotency_key: "manual" }],
      failOn: (table, op) => table === "jobs" && op === operation,
    });
    await assert.rejects(engine.processJob(system, "manual-worker", "manual"), new RegExp(operation === "select" ? "job read" : "job claim"));
    assert.equal(fake.calls.some(call => call[0] === "rpc"), false);
    assert.equal(fake.tables.agent_runs.length, 0);
  }
});

test("batch jobs whose leases expired while an earlier handler ran never start", async () => {
  let fakeRef;
  const ran = [];
  const { engine, fake } = setup({ jobs: [
    { id: "first", run_type: "report.generate", idempotency_key: "first", client_id: CLIENT },
    { id: "second", run_type: "report.generate", idempotency_key: "second", client_id: CLIENT },
  ], handlers: { "report.generate": async ({ job }) => {
    ran.push(job.id);
    if (job.id === "first") fakeRef.tables.jobs[1].lease_expires_at = "2000-01-01T00:00:00Z";
    return { status: "succeeded", summary: "ok" };
  } } });
  fakeRef = fake;
  const summary = await engine.processJobs(system, "batch-worker");
  assert.equal(summary.processed, 2);
  assert.equal(summary.succeeded, 1);
  assert.deepEqual(ran, ["first"]);
  assert.equal(fake.tables.agent_runs.length, 1);
  assert.equal(fake.tables.jobs[1].status, "running");
});

test("deadline processing claims one job at a time and leaves the rest unclaimed when time runs short", async () => {
  let time = 0;
  const { engine, fake } = setup({ jobs: [
    { id: "first", run_type: "report.generate", idempotency_key: "first" },
    { id: "second", run_type: "report.generate", idempotency_key: "second" },
  ], handlers: { "report.generate": async () => { time = 50; return { status: "succeeded", summary: "ok" }; } } });
  const result = await engine.processJobs(system, "deadline-worker", 5, 60, { deadline: 100, clock: () => time });
  assert.equal(result.processed, 1);
  assert.equal(result.succeeded, 1);
  assert.equal(result.deferred, 1);
  assert.equal(fake.tables.jobs[1].status, "queued");
  assert.equal(fake.tables.jobs[1].attempts, 0);
  assert.equal(fake.calls.filter(call => call[0] === "rpc").length, 1);
  assert.equal(fake.calls.find(call => call[0] === "rpc")[2].p_limit, 1);
});


test("a failing agent-run update cannot requeue an already successful job", async () => {
  const { engine, fake } = setup({ jobs: [{ id: "manual", run_type: "report.generate", idempotency_key: "manual", client_id: CLIENT }],
    finishRunHook: async () => { throw new Error("agent run write unavailable"); },
  });
  assert.equal(await engine.processJob(system, "manual-worker", "manual"), "succeeded");
  assert.equal(fake.tables.jobs[0].status, "succeeded");
  assert.equal(fake.tables.jobs[0].attempts, 1);
  assert.equal(fake.calls.filter(call => call[0] === "jobs" && call[1] === "update" && call[2].status === "queued").length, 0);
});

test("an audit failure after completion cannot relabel a successful agent run as failed", async () => {
  const { engine, fake } = setup({ jobs: [{ id: "manual", run_type: "report.generate", idempotency_key: "manual", client_id: CLIENT }],
    failOn: (table, operation) => table === "audit_logs" && operation === "insert",
  });
  assert.equal(await engine.processJob(system, "manual-worker", "manual"), "succeeded");
  assert.equal(fake.tables.jobs[0].status, "succeeded");
  assert.equal(fake.tables.agent_runs[0].status, "completed");
  assert.equal(fake.tables.jobs[0].attempts, 1);
});


test("a lease lost during agent lookup cannot start an agent run or handler", async () => {
  let fakeRef, calls = 0;
  const { engine, fake } = setup({ jobs: [{ id: "manual", run_type: "report.generate", agent_id: REPORT, client_id: CLIENT, idempotency_key: "manual" }],
    failOn: (table, operation) => {
      if (table === "agents" && operation === "select") fakeRef.tables.jobs[0].lease_expires_at = "2000-01-01T00:00:00Z";
      return false;
    },
    handlers: { "report.generate": async () => { calls++; return { status: "succeeded", summary: "bad" }; } },
  });
  fakeRef = fake;
  assert.equal(await engine.processJob(system, "manual-worker", "manual"), "lost");
  assert.equal(calls, 0);
  assert.equal(fake.tables.agent_runs.length, 0);
  assert.equal(fake.tables.jobs[0].status, "running");
});

test("a lease lost while loading the handler cannot start it and closes the agent run as failed", async () => {
  let calls = 0;
  const { engine, fake } = setup({ jobs: [{ id: "manual", run_type: "report.generate", agent_id: REPORT, client_id: CLIENT, idempotency_key: "manual" }],
    handlerLoaderHook: fake => { fake.tables.jobs[0].lease_expires_at = "2000-01-01T00:00:00Z"; },
    handlers: { "report.generate": async () => { calls++; return { status: "succeeded", summary: "bad" }; } },
  });
  assert.equal(await engine.processJob(system, "manual-worker", "manual"), "lost");
  assert.equal(calls, 0);
  assert.equal(fake.tables.jobs[0].status, "running");
  assert.equal(fake.tables.agent_runs.length, 1);
  assert.equal(fake.tables.agent_runs[0].status, "failed");
  assert.match(fake.tables.agent_runs[0].summary, /Bail perdu/);
  assert.equal(fake.tables.audit_logs.some(row => row.action === "job.succeeded"), false);
});


test("atomic enqueue unavailable preserves the due occurrence and never falls back to separate writes", async () => {
  const { engine, fake } = setup({ automations: [weekly()] });
  const initial = structuredClone(fake.tables.automations[0]);
  fake.client.rpc = async () => ({ data: null, error: { code: "PGRST202", message: "missing RPC" } });
  await assert.rejects(engine.enqueueDueAutomations(system, new Date("2026-10-12T06:00:30Z")), /migration atomique/);
  assert.deepEqual(fake.tables.automations[0], initial);
  assert.equal(fake.tables.jobs.length, 0);
  assert.equal(fake.tables.audit_logs.some(row => row.action === "job.enqueued"), false);
});
