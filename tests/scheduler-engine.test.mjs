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

function setup({ automations = [], jobs = [], handlers = {}, configured = () => true, initialAgents = agents() } = {}) {
  const fake = createFakeSupabase({ agents: initialAgents, automations, jobs: jobs.map((job) => ({ status: "queued", attempts: 0, max_attempts: 3, scheduled_for: "2000-01-01T00:00:00Z", payload: {}, worker_id: null, ...job })), agent_runs: [], audit_logs: [] }, {
    unique: { jobs: [["idempotency_key"]] }, rpc: { codev_claim_jobs: claimRpc },
  });
  const server = { getSupabaseServerClient: () => fake.client };
  const audit = loadTs("lib/core/audit.ts", { "@/lib/supabase/server": server, "@/lib/core/actor": actorModule });
  const outputs = loadTs("lib/agents/outputs.ts", { "@/lib/supabase/server": server, "@/lib/core/audit": audit, "@/lib/permissions/engine": permissions, "@/lib/agents/registry": registry, "@/lib/actions/registry": loadTs("lib/actions/registry.ts", { zod }) });
  const engine = loadTs("lib/scheduler/engine.ts", {
    "@/lib/supabase/server": server, "@/lib/core/audit": audit, "@/lib/permissions/engine": permissions, "@/lib/agents/registry": registry,
    "@/lib/system/providers": { isProviderConfigured: configured }, "@/lib/agents/outputs": outputs,
    "@/lib/runs/handlers": { runHandlers: Object.fromEntries(Object.keys(registry.runTypes).map((type) => [type, async () => handlers[type] ?? (async () => ({ status: "succeeded", summary: "ok" }))])) },
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

test("successful job: run recorded, job succeeded, audited", async () => {
  const { engine, fake } = setup({ jobs: [{ id: "job-1", run_type: "report.generate", idempotency_key: "k1", automation_id: null }] });
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
  const { engine, fake } = setup({ automations: [weekly({ id: "auto-m", agent_id: MONITORING, run_type: "monitoring.check_sites", consecutive_failures: 2 })], jobs: [{ id: "job-r", run_type: "monitoring.check_sites", idempotency_key: "kr", automation_id: "auto-m", max_attempts: 2 }], handlers });
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
