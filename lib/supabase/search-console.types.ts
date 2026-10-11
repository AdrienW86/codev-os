// Types des tables Google Search Console (migration 20261022000000_search_console_integration.sql).
type Table<Row, Insert, Update = Partial<Insert>> = { Row: Row; Insert: Insert; Update: Update; Relationships: [] };

export type IntegrationCredentialSecretRow = { reference: string; provider: "search-console"; key_id: string; iv: string; ciphertext: string; auth_tag: string; created_at: string };
export type IntegrationOAuthStateRow = { id: string; state_hash: string; provider: "search-console"; actor_id: string; created_at: string; expires_at: string; consumed_at: string | null };
export type SearchConsoleDailyRow = { client_id: string; property: string; date: string; clicks: number; impressions: number; position: number | null; fetched_at: string };
export type SearchConsoleSyncTrigger = "daily" | "manual" | "dashboard";
export type SearchConsoleSyncRunRow = { id: string; client_id: string; property: string; trigger: SearchConsoleSyncTrigger; sync_date: string; status: "running" | "succeeded" | "failed"; error_kind: string | null; started_at: string; finished_at: string | null };

export type SearchConsoleTables = {
  integration_credential_secrets: Table<IntegrationCredentialSecretRow, Omit<IntegrationCredentialSecretRow, "created_at">, never>;
  integration_oauth_states: Table<IntegrationOAuthStateRow, Pick<IntegrationOAuthStateRow, "state_hash" | "provider" | "actor_id" | "expires_at">, { consumed_at: string }>;
  search_console_daily_metrics: Table<SearchConsoleDailyRow, Omit<SearchConsoleDailyRow, "fetched_at"> & { fetched_at?: string }>;
  search_console_sync_runs: Table<SearchConsoleSyncRunRow, Pick<SearchConsoleSyncRunRow, "client_id" | "property" | "trigger" | "sync_date">, Partial<Pick<SearchConsoleSyncRunRow, "status" | "error_kind" | "finished_at">>>;
};
