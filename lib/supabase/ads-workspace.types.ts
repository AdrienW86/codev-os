export type AdsScopeRow = { client_id: string; connection_id: string; provider: "google_ads"; account_id: string; revision: number; updated_at: string };
export type AdsCampaignAssignmentRow = { account_id: string; campaign_id: string; client_id: string };
type Table<R, I> = { Row: R; Insert: I; Update: Partial<I>; Relationships: [] };
export type AdsWorkspaceTables = {
  client_ads_scopes: Table<AdsScopeRow, Omit<AdsScopeRow, "revision" | "updated_at" | "provider">>;
  client_ads_campaigns: Table<AdsCampaignAssignmentRow, AdsCampaignAssignmentRow>;
  client_ads_context: Table<{ client_id: string; context: Json; revision: number; updated_at: string }, { client_id: string; context: Json; revision?: number }>;
  ads_analysis_leases: Table<{ client_id: string; token: string; expires_at: string; next_allowed_at: string }, { client_id: string; token: string; expires_at: string; next_allowed_at: string }>;
  report_deliveries: Table<{ report_id: string; version: number; token: string; state: string; recipient: string; subject: string; body: string; provider_id: string | null; created_at: string; updated_at: string }, { report_id: string; version: number; token: string; recipient: string; subject: string; body: string }>;
};
export type AdsWorkspaceFunctions = {
  codev_set_ads_campaigns: { Args: { p_client_id: string; p_connection_id: string; p_account_id: string; p_campaign_ids: string[]; p_revision: number }; Returns: number };
  codev_save_ads_context: { Args: { p_client_id: string; p_context: Json; p_revision: number }; Returns: number };
  codev_claim_ads_analysis: { Args: { p_client_id: string; p_token: string }; Returns: boolean };
  codev_claim_report_delivery: { Args: { p_report_id: string; p_version: number; p_token: string; p_recipient: string; p_subject: string; p_body: string; p_content: Json }; Returns: boolean };
  codev_finish_report_delivery: { Args: { p_report_id: string; p_version: number; p_token: string; p_state: string; p_provider_id: string | null }; Returns: boolean };
};
import type { Json } from "./database.types";
