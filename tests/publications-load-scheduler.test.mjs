// Phase 8 (#47) — le moteur d'automatisations sous charge : avec l'échéance du passage, les jobs ne démarrent que s'ils
// peuvent finir à temps et ne sont jamais réservés pour rien (un bail expiré consommerait une tentative), pour laisser
// le temps aux étapes Publications qui suivent dans /api/internal/scheduler/tick. Déterministe (horloge simulée).
import assert from "node:assert/strict";
import { test } from "node:test";
import * as zod from "zod";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";
import { loadRegistry, loadTs } from "./helpers/load-ts.mjs";
import { src } from "./helpers/ts-load.mjs";

const { registry } = loadRegistry();
const permissions = loadTs("lib/permissions/engine.ts", { "@/lib/agents/registry": registry });
const recurrence = loadTs("lib/scheduler/recurrence.ts", { zod });
const types = loadTs("lib/runs/types.ts");
const actorModule = loadTs("lib/core/actor.ts");
const REPORT = "a-report";
function claimRpc(args, tables) {
  const due = tables.jobs.filter((job) => job.status === "queued").slice(0, args.p_limit);
  for (const job of due) Object.assign(job, { status: "running", worker_id: args.p_worker, attempts: job.attempts + 1, lease_expires_at: "2999-01-01T00:00:00Z" });
  return JSON.parse(JSON.stringify(due));
}
function setup(count, handler) {
  const fake = createFakeSupabase({ agents: [{ id: REPORT, name: "Agent Rapport", agent_type: "report", enabled: true, status: "Actif", autonomy_level: 0, created_at: "1" }], agent_client_assignments: [], automations: [], agent_runs: [], audit_logs: [],
    jobs: Array.from({ length: count }, (_, i) => ({ id: `job-${i + 1}`, run_type: "report.generate", idempotency_key: `k${i}`, automation_id: null, client_id: null, status: "queued", attempts: 0, max_attempts: 3, scheduled_for: "2000-01-01T00:00:00Z", payload: {}, worker_id: null })) },
    { unique: { jobs: [["idempotency_key"]] }, rpc: { codev_claim_jobs: claimRpc } });
  const server = { getSupabaseServerClient: () => fake.client };
  const audit = loadTs("lib/core/audit.ts", { "@/lib/supabase/server": server, "@/lib/core/actor": actorModule });
  const outputs = loadTs("lib/agents/outputs.ts", { "@/lib/supabase/server": server, "@/lib/core/audit": audit, "@/lib/permissions/engine": permissions, "@/lib/agents/registry": registry, "@/lib/actions/registry": loadTs("lib/actions/registry.ts", { zod }) });
  const engine = loadTs("lib/scheduler/engine.ts", {
    "@/lib/supabase/server": server, "@/lib/core/audit": audit, "@/lib/permissions/engine": permissions, "@/lib/agents/registry": registry,
    "@/lib/system/providers": { isProviderConfigured: () => true }, "@/lib/agents/outputs": outputs,
    "@/lib/runs/handlers": { runHandlers: Object.fromEntries(Object.keys(registry.runTypes).map((type) => [type, async () => handler])) },
    "@/lib/reports/recurring/service": { enqueueDueAdsReports: async () => 0 }, "@/lib/runs/types": types, "@/lib/scheduler/recurrence": recurrence,
  });
  return { engine, fake };
}
const system = { kind: "system", worker: "test" };

test("automation jobs with a tick deadline: start only when they can finish, never claimed for nothing; legacy batch unchanged", async () => {
  let clock = 0;
  const slow = setup(5, async () => { clock += 50_000; return { status: "succeeded", summary: "ok" }; });
  const r = await slow.engine.processJobs(system, "w", 5, 60_000, { deadline: 120_000, clock: () => clock });
  assert.equal(r.succeeded, 2, "2 jobs of 50 s fit in the 120 s automation budget");
  assert.equal(r.deferred, 1);
  const statuses = slow.fake.tables.jobs.map((job) => `${job.status}:${job.attempts}`);
  assert.deepEqual(statuses, ["succeeded:1", "succeeded:1", "queued:0", "queued:0", "queued:0"], "the other jobs stay queued, no attempt consumed");
  console.log(`LOAD automation jobs: ${r.succeeded} run, 3 left queued within a 120 s budget (worst case before #47: 5 × 60 s = the whole tick)`);
  // Sans échéance : lot historique de 5 réservé d'un coup.
  const legacy = setup(5, async () => ({ status: "succeeded", summary: "ok" }));
  assert.equal((await legacy.engine.processJobs(system, "w")).succeeded, 5);
  // Câblage : la route borne les automatisations pour laisser l'envoi des publications dues.
  assert.match(src("app/api/internal/scheduler/tick/route.ts"), /jobDeadline: Math\.min\(deadline, startedAt\.getTime\(\) \+ AUTOMATIONS_BUDGET_MS\)/);
  assert.match(src("app/api/internal/scheduler/tick/route.ts"), /const AUTOMATIONS_BUDGET_MS = 120_000;/);
});
