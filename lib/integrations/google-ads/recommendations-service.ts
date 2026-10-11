import "server-only";
import { createHash } from "node:crypto";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/require-admin";
import { getActiveScenario } from "@/lib/simulation/server";
import { listAgentsForClient } from "@/lib/agents/data";
import { getAdsBusinessContext } from "./context-service";
import { runGoogleAdsAnalysis } from "./service";
import { selectAIProvider } from "@/lib/ai/providers";
import { parseScope, type AdsScope } from "./scope";
import { writeAudit } from "@/lib/core/audit";
import type { Json } from "@/lib/supabase/database.types";
export const RECOMMENDATION_FRESHNESS_MS = 5 * 60_000;
export type RecommendationResult = { ok: true; text: string; summary: string; runId: string; fetchedAt: string; reused: boolean; engine: string; elapsedMs: number; aiMs: number; resolveAndReadMs?: number; googleReadMs?: number; resolutionMs?: number } | { ok: false; message: string };
/** Persisted cache: exact client/account/scope/instructions/provider, completed runs only, five minutes. */
export async function getAdsRecommendation(clientId: string, input: AdsScope, mode: "ai" | "deterministic" = "ai", refresh = false, dashboard?: import("./dashboard").DashboardData): Promise<RecommendationResult> {
  const actor = await requireAdmin();
  if (await getActiveScenario()) return { ok: false, message: "Simulation active : aucune donnée réelle n’est consultée." };
  const scope = parseScope(input);
  if (!scope || !/^[0-9a-f-]{36}$/i.test(clientId)) return { ok: false, message: "Périmètre invalide." };
  const started = performance.now();
  const assignment = (await listAgentsForClient(clientId)).find(item => item.enabled && item.agent?.agent_type === "google-ads" && item.agent.enabled && item.agent.status === "Actif");
  if (!assignment) return { ok: false, message: "Assignez un agent Google Ads actif à ce client." };
  const db = getSupabaseServerClient();
  const business = await getAdsBusinessContext(clientId);
  const connection = await db.from("client_connections").select("external_account_id,updated_at,status").eq("client_id", clientId).eq("provider", "google_ads").maybeSingle();
  if (connection.error || !connection.data || connection.data.status !== "connected") return { ok: false, message: "Connexion indisponible." };
  const provider = selectAIProvider();
  const key = createHash("sha256").update(JSON.stringify([clientId, connection.data, { ...scope, campaignIds: [...scope.campaignIds].sort(), types: [...scope.types].sort() }, mode, assignment.agent_id, assignment.agent?.instructions, assignment.client_instructions, business, provider?.id, provider?.model])).digest("hex");
  if (!refresh) {
    const cached = await db.from("agent_runs").select("id,metadata,started_at,summary").eq("client_id", clientId).eq("agent_id", assignment.agent_id).eq("status", "completed").contains("metadata", { recommendation_cache_key: key }).gte("started_at", new Date(Date.now() - RECOMMENDATION_FRESHNESS_MS).toISOString()).order("started_at", { ascending: false }).limit(1).maybeSingle();
    const metadata = cached.data?.metadata as Record<string, unknown> | undefined;
    if (!cached.error && cached.data && typeof metadata?.analysis_text === "string") {
      await writeAudit({ kind: "admin", userId: actor.userId }, { action: "google_ads.analysis_reused", resource_type: "agent_run", resource_id: cached.data.id, metadata: {} });
      return { ok: true, text: metadata.analysis_text, summary: cached.data.summary ?? "Analyse récente réutilisée.", runId: cached.data.id, fetchedAt: typeof metadata.data_fetched_at === "string" ? metadata.data_fetched_at : cached.data.started_at, reused: true, engine: String(metadata.engine), elapsedMs: Math.round(performance.now() - started), aiMs: 0 };
    }
  }
  const result = await runGoogleAdsAnalysis(assignment.agent_id, clientId, { scope, mode, dashboard });
  if (!result.ok || !result.runId) return { ok: false, message: result.message ?? "Analyse indisponible." };
  const run = await db.from("agent_runs").select("metadata,started_at").eq("id", result.runId).eq("client_id", clientId).single();
  const metadata = run.data?.metadata as Record<string, unknown> | undefined;
  if (run.error || typeof metadata?.analysis_text !== "string") return { ok: false, message: "Analyse enregistrée mais détail indisponible." };
  // Fallbacks are visible, but deliberately not reused as personalized AI analyses.
  if (metadata.engine !== "deterministic_fallback") await db.from("agent_runs").update({ metadata: { ...metadata, recommendation_cache_key: key } as Json }).eq("id", result.runId).eq("client_id", clientId).eq("status", "completed");
  return { ok: true, text: metadata.analysis_text, summary: result.message ?? "Analyse terminée.", runId: result.runId, fetchedAt: typeof metadata.data_fetched_at === "string" ? metadata.data_fetched_at : run.data!.started_at, reused: false, engine: String(metadata.engine), elapsedMs: Math.round(performance.now() - started), aiMs: Number(metadata.ai_ms ?? 0) };
}
