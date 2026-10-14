// Diagnostic de production (lot 9) : chaque mécanisme classé dans exactement un état (« configuré »,
// « opérationnel », « désactivé », « en erreur », « inconnu » si illisible), avec sa preuve. Jamais « opérationnel »
// sans passage ou traitement réussi récent ; jamais de valeur de variable.
import test from "node:test";
import assert from "node:assert/strict";
import { load, src, json, uid } from "./helpers/ts-load.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";

const m = load("lib/system/diagnostic-model.ts");
const now = new Date("2026-10-12T08:00:00Z");
const ago = h => new Date(now.getTime() - h * 3600000).toISOString();
const STATES = ["configured", "operational", "disabled", "error", "unknown"];
const SECRET = "sk-ultra-secret-value-123";
const beat = (extra = {}) => ({ startedAt: ago(1), finishedAt: ago(1), ok: true, lastSuccessAt: ago(1), lastFailureAt: null, steps: [{ name: "automations", status: "ok", ms: 40 }], ...extra });

test("labels: exactly the five French states", () => {
  assert.deepEqual(json(m.DIAGNOSTIC_STATUS_LABELS), { configured: "configuré", operational: "opérationnel", disabled: "désactivé", error: "en erreur", unknown: "inconnu" });
});

test("generic mechanism: configured env without a recent success is never operational", () => {
  const base = { id: "x", label: "X", now };
  assert.equal(m.classifyMechanism({ ...base, configured: false }).status, "disabled");
  assert.equal(m.classifyMechanism({ ...base, configured: true, enabled: false }).status, "disabled");
  const idle = m.classifyMechanism({ ...base, configured: true });
  assert.equal(idle.status, "configured"); assert.equal(idle.at, null);
  const ok = m.classifyMechanism({ ...base, configured: true, lastSuccessAt: ago(2) });
  assert.equal(ok.status, "operational"); assert.equal(ok.at, ago(2), "evidence carries its timestamp");
  const old = m.classifyMechanism({ ...base, configured: true, lastSuccessAt: ago(24 * 10) });
  assert.equal(old.status, "configured", "an old success proves nothing now"); assert.match(old.evidence, /trop ancien/);
  assert.equal(m.classifyMechanism({ ...base, configured: true, lastSuccessAt: ago(5), lastFailureAt: ago(1) }).status, "error", "latest failure after the latest success");
  assert.equal(m.classifyMechanism({ ...base, configured: true, lastSuccessAt: ago(1), lastFailureAt: ago(5) }).status, "operational", "recovered");
  const issues = m.classifyMechanism({ ...base, configured: true, lastSuccessAt: ago(1), openIssues: 2, issueLabel: "2 connexions expirées" });
  assert.equal(issues.status, "error"); assert.equal(issues.evidence, "2 connexions expirées");
  assert.equal(m.classifyMechanism({ ...base, configured: false, openIssues: 3 }).status, "disabled", "not configured wins: nothing can run");
});

test("scheduler: only a real recent finished pass is operational", () => {
  assert.equal(m.classifyScheduler(false, beat(), now).status, "disabled");
  assert.equal(m.classifyScheduler(true, "unavailable", now).status, "unknown");
  assert.deepEqual(json(m.classifyScheduler(true, null, now)), { id: "scheduler", label: "Planificateur (cron)", status: "configured", evidence: "Configuré, aucun passage enregistré.", at: null });
  const ok = m.classifyScheduler(true, beat(), now);
  assert.equal(ok.status, "operational"); assert.equal(ok.at, ago(1));
  const failed = m.classifyScheduler(true, beat({ ok: false, lastSuccessAt: ago(5), lastFailureAt: ago(1), steps: [{ name: "whatsapp", status: "failed", ms: 3 }] }), now);
  assert.equal(failed.status, "error"); assert.match(failed.evidence, /Import WhatsApp → Drive/);
  const stale = m.classifyScheduler(true, beat({ startedAt: ago(48), finishedAt: ago(48), lastSuccessAt: ago(48) }), now);
  assert.equal(stale.status, "error"); assert.match(stale.evidence, /Aucun passage depuis 2 j/);
  assert.equal(m.classifyScheduler(true, beat({ startedAt: ago(2), finishedAt: null, lastSuccessAt: ago(3) }), now).status, "error", "started 2 h ago, never finished");
  assert.equal(m.classifyScheduler(true, beat({ startedAt: new Date(now.getTime() - 60000).toISOString(), finishedAt: null, lastSuccessAt: ago(3) }), now).status, "operational", "running now, previous pass ok");
  assert.equal(m.classifyScheduler(true, beat({ startedAt: new Date(now.getTime() - 60000).toISOString(), finishedAt: null, lastSuccessAt: null }), now).status, "configured", "first pass running: no proof yet");
});

