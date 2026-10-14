// Types des tables de l'Agent SEO V2 (migration 20261109000000_seo_keyword_opportunities.sql).
import type { Json } from "@/lib/supabase/database.types";
import type { ActionKind, DataSource, Level, OpportunityCategory, SearchIntent, TargetStatus } from "@/lib/seo/opportunities";

type Table<Row, Insert, Update = Partial<Insert>> = { Row: Row; Insert: Insert; Update: Update; Relationships: [] };

export type OpportunityStatus = "detected" | "to_review" | "approved" | "in_progress" | "done" | "dismissed";
export type AnalysisDepth = "daily" | "weekly";
export type AnalysisTrigger = "schedule" | "manual" | "assistant" | "system";

export type SeoAnalysisRow = {
  id: string; client_id: string; depth: AnalysisDepth; trigger: AnalysisTrigger; analysis_date: string; status: "running" | "succeeded" | "failed";
  property: string | null; period_start: string | null; period_end: string | null; previous_start: string | null; previous_end: string | null;
  sources: Json; counts: Json; summary: string | null; error_kind: string | null; agent_run_id: string | null; started_at: string; finished_at: string | null;
};
export type SeoOpportunityRow = {
  id: string; client_id: string; fingerprint: string; category: OpportunityCategory; keyword: string; keywords: string[]; target_url: string | null; target_status: TargetStatus;
  intent: SearchIntent; intent_basis: string | null; priority: Level; confidence: Level; data_source: DataSource; verified: boolean;
  period_start: string | null; period_end: string | null; previous_start: string | null; previous_end: string | null;
  metrics: Json | null; previous_metrics: Json | null; potential_clicks: number | null; factors: string[]; rationale: string; recommended_action: string; action_kind: ActionKind;
  evidence: Json; status: OpportunityStatus; status_reason: string | null; status_changed_at: string; significant_change: boolean;
  recommendation_id: string | null; last_analysis_id: string | null; detection_count: number; first_detected_at: string; last_detected_at: string; created_at: string; updated_at: string;
};
export type SeoInterventionRow = {
  id: string; opportunity_id: string; client_id: string; action_id: string | null; pull_request_url: string | null; keyword: string; target_url: string | null;
  baseline: Json | null; baseline_start: string | null; baseline_end: string | null; deployed_at: string | null; measurements: Json; measured_at: string | null;
  created_by: string; created_at: string; updated_at: string;
};

type OpportunityInsert = Omit<SeoOpportunityRow, "id" | "status" | "status_reason" | "status_changed_at" | "significant_change" | "recommendation_id" | "detection_count" | "first_detected_at" | "last_detected_at" | "created_at" | "updated_at">
  & Partial<Pick<SeoOpportunityRow, "status" | "status_reason" | "significant_change" | "recommendation_id" | "detection_count" | "last_detected_at">>;

export type SeoOpportunityTables = {
  seo_opportunity_analyses: Table<SeoAnalysisRow, Pick<SeoAnalysisRow, "client_id" | "depth" | "trigger" | "analysis_date"> & Partial<Pick<SeoAnalysisRow, "property" | "agent_run_id">>, Partial<Omit<SeoAnalysisRow, "id" | "client_id" | "started_at">>>;
  seo_keyword_opportunities: Table<SeoOpportunityRow, OpportunityInsert, Partial<Omit<SeoOpportunityRow, "id" | "client_id" | "fingerprint" | "first_detected_at" | "created_at" | "updated_at" | "status_changed_at">>>;
  seo_opportunity_interventions: Table<SeoInterventionRow, Pick<SeoInterventionRow, "opportunity_id" | "client_id" | "keyword" | "created_by"> & Partial<Pick<SeoInterventionRow, "action_id" | "pull_request_url" | "target_url" | "baseline" | "baseline_start" | "baseline_end" | "deployed_at">>, Partial<Pick<SeoInterventionRow, "deployed_at" | "pull_request_url" | "measurements" | "measured_at">>>;
};
