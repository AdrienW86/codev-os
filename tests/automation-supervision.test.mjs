import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTs } from "./helpers/load-ts.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";

const model = loadTs("lib/automations/supervision-model.ts");
const now = new Date("2026-10-15T10:00:00Z");
const A = "11111111-1111-4111-8111-111111111111", C = "22222222-2222-4222-8222-222222222222", R = "33333333-3333-4333-8333-333333333333", J = "44444444-4444-4444-8444-444444444444";
const automation = overrides => ({ id: A, status: "active", next_run_at: "2026-10-16T16:00:00Z", last_run_at: null, client_id: C, name: "Rapport client", ...overrides });
const job = overrides => ({ id: J, automation_id: A, client_id: C, run_type: "report.generate", status: "succeeded", attempts: 1, max_attempts: 3, scheduled_for: "2026-10-15T09:00:00Z", started_at: "2026-10-15T09:00:01Z", finished_at: "2026-10-15T09:00:03Z", created_at: "2026-10-15T08:00:00Z", lease_expires_at: null, agent_run_id: null, result: null, ...overrides });
const report = overrides => ({ id: R, client_id: C, title: "Rapport exact", status: "ready_for_review", version: 2, approved_version: null, ...overrides });

test("supervision distinguishes a configuration, a job in queue and a completed run", () => {
  assert.equal(model.automationEvidence(automation(), null, [], now).state, "never");
  assert.equal(model.automationEvidence(automation({ last_run_at: "2026-10-15T09:00:00Z" }), null, [], now).state, "unknown");
  assert.equal(model.automationEvidence(automation(), job({ status: "queued", scheduled_for: "2026-10-16T16:00:00Z", attempts: 0 }), [], now).state, "planned");
  assert.equal(model.automationEvidence(automation(), job(), [], now).state, "succeeded");
  assert.equal(model.automationEvidence(automation(), job({ status: "skipped" }), [], now).state, "skipped");
  assert.equal(model.automationEvidence(automation(), job({ status: "failed" }), [], now).state, "failed");
});

test("overdue schedules and queues, expired leases and pending retries never appear successful", () => {
  assert.equal(model.automationEvidence(automation({ next_run_at: "2026-10-15T09:54:59Z" }), job(), [], now).state, "delayed");
  assert.equal(model.automationEvidence(automation({ status: "paused", next_run_at: "2026-10-15T09:00:00Z" }), job(), [], now).state, "succeeded");
  assert.equal(model.automationEvidence(automation(), job({ status: "queued" }), [], now).state, "delayed");
  const retry = model.automationEvidence(automation(), job({ status: "queued", attempts: 2, scheduled_for: "2026-10-15T10:04:00Z" }), [], now);
  assert.equal(retry.state, "planned"); assert.match(retry.description, /Nouvelle tentative/);
  assert.equal(model.automationEvidence(automation(), job({ status: "running", lease_expires_at: "2026-10-15T09:59:59Z" }), [], now).state, "delayed");
  assert.equal(model.automationEvidence(automation(), job({ status: "running", lease_expires_at: "2026-10-15T10:04:00Z" }), [], now).state, "running");
});

test("approval comes from the linked report's current version, not a success message or stale approval", () => {
  const successful = job({ result: { report_id: R, summary: "Approved" } });
  assert.equal(model.automationEvidence(automation(), successful, [report()], now).state, "awaiting_validation");
  assert.equal(model.automationEvidence(automation(), successful, [report({ status: "approved", approved_version: 1 })], now).state, "awaiting_validation");
  assert.equal(model.automationEvidence(automation(), successful, [report({ status: "approved", approved_version: 2 })], now).state, "succeeded");
  assert.equal(model.automationEvidence(automation(), successful, [report({ client_id: "other-client" })], now).state, "succeeded", "another client cannot supply approval evidence");
  assert.match(model.automationEvidence(automation(), successful, [report({ status: "sent" })], now).description, /ne prouve aucun envoi/);
  assert.deepEqual(Array.from(model.jobReportIds(job({ result: { report_id: "https://evil.invalid", report_ids: [R, R, "../admin", null] } }))), [R]);
});

