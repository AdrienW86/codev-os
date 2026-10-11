import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { RunHandler } from "@/lib/runs/types";
import { RunError } from "@/lib/runs/types";
import { recurringConfigSchema, automaticSendDecision, type OccurrenceWindow } from "./domain";
import { googleAdsReportSnapshot } from "@/lib/reports/google-ads-service";
import { getReport, transportApprovedReport } from "@/lib/reports/service";
import { reportEmailPreview } from "@/lib/reports/email-preview";
import type { Json } from "@/lib/supabase/database.types";
const db = () => getSupabaseServerClient();
async function recordOutcome(job: Parameters<RunHandler>[0]["job"], id: string, phase: "prepare" | "send", state: string, reason: string | null) {
  const result = await db().rpc("codev_record_ads_report_outcome", { p_occurrence: id, p_job: job.id, p_worker: job.worker_id!, p_phase: phase, p_state: state, p_reason: reason });
  if (result.error) throw new RunError("État du rapport non enregistré : migration de durcissement requise.");
  return result.data;
}
async function occurrence(id: unknown, clientId: string | null) {
  if (typeof id !== "string" || !clientId || !/^[0-9a-f-]{36}$/.test(id)) throw new RunError("Échéance invalide.", false);
  const result = await db().from("ads_report_occurrences").select("*").eq("id", id).eq("client_id", clientId).maybeSingle();
  if (result.error || !result.data) throw new RunError("Échéance indisponible.");
  const settings = await db().from("client_ads_report_settings").select("config,revision").eq("client_id", clientId).maybeSingle();
  if (settings.error) throw new RunError("Configuration indisponible.");
  return { row: result.data, active: settings.data?.revision === result.data.revision && (settings.data?.config as Record<string, unknown>)?.enabled === true };
}
export const prepareRecurringReportRun: RunHandler = async ({ job, signal }) => {
  const { row: o, active } = await occurrence((job.payload as Record<string, unknown>).occurrenceId, job.client_id);
  if (!active) return { status: "skipped", summary: "Rapports en pause ou configuration remplacée." };
  if (o.preparation === "ready") return { status: "succeeded", summary: "Rapport déjà préparé, contenu conservé." };
  const config = recurringConfigSchema.parse(o.config), window = o.period_window as unknown as OccurrenceWindow;
  try {
    signal?.throwIfAborted();
    const result = await googleAdsReportSnapshot(o.client_id, { start: window.start, end: window.end, status: "all", types: config.types, campaignIds: config.campaignIds }, config.accountId, { system: true, mode: config.mode }, config.dataTimezone);
    signal?.throwIfAborted();
    if (!result.ok) throw new RunError(result.message);
    const cutoff = { title: "Coupure des données", lines: [`${window.cutoff}. Les journées suivantes sont exclues.`, `Fréquence : ${config.frequency === "weekly" ? "hebdomadaire" : "mensuelle"}.`] };
    result.built.client.sections.push(cutoff); result.built.internal.sections.push(cutoff);
    const published = await db().rpc("codev_store_ads_report", { p_occurrence: o.id, p_job: job.id, p_worker: job.worker_id!, p_report: { title: result.built.title, summary: result.built.client.summary, internal_content: result.built.internal, client_content: result.built.client, scope: result.stored } as unknown as Json });
    if (published.error) throw new RunError("Rapport non enregistré.");
    if (!published.data) return { status: "skipped", summary: "Bail perdu ou configuration remplacée ; aucun rapport publié." };
    return { status: "succeeded", summary: "Rapport finalisé, à relire et approuver avant envoi.", data: { report_id: o.report_id } };
  } catch (error) {
    if (!signal?.aborted) await recordOutcome(job, o.id, "prepare", "failed", "preparation_failed");
    throw error;
  }
};
export const sendRecurringReportRun: RunHandler = async ({ job, now }) => {
  const { row: o, active } = await occurrence((job.payload as Record<string, unknown>).occurrenceId, job.client_id);
  const config = recurringConfigSchema.parse(o.config);
  const report = await getReport(o.report_id);
  if (report?.status === "sent") return { status: "skipped", summary: "Rapport déjà envoyé : aucune nouvelle tentative." };
  const decision = automaticSendDecision({ ...config, enabled: config.enabled && active }, o.due_at, now, report);
  if (["accepted", "uncertain", "failed", "blocked", "late", "paused", "prepare_only"].includes(o.transport)) return { status: "skipped", summary: "Tentative d’envoi conservée ; aucune répétition automatique." };
  if (decision !== "send") {
    const state = decision === "approval_required" ? "blocked" : decision === "not_due" ? "pending" : decision;
    if (decision !== "paused") await recordOutcome(job, o.id, "send", state, decision);
    return { status: "skipped", summary: decision === "approval_required" ? "Envoi bloqué : validation nécessaire." : decision === "late" ? "Échéance dépassée : envoi manuel requis." : "Aucun envoi automatique autorisé." };
  }
  const email = reportEmailPreview(report!);
  const result = await transportApprovedReport({ kind: "system", worker: job.worker_id! }, o.report_id, "email", { version: report!.version, recipient: config.recipient, digest: email.digest, confirmed: true }, o.id, { jobId: job.id, worker: job.worker_id! });
  const delivery = await db().from("report_deliveries").select("state").eq("report_id", o.report_id).eq("version", report!.version).maybeSingle();
  const state = result.ok ? "accepted" : delivery.data?.state === "uncertain" || delivery.data?.state === "sending" ? "uncertain" : "failed";
  await recordOutcome(job, o.id, "send", state, result.ok ? null : "delivery_failed");
  return { status: result.ok ? "succeeded" : "skipped", summary: result.ok ? "Resend a accepté l’e-mail (livraison non confirmée)." : result.message ?? "Envoi non effectué." };
};
