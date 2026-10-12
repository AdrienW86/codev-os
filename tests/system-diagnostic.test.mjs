// Diagnostic technique (/settings/diagnostic) : une section par mécanisme, chacune échoue seule, lecture seule,
// jamais de valeur de variable, de jeton, de texte fournisseur ni d'identifiant brut.
import test from "node:test";
import assert from "node:assert/strict";
import { load, src, json, uid } from "./helpers/ts-load.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";

const C = uid("1", 1), now = new Date("2026-10-12T08:00:00Z");
const ago = h => new Date(now.getTime() - h * 3600000).toISOString();
const SECRET = "sk-ultra-secret-value-123", TOKEN = "EAAG-token-provider";
const env = { CRON_SECRET: SECRET, OPENAI_API_KEY: SECRET, SUPABASE_SECRET_KEY: SECRET, WHATSAPP_ACCESS_TOKEN: TOKEN, PUBLICATIONS_SCHEDULED_DELIVERY: "true", WHATSAPP_INGESTION_ENABLED: "true" };
const tables = () => ({
  publication_settings: [{ emergency_stop: false, automation_enabled: true, generation_enabled: true, publishing_enabled: false }],
  jobs: [{ id: uid("2", 1), trigger: "schedule", status: "succeeded", created_at: ago(1) }, { id: uid("2", 2), trigger: "manual", status: "running", lease_expires_at: ago(2), created_at: ago(3) }],
  clients: [{ id: C, name: "Couverture Martin" }],
  publication_agent_v2_runs: [
    { id: uid("3", 1), client_id: C, status: "failed", error_code: "generation_failed", media_status: "none", estimated_cost_eur: 0.004, created_at: ago(2), completed_at: ago(2) },
    { id: uid("3", 2), client_id: C, status: "processing", error_code: null, media_status: "none", estimated_cost_eur: 0, created_at: ago(30), completed_at: null, lease_until: ago(29) },
    { id: uid("3", 3), client_id: C, status: "failed", error_code: "lease_expired", media_status: "none", estimated_cost_eur: 0, created_at: ago(24 * 9), completed_at: ago(24 * 9) }],
  audit_logs: [{ action: "publications.scheduled_preparation", created_at: ago(1), metadata: { run_id: uid("3", 1), ok: true, submitted: [uid("4", 1)], media_missing: true, delegated_actor: "user_admin" } },
    { action: "other", created_at: ago(1), metadata: {} }],
  publications: [{ id: uid("4", 1), status: "pending_review", archived_at: null }, { id: uid("4", 2), status: "pending_review", archived_at: ago(1) }, { id: uid("4", 3), status: "approved", archived_at: null }],
  whatsapp_inbox: [{ id: uid("5", 1), status: "failed", error_code: "retry_exhausted", received_at: ago(5), attempts: 5 }, { id: uid("5", 2), status: "failed", error_code: "media_too_large", received_at: ago(6), attempts: 1 },
    { id: uid("5", 3), status: "processing", lease_until: ago(1), received_at: ago(2), attempts: 1 }],
  client_connections: [{ id: uid("6", 1), client_id: C, provider: "meta", status: "expired", expires_at: null, last_error: `Provider said ${TOKEN}`, credential_reference: "vault:abc" },
    { id: uid("6", 2), client_id: C, provider: "google_business_profile", status: "active", expires_at: null, last_error: null }],
  publication_events: [{ action: "publication.oauth_failed", client_id: C, created_at: ago(3), metadata: { provider: "meta", code: "exchange_revoked", connection_id: uid("6", 1) } }],
  publication_deliveries: [{ id: uid("7", 1), client_id: C, platform: "facebook", status: "failed", blocked_reason: null, last_error_class: "auth", last_error_code: "token_expired", updated_at: ago(1) },
    { id: uid("7", 2), client_id: C, platform: "instagram", status: "blocked", blocked_reason: "account_unavailable", last_error_class: null, last_error_code: null, updated_at: ago(2) },
    { id: uid("7", 3), client_id: C, platform: "facebook", status: "published", updated_at: ago(2) }],
  publication_jobs: [{ id: uid("8", 1), status: "processing", lease_expires_at: ago(1) }, { id: uid("8", 2), status: "processing", lease_expires_at: new Date(now.getTime() + 60000).toISOString() }],
});
function diagnostic(t = tables(), options = {}) {
  const fake = createFakeSupabase(t, options);
  const mod = load("lib/system/diagnostic.ts", { "@/lib/require-admin": { requireAdmin: async () => ({ userId: "user_admin" }) }, "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client } });
  return { fake, mod };
}

test("diagnostic: every section read, safe labels, read only", async () => {
  const { mod, fake } = diagnostic();
  const d = json(await mod.getDiagnostic({ now, env }));
  assert.deepEqual(d.scheduler.data.switches, { emergencyStop: false, automation: true, generation: true, publishing: false });
  assert.equal(d.scheduler.data.scheduledDelivery, false, "only the exact value « enabled » enables the delivery");
  assert.equal(d.scheduler.data.cronConfigured, true); assert.equal(d.scheduler.data.stale, false);
  assert.equal(d.scheduler.data.lastScheduledJob.status, "Réussi"); assert.equal(d.scheduler.data.heartbeat, null, "heartbeat not plugged yet (lot #39)");
  assert.equal(d.agent.data.runs[0].client, "Couverture Martin"); assert.equal(d.agent.data.runs[0].error, "Génération en échec");
  assert.deepEqual(d.agent.data.failures7d, { value: 1, capped: false });
  assert.match(d.agent.data.preparations[0].outcome, /1 soumise à validation · photo manquante/); assert.equal(d.agent.data.preparations.length, 1);
  assert.deepEqual(d.review.data.pending, { value: 1, capped: false });
  assert.deepEqual([d.whatsapp.data.failed.value, d.whatsapp.data.exhausted.value, d.whatsapp.data.stuck.value], [2, 1, 1]);
  assert.deepEqual(d.whatsapp.data.recent.map(r => r.label), ["Abandon après 5 tentatives", "Média trop volumineux"]);
  assert.deepEqual(d.connections.data.connections, [{ client: "Couverture Martin", provider: "Meta", state: "Expiré" }]);
  assert.equal(d.connections.data.oauthFailures[0].reason, "Échange du code d’autorisation en échec");
  assert.deepEqual(d.connections.data.deliveries.map(x => [x.platform, x.status, x.reason]), [["Facebook", "Échec", "Autorisation refusée ou révoquée (token_expired)"], ["Instagram", "Bloquée", d.connections.data.deliveries[1].reason]]);
  assert.ok(d.connections.data.deliveries[1].reason && d.connections.data.deliveries[1].reason !== "account_unavailable", "blocked reason labelled");
  assert.deepEqual(d.connections.data.deliveryCounts, { failed: 1, blocked: 1 });
  assert.deepEqual(json(d.stuck.data), { jobs: { value: 1, capped: false }, publicationJobs: { value: 1, capped: false }, agentRuns: { value: 1, capped: false }, whatsapp: { value: 1, capped: false } });
  assert.ok(!fake.calls.some(c => c[0] === "rpc" || c[1] !== "select"), "read only");
  const text = JSON.stringify(d);
  assert.doesNotMatch(text, new RegExp(`${SECRET}|${TOKEN}|vault:|Provider said|${C}|${uid("3", 1)}|${uid("6", 1)}`), "no secret, provider text or raw id");
});

test("diagnostic: environment shows presence only, never values or lengths; flags on/off", async () => {
  const { mod } = diagnostic();
  const e = mod.envSection(env);
  const byLabel = Object.fromEntries(e.modules.map(m => [m.label, m.configured]));
  assert.equal(byLabel["Planificateur (cron)"], true); assert.equal(byLabel["OpenAI"], true); assert.equal(byLabel["WhatsApp (téléchargement des médias)"], true);
  assert.equal(byLabel["Google Drive (import des photos clients)"], false); assert.equal(byLabel["WhatsApp (réception)"], false);
  for (const label of ["Supabase (données)", "Clerk (authentification)", "Meta (Facebook & Instagram)", "Google Business Profile", "Trousseau des identifiants de publication", "Google Drive", "Notifications push"]) assert.ok(label in byLabel, label);
  const flags = Object.fromEntries(e.flags.map(f => [f.variable, f.enabled]));
  assert.deepEqual(flags, { PUBLICATIONS_SCHEDULED_DELIVERY: false, WHATSAPP_INGESTION_ENABLED: true, PUSH_SENDING_ENABLED: false, EMAIL_SENDING_ENABLED: false });
  assert.equal(mod.envSection({ PUBLICATIONS_SCHEDULED_DELIVERY: "enabled" }).flags[0].enabled, true);
  const text = JSON.stringify(e);
  assert.doesNotMatch(text, new RegExp(`${SECRET}|${TOKEN}|${SECRET.length}\\b`));
  assert.ok(e.modules.every(m => Object.keys(m).sort().join() === "configured,label"), "only label + boolean");
  // Même règle que la diffusion planifiée réelle.
  const registry = src("lib/publications/delivery/registry.ts");
  assert.match(registry, /env\[SCHEDULED_DELIVERY_FLAG\]==='enabled'/);
  assert.match(src("lib/system/providers.ts"), /variable: "PUBLICATIONS_SCHEDULED_DELIVERY", enabledValue: "enabled"/);
});

test("diagnostic: each section fails soft on its own", async () => {
  const { mod } = diagnostic(tables(), { failOn: table => table === "whatsapp_inbox" || table === "publication_agent_v2_runs" });
  const d = json(await mod.getDiagnostic({ now, env }));
  assert.equal(d.whatsapp.ok, false); assert.equal(d.agent.ok, false); assert.equal(d.stuck.ok, false);
  for (const name of ["scheduler", "review", "connections", "env"]) assert.equal(d[name].ok, true, name);
  const broken = load("lib/system/diagnostic.ts", { "@/lib/require-admin": { requireAdmin: async () => ({ userId: "user_admin" }) }, "@/lib/supabase/server": { getSupabaseServerClient: () => { throw Error("Configuration du stockage indisponible."); } } });
  const none = json(await broken.getDiagnostic({ now, env }));
  assert.deepEqual(Object.entries(none).filter(([, s]) => s.ok).map(([k]) => k), ["env"], "database down: everything but the environment unavailable");
});

test("diagnostic: heartbeat hook (lot #39) normalised and isolated", async () => {
  const { mod } = diagnostic();
  const beat = { started_at: ago(1), finished_at: ago(1), ok: false, steps: { publications: { ok: true }, whatsapp: { ok: false, error: TOKEN }, "bad name!": { ok: false } }, last_success_at: ago(2), last_failure_at: ago(1) };
  const d = json(await mod.getDiagnostic({ now, env, heartbeat: async () => beat }));
  assert.deepEqual(d.scheduler.data.heartbeat.failedSteps, ["whatsapp"]); assert.equal(d.scheduler.data.heartbeat.ok, false);
  assert.doesNotMatch(JSON.stringify(d.scheduler), new RegExp(TOKEN));
  assert.deepEqual(json(mod.heartbeatView({ ...beat, steps: [{ name: "drive", ok: false }, { name: "push", ok: true }] })).failedSteps, ["drive"]);
  const failing = json(await mod.getDiagnostic({ now, env, heartbeat: async () => { throw Error("relation does not exist"); } }));
  assert.equal(failing.scheduler.ok, true); assert.equal(failing.scheduler.data.heartbeat, "unavailable");
});

test("diagnostic page: admin only, linked from Observabilité and supervision, tokens only, env never in lib/publications", () => {
  const page = src("app/(cockpit)/settings/diagnostic/page.tsx");
  assert.match(page, /await requireAdmin\(\)/); assert.match(page, /getDiagnostic\(\{ env: process\.env \}\)/);
  assert.match(page, /href="\/publications\/review"/); assert.doesNotMatch(page, /#[0-9a-fA-F]{3,6}\b|rgb\(|(?:text|bg|border)-(?:red|amber|emerald|green|sky|blue)-\d/);
  assert.match(src("app/(cockpit)/settings/page.tsx"), /href="\/settings\/diagnostic"/);
  assert.match(src("app/(cockpit)/publications/supervision/page.tsx"), /href="\/settings\/diagnostic"/);
  const lib = src("lib/system/diagnostic.ts");
  assert.match(lib, /^import "server-only";/); assert.doesNotMatch(lib, /credential_reference|access_token|refresh_token|\.select\("[^"]*last_error_message/);
});
