// Types des tables du noyau V1 (migration 20261015000000_codev_os_core.sql).
import type { Json } from "@/lib/supabase/database.types";

type Table<Row, Insert, Update = Partial<Omit<Row, "id" | "created_at">>> = { Row: Row; Insert: Insert; Update: Update; Relationships: [] };

export type AutomationFrequency = "once" | "daily" | "weekly" | "monthly";
export type AutomationStatus = "active" | "paused" | "error" | "completed" | "archived";
export type AutomationRow = {
  id: string; name: string; client_id: string | null; project_id: string | null; agent_id: string; run_type: string;
  timezone: string; frequency: AutomationFrequency; schedule: Json; next_run_at: string | null; last_run_at: string | null;
  status: AutomationStatus; autonomy_policy: number; config: Json; consecutive_failures: number; created_by: string | null;
  created_at: string; updated_at: string;
};
export type AutomationInsert = Omit<AutomationRow, "id" | "created_at" | "updated_at" | "last_run_at" | "consecutive_failures" | "status" | "config" | "autonomy_policy"> & {
  status?: AutomationStatus; config?: Json; autonomy_policy?: number; last_run_at?: string | null; consecutive_failures?: number;
};

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "skipped";
export type JobTrigger = "schedule" | "manual" | "assistant" | "system";
export type JobRow = {
  id: string; automation_id: string | null; run_type: string; agent_id: string | null; client_id: string | null; project_id: string | null;
  payload: Json; scheduled_for: string; status: JobStatus; attempts: number; max_attempts: number; lease_expires_at: string | null;
  worker_id: string | null; idempotency_key: string; trigger: JobTrigger; last_error: string | null; result: Json | null;
  agent_run_id: string | null; created_at: string; updated_at: string; started_at: string | null; finished_at: string | null;
};
export type JobInsert = {
  automation_id?: string | null; run_type: string; agent_id?: string | null; client_id?: string | null; project_id?: string | null;
  payload?: Json; scheduled_for?: string; idempotency_key: string; trigger?: JobTrigger; max_attempts?: number;
};

export type ReportKind = "weekly" | "monthly" | "google_ads";
export type ReportStatus = "draft" | "ready_for_review" | "approved" | "sent" | "archived";
export type ReportRow = {
  id: string; client_id: string | null; kind: ReportKind; period_start: string; period_end: string; status: ReportStatus; version: number;
  title: string; summary: string; internal_content: Json; client_content: Json; generated_at: string | null; approved_at: string | null;
  approved_by: string | null; approved_version: number | null; sent_at: string | null; archived_at: string | null; delivery: Json;
  created_at: string; updated_at: string;
};
// scope : colonne ajoutée par 20261016000000_google_ads_reports.sql ; volontairement absente de ReportRow
// (les listes ne la lisent pas, pour rester compatibles avec une base où la migration n'est pas appliquée).
export type ReportInsert = Partial<Omit<ReportRow, "id" | "created_at" | "updated_at">> & Pick<ReportRow, "kind" | "period_start" | "period_end"> & { scope?: Json };
export type ReportVersionRow = { id: string; report_id: string; version: number; summary: string; internal_content: Json; client_content: Json; created_by: string | null; created_at: string };

export type AgendaKind = "event" | "meeting" | "work_block" | "check" | "automation";
export type AgendaRecurrence = "none" | "daily" | "weekly" | "monthly";
export type AgendaItemRow = {
  id: string; kind: AgendaKind; title: string; notes: string | null; client_id: string | null; project_id: string | null; agent_id: string | null;
  automation_id: string | null; starts_at: string; duration_minutes: number; timezone: string; recurrence: AgendaRecurrence; recurrence_until: string | null;
  priority: "low" | "normal" | "high"; status: "planned" | "done" | "cancelled"; created_by: string | null; created_at: string; updated_at: string;
};
export type AgendaItemInsert = Omit<AgendaItemRow, "id" | "created_at" | "updated_at" | "status" | "priority" | "notes" | "created_by"> & {
  status?: AgendaItemRow["status"]; priority?: AgendaItemRow["priority"]; notes?: string | null; created_by?: string | null;
};

export type IncidentRow = {
  id: string; client_id: string; project_id: string | null; agent_id: string | null; source: "monitoring" | "seo" | "ads" | "publications" | "system";
  severity: "info" | "low" | "medium" | "high" | "critical"; title: string; details: Json; fingerprint: string; status: "open" | "investigating" | "resolved";
  recommendation_id: string | null; detected_at: string; resolved_at: string | null; created_at: string; updated_at: string;
};
export type IncidentInsert = Pick<IncidentRow, "client_id" | "source" | "title" | "fingerprint"> & Partial<Pick<IncidentRow, "project_id" | "agent_id" | "severity" | "details" | "status" | "recommendation_id">>;

export type SiteCheckRow = { id: string; client_id: string; url: string; checked_at: string; ok: boolean; status_code: number | null; response_ms: number | null; error_kind: string | null; details: Json; job_id: string | null };
export type MetricSnapshotRow = { id: string; client_id: string | null; provider: string; metric_key: string; period_start: string; period_end: string; data: Json; fetched_at: string };
export type NewsItemRow = { id: string; source_id: string; source_name: string; title: string; url: string; category: "IA" | "Développement" | "SEO" | "Ads" | "Web"; summary: string; published_at: string | null; score: number; dedupe_key: string; fetched_at: string };

export type CoreTables = {
  automations: Table<AutomationRow, AutomationInsert>;
  jobs: Table<JobRow, JobInsert, Partial<Omit<JobRow, "id" | "idempotency_key" | "created_at">>>;
  reports: Table<ReportRow & { scope?: Json }, ReportInsert>;
  report_versions: Table<ReportVersionRow & { scope?: Json | null }, Omit<ReportVersionRow, "id" | "created_at"> & { scope?: Json | null }, never>;
  agenda_items: Table<AgendaItemRow, AgendaItemInsert>;
  incidents: Table<IncidentRow, IncidentInsert>;
  site_checks: Table<SiteCheckRow, Omit<SiteCheckRow, "id" | "checked_at" | "details" | "job_id"> & { details?: Json; job_id?: string | null; checked_at?: string }>;
  metric_snapshots: Table<MetricSnapshotRow, Omit<MetricSnapshotRow, "id" | "fetched_at"> & { fetched_at?: string }>;
  news_items: Table<NewsItemRow, Omit<NewsItemRow, "id" | "fetched_at" | "score" | "summary"> & { score?: number; summary?: string }>;
};

export type CoreFunctions = {
  codev_claim_jobs: { Args: { p_worker: string; p_limit: number; p_lease_seconds: number }; Returns: JobRow[] };
};
