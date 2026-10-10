import "server-only";
// Rapports : collecte ciblée, génération versionnée, approbation, envoi (désactivé sans fournisseur e-mail).
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import { describeAction } from "@/lib/actions/registry";
import { buildReport, previousPeriod, type Period, type RecurringReportKind, type ReportInput } from "@/lib/reports/build";
import { getReportScope } from "@/lib/reports/google-ads-service";
import { emailSendingStatus, sendEmail } from "@/lib/providers/email";
import type { Json } from "@/lib/supabase/database.types";
import type { ReportKind, ReportRow, ReportStatus } from "@/lib/supabase/core.types";

const db = () => getSupabaseServerClient();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = /^\d{4}-\d{2}-\d{2}$/;
const fail = (what: string): never => { throw new Error(`report ${what}`); };

export async function gatherReportInput(clientId: string, period: Period): Promise<ReportInput> {
  const supabase = db();
  const since = `${period.start}T00:00:00Z`;
  const until = new Date(`${period.end}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + 1);
  const end = until.toISOString();
  const [client, projects, tasks, publications, recommendations, actions, incidents, runs, checks, metrics] = await Promise.all([
    supabase.from("clients").select("id,name").eq("id", clientId).maybeSingle(),
    supabase.from("projects").select("name,status,progress").eq("client_id", clientId).limit(100),
    supabase.from("tasks").select("title,status,priority,due_date,completed_at,created_at").eq("client_id", clientId).limit(500),
    supabase.from("publications").select("subject,status,updated_at,target_date").eq("client_id", clientId).is("archived_at", null).gte("updated_at", since).limit(300),
    supabase.from("recommendations").select("title,status,severity,created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(200),
    supabase.from("actions").select("action_type,parameters,status,created_at,executed_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(200),
    supabase.from("incidents").select("title,status,severity,detected_at,resolved_at").eq("client_id", clientId).order("detected_at", { ascending: false }).limit(200),
    supabase.from("agent_runs").select("status,started_at,agent:agents(name)").eq("client_id", clientId).gte("started_at", since).lt("started_at", end).limit(500),
    supabase.from("site_checks").select("ok,response_ms,checked_at").eq("client_id", clientId).gte("checked_at", since).lt("checked_at", end).limit(5000),
    supabase.from("metric_snapshots").select("provider,metric_key,data").eq("client_id", clientId).lte("period_start", period.end).gte("period_end", period.start).limit(50),
  ]);
  for (const result of [client, projects, tasks, publications, recommendations, actions, incidents, runs, checks, metrics]) if (result.error) fail("read");
  if (!client.data) fail("client");
  return {
    client: client.data, period,
    projects: projects.data ?? [], tasks: tasks.data ?? [], publications: publications.data ?? [],
    recommendations: recommendations.data ?? [],
    actions: (actions.data ?? []).map((item) => ({ label: describeAction(item.action_type, item.parameters), status: item.status, created_at: item.created_at, executed_at: item.executed_at })),
    incidents: incidents.data ?? [],
    runs: (runs.data ?? []).map((item) => ({ agent: (item.agent as { name?: string } | null)?.name ?? "Agent", status: item.status, started_at: item.started_at })),
    siteChecks: checks.data ?? [],
    metrics: (metrics.data ?? []).map((item) => ({ provider: item.provider, metric_key: item.metric_key, data: (item.data ?? {}) as Record<string, unknown> })),
  };
}

export type GenerateResult = { status: "created" | "updated" | "frozen"; id: string; version: number };

/** Génère (ou régénère en nouvelle version) le rapport d'une période. Un rapport envoyé ou archivé n'est jamais modifié. */
export async function generateReport(actor: Actor, input: { clientId: string; kind: RecurringReportKind; today: string; period?: Period }): Promise<GenerateResult> {
  if (!uuid.test(input.clientId)) fail("client");
  const period = input.period ?? previousPeriod(input.kind, input.today);
  const data = await gatherReportInput(input.clientId, period);
  const built = buildReport(input.kind, data, input.today);
  const supabase = db();
  const { data: existing, error } = await supabase.from("reports").select("id,status,version,client_content").eq("client_id", input.clientId).eq("kind", input.kind).eq("period_start", period.start).maybeSingle();
  if (error) fail("read");
  const now = new Date().toISOString();
  const content = { internal_content: built.internal as unknown as Json, client_content: built.client as unknown as Json, summary: built.client.summary.slice(0, 4000), title: built.title.slice(0, 200) };
  if (existing && ["sent", "archived"].includes(existing.status)) return { status: "frozen", id: existing.id, version: existing.version };
  if (existing) {
    const version = existing.version + 1;
    const { error: updateError } = await supabase.from("reports").update({ ...content, version, status: "ready_for_review", generated_at: now, approved_at: null, approved_by: null, approved_version: null }).eq("id", existing.id).eq("version", existing.version);
    if (updateError) fail("update");
    await supabase.from("report_versions").insert({ report_id: existing.id, version, summary: content.summary, internal_content: content.internal_content, client_content: content.client_content, created_by: actor.kind === "system" ? `system:${actor.worker}` : actor.userId });
    await writeAudit(actor, { action: "report.regenerated", resource_type: "report", resource_id: existing.id, metadata: { version } });
    return { status: "updated", id: existing.id, version };
  }
  const { data: created, error: insertError } = await supabase.from("reports").insert({ client_id: input.clientId, kind: input.kind, period_start: period.start, period_end: period.end, status: "ready_for_review", version: 1, generated_at: now, ...content }).select("id").single();
  if (insertError || !created) fail("insert");
  await supabase.from("report_versions").insert({ report_id: created!.id, version: 1, summary: content.summary, internal_content: content.internal_content, client_content: content.client_content, created_by: actor.kind === "system" ? `system:${actor.worker}` : actor.userId });
  await writeAudit(actor, { action: "report.generated", resource_type: "report", resource_id: created!.id, metadata: { client_id: input.clientId, kind: input.kind, period_start: period.start } });
  return { status: "created", id: created!.id, version: 1 };
}

const columns = "id,client_id,kind,period_start,period_end,status,version,title,summary,internal_content,client_content,generated_at,approved_at,approved_by,approved_version,sent_at,archived_at,delivery,created_at,updated_at";
export type ReportRecord = ReportRow & { client: { id: string; name: string } | null };

/** Filtres : `from` / `to` portent sur la PÉRIODE COUVERTE (chevauchement), pas sur la date de génération. */
export async function listReports(filters: { status?: ReportStatus; kind?: ReportKind; clientId?: string; includeArchived?: boolean; from?: string; to?: string } = {}): Promise<ReportRecord[]> {
  let query = db().from("reports").select(`${columns},client:clients(id,name)`).order("period_start", { ascending: false }).limit(200);
  if (filters.status) query = query.eq("status", filters.status);
  else if (!filters.includeArchived) query = query.neq("status", "archived");
  if (filters.kind) query = query.eq("kind", filters.kind);
  if (filters.clientId && uuid.test(filters.clientId)) query = query.eq("client_id", filters.clientId);
  if (filters.from && day.test(filters.from)) query = query.gte("period_end", filters.from);
  if (filters.to && day.test(filters.to)) query = query.lte("period_start", filters.to);
  const { data, error } = await query;
  if (error) fail("list");
  return (data ?? []) as unknown as ReportRecord[];
}

export async function getReport(id: string) {
  if (!uuid.test(id)) return null;
  const { data, error } = await db().from("reports").select(`${columns},client:clients(id,name,email)`).eq("id", id).maybeSingle();
  if (error) fail("read");
  return data as unknown as (ReportRecord & { client: { id: string; name: string; email: string | null } | null }) | null;
}

export async function listReportVersions(id: string) {
  if (!uuid.test(id)) return [];
  const { data, error } = await db().from("report_versions").select("version,summary,created_by,created_at").eq("report_id", id).order("version", { ascending: false }).limit(50);
  if (error) fail("versions");
  return data ?? [];
}

type Outcome = { ok: true } | { ok: false; message: string };

export async function approveReport(actor: Actor & { kind: "admin" }, id: string): Promise<Outcome> {
  const report = await getReport(id);
  if (!report || report.status !== "ready_for_review") return { ok: false, message: "Seul un rapport prêt à relire peut être approuvé." };
  const { data, error } = await db().from("reports").update({ status: "approved", approved_at: new Date().toISOString(), approved_by: actor.userId, approved_version: report.version }).eq("id", id).eq("version", report.version).eq("status", "ready_for_review").select("id");
  if (error) fail("approve");
  if (!data?.length) return { ok: false, message: "Le rapport a changé entre-temps : rechargez-le." };
  await writeAudit(actor, { action: "report.approved", resource_type: "report", resource_id: id, metadata: { version: report.version } });
  return { ok: true };
}

/** Modification de la synthèse client : nouvelle version, approbation invalidée. */
export async function editReportSummary(actor: Actor & { kind: "admin" }, id: string, summary: string): Promise<Outcome> {
  const text = summary.trim();
  if (!text || text.length > 4000) return { ok: false, message: "Synthèse vide ou trop longue (4 000 caractères maximum)." };
  const report = await getReport(id);
  if (!report || ["sent", "archived"].includes(report.status)) return { ok: false, message: "Ce rapport ne peut plus être modifié." };
  const clientContent = { ...(report.client_content as Record<string, unknown>), summary: text };
  const version = report.version + 1;
  const { data, error } = await db().from("reports").update({ client_content: clientContent as Json, summary: text, version, status: "ready_for_review", approved_at: null, approved_by: null, approved_version: null }).eq("id", id).eq("version", report.version).select("id");
  if (error) fail("edit");
  if (!data?.length) return { ok: false, message: "Le rapport a changé entre-temps : rechargez-le." };
  // Rapport Google Ads : la version porte le même périmètre que le rapport (inchangé par une modification de synthèse).
  const scope = report.kind === "google_ads" ? await getReportScope(id) : null;
  await db().from("report_versions").insert({ report_id: id, version, summary: text, internal_content: report.internal_content, client_content: clientContent as Json, created_by: actor.userId, ...(scope ? { scope: scope as unknown as Json } : {}) });
  await writeAudit(actor, { action: "report.edited", resource_type: "report", resource_id: id, metadata: { version } });
  return { ok: true };
}

export async function archiveReport(actor: Actor & { kind: "admin" }, id: string): Promise<Outcome> {
  const report = await getReport(id);
  if (!report || report.status === "archived") return { ok: false, message: "Rapport introuvable ou déjà archivé." };
  const { error } = await db().from("reports").update({ status: "archived", archived_at: new Date().toISOString() }).eq("id", id);
  if (error) fail("archive");
  await writeAudit(actor, { action: "report.archived", resource_type: "report", resource_id: id, metadata: {} });
  return { ok: true };
}

/**
 * Envoi de la version APPROUVÉE. Sans fournisseur e-mail configuré ET activé (EMAIL_SENDING_ENABLED=true),
 * aucun e-mail n'est envoyé : l'administrateur peut seulement consigner un envoi manuel.
 */
export async function sendReport(actor: Actor & { kind: "admin" }, id: string, mode: "email" | "manual"): Promise<Outcome> {
  const report = await getReport(id);
  if (!report || report.status !== "approved" || report.approved_version !== report.version) return { ok: false, message: "Seule la version approuvée d’un rapport peut être envoyée." };
  let delivery: Record<string, unknown> = { mode: "manual", recorded_by: actor.userId };
  if (mode === "email") {
    const status = emailSendingStatus();
    if (!status.enabled) return { ok: false, message: status.reason };
    const recipient = report.client?.email;
    if (!recipient) return { ok: false, message: "Aucune adresse e-mail renseignée pour ce client." };
    const content = report.client_content as { summary?: string; sections?: { title: string; lines: string[] }[] };
    const text = [content.summary ?? report.summary, ...(content.sections ?? []).flatMap((section) => ["", section.title, ...section.lines.map((line) => `• ${line}`)])].join("\n");
    const result = await sendEmail({ to: recipient, subject: report.title, text, idempotencyKey: `report-${report.id}-v${report.version}` });
    delivery = { mode: "email", provider: "resend", message_id: result.id, recipient_domain: recipient.split("@")[1] ?? null };
  }
  const { data, error } = await db().from("reports").update({ status: "sent", sent_at: new Date().toISOString(), delivery: delivery as Json }).eq("id", id).eq("status", "approved").eq("version", report.version).select("id");
  if (error) fail("send");
  if (!data?.length) return { ok: false, message: "Le rapport a changé entre-temps : rechargez-le." };
  await writeAudit(actor, { action: mode === "email" ? "report.sent" : "report.marked_sent", resource_type: "report", resource_id: id, metadata: { version: report.version, mode } });
  return { ok: true };
}
