import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { AutomationRecord } from "@/lib/automations/service";
import { jobReportIds, type AutomationJob, type AutomationReport } from "@/lib/automations/supervision-model";

export type SupervisedAutomation = AutomationRecord & { jobs: AutomationJob[]; reports: AutomationReport[]; resultUnavailable: boolean };
// Les paramètres, erreurs fournisseur, clés d'idempotence et identifiants de worker ne sont jamais exposés ici.
const jobColumns = "id,automation_id,run_type,client_id,status,attempts,max_attempts,scheduled_for,started_at,finished_at,created_at,lease_expires_at,agent_run_id,result";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function withReports(automations: (AutomationRecord & { jobs: AutomationJob[] })[]): Promise<SupervisedAutomation[]> {
  const ids = [...new Set(automations.flatMap(a => a.jobs.flatMap(jobReportIds)))];
  const reports: AutomationReport[] = [];
  let unavailable = false;
  // Lots bornés : un rapport global peut concerner plusieurs centaines de clients.
  for (let offset = 0; offset < ids.length; offset += 100) {
    const result = await getSupabaseServerClient().from("reports").select("id,client_id,title,status,version,approved_version").in("id", ids.slice(offset, offset + 100));
    if (result.error) { unavailable = true; continue; }
    reports.push(...(result.data ?? []) as AutomationReport[]);
  }
  return automations.map(automation => {
    const wanted = new Set(automation.jobs.flatMap(jobReportIds));
    const linked = reports.filter(report => wanted.has(report.id) && (!automation.client_id || report.client_id === automation.client_id));
    return { ...automation, reports: linked, resultUnavailable: unavailable || [...wanted].some(id => !linked.some(report => report.id === id)) };
  });
}

/** Une requête relationnelle bornée, dernier job réel de chaque automatisation (pas les N derniers jobs globaux). */
export async function listAutomationSupervision(): Promise<SupervisedAutomation[]> {
  const { data, error } = await getSupabaseServerClient().from("automations")
    .select(`*,agent:agents(name),client:clients(name),jobs:jobs(${jobColumns})`)
    .neq("status", "archived").order("created_at", { ascending: false }).limit(200)
    .order("created_at", { referencedTable: "jobs", ascending: false }).order("id", { referencedTable: "jobs", ascending: false }).limit(1, { referencedTable: "jobs" });
  if (error) throw new Error("automation supervision read");
  return withReports((data ?? []) as unknown as (AutomationRecord & { jobs: AutomationJob[] })[]);
}

/** Historique individuel : 50 jobs au maximum, y compris les demandes manuelles rattachées. */
export async function getAutomationSupervision(id: string): Promise<SupervisedAutomation | null> {
  if (!uuid.test(id)) return null;
  const [automation, jobs] = await Promise.all([
    getSupabaseServerClient().from("automations").select("*,agent:agents(name),client:clients(name)").eq("id", id).maybeSingle(),
    getSupabaseServerClient().from("jobs").select(jobColumns).eq("automation_id", id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(50),
  ]);
  if (automation.error || jobs.error) throw new Error("automation history read");
  if (!automation.data) return null;
  const result = await withReports([{ ...automation.data, jobs: jobs.data ?? [] } as unknown as AutomationRecord & { jobs: AutomationJob[] }]);
  return result[0];
}
