import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit-logs";
import { isRecommendationUuid } from "@/lib/recommendations/validation";
import type { AgentMessageRecord, CreateAdminMessageResult } from "./types";

const genericError = "Impossible de traiter le message. Actualisez la recommandation et réessayez.";
const columns = "id,recommendation_id,agent_id,client_id,project_id,sender_type,message,metadata,created_at";

function storageFailure(operation: "list" | "create"): never {
  console.error(`[agent-messages] Échec du stockage (${operation}).`);
  throw new Error("Le stockage des messages est indisponible. Réessayez plus tard.");
}

export async function listMessagesByRecommendation(recommendationId: string): Promise<AgentMessageRecord[]> {
  await requireAdmin();
  if (!isRecommendationUuid(recommendationId)) return [];
  try {
    const { data, error } = await getSupabaseServerClient().from("agent_messages").select(columns).eq("recommendation_id", recommendationId).order("created_at", { ascending: true });
    if (error) throw new Error();
    return data ?? [];
  } catch { storageFailure("list"); }
}

export async function createAdminMessage(recommendationId: string, message: unknown): Promise<CreateAdminMessageResult> {
  const { userId } = await requireAdmin();
  if (!isRecommendationUuid(recommendationId) || typeof message !== "string") return { ok: false, message: genericError };
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 5000 || trimmed.includes("\0")) return { ok: false, message: "Le message est vide ou trop long." };
  try {
    const supabase = getSupabaseServerClient();
    const { data: recommendation, error: recommendationError } = await supabase.from("recommendations").select("id,agent_id,client_id,project_id").eq("id", recommendationId).maybeSingle();
    if (recommendationError) throw new Error();
    if (!recommendation) return { ok: false, message: genericError };
    const { data, error } = await supabase.from("agent_messages").insert({
      recommendation_id: recommendation.id,
      agent_id: recommendation.agent_id,
      client_id: recommendation.client_id,
      project_id: recommendation.project_id??null,
      sender_type: "admin",
      message: trimmed,
      metadata: {},
    }).select(columns).single();
    if (error || !data) throw new Error();
    await writeAuditLog({
      action: "agent_message.created",
      actor_type: "admin",
      actor_id: userId,
      resource_type: "agent_message",
      resource_id: data.id,
      before_data: null,
      after_data: { id: data.id, recommendation_id: recommendation.id, agent_id: recommendation.agent_id, client_id: recommendation.client_id, project_id: recommendation.project_id??null, sender_type: "admin", created_at: data.created_at },
      metadata: {},
    });
    return { ok: true, message: data };
  } catch { storageFailure("create"); }
}
