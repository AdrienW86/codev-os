import assert from "node:assert/strict";
import { test } from "node:test";
import * as zod from "zod";
import { loadRegistry, loadTs } from "./helpers/load-ts.mjs";

const { registry } = loadRegistry();
const recurrence = loadTs("lib/scheduler/recurrence.ts", { zod });
const automations = loadTs("lib/automations/definitions.ts", { zod, "@/lib/agents/registry": registry, "@/lib/scheduler/recurrence": recurrence });
const build = loadTs("lib/reports/build.ts");
const actions = loadTs("lib/actions/registry.ts", { zod });
const modes = loadTs("lib/actions/modes.ts");
const ads = loadTs("lib/ads/anomalies.ts");
const seo = loadTs("lib/seo/analyze.ts");
const monitoring = loadTs("lib/monitoring/evaluate.ts");
const providers = loadTs("lib/system/providers.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));

test("automation validation: Europe/Paris default, client required for client-scoped runs, strict config", () => {
  const now = new Date("2026-10-09T10:00:00Z");
  const ok = automations.validateAutomation({ name: "Rapports", runType: "report.generate", clientId: null, frequency: "weekly", schedule: { time: "08:00", weekdays: [1] }, config: { kind: "weekly" } }, now);
  assert.equal(ok.ok, true);
  assert.equal(ok.value.timezone, "Europe/Paris");
  assert.equal(ok.value.nextRunAt, "2026-10-12T06:00:00.000Z", "Monday 08:00 Paris (CEST)");
  assert.equal(automations.validateAutomation({ name: "SEO", runType: "seo.analyze", clientId: null, frequency: "daily", schedule: { time: "07:00" } }, now).ok, false);
  assert.equal(automations.validateAutomation({ name: "X", runType: "report.generate", clientId: null, frequency: "daily", schedule: { time: "07:00" }, config: { kind: "weekly", shell: "rm" } }, now).ok, false, "unknown config key refused");
  assert.equal(automations.validateAutomation({ name: "X", runType: "shell.exec", clientId: null, frequency: "daily", schedule: { time: "07:00" } }, now).ok, false);
  assert.equal(automations.validateAutomation({ name: "X", runType: "news.fetch", clientId: null, frequency: "daily", timezone: "Mars/Olympus", schedule: { time: "07:00" } }, now).ok, false);
  assert.equal(automations.validateAutomation({ name: "X", runType: "news.fetch", clientId: null, frequency: "daily", schedule: { time: "25:00" } }, now).ok, false);
  assert.equal(automations.validateAutomation({ name: "X", runType: "news.fetch", clientId: null, frequency: "daily", schedule: { time: "07:00" }, injected: true }, now).ok, false, "extra fields refused");
});

test("automation form: local one-off date is interpreted in the automation timezone; past dates refused", () => {
  const form = (entries) => ({ get: (name) => entries[name] ?? null, getAll: (name) => [].concat(entries[name] ?? []) });
  const input = automations.automationFromForm(form({ name: "Une fois", run_type: "news.fetch", frequency: "once", run_at: "2026-12-01T09:30" }));
  const result = automations.validateAutomation(input, new Date("2026-10-09T10:00:00Z"));
  assert.equal(result.ok, true);
  assert.equal(result.value.nextRunAt, "2026-12-01T08:30:00.000Z", "09:30 Paris in winter = 08:30Z");
  const past = automations.validateAutomation(automations.automationFromForm(form({ name: "Passé", run_type: "news.fetch", frequency: "once", run_at: "2026-01-01T09:30" })), new Date("2026-10-09T10:00:00Z"));
  assert.equal(past.ok, false);
  const weekly = automations.automationFromForm(form({ name: "Hebdo", run_type: "report.generate", frequency: "weekly", time: "08:00", weekdays: ["1", "5"], kind: "monthly" }));
  assert.deepEqual(plain(weekly.schedule), { time: "08:00", weekdays: [1, 5] });
  assert.deepEqual(plain(weekly.config), { kind: "monthly" });
});

test("recommended automations are all valid and never exceed V1 autonomy", () => {
  for (const preset of automations.automationPresets) {
    const result = automations.validateAutomation({ name: preset.name, runType: preset.runType, clientId: null, frequency: preset.frequency, schedule: preset.schedule, config: preset.config }, new Date("2026-10-09T10:00:00Z"));
    assert.equal(result.ok, true, preset.id);
    assert.equal(registry.runTypes[preset.runType].scope, "global", "presets need no client");
  }
});

test("report builder: periods, internal vs client versions, empty period", () => {
  assert.deepEqual(plain(build.previousPeriod("weekly", "2026-10-12")), { start: "2026-10-05", end: "2026-10-11" });
  assert.deepEqual(plain(build.previousPeriod("weekly", "2026-10-11")), { start: "2026-09-28", end: "2026-10-04" });
  assert.deepEqual(plain(build.previousPeriod("monthly", "2026-03-15")), { start: "2026-02-01", end: "2026-02-28" });
  const period = { start: "2026-10-05", end: "2026-10-11" };
  const input = {
    client: { id: "c", name: "Boulangerie Martin" }, period, projects: [{ name: "Site", status: "En cours", progress: 60 }],
    tasks: [
      { title: "Refonte page contact", status: "Terminé", priority: "Moyenne", due_date: null, completed_at: "2026-10-07T10:00:00Z", created_at: "2026-10-01T00:00:00Z" },
      { title: "Corriger formulaire", status: "À faire", priority: "Haute", due_date: "2026-10-01", completed_at: null, created_at: "2026-09-20T00:00:00Z" },
    ],
    publications: [{ subject: "Nouveau pain", status: "published", updated_at: "2026-10-06T00:00:00Z", target_date: "2026-10-06" }],
    recommendations: [], actions: [], incidents: [{ title: "Site lent", status: "open", severity: "medium", detected_at: "2026-10-08T00:00:00Z", resolved_at: null }],
    runs: [{ agent: "Agent Monitoring", status: "failed", started_at: "2026-10-08T00:00:00Z" }],
    siteChecks: [{ ok: true, response_ms: 300, checked_at: "2026-10-06T00:00:00Z" }, { ok: false, response_ms: null, checked_at: "2026-10-07T00:00:00Z" }],
    metrics: [{ provider: "search-console", metric_key: "x", data: { clicks: 120, impressions: 4000, position: 12.34 } }],
  };
  const report = build.buildReport("weekly", input, "2026-10-12");
  assert.match(report.title, /Rapport hebdomadaire — Boulangerie Martin/);
  const internal = report.internal.sections.map((section) => section.title);
  const client = report.client.sections.map((section) => section.title);
  assert.ok(internal.includes("En retard") && internal.includes("Analyses des agents") && internal.includes("Incidents"));
  assert.ok(!client.includes("En retard") && !client.includes("Analyses des agents") && !client.includes("Incidents"), "client version hides internal details");
  assert.match(JSON.stringify(report.client), /Search Console : 120 clics/);
  assert.match(JSON.stringify(report.client), /Disponibilité du site : 50 %/);
  assert.doesNotMatch(JSON.stringify(report.client), /échec|Corriger formulaire/);
  const empty = build.buildReport("monthly", { ...input, projects: [], tasks: [], publications: [], incidents: [], runs: [], siteChecks: [], metrics: [] }, "2026-11-02");
  assert.equal(empty.internal.empty, true);
  assert.match(empty.client.summary, /Pas d’activité notable/);
});

test("action registry: strict payloads, unknown types refused, execution modes", () => {
  assert.equal(actions.parseActionParameters("shell.exec", {}), null);
  assert.equal(actions.parseActionParameters("seo.site_change", { page: "/", change: "Titre" , extra: 1 }), null);
  assert.ok(actions.parseActionParameters("seo.site_change", { page: "/contact", change: "Ajouter un H1" }));
  assert.equal(actions.parseActionParameters("report.send", { report_id: "x", recipient: "a@b.fr", version: 1 }), null);
  assert.equal(actions.describeAction("ads.optimization", { campaign: "Marque", change: "Baisser le CPC max" }), "Campagne « Marque » : Baisser le CPC max");
  assert.equal(actions.describeAction("nope", {}), "Action non reconnue.");
  for (const [id, definition] of Object.entries(actions.actionTypes)) assert.equal(modes.executionModeOf(id), definition.executionMode, `${id}: UI mode matches registry`);
  assert.equal(modes.executionModeOf("unknown"), "manual", "unknown types never run internally");
});

test("Google Ads anomalies: spend without conversion, CPA spike, cost spike; paused campaigns ignored", () => {
  const c = (id, cost, conversions, status = "ENABLED") => ({ id, name: `C${id}`, status, impressions: 1000, clicks: 50, cost, conversions, budget: null });
  const anomalies = ads.detectAdsAnomalies([c("1", 250, 0), c("2", 300, 4), c("3", 200, 2), c("4", 500, 0, "PAUSED"), c("5", 40, 0)], [c("2", 100, 4), c("3", 60, 2)]);
  assert.deepEqual(plain(anomalies.map((item) => [item.campaignId, item.rule, item.severity])), [["1", "spend_without_conversions", "high"], ["2", "cpa_spike", "high"], ["3", "cost_spike", "medium"]]);
  assert.deepEqual(plain(ads.summarize([c("1", 10, 2), c("2", 20.555, 1)])), { impressions: 2000, clicks: 100, cost: 30.56, conversions: 3, cpa: 10.19, campaigns: 2 });
});

test("SEO analysis: drops, disappeared pages, emerging queries, low CTR", () => {
  const row = (key, clicks, impressions = 1000, position = 3, ctr = clicks / impressions) => ({ keys: [key], clicks, impressions, ctr, position });
  const findings = seo.analyzeSeo([row("/a", 10), row("/b", 40)], [row("/a", 40), row("/b", 20), row("/gone", 30)], [row("pain bio", 5, 300, 12), row("boulangerie", 5, 800, 2)], []);
  const kinds = findings.map((item) => `${item.kind}:${item.key}`);
  assert.deepEqual(plain(kinds), ["page_drop:/a", "page_growth:/b", "page_drop:/gone", "emerging_query:pain bio", "low_ctr:boulangerie"]);
  assert.equal(findings[0].severity, "high");
  assert.equal(seo.totals([]).position, null);
});

test("monitoring verdicts and URL normalisation", () => {
  assert.equal(monitoring.siteUrl("exemple.fr"), "https://exemple.fr/");
  assert.equal(monitoring.siteUrl("javascript:alert(1)"), null);
  assert.equal(monitoring.siteUrl("http://exemple.fr/page"), "http://exemple.fr/page");
  assert.equal(monitoring.siteUrl("ftp://exemple.fr"), null);
  assert.equal(monitoring.siteUrl(""), null);
  assert.equal(monitoring.evaluateCheck({ ok: true, status: 200, ms: 300, errorKind: null }).state, "up");
  assert.equal(monitoring.evaluateCheck({ ok: true, status: 200, ms: 6000, errorKind: null }).state, "slow");
  assert.equal(monitoring.evaluateCheck({ ok: false, status: 503, ms: 100, errorKind: null }).state, "down");
  assert.equal(monitoring.evaluateCheck({ ok: false, status: null, ms: null, errorKind: "timeout" }).label, "Pas de réponse (délai dépassé)");
  assert.equal(monitoring.evaluateCheck({ ok: false, status: null, ms: null, errorKind: "blocked" }).state, "blocked");
});

test("system status: ✓ configured, ○ nothing set, ! partial or last sync error — names only, never values", () => {
  const ads = providers.providerRequirements.find((item) => item.id === "google-ads");
  assert.equal(providers.connectionState(ads, {}), "todo");
  assert.equal(providers.connectionState(ads, { GOOGLE_ADS_CLIENT_ID: "x" }), "attention");
  const full = { GOOGLE_ADS_CLIENT_ID: "a", GOOGLE_ADS_CLIENT_SECRET: "b", GOOGLE_ADS_REFRESH_TOKEN: "c", GOOGLE_ADS_DEVELOPER_TOKEN: "d" };
  assert.equal(providers.connectionState(ads, full), "ok");
  assert.equal(providers.connectionState(ads, full, "Jeton expiré"), "attention");
  const statuses = JSON.stringify(providers.allProviderStatuses({ ...full, OPENAI_API_KEY: "sk-very-secret-value" }));
  assert.doesNotMatch(statuses, /sk-very-secret-value|"a"|"b"/);
  assert.ok(!providers.allProviderStatuses({}).some((item) => item.id === "internal"));
});

const agenda = loadTs("lib/agenda/occurrences.ts", { zod, "@/lib/scheduler/recurrence": recurrence });

test("agenda recurrence keeps the Paris wall-clock time across the DST change; until and cancelled respected", () => {
  const item = { id: "w", starts_at: "2026-10-19T07:00:00.000Z", timezone: "Europe/Paris", recurrence: "weekly", recurrence_until: "2026-11-02", status: "planned", duration_minutes: 30 };
  const list = agenda.expandOccurrences([item, { ...item, id: "c", status: "cancelled" }], new Date("2026-10-01T00:00:00Z"), new Date("2026-12-01T00:00:00Z"));
  assert.deepEqual(plain(list.map((occurrence) => occurrence.startsAt.toISOString())), ["2026-10-19T07:00:00.000Z", "2026-10-26T08:00:00.000Z", "2026-11-02T08:00:00.000Z"], "09:00 Paris before and after 25 Oct");
  assert.equal(list[0].endsAt.toISOString(), "2026-10-19T07:30:00.000Z");
  const monthly = agenda.expandOccurrences([{ ...item, id: "m", starts_at: "2026-01-31T09:00:00.000Z", recurrence: "monthly", recurrence_until: null }], new Date("2026-02-01T00:00:00Z"), new Date("2026-04-01T00:00:00Z"));
  assert.deepEqual(plain(monthly.map((occurrence) => occurrence.startsAt.toISOString().slice(0, 10))), ["2026-02-28", "2026-03-31"], "month end clamps");
  const once = agenda.expandOccurrences([{ ...item, id: "o", recurrence: "none" }], new Date("2026-10-20T00:00:00Z"), new Date("2026-10-27T00:00:00Z"));
  assert.equal(once.length, 0);
  assert.equal(agenda.mondayOf("2026-10-11"), "2026-10-05");
  assert.equal(agenda.localDay(new Date("2026-10-09T22:30:00Z")), "2026-10-10", "Paris day, not UTC day");
});

test("agenda shows planned automation runs and validates input server-side", () => {
  const runs = agenda.automationRuns([{ id: "a", name: "Rapports", status: "active", frequency: "weekly", schedule: { time: "08:00", weekdays: [1] }, timezone: "Europe/Paris", next_run_at: "2026-10-12T06:00:00.000Z" }, { id: "p", name: "Pause", status: "paused", frequency: "daily", schedule: { time: "08:00" }, timezone: "Europe/Paris", next_run_at: "2026-10-12T06:00:00.000Z" }], new Date("2026-10-12T00:00:00Z"), new Date("2026-10-27T00:00:00Z"));
  assert.deepEqual(plain(runs.map((run) => run.at.toISOString())), ["2026-10-12T06:00:00.000Z", "2026-10-19T06:00:00.000Z", "2026-10-26T07:00:00.000Z"]);
  const ok = agenda.validateAgendaInput({ kind: "meeting", title: "Point", clientId: null, startsLocal: "2026-12-01T09:30" });
  assert.equal(ok.value.startsAt, "2026-12-01T08:30:00.000Z");
  assert.equal(agenda.validateAgendaInput({ kind: "meeting", title: "Point", clientId: null, startsLocal: "2026-02-30T09:30" }).ok, false, "impossible date");
  assert.equal(agenda.validateAgendaInput({ kind: "automation", title: "x", clientId: null, startsLocal: "2026-12-01T09:30" }).ok, false, "automation entries are derived, never typed");
  assert.equal(agenda.validateAgendaInput({ kind: "meeting", title: "x", clientId: null, startsLocal: "2026-12-01T09:30", recurrence: "weekly", recurrenceUntil: "2026-11-01" }).ok, false);
  assert.equal(agenda.validateAgendaInput({ kind: "meeting", title: "x", clientId: null, startsLocal: "2026-12-01T09:30", sql: "drop" }).ok, false);
  assert.equal(agenda.validateAgendaInput({ kind: "meeting", title: "", clientId: null, startsLocal: "2026-12-01T09:30" }).ok, false);
});
