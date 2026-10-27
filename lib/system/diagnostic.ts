import "server-only";
// Diagnostic technique (admin) : planificateur, Agent Publications, validations, import WhatsApp, connexions et
// diffusions, tâches bloquées, variables d'environnement. Lecture seule, une fonction par section : chacune échoue
// seule (« indisponible ») sans empêcher les autres. Jamais de jeton, de valeur de variable, de texte fournisseur
// ni d'identifiant brut : uniquement des états, des libellés français, des dates et des noms de clients.
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSchedulerHeartbeat, SCHEDULER_HEARTBEAT, schedulerSteps } from "@/lib/scheduler/heartbeat";
import { classifyMechanism, classifyQueue, classifyScheduledDelivery, classifyScheduler, classifyStep, classifySwitch, latest, type DiagnosticItem, type HeartbeatInput, type StepStatus } from "@/lib/system/diagnostic-model";
import { featureFlags, isFlagEnabled, isProviderConfigured, providerRequirements, providerStatus, type Env } from "@/lib/system/providers";
import { inboxErrorLabel } from "@/lib/whatsapp/drive-errors";
import { blockedReasonLabel, DELIVERY_STATUS_LABELS, ERROR_CLASS_LABELS, type DeliveryErrorClass, type DeliveryStatus } from "@/lib/publications/delivery/model";
import { MEDIA_STATE_LABELS } from "@/lib/publications/agent-v2/media-view";
import { PROVIDER_LABELS, CONNECTION_STATUS_LABELS } from "@/lib/publications/connections/model";
import { platformLabels } from "@/lib/publications/editor";
import type { PublicationPlatform } from "@/lib/publications/types";

// Client minimal (sous-ensemble du client Supabase) : les tables lues ici ne sont pas toutes typées, et les tests
// injectent un faux client.
type Query = PromiseLike<{ data: unknown; error: unknown }> & {
  eq(column: string, value: unknown): Query; neq(column: string, value: unknown): Query; in(column: string, values: readonly unknown[]): Query;
  is(column: string, value: null): Query; not(column: string, operator: string, value: unknown): Query;
  lt(column: string, value: string): Query; lte(column: string, value: string): Query; gte(column: string, value: string): Query;
  order(column: string, options?: { ascending?: boolean }): Query; limit(count: number): Query; maybeSingle(): Query;
};
export type DiagnosticDb = { from(table: string): { select(columns: string): Query } };

export type Section<T> = { ok: true; data: T } | { ok: false };
const DAY = 86_400_000;
/** Plafond de lecture par liste : au-delà, le compteur affiche « N+ ». */
export const DIAGNOSTIC_LIMIT = 200;
export type Count = { value: number; capped: boolean };
const count = (rows: unknown[]): Count => ({ value: rows.length, capped: rows.length >= DIAGNOSTIC_LIMIT });

async function rows<T>(query: Query): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw Error("diagnostic read");
  return (data ?? []) as T[];
}
async function soft<T>(name: string, read: () => Promise<T>): Promise<Section<T>> {
  try { return { ok: true, data: await read() }; } catch { console.error("[diagnostic] Section indisponible.", { section: name }); return { ok: false }; }
}
async function clientNames(db: DiagnosticDb, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === "string"))];
  if (!unique.length) return new Map();
  const list = await rows<{ id: string; name: string }>(db.from("clients").select("id,name").in("id", unique));
  return new Map(list.map((c) => [c.id, c.name]));
}
const safeCode = (value: unknown) => (typeof value === "string" && /^[a-z0-9_.-]{1,80}$/.test(value) ? value : null);

