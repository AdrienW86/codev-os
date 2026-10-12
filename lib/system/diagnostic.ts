import "server-only";
// Diagnostic technique (admin) : planificateur, Agent Publications, validations, import WhatsApp, connexions et
// diffusions, tâches bloquées, variables d'environnement. Lecture seule, une fonction par section : chacune échoue
// seule (« indisponible ») sans empêcher les autres. Jamais de jeton, de valeur de variable, de texte fournisseur
// ni d'identifiant brut : uniquement des états, des libellés français, des dates et des noms de clients.
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSchedulerHeartbeat, SCHEDULER_HEARTBEAT } from "@/lib/scheduler/heartbeat";
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
  lt(column: string, value: string): Query; gte(column: string, value: string): Query;
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
export type HeartbeatView = { startedAt: string | null; finishedAt: string | null; ok: boolean | null; failedSteps: string[]; lastSuccessAt: string | null; lastFailureAt: string | null };
/** Étapes en échec : uniquement des noms courts (objet {étape: {status}} ou liste [{name, ok}]), jamais leur contenu. */
export function heartbeatView(row: SchedulerHeartbeatRow): HeartbeatView {
  const failed: string[] = [];
  const add = (name: unknown, value: unknown) => {
    if (typeof name === "string" && /^[a-zA-Z0-9_-]{1,40}$/.test(name) && value && typeof value === "object" && ((value as { ok?: unknown }).ok === false || (value as { status?: unknown }).status === "failed")) failed.push(name);
  };
  if (Array.isArray(row.steps)) for (const step of row.steps.slice(0, 30)) add((step as { name?: unknown } | null)?.name, step);
  else if (row.steps && typeof row.steps === "object") for (const [name, value] of Object.entries(row.steps).slice(0, 30)) add(name, value);
  return { startedAt: row.started_at, finishedAt: row.finished_at, ok: row.ok, failedSteps: failed, lastSuccessAt: row.last_success_at, lastFailureAt: row.last_failure_at };
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

export type Diagnostic = {
  scheduler: Section<SchedulerDiagnostic>; agent: Section<AgentDiagnostic>; review: Section<{ pending: Count }>; whatsapp: Section<WhatsAppDiagnostic>;
  connections: Section<ConnectionsDiagnostic>; stuck: Section<StuckDiagnostic>; env: Section<EnvDiagnostic>;
};
export async function getDiagnostic(options: { now?: Date; env?: Env; db?: DiagnosticDb; heartbeat?: HeartbeatLoader | null } = {}): Promise<Diagnostic> {
  await requireAdmin();
  const now = options.now ?? new Date(), env = options.env ?? process.env;
  let db: DiagnosticDb | null = options.db ?? null;
  try { db ??= getSupabaseServerClient() as unknown as DiagnosticDb; } catch { db = null; }
  const read = <T,>(name: string, fn: (d: DiagnosticDb) => Promise<T>) => (db ? soft(name, () => fn(db!)) : Promise.resolve({ ok: false } as Section<T>));
  const [scheduler, agent, review, whatsapp, connections, stuck] = await Promise.all([
    read("scheduler", (d) => schedulerSection(d, now, env, options.heartbeat === undefined ? loadSchedulerHeartbeat : options.heartbeat)),
    read("agent", (d) => agentSection(d, now)), read("review", (d) => reviewSection(d)), read("whatsapp", (d) => whatsappSection(d, now)),
    read("connections", (d) => connectionsSection(d, now)), read("stuck", (d) => stuckSection(d, now)),
  ]);
  return { scheduler, agent, review, whatsapp, connections, stuck, env: await soft("env", async () => envSection(env)) };
}
