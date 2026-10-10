export type AdsScopeRow = { client_id: string; connection_id: string; provider: "google_ads"; account_id: string; revision: number; updated_at: string };
export type AdsCampaignAssignmentRow = { account_id: string; campaign_id: string; client_id: string };
type Table<R, I> = { Row: R; Insert: I; Update: Partial<I>; Relationships: [] };
export type AdsReportSettingsRow = { client_id: string; revision: number; config: Json; next_due_at: string; next_prepare_at: string; updated_at: string };
export type AdsReportOccurrenceRow = { id: string; client_id: string; revision: number; config: Json; period_window: Json; due_at: string; prepare_at: string; report_id: string; preparation: string; transport: string; reason: string | null; created_at: string };
export type AdsWorkspaceTables = {
  client_ads_report_settings: Table<AdsReportSettingsRow, Omit<AdsReportSettingsRow, "updated_at">>;
  ads_report_occurrences: Table<AdsReportOccurrenceRow, Omit<AdsReportOccurrenceRow, "id" | "created_at">>;

  client_ads_scopes: Table<AdsScopeRow, Omit<AdsScopeRow, "revision" | "updated_at" | "provider">>;
  client_ads_campaigns: Table<AdsCampaignAssignmentRow, AdsCampaignAssignmentRow>;
  client_ads_context: Table<{ client_id: string; context: Json; revision: number; updated_at: string }, { client_id: string; context: Json; revision?: number }>;
  ads_analysis_leases: Table<{ client_id: string; token: string; expires_at: string; next_allowed_at: string }, { client_id: string; token: string; expires_at: string; next_allowed_at: string }>;
  report_deliveries: Table<{ report_id: string; version: number; token: string; state: string; recipient: string; subject: string; body: string; provider_id: string | null; created_at: string; updated_at: string }, { report_id: string; version: number; token: string; recipient: string; subject: string; body: string }>;
  admin_notifications: Table<{ id: string; event_key: string; category: string; href: string; created_at: string }, { event_key: string; category: string; href: string }>;
  admin_notification_reads: Table<{ notification_id: string; user_id: string; read_at: string }, { notification_id: string; user_id: string }>;
  admin_notification_preferences: Table<{ user_id: string; categories: string[]; push_enabled: boolean; push_categories: string[] }, { user_id: string; categories: string[]; push_enabled: boolean; push_categories: string[] }>;
  admin_push_subscriptions: Table<{ id: string; user_id: string; device_id: string; endpoint: string; keys: Json; created_at: string }, { user_id: string; device_id: string; endpoint: string; keys: Json }>;
  admin_push_deliveries: Table<PushDelivery, { notification_id: string; subscription_id: string; state?: string; token?: string | null; updated_at?: string }>;
};
export type AdsWorkspaceFunctions = {
  codev_save_ads_report_settings: { Args: { p_client_id: string; p_revision: number; p_config: Json; p_due: string; p_prepare: string }; Returns: number };
  codev_enqueue_ads_report: { Args: { p_client_id: string; p_revision: number; p_due: string; p_window: Json; p_next_due: string; p_next_prepare: string; p_manual?: boolean }; Returns: string | null };
  codev_store_ads_report: { Args: { p_occurrence: string; p_job: string; p_worker: string; p_report: Json }; Returns: boolean };
  codev_claim_recurring_delivery: { Args: { p_occurrence: string; p_job: string; p_worker: string; p_report_id: string; p_version: number; p_token: string; p_recipient: string; p_subject: string; p_body: string; p_content: Json }; Returns: boolean };

  codev_set_ads_campaigns: { Args: { p_client_id: string; p_connection_id: string; p_account_id: string; p_campaign_ids: string[]; p_revision: number }; Returns: number };
  codev_save_ads_context: { Args: { p_client_id: string; p_context: Json; p_revision: number }; Returns: number };
  codev_claim_ads_analysis: { Args: { p_client_id: string; p_token: string }; Returns: boolean };
  codev_claim_report_delivery: { Args: { p_report_id: string; p_version: number; p_token: string; p_recipient: string; p_subject: string; p_body: string; p_content: Json }; Returns: boolean };
  codev_finish_report_delivery: { Args: { p_report_id: string; p_version: number; p_token: string; p_state: string; p_provider_id: string | null }; Returns: boolean };
  codev_subscribe_push: { Args: { p_user_id: string; p_device_id: string; p_endpoint: string; p_keys: Json }; Returns: string };
  codev_claim_push: { Args: { p_token: string; p_limit: number }; Returns: PushDelivery[] };
  codev_unread_notifications: { Args: { p_user_id: string }; Returns: number };
};
export type PushDelivery = { notification_id: string; subscription_id: string; state: string; token: string | null; created_at: string; updated_at: string };
import type { Json } from "./database.types";
