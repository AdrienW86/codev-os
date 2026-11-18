import "server-only";
// Décisions automatiques du planificateur (étape auto_decisions) : ce qui n'est pas crucial n'attend plus l'administrateur.
// Aujourd'hui : rapports internes hebdomadaires et mensuels « à relire ». Le plus récent de chaque client et type est
// approuvé au nom du planificateur ; les plus anciens, remplacés, sont archivés. Rien n'est envoyé : l'envoi d'un rapport
// au client reste une action de l'administrateur. Les rapports Google Ads (envoi récurrent automatique possible après
// approbation) ne sont jamais touchés ici : ils restent une confirmation cruciale.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import { planReportDecisions } from "./inbox";

export const AUTO_DECISIONS_ACTOR: Actor = { kind: "system", worker: "auto-decisions" };
const LIMIT = 200;

export type AutoDecisionsSummary = { approved: number; archived: number; failed: number };

type ReportRow = { id: string; client_id: string | null; kind: string; period_start: string; version: number };

export async function runAutoDecisions(now = new Date()): Promise<AutoDecisionsSummary> {
  const db = getSupabaseServerClient();
  const summary: AutoDecisionsSummary = { approved: 0, archived: 0, failed: 0 };
  const { data, error } = await db.from("reports").select("id,client_id,kind,period_start,version").eq("status", "ready_for_review").in("kind", ["weekly", "monthly"]).limit(LIMIT);
  if (error || !data) throw new Error("reports read");
  const plan = planReportDecisions(data as ReportRow[]);
  const at = now.toISOString();
  for (const report of plan.archive) {
    const r = await db.from("reports").update({ status: "archived", archived_at: at }).eq("id", report.id).eq("status", "ready_for_review").eq("version", report.version).select("id");
    if (r.error || !r.data?.length) { summary.failed++; continue; }
    summary.archived++;
    await writeAudit(AUTO_DECISIONS_ACTOR, { action: "report.auto_archived", resource_type: "report", resource_id: report.id, metadata: { reason: "superseded" } }).catch(() => undefined);
  }
  for (const report of plan.approve) {
    const r = await db.from("reports").update({ status: "approved", approved_at: at, approved_by: "system:auto-decisions", approved_version: report.version })
      .eq("id", report.id).eq("status", "ready_for_review").eq("version", report.version).select("id");
    if (r.error || !r.data?.length) { summary.failed++; continue; }
    summary.approved++;
    await writeAudit(AUTO_DECISIONS_ACTOR, { action: "report.auto_approved", resource_type: "report", resource_id: report.id, metadata: { version: report.version } }).catch(() => undefined);
  }
  return summary;
}