function repository(initial, failOn) {
  const fake = createFakeSupabase(initial, { failOn });
  const service = loadTs("lib/automations/supervision.ts", { "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client }, "@/lib/automations/supervision-model": model });
  return { fake, service };
}

test("history reads only the chosen automation, excludes other-client results and performs no mutation", async () => {
  const { fake, service } = repository({ automations: [automation()], jobs: [job({ result: { report_ids: [R] } }), job({ id: "unrelated", automation_id: "other" })], reports: [report({ client_id: "another-client" })] });
  const result = await service.getAutomationSupervision(A);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].id, J);
  assert.equal(result.reports.length, 0);
  assert.equal(result.resultUnavailable, true);
  assert.equal(fake.calls.every(call => call[1] === "select"), true);
  assert.equal(await service.getAutomationSupervision("../x"), null);
});

test("missing reports and storage failures stay explicit and never become a fabricated validation", async () => {
  const { service } = repository({ automations: [{ ...automation(), jobs: [job({ result: { report_id: R } })] }], reports: [] });
  assert.equal((await service.listAutomationSupervision())[0].resultUnavailable, true);
  const failing = repository({ automations: [automation()], jobs: [] }, table => table === "jobs");
  await assert.rejects(failing.service.getAutomationSupervision(A), /history read/);
});

function historyPage({ deny = false, simulation = false, record = null, unavailable = false } = {}) {
  let reads = 0;
  const Box = ({ children }) => createElement("section", null, children);
  const page = loadTs("app/(cockpit)/settings/automations/[id]/page.tsx", {
    "next/link": { default: ({ children, href }) => createElement("a", { href }, children) },
    "next/navigation": { notFound: () => { throw new Error("not found"); } },
    "@/lib/require-admin": { requireAdmin: async () => { if (deny) throw new Error("denied"); } },
    "@/components/ui/primitives": { Panel: Box, PageHeading: ({ title, description }) => createElement("header", null, title, description) },
    "@/components/ui/status-badge": { StatusBadge: ({ label }) => createElement("span", null, label) },
    "@/components/ui/module-unavailable": { ModuleUnavailable: () => createElement("p", null, "Module indisponible") },
    "@/lib/simulation/server": { getActiveScenario: async () => simulation },
    "@/lib/core/safe-read": { safeRead: async (_name, read) => ({ data: await read(), unavailable }) },
    "@/lib/automations/supervision": { getAutomationSupervision: async () => { reads++; return record; } },
    "@/lib/automations/supervision-model": model,
    "@/lib/format-date": loadTs("lib/format-date.ts"),
  });
  return { render: () => page.default({ params: Promise.resolve({ id: A }) }), reads: () => reads };
}

test("history page enforces admin and simulation boundaries before all real reads", async () => {
  const denied = historyPage({ deny: true }); await assert.rejects(denied.render(), /denied/); assert.equal(denied.reads(), 0);
  const simulated = historyPage({ simulation: true }); assert.match(renderToStaticMarkup(await simulated.render()), /Quittez la simulation/); assert.equal(simulated.reads(), 0);
});

test("history exposes real job anchors and current result links without mutation controls or raw provider errors", async () => {
  const page = historyPage({ record: { ...automation(), jobs: [job({ result: { report_id: R }, last_error: "secret-provider-token" })], reports: [report()], resultUnavailable: false } });
  const html = renderToStaticMarkup(await page.render());
  assert.match(html, /Validation nécessaire/);
  assert.ok(html.includes(`/reports/${R}`));
  assert.ok(html.includes(`#job-${J}`));
  assert.match(html, /version actuelle 2/);
  assert.doesNotMatch(html, /secret-provider-token|<button|<form/);
});