test("scheduler steps: ok fresh = operational, failed = error, disabled = disabled, skipped = configured, absent = unknown", () => {
  const h = beat({ steps: [{ name: "automations", status: "ok", ms: 40 }, { name: "whatsapp", status: "failed", ms: 1 }, { name: "push", status: "disabled", ms: 0 }, { name: "search_console", status: "skipped", ms: 0 }] });
  const s = n => m.classifyStep(n, h, now).status;
  assert.deepEqual(["automations", "whatsapp", "push", "search_console", "media_intelligence"].map(s), ["operational", "error", "disabled", "configured", "unknown"]);
  assert.equal(m.classifyStep("automations", beat({ finishedAt: ago(60), startedAt: ago(60) }), now).status, "configured", "ok but stale");
  assert.equal(m.classifyStep("automations", null, now).status, "unknown");
  assert.equal(m.classifyStep("automations", "unavailable", now).status, "unknown");
  assert.equal(m.stepLabel("publication_delivery_send"), "Envoi des publications dues");
});

test("safety switches and the PUBLICATIONS_SCHEDULED_DELIVERY flag (exact value « enabled » only)", () => {
  assert.equal(m.classifySwitch("a", "A", null, "on", "off").status, "unknown");
  assert.equal(m.classifySwitch("a", "A", false, "on", "off").status, "disabled");
  assert.equal(m.classifySwitch("a", "A", true, "on", "off").status, "configured", "a switch on is an authorisation, not a proof");
  const okStep = { status: "operational", at: ago(1) }, idle = { status: "unknown", at: null }, ko = { status: "error", at: ago(1) };
  assert.equal(m.classifyScheduledDelivery("absent", okStep).status, "disabled");
  assert.equal(m.classifyScheduledDelivery("other", okStep).status, "disabled");
  assert.equal(m.classifyScheduledDelivery("enabled", idle).status, "configured");
  assert.equal(m.classifyScheduledDelivery("enabled", okStep).status, "operational");
  assert.equal(m.classifyScheduledDelivery("enabled", ko).status, "error");
});

test("queues: oldest pending beyond 36 h = error (or disabled when sending is manual), otherwise operational", () => {
  const q = extra => m.classifyQueue({ id: "q", label: "Q", now, ...extra });
  assert.equal(q({ oldestAt: null, pending: 0 }).status, "operational");
  assert.equal(q({ oldestAt: ago(2), pending: 3 }).status, "operational");
  const late = q({ oldestAt: ago(40), pending: 3 });
  assert.equal(late.status, "error"); assert.match(late.evidence, /3 en attente · le plus ancien depuis 40 h/);
  assert.equal(q({ oldestAt: ago(40), pending: 3, disabled: "envoi manuel" }).status, "disabled");
  assert.match(q({ oldestAt: ago(40), pending: 200, capped: true }).evidence, /200\+/);
  assert.deepEqual(json(m.statusCounts([{ status: "error" }, { status: "error" }, { status: "configured" }])), { operational: 0, configured: 1, disabled: 0, error: 2, unknown: 0 });
  assert.equal(m.ageLabel(ago(0.5), now), "30 min"); assert.equal(m.ageLabel(null, now), "durée inconnue");
});

