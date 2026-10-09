import type { ClientServiceRow } from "@/lib/supabase/database.types";

export type ClientServiceRecord = ClientServiceRow;
export type ClientServiceField = "client_id" | "service_type" | "status" | "monthly_fee_eur" | "notes" | "id";
export type ClientServiceFormState = {
  errors?: Partial<Record<ClientServiceField, string>>;
  values?: Partial<Record<ClientServiceField, string>>;
  message?: string;
};
export type ClientServiceMutationResult = { ok: true; service: ClientServiceRecord } | { ok: false; state: ClientServiceFormState };
export type ClientServiceDeleteResult = { ok: true } | { ok: false; message: string };