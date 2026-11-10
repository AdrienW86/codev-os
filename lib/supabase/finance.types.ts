// Contrats commerciaux indépendants des services techniques/agents.
import type { Json } from "@/lib/supabase/database.types";
type Table<Row, Insert, Update = Partial<Insert>> = { Row: Row; Insert: Insert; Update: Update; Relationships: [] };
export type FinanceCategoryRow = { code: string; label: string; sort_order: number; archived_at: string | null };
export type FinanceCatalogRow = {
  id: string; code: string; category_code: string; name: string; description: string;
  billing_unit: string; billing_frequency: "ponctuel" | "mensuel" | "annuel";
  reference_min_cents: number | null; reference_max_cents: number | null; default_price_cents: number | null;
  currency: "EUR"; source: string; archived_at: string | null; updated_by: string | null;
  created_at: string; updated_at: string;
};
export type FinanceContractRow = {
  id: string; client_id: string; catalog_item_id: string | null; name: string; description: string;
  billing_unit: string; billing_frequency: "ponctuel" | "mensuel" | "annuel";
  unit_price_cents: number; quantity: number; currency: "EUR"; starts_on: string; ends_on: string | null;
  status: "draft" | "active" | "paused" | "ended"; reference: string | null; notes: string | null;
  updated_by: string | null; created_at: string; updated_at: string;
};
export type FinanceTables = {
  finance_categories: Table<FinanceCategoryRow, { code: string; label: string; sort_order?: number; archived_at?: string | null }>;
  finance_catalog_items: Table<FinanceCatalogRow, {
    code: string; category_code: string; name: string; description: string;
    billing_unit: string; billing_frequency: FinanceCatalogRow["billing_frequency"];
    reference_min_cents?: number | null; reference_max_cents?: number | null; default_price_cents?: number | null;
    updated_by?: string | null; archived_at?: string | null; source?: string;
  }>;
  finance_client_contracts: Table<FinanceContractRow, {
    client_id: string; catalog_item_id?: string | null; name: string; description: string; billing_unit: string;
    billing_frequency: FinanceContractRow["billing_frequency"]; unit_price_cents: number; quantity: number;
    starts_on: string; ends_on?: string | null; status: FinanceContractRow["status"];
    reference?: string | null; notes?: string | null; updated_by?: string | null;
  }>;
  finance_catalog_history: Table<{ id: number; catalog_item_id: string; snapshot: Json; changed_by: string | null; changed_at: string }, never, never>;
  finance_contract_history: Table<{ id: number; contract_id: string; snapshot: Json; changed_by: string | null; changed_at: string }, never, never>;
};