// --- Sections lues en base ---
const C = uid("1", 1), AG = uid("9", 1);
const env = { CRON_SECRET: SECRET, OPENAI_API_KEY: SECRET, META_APP_ID: SECRET, META_APP_SECRET: SECRET, PUBLICATIONS_OAUTH_BASE_URL: SECRET, PUBLICATION_CREDENTIALS_KEY: SECRET, PUBLICATION_CREDENTIALS_KEY_ID: SECRET,
  GOOGLE_DRIVE_IMPORT_CLIENT_ID: SECRET, GOOGLE_DRIVE_IMPORT_CLIENT_SECRET: SECRET, GOOGLE_DRIVE_IMPORT_REFRESH_TOKEN: SECRET, PUBLICATIONS_SCHEDULED_DELIVERY: "true" };
const tables = () => ({
  publication_settings: [{ emergency_stop: false, automation_enabled: true, generation_enabled: true, publishing_enabled: true }],
  publication_client_settings: [{ client_id: C, auto_prepare_enabled: true, generation_enabled: true }],
  audit_logs: [{ action: "publications.scheduled_preparation", created_at: ago(3), metadata: { run_id: uid("3", 1), ok: true } }],
  scheduler_heartbeats: [{ name: "scheduler_tick", started_at: ago(1), finished_at: ago(1), ok: true, steps: { automations: { status: "ok", ms: 12 }, publication_delivery_send: { status: "disabled", ms: 0 }, whatsapp: { status: "disabled", ms: 0 } }, last_success_at: ago(1), last_failure_at: ago(30) }],
  agents: [{ id: AG, name: "Agent SEO", enabled: true }, { id: uid("9", 2), name: "Agent éteint", enabled: false }],
  agent_runs: [{ agent_id: AG, status: "failed", started_at: ago(2), completed_at: ago(2), estimated_cost_eur: 0 }, { agent_id: AG, status: "completed", started_at: ago(20), completed_at: ago(20), estimated_cost_eur: 0.5 }],
  publication_agent_projects: [{ project_id: uid("2", 1), enabled: true, rights_confirmed: true }],
  publication_agent_v2_runs: [{ status: "completed", error_code: null, media_status: "attached", media_error_code: null, estimated_cost_eur: 0.02, created_at: ago(5), completed_at: ago(5) },
    { status: "failed", error_code: "generation_failed", media_status: "none", media_error_code: null, estimated_cost_eur: 0.01, created_at: ago(30), completed_at: ago(30) },
    { status: "failed", error_code: "context_unavailable", media_status: "needs_media", media_error_code: "fetch_failed", estimated_cost_eur: 0, created_at: ago(40), completed_at: ago(40) }],
  client_media_ai_usage: [{ estimated_cost_eur: 0.001, created_at: ago(6) }, { estimated_cost_eur: 0.002, created_at: ago(24 * 40) }],
  whatsapp_assets: [{ id: uid("5", 1), origin: "whatsapp", imported_at: ago(4), classification_failed_at: ago(10) }],
  whatsapp_inbox: [{ id: uid("6", 1), status: "imported", client_id: C, received_at: ago(4), error_code: null },
    { id: uid("6", 2), status: "failed", client_id: C, received_at: ago(8), error_code: "oauth_invalid_grant" },
    { id: uid("6", 3), status: "pending", client_id: C, received_at: ago(50) }, { id: uid("6", 4), status: "pending", client_id: null, received_at: ago(90) }],
  client_connections: [{ provider: "meta", status: "expired", expires_at: null, last_checked_at: ago(5), credential_reference: "vault:abc", last_error: "Provider said EAAG" },
    { provider: "google_business_profile", status: "active", expires_at: null, last_checked_at: ago(5) }],
  publication_deliveries: [{ platform: "facebook", status: "blocked", updated_at: ago(2), scheduled_for: ago(3), remote_id: null },
    { platform: "facebook", status: "published", updated_at: ago(24 * 3), scheduled_for: ago(24 * 3), remote_id: "remote" },
    { platform: "instagram", status: "scheduled", updated_at: ago(60), scheduled_for: ago(40), remote_id: null }],
  jobs: [{ status: "queued", scheduled_for: ago(1), trigger: "manual", created_at: ago(1) }],
  publication_jobs: [],
});
function diagnostic(t = tables(), options = {}) {
  const fake = createFakeSupabase(t, options);
  return { fake, mod: load("lib/system/diagnostic.ts", { "@/lib/require-admin": { requireAdmin: async () => ({ userId: "user_admin" }) }, "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client } }) };
}
const byId = group => Object.fromEntries(group.data.items.map(i => [i.id, i]));

test("classified sections: every item in exactly one state, with evidence; read only; no secret", async () => {
  const { mod, fake } = diagnostic();
  const d = json(await mod.getDiagnostic({ now, env }));
  const all = Object.values(d.status).flatMap(g => { assert.equal(g.ok, true); return g.data.items; });
  for (const item of all) { assert.ok(STATES.includes(item.status), item.id); assert.ok(item.evidence.length > 3, item.id); }
  const sch = byId(d.status.scheduler);
  assert.equal(sch.scheduler.status, "operational"); assert.equal(sch["step:automations"].status, "operational"); assert.equal(sch["step:whatsapp"].status, "disabled");
  assert.equal(sch["step:media_intelligence"].status, "unknown", "absent from the last pass");
  const safety = byId(d.status.safety);
  assert.equal(safety["switch:emergency-stop"].status, "configured"); assert.equal(safety["switch:publishing"].status, "configured");
  assert.equal(safety["flag:publications-scheduled-delivery"].status, "disabled", "« true » is not « enabled »");
  assert.match(safety["flag:publications-scheduled-delivery"].evidence, /différente de « enabled »/);
  assert.equal(safety["auto-prepare"].status, "operational"); assert.equal(safety["auto-prepare"].at, ago(3));
  const agents = byId(d.status.agents);
  assert.equal(agents["agent:publications-v2"].status, "operational");
  assert.equal(agents[`agent:${AG}`].status, "error", "latest run failed"); assert.ok(!(`agent:${uid("9", 2)}` in agents), "disabled agents not listed as active");
  const ai = d.status.ai.data;
  assert.equal(ai.items[0].status, "operational", "latest AI success (5 h) after the latest AI failure (10 h)");
  assert.deepEqual(ai.errors7d, { generation: 1, classification: 1 });
  assert.ok(Math.abs(ai.costs30d.total - (0.02 + 0.01 + 0.001 + 0.5)) < 1e-9, "30-day window only");
  const media = byId(d.status.media);
  assert.equal(media["drive:publications"].status, "disabled", "Publications Drive token absent");
  assert.equal(media["drive:import"].status, "operational", "deposit at 4 h after the Drive failure at 8 h");
  assert.equal(media["whatsapp:webhook"].status, "disabled"); assert.equal(media["whatsapp:ingestion"].status, "disabled", "WHATSAPP_INGESTION_ENABLED absent");
  const conn = byId(d.status.connections);
  assert.equal(conn["connections:meta"].status, "error"); assert.match(conn["connections:meta"].evidence, /1 connexion expirée/);
  assert.equal(conn["connections:google_business_profile"].status, "disabled", "GBP OAuth app not configured");
  assert.equal(conn.deliveries.status, "error"); assert.match(conn.deliveries.evidence, /1 diffusion/);
  const delays = byId(d.status.delays);
  assert.equal(delays["delay:whatsapp"].status, "error", "50 h old assigned item; unassigned photos wait for a human");
  assert.equal(delays["delay:jobs"].status, "operational"); assert.equal(delays["delay:publication-jobs"].status, "operational");
  assert.equal(delays["delay:deliveries"].status, "disabled", "overdue but automatic sending disabled");
  assert.ok(!fake.calls.some(c => c[1] !== "select"), "read only");
  assert.doesNotMatch(JSON.stringify(d), new RegExp(`${SECRET}|vault:|Provider said|EAAG|${C}`));
});

test("classified sections: proof required — configured env with no activity stays « configuré »", async () => {
  const t = tables();
  for (const name of ["scheduler_heartbeats", "agent_runs", "publication_agent_v2_runs", "client_media_ai_usage", "whatsapp_assets", "whatsapp_inbox", "audit_logs", "publication_deliveries"]) t[name] = [];
  t.client_connections = [{ provider: "meta", status: "active", expires_at: null, last_checked_at: null }];
  const full = { ...env, PUBLICATIONS_SCHEDULED_DELIVERY: "enabled", WHATSAPP_INGESTION_ENABLED: "true", WHATSAPP_ACCESS_TOKEN: SECRET, GOOGLE_DRIVE_CLIENT_ID: SECRET, GOOGLE_DRIVE_CLIENT_SECRET: SECRET, GOOGLE_DRIVE_REFRESH_TOKEN: SECRET };
  const d = json(await diagnostic(t).mod.getDiagnostic({ now, env: full }));
  assert.equal(byId(d.status.scheduler).scheduler.status, "configured");
  assert.equal(byId(d.status.safety)["flag:publications-scheduled-delivery"].status, "configured", "enabled but no successful send step yet");
  assert.equal(d.status.ai.data.items[0].status, "configured");
  const media = byId(d.status.media);
  assert.equal(media["drive:publications"].status, "configured", "no journal of Publications Drive reads: never operational");
  assert.equal(media["drive:import"].status, "configured"); assert.equal(media["whatsapp:ingestion"].status, "configured");
  assert.equal(byId(d.status.connections)["connections:meta"].status, "configured");
  assert.equal(byId(d.status.agents)["agent:publications-v2"].status, "configured");
});

test("classified sections: each group fails alone; unreadable settings are « inconnu », never on", async () => {
  const { mod } = diagnostic(tables(), { failOn: table => table === "client_media_ai_usage" || table === "agents" });
  const d = json(await mod.getDiagnostic({ now, env }));
  assert.equal(d.status.ai.ok, false); assert.equal(d.status.agents.ok, false);
  for (const name of ["scheduler", "safety", "media", "connections", "delays"]) assert.equal(d.status[name].ok, true, name);
  const t = tables(); t.publication_settings = [];
  const s = byId(json(await diagnostic(t).mod.getDiagnostic({ now, env })).status.safety);
  for (const id of ["switch:emergency-stop", "switch:automation", "switch:generation", "switch:publishing"]) assert.equal(s[id].status, "unknown", id);
  assert.equal(s["auto-prepare"].status, "disabled", "considered stopped");
  assert.deepEqual(Object.keys(mod.STATUS_GROUP_FALLBACK).sort(), ["agents", "ai", "connections", "delays", "media", "safety"]);
});

test("diagnostic page: classified states first, unknown fallback, design tokens only, never an env value", () => {
  const page = src("app/(cockpit)/settings/diagnostic/page.tsx");
  assert.match(page, /data-diagnostic-states="true"/); assert.match(page, /unknownItems\(fallback\)/);
  for (const g of ["st.scheduler", "st.safety", "st.agents", "st.ai", "st.media", "st.connections", "st.delays"]) assert.ok(page.includes(`section={${g}}`), g);
  assert.doesNotMatch(page, /#[0-9a-fA-F]{3,6}\b|rgb\(|(?:text|bg|border)-(?:red|amber|emerald|green|sky|blue)-\d/);
  assert.doesNotMatch(page, /process\.env\.[A-Z]/, "env passed whole to the module, never read value by value");
  const model = src("lib/system/diagnostic-model.ts");
  assert.doesNotMatch(model, /process\.env|fetch\(/);
});
