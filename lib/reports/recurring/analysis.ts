import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { adsBusinessSchema } from "@/lib/integrations/google-ads/business-context";
import { analyzeRecommendation } from "@/lib/integrations/google-ads/recommendation-core";
import type { CampaignRow } from "@/lib/integrations/google-ads/dashboard";
import type { StoredAdsScope } from "@/lib/integrations/google-ads/scope";
import { startRun, finishRun, recordRecommendation } from "@/lib/agents/outputs";
import type { Json } from "@/lib/supabase/database.types";
/** Same bounded AI engine, scope and instruction snapshot as interactive analyses; no session dependency. */
export async function analyzeClientReport(clientId: string, rows: CampaignRow[], scope: StoredAdsScope, mode: "ai" | "deterministic") {
  const db = getSupabaseServerClient();
  const assignments = await db.from("agent_client_assignments").select("agent_id,client_instructions,agent:agents(id,agent_type,enabled,status,instructions)").eq("client_id", clientId).eq("enabled", true);
  if (assignments.error) throw new Error("assignment read");
  const assignment = assignments.data?.find(item => { const a = item.agent as unknown as { agent_type: string; enabled: boolean; status: string }; return a?.agent_type === "google-ads" && a.enabled && a.status === "Actif"; });
  if (!assignment) return { ok: false as const, message: "Assignez un agent Google Ads actif pour préparer ce rapport." };
  const agent = assignment.agent as unknown as { instructions: string | null };
  const context = await db.from("client_ads_context").select("context").eq("client_id", clientId).maybeSingle();
  if (context.error) return { ok: false as const, message: "Contexte commercial indisponible : migration 18 requise." };
  const business = context.data ? adsBusinessSchema.parse(context.data.context) : null;
  const instructions = { global: (agent.instructions ?? "").slice(0,10000), client: (assignment.client_instructions ?? "").slice(0,3000), business };
  const runId = await startRun({ agentId: assignment.agent_id, clientId, runType: "google_ads_read_only" });
  try {
    const analyzed = await analyzeRecommendation(rows, scope, instructions, mode);
    const metadata = { run_type: "google_ads_read_only", scope, instruction_snapshot: instructions, engine: analyzed.engine, requested_mode: mode, analysis_text: analyzed.text, analysis: analyzed.ai?.output ?? null, evidence: analyzed.ai?.evidence ?? [], ai_ms: analyzed.aiMs } as unknown as Json;
    const saved = await db.from("agent_runs").update({ metadata }).eq("id", runId).eq("client_id", clientId).eq("status", "running");
    if (saved.error) throw new Error("analysis save");
    await finishRun(runId, "completed", "Analyse du rapport récurrent en lecture seule.");
    await recordRecommendation({ kind: "system", worker: "recurring-report" }, { agentId: assignment.agent_id, clientId, title: `Google Ads — ${scope.start} → ${scope.end}`, reason: analyzed.text, severity: "medium", payload: { run_id: runId, scope, engine: analyzed.engine } });
    return { ok: true as const, text: analyzed.text, engine: analyzed.engine };
  } catch (error) { await finishRun(runId, "failed", "Analyse du rapport indisponible."); throw error; }
}