// --- 1. Planificateur ---
/** Battement du planificateur (table public.scheduler_heartbeats, ligne SCHEDULER_HEARTBEAT, écrite à chaque passage par le lot #39). */
export type SchedulerHeartbeatRow = { started_at: string | null; finished_at: string | null; ok: boolean | null; steps: unknown; last_success_at: string | null; last_failure_at: string | null };
export type HeartbeatLoader = (db: DiagnosticDb) => Promise<SchedulerHeartbeatRow | null>;
export const loadSchedulerHeartbeat: HeartbeatLoader = async (db) => {
  const beat = await getSchedulerHeartbeat(SCHEDULER_HEARTBEAT, db as unknown as Parameters<typeof getSchedulerHeartbeat>[1]);
  return beat && { started_at: beat.startedAt, finished_at: beat.finishedAt, ok: beat.ok, steps: beat.steps, last_success_at: beat.lastSuccessAt, last_failure_at: beat.lastFailureAt };
};
export type HeartbeatView = HeartbeatInput & { ok: boolean | null; failedSteps: string[] };
const STEP_STATUSES = new Set<StepStatus>(["ok", "failed", "skipped", "disabled"]);
/** Étapes : uniquement des noms courts, un état fermé et une durée (objet {étape: {status, ms}} ou liste [{name, ok}]), jamais leur contenu. */
export function heartbeatView(row: SchedulerHeartbeatRow): HeartbeatView {
  const steps: HeartbeatView["steps"] = [];
  const add = (name: unknown, value: unknown) => {
    if (typeof name !== "string" || !/^[a-zA-Z0-9_-]{1,40}$/.test(name) || !value || typeof value !== "object") return;
    const v = value as { ok?: unknown; status?: unknown; ms?: unknown };
    const status: StepStatus | null = typeof v.status === "string" && STEP_STATUSES.has(v.status as StepStatus) ? v.status as StepStatus : v.ok === false ? "failed" : v.ok === true ? "ok" : null;
    if (status) steps.push({ name, status, ms: typeof v.ms === "number" && Number.isFinite(v.ms) ? Math.max(0, Math.round(v.ms)) : 0 });
  };
  if (Array.isArray(row.steps)) for (const step of row.steps.slice(0, 30)) add((step as { name?: unknown } | null)?.name, step);
  else if (row.steps && typeof row.steps === "object") for (const [name, value] of Object.entries(row.steps).slice(0, 30)) add(name, value);
  return { startedAt: row.started_at, finishedAt: row.finished_at, ok: row.ok, steps, failedSteps: steps.filter((s) => s.status === "failed").map((s) => s.name), lastSuccessAt: row.last_success_at, lastFailureAt: row.last_failure_at };
}
export type SchedulerDiagnostic = {
  switches: { emergencyStop: boolean; automation: boolean; generation: boolean; publishing: boolean } | null;
  scheduledDelivery: boolean; cronConfigured: boolean;
  lastScheduledJob: { at: string; status: string } | null; stale: boolean;
  /** null : aucun passage enregistré ; "unavailable" : lecture en échec. */
  heartbeat: HeartbeatView | null | "unavailable";
};
const JOB_STATUS_LABELS: Record<string, string> = { queued: "En file", running: "En cours", succeeded: "Réussi", failed: "Échec", cancelled: "Annulé", skipped: "Ignoré" };
export async function schedulerSection(db: DiagnosticDb, now: Date, env: Env, heartbeat: HeartbeatLoader | null = loadSchedulerHeartbeat): Promise<SchedulerDiagnostic> {
  const [settings, job] = await Promise.all([
    db.from("publication_settings").select("emergency_stop,automation_enabled,generation_enabled,publishing_enabled").limit(1).maybeSingle(),
    db.from("jobs").select("created_at,status").eq("trigger", "schedule").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (settings.error || job.error) throw Error("diagnostic read");
  const s = settings.data as { emergency_stop: boolean; automation_enabled: boolean; generation_enabled: boolean; publishing_enabled: boolean } | null;
  const last = job.data as { created_at: string; status: string } | null;
  let beat: SchedulerDiagnostic["heartbeat"] = null;
  if (heartbeat) { try { const row = await heartbeat(db); beat = row ? heartbeatView(row) : null; } catch { beat = "unavailable"; } }
  return {
    switches: s ? { emergencyStop: s.emergency_stop !== false, automation: s.automation_enabled === true, generation: s.generation_enabled === true, publishing: s.publishing_enabled === true } : null,
    scheduledDelivery: isFlagEnabled("publications-scheduled-delivery", env), cronConfigured: isProviderConfigured("scheduler", env),
    lastScheduledJob: last ? { at: last.created_at, status: JOB_STATUS_LABELS[last.status] ?? "Inconnu" } : null,
    stale: !last || now.getTime() - Date.parse(last.created_at) > 36 * 3_600_000, heartbeat: beat,
  };
}

// --- 2. Dernier passage de l'Agent Publications ---
const RUN_STATUS_LABELS: Record<string, string> = { processing: "En cours", completed: "Terminé", failed: "Échec" };
const RUN_ERROR_LABELS: Record<string, string> = {
  invalid_output: "Contenu généré invalide", unsupported_claim: "Affirmation absente du contexte", occurrence_unavailable: "Créneau devenu indisponible",
  generation_failed: "Génération en échec", context_unavailable: "Contexte du client indisponible", lease_expired: "Préparation interrompue (délai dépassé)",
};
const MEDIA_STATUS: Record<string, keyof typeof MEDIA_STATE_LABELS> = { none: "none", attached: "attached", needs_media: "failed", pending: "pending" };
export type AgentRunView = { client: string; status: string; error: string | null; media: string; costEur: number; createdAt: string; completedAt: string | null };
export type PreparationView = { at: string; outcome: string };
export type AgentDiagnostic = { runs: AgentRunView[]; failures7d: Count; preparations: PreparationView[] };
export async function agentSection(db: DiagnosticDb, now: Date): Promise<AgentDiagnostic> {
  const since = new Date(now.getTime() - 7 * DAY).toISOString();
  const [runs, failures, audits] = await Promise.all([
    rows<{ client_id: string; status: string; error_code: string | null; media_status: string | null; estimated_cost_eur: number | string | null; created_at: string; completed_at: string | null }>(
      db.from("publication_agent_v2_runs").select("client_id,status,error_code,media_status,estimated_cost_eur,created_at,completed_at").order("created_at", { ascending: false }).limit(5)),
    rows<{ id: string }>(db.from("publication_agent_v2_runs").select("id").eq("status", "failed").gte("created_at", since).limit(DIAGNOSTIC_LIMIT)),
    rows<{ created_at: string; metadata: unknown }>(db.from("audit_logs").select("created_at,metadata").eq("action", "publications.scheduled_preparation").order("created_at", { ascending: false }).limit(5)),
  ]);
  const names = await clientNames(db, runs.map((r) => r.client_id));
  return {
    runs: runs.map((r) => ({
      client: names.get(r.client_id) ?? "Client", status: RUN_STATUS_LABELS[r.status] ?? "Inconnu",
      error: r.error_code ? RUN_ERROR_LABELS[r.error_code] ?? "Échec non identifié" : null,
      media: MEDIA_STATE_LABELS[MEDIA_STATUS[r.media_status ?? "none"] ?? "none"], costEur: Number(r.estimated_cost_eur ?? 0) || 0, createdAt: r.created_at, completedAt: r.completed_at,
    })),
    failures7d: count(failures),
    preparations: audits.map((a) => {
      const m = (a.metadata && typeof a.metadata === "object" ? a.metadata : {}) as { ok?: unknown; run_id?: unknown; submitted?: unknown; media_missing?: unknown };
      const submitted = Array.isArray(m.submitted) ? m.submitted.length : 0;
      const outcome = !m.run_id ? "Préparation refusée (aucune génération)" : m.ok === true
        ? `Préparée · ${submitted} soumise${submitted > 1 ? "s" : ""} à validation${m.media_missing === true ? " · photo manquante" : ""}` : "Préparation en échec";
      return { at: a.created_at, outcome };
    }),
  };
}

// --- 3. Publications en attente de validation ---
export async function reviewSection(db: DiagnosticDb): Promise<{ pending: Count }> {
  return { pending: count(await rows(db.from("publications").select("id").eq("status", "pending_review").is("archived_at", null).limit(DIAGNOSTIC_LIMIT))) };
}

// --- 4. Ingestion WhatsApp ---
export type InboxIssue = { label: string; receivedAt: string; attempts: number };
export type WhatsAppDiagnostic = { failed: Count; stuck: Count; exhausted: Count; recent: InboxIssue[] };
export async function whatsappSection(db: DiagnosticDb, now: Date): Promise<WhatsAppDiagnostic> {
  const [failed, stuck] = await Promise.all([
    rows<{ error_code: string | null; received_at: string; attempts: number }>(db.from("whatsapp_inbox").select("error_code,received_at,attempts").eq("status", "failed").order("received_at", { ascending: false }).limit(DIAGNOSTIC_LIMIT)),
    rows<{ id: string }>(db.from("whatsapp_inbox").select("id").eq("status", "processing").lt("lease_until", now.toISOString()).limit(DIAGNOSTIC_LIMIT)),
  ]);
  return {
    failed: count(failed), stuck: count(stuck), exhausted: count(failed.filter((r) => r.error_code === "retry_exhausted")),
    recent: failed.slice(0, 5).map((r) => ({ label: inboxErrorLabel(r.error_code) ?? "Échec sans code", receivedAt: r.received_at, attempts: r.attempts })),
  };
}

// --- 5. Connexions et diffusion ---
const OAUTH_CODE_LABELS: Record<string, string> = {
  access_denied: "Autorisation refusée par l’utilisateur", provider_error: "Erreur renvoyée par le fournisseur", missing_code: "Retour OAuth incomplet",
  not_configured: "OAuth non configuré sur le serveur",
};
function oauthCodeLabel(code: string | null): string {
  if (!code) return "Échec de connexion";
  if (code in OAUTH_CODE_LABELS) return OAUTH_CODE_LABELS[code];
  return code.startsWith("exchange_") ? "Échange du code d’autorisation en échec" : "Échec de connexion";
}
const providerLabel = (provider: string) => (provider in PROVIDER_LABELS ? PROVIDER_LABELS[provider as keyof typeof PROVIDER_LABELS] : "Autre service");
export type ConnectionIssue = { client: string; provider: string; state: string };
export type OAuthFailure = { client: string; provider: string; reason: string; at: string };
export type DeliveryIssue = { client: string; platform: string; status: string; reason: string | null; at: string };
export type ConnectionsDiagnostic = { connections: ConnectionIssue[]; oauthFailures: OAuthFailure[]; deliveries: DeliveryIssue[]; deliveryCounts: Record<string, number> };
export const DELIVERY_ISSUE_STATUSES = ["failed", "uncertain", "blocked", "retryable_error"] as const;
export async function connectionsSection(db: DiagnosticDb, now: Date): Promise<ConnectionsDiagnostic> {
  const since = new Date(now.getTime() - 7 * DAY).toISOString();
  // Jamais la référence des identifiants ni le texte de last_error : seulement sa présence.
  const [connections, events, deliveries] = await Promise.all([
    rows<{ client_id: string | null; provider: string; status: string; expires_at: string | null; last_error: string | null }>(db.from("client_connections").select("client_id,provider,status,expires_at,last_error").limit(DIAGNOSTIC_LIMIT)),
    rows<{ client_id: string | null; metadata: unknown; created_at: string }>(db.from("publication_events").select("client_id,metadata,created_at").eq("action", "publication.oauth_failed").gte("created_at", since).order("created_at", { ascending: false }).limit(20)),
    rows<{ client_id: string; platform: PublicationPlatform; status: string; blocked_reason: string | null; last_error_class: string | null; last_error_code: string | null; updated_at: string }>(
      db.from("publication_deliveries").select("client_id,platform,status,blocked_reason,last_error_class,last_error_code,updated_at").in("status", DELIVERY_ISSUE_STATUSES).order("updated_at", { ascending: false }).limit(DIAGNOSTIC_LIMIT)),
  ]);
  const issues = connections.filter((c) => c.status === "expired" || c.status === "error" || c.status === "revoked" || Boolean(c.last_error) || (c.status === "active" && c.expires_at !== null && Date.parse(c.expires_at) <= now.getTime()));
  const names = await clientNames(db, [...issues.map((c) => c.client_id), ...events.map((e) => e.client_id), ...deliveries.slice(0, 10).map((d) => d.client_id)]);
  const name = (id: string | null) => (id ? names.get(id) ?? "Client" : "Connexion globale");
  const deliveryCounts: Record<string, number> = {};
  for (const d of deliveries) deliveryCounts[d.status] = (deliveryCounts[d.status] ?? 0) + 1;
  return {
    connections: issues.slice(0, 20).map((c) => ({
      client: name(c.client_id), provider: providerLabel(c.provider),
      state: c.status !== "active" ? (CONNECTION_STATUS_LABELS as Record<string, string>)[c.status] ?? "Inactive" : c.expires_at && Date.parse(c.expires_at) <= now.getTime() ? "Expirée" : "Dernière synchronisation en erreur",
    })),
    oauthFailures: events.map((e) => {
      const m = (e.metadata && typeof e.metadata === "object" ? e.metadata : {}) as { provider?: unknown; code?: unknown };
      return { client: name(e.client_id), provider: providerLabel(typeof m.provider === "string" ? m.provider : ""), reason: oauthCodeLabel(safeCode(m.code)), at: e.created_at };
    }),
    deliveries: deliveries.slice(0, 10).map((d) => {
      const klass = d.last_error_class && d.last_error_class in ERROR_CLASS_LABELS ? ERROR_CLASS_LABELS[d.last_error_class as DeliveryErrorClass] : null;
      return {
        client: name(d.client_id), platform: platformLabels[d.platform] ?? "Plateforme", status: DELIVERY_STATUS_LABELS[d.status as DeliveryStatus] ?? "Inconnu",
        reason: d.status === "blocked" ? blockedReasonLabel(d.blocked_reason) : klass ? `${klass}${safeCode(d.last_error_code) ? ` (${safeCode(d.last_error_code)})` : ""}` : null, at: d.updated_at,
      };
    }),
    deliveryCounts,
  };
}

// --- 6. Tâches bloquées ou à relancer (bail expiré) ---
export type StuckDiagnostic = { jobs: Count; publicationJobs: Count; agentRuns: Count; whatsapp: Count };
export async function stuckSection(db: DiagnosticDb, now: Date): Promise<StuckDiagnostic> {
  const at = now.toISOString();
  const [jobs, publicationJobs, agentRuns, whatsapp] = await Promise.all([
    rows(db.from("jobs").select("id").eq("status", "running").lt("lease_expires_at", at).limit(DIAGNOSTIC_LIMIT)),
    rows(db.from("publication_jobs").select("id").eq("status", "processing").lt("lease_expires_at", at).limit(DIAGNOSTIC_LIMIT)),
    rows(db.from("publication_agent_v2_runs").select("id").eq("status", "processing").lt("lease_until", at).limit(DIAGNOSTIC_LIMIT)),
    rows(db.from("whatsapp_inbox").select("id").eq("status", "processing").lt("lease_until", at).limit(DIAGNOSTIC_LIMIT)),
  ]);
  return { jobs: count(jobs), publicationJobs: count(publicationJobs), agentRuns: count(agentRuns), whatsapp: count(whatsapp) };
}

// --- 7. Variables d'environnement : configuré oui / non, interrupteurs activé / désactivé. Jamais une valeur ni une longueur. ---
export const ENV_MODULES = ["supabase", "clerk", "scheduler", "openai", "meta", "google-business-profile", "credentials", "google-drive", "google-drive-import", "whatsapp-webhook", "whatsapp-ingestion", "push"] as const;
export type EnvDiagnostic = { modules: { label: string; configured: boolean }[]; flags: { label: string; variable: string; enabled: boolean }[] };
export function envSection(env: Env): EnvDiagnostic {
  return {
    modules: ENV_MODULES.flatMap((id) => { const r = providerRequirements.find((item) => item.id === id); return r ? [{ label: r.label, configured: providerStatus(r, env).state === "configured" }] : []; }),
    flags: featureFlags.map((f) => ({ label: f.label, variable: f.variable, enabled: env[f.variable] === f.enabledValue })),
  };
}

// --- 8. États classés (lot 9) : chaque mécanisme dans exactement un état, avec sa preuve (date ou compteur). ---
// Une fonction par groupe, chacune échoue seule : la page affiche alors les éléments connus du groupe « inconnu ».
export type StatusGroup = { items: DiagnosticItem[] };
const MONTH = 30 * DAY;
/** Préparations planifiées : au plus une par jour et par client, preuve sur 7 jours. */
const FRESH_RUN_MS_FOR_PREP = 7 * DAY;
const sumCost = (list: { estimated_cost_eur?: number | string | null }[]) => list.reduce((total, r) => total + (Number(r.estimated_cost_eur ?? 0) || 0), 0);
const first = <T,>(list: T[]) => list[0] ?? null;
type Heartbeat = HeartbeatView | null | "unavailable";
async function readHeartbeat(db: DiagnosticDb, loader: HeartbeatLoader | null): Promise<Heartbeat> {
  if (!loader) return null;
  try { const row = await loader(db); return row ? heartbeatView(row) : null; } catch { return "unavailable"; }
}

/** Planificateur et chacune de ses étapes : uniquement d'après le dernier passage réel (scheduler_heartbeats). */
export function schedulerStatus(env: Env, heartbeat: Heartbeat, now: Date): StatusGroup {
  return { items: [classifyScheduler(isProviderConfigured("scheduler", env), heartbeat, now), ...schedulerSteps.map((name) => classifyStep(name, heartbeat, now))] };
}

/** Interrupteurs de sécurité : arrêt d'urgence, réglages globaux, drapeau de diffusion, préparation automatique par client. */
export async function safetyStatus(db: DiagnosticDb, env: Env, heartbeat: Heartbeat, now: Date): Promise<StatusGroup> {
  const [settings, clients, audits] = await Promise.all([
    db.from("publication_settings").select("emergency_stop,automation_enabled,generation_enabled,publishing_enabled").limit(1).maybeSingle(),
    rows<{ client_id: string; auto_prepare_enabled: boolean; generation_enabled: boolean }>(db.from("publication_client_settings").select("client_id,auto_prepare_enabled,generation_enabled").eq("auto_prepare_enabled", true).limit(DIAGNOSTIC_LIMIT)),
    rows<{ created_at: string; metadata: unknown }>(db.from("audit_logs").select("created_at,metadata").eq("action", "publications.scheduled_preparation").order("created_at", { ascending: false }).limit(20)),
  ]);
  const s = settings.error ? null : settings.data as { emergency_stop: boolean; automation_enabled: boolean; generation_enabled: boolean; publishing_enabled: boolean } | null;
  // Réglages absents ou illisibles : tout est considéré comme arrêté, et dit « inconnu ».
  const stop = s ? s.emergency_stop !== false : null;
  const raw = env.PUBLICATIONS_SCHEDULED_DELIVERY;
  const flag = raw === "enabled" ? "enabled" : typeof raw === "string" && raw.trim() ? "other" : "absent";
  const autoClients = clients.filter((c) => c.generation_enabled === true).length;
  const meta = (a: { metadata: unknown }) => (a.metadata && typeof a.metadata === "object" ? a.metadata : {}) as { ok?: unknown; run_id?: unknown };
  const lastOk = first(audits.filter((a) => meta(a).ok === true && meta(a).run_id).map((a) => a.created_at));
  const lastKo = first(audits.filter((a) => meta(a).ok !== true).map((a) => a.created_at));
  const globallyOff = !s || stop || !s.automation_enabled || !s.generation_enabled;
  return { items: [
    classifySwitch("switch:emergency-stop", "Automatismes Publications (arrêt d’urgence)", stop === null ? null : !stop, "Arrêt d’urgence levé", "Arrêt d’urgence actif : aucune préparation ni diffusion automatique"),
    classifySwitch("switch:automation", "Automatisation (réglage global)", s ? s.automation_enabled === true : null, "Activée dans les réglages", "Désactivée dans les réglages"),
    classifySwitch("switch:generation", "Génération IA (réglage global)", s ? s.generation_enabled === true : null, "Activée dans les réglages", "Désactivée dans les réglages"),
    classifySwitch("switch:publishing", "Diffusion (réglage global)", s ? s.publishing_enabled === true : null, "Autorisée dans les réglages", "Désactivée dans les réglages"),
    classifyScheduledDelivery(flag, classifyStep("publication_delivery_send", heartbeat, now)),
    classifyMechanism({ id: "auto-prepare", label: "Préparation automatique par client", configured: null, enabled: autoClients > 0 && !globallyOff, now, freshMs: FRESH_RUN_MS_FOR_PREP,
      disabledReason: autoClients === 0 ? "Aucun client en préparation automatique" : `${autoClients} client${autoClients > 1 ? "s" : ""} en préparation automatique, coupée par les réglages globaux`,
      lastSuccessAt: lastOk, lastFailureAt: lastKo, successLabel: `${autoClients} client${autoClients > 1 ? "s" : ""} · dernière préparation réussie`, failureLabel: "Dernière préparation planifiée en échec ou refusée",
      idleLabel: `${autoClients} client${autoClients > 1 ? "s" : ""} · aucune préparation planifiée réussie enregistrée` }),
  ] };
}
/** Agents actifs : agents du cockpit activés (dernier run) et Agent Publications v2 (projets autorisés, dernier run). */
export async function agentsStatus(db: DiagnosticDb, now: Date): Promise<StatusGroup> {
  const since = new Date(now.getTime() - MONTH).toISOString();
  const [agents, runs, projects, v2] = await Promise.all([
    rows<{ id: string; name: string; enabled: boolean }>(db.from("agents").select("id,name,enabled").eq("enabled", true).order("name").limit(30)),
    rows<{ agent_id: string; status: string; started_at: string; completed_at: string | null }>(db.from("agent_runs").select("agent_id,status,started_at,completed_at").gte("started_at", since).order("started_at", { ascending: false }).limit(500)),
    rows<{ project_id: string }>(db.from("publication_agent_projects").select("project_id").eq("enabled", true).eq("rights_confirmed", true).limit(DIAGNOSTIC_LIMIT)),
    rows<{ status: string; created_at: string; completed_at: string | null }>(db.from("publication_agent_v2_runs").select("status,created_at,completed_at").gte("created_at", since).order("created_at", { ascending: false }).limit(200)),
  ]);
  const v2Ok = first(v2.filter((r) => r.status === "completed").map((r) => r.completed_at ?? r.created_at)), v2Ko = first(v2.filter((r) => r.status === "failed").map((r) => r.completed_at ?? r.created_at));
  const items = [classifyMechanism({ id: "agent:publications-v2", label: "Agent Publications", configured: null, enabled: projects.length > 0, now,
    disabledReason: "Aucun projet autorisé (agent activé et droits médias confirmés)", lastSuccessAt: v2Ok, lastFailureAt: v2Ko,
    successLabel: `${projects.length} projet${projects.length > 1 ? "s" : ""} · dernière préparation terminée`, failureLabel: "Dernière préparation en échec",
    idleLabel: `${projects.length} projet${projects.length > 1 ? "s" : ""} · aucune préparation terminée sur 30 jours` })];
  for (const agent of agents) {
    const own = runs.filter((r) => r.agent_id === agent.id);
    const ok = first(own.filter((r) => r.status === "completed" || r.status === "succeeded").map((r) => r.completed_at ?? r.started_at)), ko = first(own.filter((r) => r.status === "failed").map((r) => r.completed_at ?? r.started_at));
    items.push(classifyMechanism({ id: `agent:${agent.id}`, label: agent.name, configured: null, enabled: true, now, lastSuccessAt: ok, lastFailureAt: ko,
      successLabel: "Dernier run terminé", failureLabel: "Dernier run en échec", idleLabel: "Activé, aucun run terminé sur 30 jours" }));
  }
  return { items };
}

/** IA (OpenAI) : erreurs et coûts réels enregistrés (Agent Publications, classement de la photothèque, agents). */
export type AiCosts = { agentPublications: number; mediaClassification: number; agents: number; total: number; capped: boolean };
export type AiStatus = StatusGroup & { costs30d: AiCosts; errors7d: { generation: number; classification: number } };
const AI_ERROR_CODES = new Set(["generation_failed", "invalid_output", "unsupported_claim"]);
export async function aiStatus(db: DiagnosticDb, now: Date, env: Env): Promise<AiStatus> {
  const since = new Date(now.getTime() - MONTH).toISOString(), week = now.getTime() - 7 * DAY;
  const [v2, usage, agentRuns, classification] = await Promise.all([
    rows<{ status: string; error_code: string | null; estimated_cost_eur: number | string | null; created_at: string; completed_at: string | null }>(db.from("publication_agent_v2_runs").select("status,error_code,estimated_cost_eur,created_at,completed_at").gte("created_at", since).order("created_at", { ascending: false }).limit(1000)),
    rows<{ estimated_cost_eur: number | string | null; created_at: string }>(db.from("client_media_ai_usage").select("estimated_cost_eur,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(1000)),
    rows<{ status: string; estimated_cost_eur: number | string | null; started_at: string; completed_at: string | null }>(db.from("agent_runs").select("status,estimated_cost_eur,started_at,completed_at").gte("started_at", since).order("started_at", { ascending: false }).limit(1000)),
    rows<{ classification_failed_at: string | null }>(db.from("whatsapp_assets").select("classification_failed_at").gte("classification_failed_at", new Date(week).toISOString()).order("classification_failed_at", { ascending: false }).limit(DIAGNOSTIC_LIMIT)),
  ]);
  const aiFailures = v2.filter((r) => r.status === "failed" && r.error_code !== null && AI_ERROR_CODES.has(r.error_code));
  const lastOk = latest(first(v2.filter((r) => r.status === "completed").map((r) => r.completed_at ?? r.created_at)), first(usage.map((u) => u.created_at)),
    first(agentRuns.filter((r) => r.status === "completed" && Number(r.estimated_cost_eur ?? 0) > 0).map((r) => r.completed_at ?? r.started_at)));
  const lastKo = latest(first(aiFailures.map((r) => r.completed_at ?? r.created_at)), first(classification.map((c) => c.classification_failed_at)));
  const generation = aiFailures.filter((r) => Date.parse(r.created_at) >= week).length;
  const costs = { agentPublications: sumCost(v2), mediaClassification: sumCost(usage), agents: sumCost(agentRuns) };
  return {
    items: [classifyMechanism({ id: "ai:openai", label: "IA (OpenAI)", configured: isProviderConfigured("openai", env), disabledReason: "OPENAI_API_KEY absente : aucune génération ni classement.", now,
      lastSuccessAt: lastOk, lastFailureAt: lastKo, successLabel: "Dernier appel IA réussi enregistré", failureLabel: "Dernier appel IA en échec", idleLabel: "Configurée, aucun appel IA réussi sur 30 jours" })],
    costs30d: { ...costs, total: costs.agentPublications + costs.mediaClassification + costs.agents, capped: v2.length >= 1000 || usage.length >= 1000 || agentRuns.length >= 1000 },
    errors7d: { generation, classification: classification.length },
  };
}

/** Médias : Drive des publications (lecture seule), Drive d'import (drive.file), réception et import WhatsApp. Jetons jamais mélangés. */
const DRIVE_IMPORT_ERROR = /^(config_|oauth_|drive_)/;
export async function mediaStatus(db: DiagnosticDb, now: Date, env: Env): Promise<StatusGroup> {
  const week = new Date(now.getTime() - 7 * DAY).toISOString(), at = now.toISOString();
  const [mediaFailures, received, failed, imported, stuck] = await Promise.all([
    rows<{ created_at: string }>(db.from("publication_agent_v2_runs").select("created_at").eq("media_error_code", "fetch_failed").gte("created_at", week).order("created_at", { ascending: false }).limit(DIAGNOSTIC_LIMIT)),
    rows<{ received_at: string }>(db.from("whatsapp_inbox").select("received_at").order("received_at", { ascending: false }).limit(1)),
    rows<{ error_code: string | null; received_at: string }>(db.from("whatsapp_inbox").select("error_code,received_at").eq("status", "failed").gte("received_at", week).order("received_at", { ascending: false }).limit(DIAGNOSTIC_LIMIT)),
    rows<{ imported_at: string }>(db.from("whatsapp_assets").select("imported_at").eq("origin", "whatsapp").order("imported_at", { ascending: false }).limit(1)),
    rows<{ id: string }>(db.from("whatsapp_inbox").select("id").eq("status", "processing").lt("lease_until", at).limit(DIAGNOSTIC_LIMIT)),
  ]);
  const lastImport = first(imported.map((r) => r.imported_at)), driveFailures = failed.filter((r) => r.error_code && DRIVE_IMPORT_ERROR.test(r.error_code));
  const ingestionOn = isFlagEnabled("whatsapp-ingestion", env);
  return { items: [
    // Aucun journal dédié aux lectures du Drive des publications : jamais « opérationnel » sans preuve.
    classifyMechanism({ id: "drive:publications", label: "Google Drive (photos des publications, lecture seule)", configured: isProviderConfigured("google-drive", env), now,
      disabledReason: "Variables GOOGLE_DRIVE_* absentes.", openIssues: mediaFailures.length, lastFailureAt: first(mediaFailures.map((r) => r.created_at)),
      issueLabel: `${mediaFailures.length}${mediaFailures.length >= DIAGNOSTIC_LIMIT ? "+" : ""} récupération${mediaFailures.length > 1 ? "s" : ""} de média en échec (7 j)`,
      idleLabel: "Configuré ; aucune lecture réussie n’est journalisée, aucun échec de récupération sur 7 jours" }),
    classifyMechanism({ id: "drive:import", label: "Google Drive (import des photos clients, drive.file)", configured: isProviderConfigured("google-drive-import", env), now,
      disabledReason: "Variables GOOGLE_DRIVE_IMPORT_* absentes.", lastSuccessAt: lastImport, lastFailureAt: first(driveFailures.map((r) => r.received_at)),
      successLabel: "Dernier média déposé dans Drive", failureLabel: `Dépôt Drive en échec (${driveFailures.length} sur 7 j)`, idleLabel: "Configuré, aucun média déposé enregistré" }),
    classifyMechanism({ id: "whatsapp:webhook", label: "WhatsApp (réception)", configured: isProviderConfigured("whatsapp-webhook", env), now,
      disabledReason: "Variables du webhook WhatsApp absentes.", lastSuccessAt: first(received.map((r) => r.received_at)), successLabel: "Dernier média reçu",
      idleLabel: "Configuré, aucun média reçu enregistré" }),
    classifyMechanism({ id: "whatsapp:ingestion", label: "WhatsApp (téléchargement et import)", configured: isProviderConfigured("whatsapp-ingestion", env), enabled: ingestionOn, now,
      disabledReason: ingestionOn ? "WHATSAPP_ACCESS_TOKEN absent." : "WHATSAPP_INGESTION_ENABLED ≠ true : import coupé.",
      openIssues: stuck.length, issueLabel: `${stuck.length} import${stuck.length > 1 ? "s" : ""} bloqué${stuck.length > 1 ? "s" : ""} (bail expiré)`,
      lastSuccessAt: lastImport, lastFailureAt: first(failed.map((r) => r.received_at)), successLabel: "Dernier média importé", failureLabel: `Dernier import en échec (${failed.length}${failed.length >= DIAGNOSTIC_LIMIT ? "+" : ""} sur 7 j)`,
      idleLabel: "Configuré, aucun média importé enregistré" }),
  ] };
}

/** Connexions sociales (expirées, révoquées, en erreur) et diffusions bloquées. */
const PROVIDER_PLATFORMS: Record<string, readonly string[]> = { meta: ["facebook", "instagram"], google_business_profile: ["google_business_profile"], tiktok: ["tiktok"] };
export async function connectionsStatus(db: DiagnosticDb, now: Date, env: Env): Promise<StatusGroup> {
  const month = new Date(now.getTime() - MONTH).toISOString();
  const [connections, issues, published, settings] = await Promise.all([
    rows<{ provider: string; status: string; expires_at: string | null; last_checked_at: string | null }>(db.from("client_connections").select("provider,status,expires_at,last_checked_at").in("provider", ["meta", "google_business_profile", "tiktok"]).limit(DIAGNOSTIC_LIMIT)),
    rows<{ status: string; updated_at: string }>(db.from("publication_deliveries").select("status,updated_at").in("status", DELIVERY_ISSUE_STATUSES).order("updated_at", { ascending: false }).limit(DIAGNOSTIC_LIMIT)),
    // Preuve d'une diffusion réelle : statut « published » (jamais « simulated ») avec identifiant distant.
    rows<{ platform: string; updated_at: string }>(db.from("publication_deliveries").select("platform,updated_at").eq("status", "published").not("remote_id", "is", null).gte("updated_at", month).order("updated_at", { ascending: false }).limit(DIAGNOSTIC_LIMIT)),
    db.from("publication_settings").select("emergency_stop,publishing_enabled").limit(1).maybeSingle(),
  ]);
  const expired = (c: { status: string; expires_at: string | null }) => c.status === "expired" || c.status === "revoked" || c.status === "error" || (c.status === "active" && c.expires_at !== null && Date.parse(c.expires_at) <= now.getTime());
  const items = (["meta", "google_business_profile", "tiktok"] as const).map((provider) => {
    const own = connections.filter((c) => c.provider === provider), broken = own.filter(expired), active = own.filter((c) => c.status === "active" && !expired(c));
    const lastPublished = first(published.filter((d) => PROVIDER_PLATFORMS[provider].includes(d.platform)).map((d) => d.updated_at));
    return classifyMechanism({ id: `connections:${provider}`, label: `Connexions ${PROVIDER_LABELS[provider]}`, configured: isProviderConfigured(provider === "meta" ? "meta" : provider === "tiktok" ? "tiktok" : "google-business-profile", env), now, freshMs: MONTH,
      disabledReason: "Application OAuth non configurée sur le serveur.", openIssues: broken.length,
      issueLabel: `${broken.length} connexion${broken.length > 1 ? "s" : ""} expirée${broken.length > 1 ? "s" : ""}, révoquée${broken.length > 1 ? "s" : ""} ou en erreur · à reconnecter`,
      lastSuccessAt: lastPublished, successLabel: `${active.length} connexion${active.length > 1 ? "s" : ""} active${active.length > 1 ? "s" : ""} · dernière diffusion confirmée`,
      idleLabel: active.length ? `${active.length} connexion${active.length > 1 ? "s" : ""} active${active.length > 1 ? "s" : ""}, aucune diffusion confirmée sur 30 jours` : "Configuré, aucune connexion active" });
  });
  const s = settings.error ? null : settings.data as { emergency_stop: boolean; publishing_enabled: boolean } | null;
  items.push(classifyMechanism({ id: "deliveries", label: "Diffusions des publications", configured: null, enabled: s ? s.emergency_stop === false && s.publishing_enabled === true : false, now, freshMs: MONTH,
    disabledReason: !s ? "Réglages illisibles : diffusion considérée comme arrêtée." : s.emergency_stop !== false ? "Arrêt d’urgence actif." : "Diffusion désactivée dans les réglages.",
    openIssues: issues.length, lastFailureAt: first(issues.map((d) => d.updated_at)),
    issueLabel: `${issues.length}${issues.length >= DIAGNOSTIC_LIMIT ? "+" : ""} diffusion${issues.length > 1 ? "s" : ""} en échec, bloquée${issues.length > 1 ? "s" : ""}, à réessayer ou à vérifier`,
    lastSuccessAt: first(published.map((d) => d.updated_at)), successLabel: "Dernière diffusion confirmée par la plateforme", idleLabel: "Autorisée, aucune diffusion confirmée sur 30 jours" }));
  return { items };
}

/** Délais de traitement : âge du plus ancien élément en attente de chaque file. */
export async function delaysStatus(db: DiagnosticDb, now: Date, env: Env): Promise<StatusGroup> {
  const at = now.toISOString();
  const [inbox, jobs, publicationJobs, deliveries] = await Promise.all([
    rows<{ received_at: string }>(db.from("whatsapp_inbox").select("received_at").eq("status", "pending").not("client_id", "is", null).order("received_at", { ascending: true }).limit(DIAGNOSTIC_LIMIT)),
    rows<{ scheduled_for: string }>(db.from("jobs").select("scheduled_for").eq("status", "queued").lte("scheduled_for", at).order("scheduled_for", { ascending: true }).limit(DIAGNOSTIC_LIMIT)),
    rows<{ run_at: string }>(db.from("publication_jobs").select("run_at").eq("status", "pending").lte("run_at", at).order("run_at", { ascending: true }).limit(DIAGNOSTIC_LIMIT)),
    rows<{ scheduled_for: string }>(db.from("publication_deliveries").select("scheduled_for").eq("status", "scheduled").lte("scheduled_for", at).order("scheduled_for", { ascending: true }).limit(DIAGNOSTIC_LIMIT)),
  ]);
  const queue = (id: string, label: string, list: Record<string, string>[], column: string, disabled: string | null = null) =>
    classifyQueue({ id, label, oldestAt: list[0]?.[column] ?? null, pending: list.length, capped: list.length >= DIAGNOSTIC_LIMIT, now, disabled });
  return { items: [
    queue("delay:whatsapp", "Retard — imports WhatsApp en attente", inbox, "received_at"),
    queue("delay:jobs", "Retard — jobs d’automatisation dus", jobs, "scheduled_for"),
    queue("delay:publication-jobs", "Retard — envois de publications dus", publicationJobs, "run_at"),
    queue("delay:deliveries", "Retard — diffusions programmées échues", deliveries, "scheduled_for",
      isFlagEnabled("publications-scheduled-delivery", env) ? null : "diffusion automatique désactivée : envoi manuel via « Envoyer les publications dues »"),
  ] };
}

/** Éléments connus de chaque groupe, affichés « inconnu » quand sa lecture échoue. */
export const STATUS_GROUP_FALLBACK: Record<"safety" | "agents" | "ai" | "media" | "connections" | "delays", string[]> = {
  safety: ["Automatismes Publications (arrêt d’urgence)", "Automatisation (réglage global)", "Génération IA (réglage global)", "Diffusion (réglage global)", "Diffusion automatique à l’heure prévue (PUBLICATIONS_SCHEDULED_DELIVERY)", "Préparation automatique par client"],
  agents: ["Agent Publications", "Agents du cockpit"], ai: ["IA (OpenAI)"],
  media: ["Google Drive (photos des publications, lecture seule)", "Google Drive (import des photos clients, drive.file)", "WhatsApp (réception)", "WhatsApp (téléchargement et import)"],
  connections: ["Connexions Meta", "Connexions Google Business Profile", "Diffusions des publications"],
  delays: ["Retard — imports WhatsApp en attente", "Retard — jobs d’automatisation dus", "Retard — envois de publications dus", "Retard — diffusions programmées échues"],
};

export type Diagnostic = {
  scheduler: Section<SchedulerDiagnostic>; agent: Section<AgentDiagnostic>; review: Section<{ pending: Count }>; whatsapp: Section<WhatsAppDiagnostic>;
  connections: Section<ConnectionsDiagnostic>; stuck: Section<StuckDiagnostic>; env: Section<EnvDiagnostic>;
  status: {
    scheduler: Section<StatusGroup>; safety: Section<StatusGroup>; agents: Section<StatusGroup>; ai: Section<AiStatus>;
    media: Section<StatusGroup>; connections: Section<StatusGroup>; delays: Section<StatusGroup>;
  };
};
export async function getDiagnostic(options: { now?: Date; env?: Env; db?: DiagnosticDb; heartbeat?: HeartbeatLoader | null } = {}): Promise<Diagnostic> {
  await requireAdmin();
  const now = options.now ?? new Date(), env = options.env ?? process.env;
  let db: DiagnosticDb | null = options.db ?? null;
  try { db ??= getSupabaseServerClient() as unknown as DiagnosticDb; } catch { db = null; }
  const read = <T,>(name: string, fn: (d: DiagnosticDb) => Promise<T>) => (db ? soft(name, () => fn(db!)) : Promise.resolve({ ok: false } as Section<T>));
  // Un seul chargement du battement, partagé par la section détaillée et les états classés.
  const loader = options.heartbeat === undefined ? loadSchedulerHeartbeat : options.heartbeat;
  const beat: Promise<Heartbeat> = db ? readHeartbeat(db, loader) : Promise.resolve("unavailable");
  const shared: HeartbeatLoader | null = loader && (async () => { const b = await beat; if (b === "unavailable") throw Error("heartbeat"); return b && { started_at: b.startedAt, finished_at: b.finishedAt, ok: b.ok, steps: Object.fromEntries(b.steps.map((s) => [s.name, { status: s.status, ms: s.ms }])), last_success_at: b.lastSuccessAt, last_failure_at: b.lastFailureAt }; });
  const [scheduler, agent, review, whatsapp, connections, stuck, safety, agents, ai, media, connectionStates, delays] = await Promise.all([
    read("scheduler", (d) => schedulerSection(d, now, env, shared)),
    read("agent", (d) => agentSection(d, now)), read("review", (d) => reviewSection(d)), read("whatsapp", (d) => whatsappSection(d, now)),
    read("connections", (d) => connectionsSection(d, now)), read("stuck", (d) => stuckSection(d, now)),
    read("status-safety", async (d) => safetyStatus(d, env, await beat, now)), read("status-agents", (d) => agentsStatus(d, now)),
    read("status-ai", (d) => aiStatus(d, now, env)), read("status-media", (d) => mediaStatus(d, now, env)),
    read("status-connections", (d) => connectionsStatus(d, now, env)), read("status-delays", (d) => delaysStatus(d, now, env)),
  ]);
  const schedulerStates = await soft("status-scheduler", async () => schedulerStatus(env, await beat, now));
  return { scheduler, agent, review, whatsapp, connections, stuck, env: await soft("env", async () => envSection(env)),
    status: { scheduler: schedulerStates, safety, agents, ai, media, connections: connectionStates, delays } };
}
