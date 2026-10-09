import type { Json, RecommendationRow } from "@/lib/supabase/database.types";

export type RecommendationRecord = RecommendationRow & {
  agent: { id: string; name: string } | null;
  client: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
};
export type RecommendationStatus = "pending" | "accepted" | "rejected" | "archived";
export type RecommendationSeverity = "info" | "low" | "medium" | "high" | "critical";
export type CreateRecommendationInput = {
  project_id?: string | null;
  agent_id: string;
  client_id: string;
  title: string;
  reason?: string | null;
  severity: RecommendationSeverity;
  status: RecommendationStatus;
  payload: Json;
};
export type RecommendationResult = { ok: true; recommendation: RecommendationRecord } | { ok: false; message: string };
export type RecommendationStatusResult = { ok: true; recommendation: RecommendationRecord } | { ok: false; message: string };
export type RecommendationActionState = { message?: string };
