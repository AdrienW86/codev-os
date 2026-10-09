import type { Json } from "@/lib/supabase/database.types";
import type { CreateRecommendationInput, RecommendationSeverity, RecommendationStatus } from "./types";

export const recommendationStatuses: readonly RecommendationStatus[] = ["pending", "accepted", "rejected", "archived"];
export const recommendationSeverities: readonly RecommendationSeverity[] = ["info", "low", "medium", "high", "critical"];

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRecommendationUuid(value: string) {
  return uuid.test(value);
}

export function validateRecommendationInput(input: unknown): CreateRecommendationInput | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (typeof value.agent_id !== "string" || !uuid.test(value.agent_id)) return null;
  if (typeof value.client_id !== "string" || !uuid.test(value.client_id)) return null;
  if (value.project_id!=null && (typeof value.project_id!=="string" || !uuid.test(value.project_id))) return null;
  if (typeof value.title !== "string" || !value.title.trim() || value.title.trim().length > 200) return null;
  if (typeof value.severity !== "string" || !recommendationSeverities.includes(value.severity as RecommendationSeverity)) return null;
  if (typeof value.status !== "string" || !recommendationStatuses.includes(value.status as RecommendationStatus)) return null;
  if (value.reason !== null && typeof value.reason !== "undefined" && typeof value.reason !== "string") return null;
  const reason = typeof value.reason === "string" ? value.reason.trim() : null;
  if (reason && reason.length > 4000) return null;
  if (!value.payload || typeof value.payload !== "object" || Array.isArray(value.payload)) return null;
  try {
    if (JSON.stringify(value.payload).length > 20000) return null;
  } catch {
    return null;
  }
  return {
    agent_id: value.agent_id,
    client_id: value.client_id,
    project_id: (value.project_id ?? null) as string | null,
    title: value.title.trim(),
    reason: reason || null,
    severity: value.severity as RecommendationSeverity,
    status: value.status as RecommendationStatus,
    payload: value.payload as Json,
  };
}

export function canTransitionRecommendation(from: string, to: RecommendationStatus) {
  if (from === "pending") return ["accepted", "rejected", "archived"].includes(to);
  if (from === "accepted" || from === "rejected") return to === "archived";
  return false;
}
