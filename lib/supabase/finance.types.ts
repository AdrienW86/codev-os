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

// Qonto read-only : données minimales et attribuées manuellement aux clients CODE-V.
export type FinanceQontoInvoiceRow = {
  id:string; external_id:string; external_client_id:string|null; external_client_name:string|null;
  client_id:string|null; number:string; status:string; total_cents:number; currency:"EUR";
  issued_on:string|null; due_on:string|null; source_updated_at:string|null;
  synced_at:string; assigned_by:string|null; assigned_at:string|null;
};
export type FinanceQontoCreditRow = {
  id:string; external_id:string; external_bank_account_id:string; amount_cents:number; currency:"EUR";
  side:"credit"; status:"completed"|"reversed"; label:string; reference:string;
  settled_at:string; source_updated_at:string|null; synced_at:string;
};
export type FinanceQontoAllocationRow = {
  id:string; invoice_id:string; transaction_id:string; amount_cents:number; assigned_by:string; created_at:string;
};
export type FinanceQontoSyncStateRow = {
  id:boolean; status:"never"|"ok"|"error"; last_attempt_at:string|null;
  last_success_at:string|null; invoice_count:number; credit_count:number; error_code:string|null; synced_by:string|null;
};
export type FinanceQontoTables = {
  finance_qonto_invoices: Table<FinanceQontoInvoiceRow,
    Pick<FinanceQontoInvoiceRow,"external_id"|"external_client_id"|"external_client_name"|"number"|"status"|"total_cents"|"currency"|"issued_on"|"due_on"|"source_updated_at"|"synced_at"> &
    Partial<Pick<FinanceQontoInvoiceRow,"client_id"|"assigned_by"|"assigned_at">>>;
  finance_qonto_transactions: Table<FinanceQontoCreditRow,
    Pick<FinanceQontoCreditRow,"external_id"|"external_bank_account_id"|"amount_cents"|"currency"|"side"|"status"|"label"|"reference"|"settled_at"|"source_updated_at"|"synced_at">>;
  finance_qonto_allocations: Table<FinanceQontoAllocationRow,never,never>;
  finance_qonto_sync_state: Table<FinanceQontoSyncStateRow,Partial<FinanceQontoSyncStateRow> & {id:boolean}>;
};
