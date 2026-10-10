import "server-only";
import { randomUUID } from "node:crypto";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

export async function reserveAdsAnalysis(clientId: string) {
  await requireAdmin();
  const token = randomUUID(), db = getSupabaseServerClient();
  const { data, error } = await db.rpc("codev_claim_ads_analysis", { p_client_id: clientId, p_token: token });
  if (error) return { acquired: false as const, message: "Analyses indisponibles : vérifiez la migration 20261018000000." };
  if (!data) return { acquired: false as const, message: "Une analyse est en cours ou vient d’être lancée pour ce client. Attendez une minute avant de réessayer." };
  return { acquired: true as const, release: async () => { await db.from("ads_analysis_leases").update({ expires_at: new Date().toISOString() }).eq("client_id", clientId).eq("token", token); } };
}

export async function saveAdsAnalysisMetadata(runId: string, clientId: string, agentId: string, metadata: Record<string, unknown>) {
  await requireAdmin();
  if (JSON.stringify(metadata).length > 80_000) throw new Error("Analyse trop volumineuse.");
  const { data, error } = await getSupabaseServerClient().from("agent_runs").update({ metadata: metadata as Json }).eq("id", runId).eq("client_id", clientId).eq("agent_id", agentId).eq("status", "running").select("id").maybeSingle();
  if (error || !data) throw new Error("Analyse non enregistrée.");
}
