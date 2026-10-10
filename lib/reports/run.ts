import "server-only";
// Handler « report.generate » : rapports de la période close pour un client, ou pour tous les clients
// auxquels l'Agent Rapport est rattaché.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { todayInParis } from "@/lib/dashboard/home";
import { generateReport } from "@/lib/reports/service";
import { RunError, type RunHandler } from "@/lib/runs/types";

export const generateReportsRun: RunHandler = async ({ job, agent, actor, now }) => {
  const payload = (job.payload ?? {}) as { kind?: unknown };
  const kind = payload.kind === "monthly" ? "monthly" : "weekly";
  let clientIds: string[];
  if (job.client_id) clientIds = [job.client_id];
  else {
    const { data, error } = await getSupabaseServerClient().from("agent_client_assignments").select("client_id").eq("agent_id", agent.id).eq("enabled", true).limit(500);
    if (error) throw new RunError("Rattachements indisponibles.");
    clientIds = [...new Set((data ?? []).map((row) => row.client_id))];
  }
  const today = todayInParis(now);
  let created = 0, updated = 0, frozen = 0;
  for (const clientId of clientIds) {
    const result = await generateReport(actor, { clientId, kind, today });
    if (result.status === "created") created++; else if (result.status === "updated") updated++; else frozen++;
  }
  if (!clientIds.length) return { status: "skipped", summary: "Aucun client rattaché à l’Agent Rapport." };
  return { status: "succeeded", summary: `${clientIds.length} rapport(s) ${kind === "weekly" ? "hebdomadaire(s)" : "mensuel(s)"} : ${created} créé(s), ${updated} mis à jour, ${frozen} déjà envoyé(s).`, data: { created, updated, frozen } };
};
