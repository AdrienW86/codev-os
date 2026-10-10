export type AdsScopeRow = { client_id: string; connection_id: string; provider: "google_ads"; account_id: string; revision: number; updated_at: string };
export type AdsCampaignAssignmentRow = { account_id: string; campaign_id: string; client_id: string };
type Table<R, I> = { Row: R; Insert: I; Update: Partial<I>; Relationships: [] };
export type AdsWorkspaceTables = {
  client_ads_scopes: Table<AdsScopeRow, Omit<AdsScopeRow, "revision" | "updated_at" | "provider">>;
  client_ads_campaigns: Table<AdsCampaignAssignmentRow, AdsCampaignAssignmentRow>;
};
export type AdsWorkspaceFunctions = {
  codev_set_ads_campaigns: { Args: { p_client_id: string; p_connection_id: string; p_account_id: string; p_campaign_ids: string[]; p_revision: number }; Returns: number };
};
