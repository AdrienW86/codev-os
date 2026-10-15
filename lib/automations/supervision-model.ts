import type { AutomationRow, JobRow, ReportRow } from "@/lib/supabase/core.types";

export type AutomationJob = Pick<JobRow, "id" | "automation_id" | "run_type" | "client_id" | "status" | "attempts" | "max_attempts" | "scheduled_for" | "started_at" | "finished_at" | "created_at" | "lease_expires_at" | "agent_run_id" | "result">;
export type AutomationReport = Pick<ReportRow, "id" | "client_id" | "title" | "status" | "version" | "approved_version">;
export type AutomationExecutionState = "never" | "planned" | "running" | "succeeded" | "failed" | "delayed" | "awaiting_validation" | "skipped" | "cancelled" | "unknown";
export type AutomationEvidence = { state: AutomationExecutionState; label: string; tone: "neutral" | "blue" | "green" | "amber" | "red"; description: string; at: string | null };
export const AUTOMATION_DELAY_MS = 5 * 60_000;
const stamp = (date: string | null | undefined) => date && Number.isFinite(Date.parse(date)) ? Date.parse(date) : null;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Identifiants structurés produits par les handlers ; jamais de lien déduit d'un résumé libre. */
export function jobReportIds(job: AutomationJob): string[] {
  if (!job.result || typeof job.result !== "object" || Array.isArray(job.result)) return [];
  const values = [job.result.report_id, ...(Array.isArray(job.result.report_ids) ? job.result.report_ids : [])];
  return [...new Set(values.filter((value): value is string => typeof value === "string" && uuid.test(value)))].slice(0, 500);
}

/** Un succès de job n'est ni une approbation ni une preuve d'envoi. Les rapports sont relus dans leur version actuelle. */
export function automationEvidence(automation: Pick<AutomationRow, "status" | "next_run_at" | "last_run_at">, job: AutomationJob | null, reports: AutomationReport[], now = new Date()): AutomationEvidence {
  const next = stamp(automation.next_run_at);
  const dueLate = automation.status === "active" && next !== null && next < now.getTime() - AUTOMATION_DELAY_MS;
  if (job?.status === "running") {
    const expires = stamp(job.lease_expires_at);
    return expires === null || expires <= now.getTime()
      ? { state: "delayed", label: "En retard", tone: "amber", description: "Exécution interrompue ou bail expiré ; aucune réussite confirmée.", at: job.started_at }
      : { state: "running", label: "En cours", tone: "blue", description: "Un worker détient actuellement cette exécution.", at: job.started_at };
  }
  if (job?.status === "queued") {
    const due = stamp(job.scheduled_for);
    const late = due !== null && due < now.getTime() - AUTOMATION_DELAY_MS;
    return { state: late ? "delayed" : "planned", label: late ? "En retard" : "Planifiée", tone: late ? "amber" : "blue", description: job.attempts ? "Nouvelle tentative en attente ; aucun nouveau succès confirmé." : "Job en file, pas encore exécuté.", at: job.scheduled_for };
  }
  if (job?.status === "failed") return { state: "failed", label: "Échouée", tone: "red", description: "L’exécution a échoué. Son journal conserve la tentative.", at: job.finished_at };
  if (job?.status === "skipped") return { state: "skipped", label: "Ignorée", tone: "neutral", description: "Conditions ou permissions non réunies ; aucun succès d’exécution.", at: job.finished_at };
  if (job?.status === "cancelled") return { state: "cancelled", label: "Annulée", tone: "neutral", description: "Job annulé ; aucun succès d’exécution.", at: job.finished_at };
  if (dueLate) return { state: "delayed", label: "En retard", tone: "amber", description: "Une échéance dépasse cinq minutes sans prise en charge confirmée.", at: automation.next_run_at };
  if (!job) return automation.last_run_at
    ? { state: "unknown", label: "Historique indisponible", tone: "neutral", description: "Une mise en file est datée, mais aucun job associé n’est retrouvé.", at: automation.last_run_at }
    : { state: "never", label: "Jamais exécutée", tone: "neutral", description: "Aucun job associé enregistré. La planification seule ne prouve pas une exécution.", at: null };
  if (job.status !== "succeeded") return { state: "unknown", label: "État inconnu", tone: "neutral", description: "Aucune réussite vérifiable.", at: null };
  const linked = reports.filter(report => jobReportIds(job).includes(report.id) && (!job.client_id || report.client_id === job.client_id));
  if (linked.some(report => report.status === "draft" || report.status === "ready_for_review" || (report.status === "approved" && report.approved_version !== report.version)))
    return { state: "awaiting_validation", label: "Validation nécessaire", tone: "amber", description: "Préparation réussie ; un rapport lié attend l’approbation de sa version actuelle.", at: job.finished_at };
  return { state: "succeeded", label: "Réussie", tone: "green", description: "Le job a terminé avec succès. Ce statut ne prouve aucun envoi ni livraison externe.", at: job.finished_at };
}
