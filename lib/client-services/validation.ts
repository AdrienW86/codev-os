import type { ClientServiceInsert } from "@/lib/supabase/database.types";
import type { ClientServiceField, ClientServiceFormState } from "./types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields: ClientServiceField[] = ["id", "client_id", "service_type", "status", "monthly_fee_eur", "notes"];

export function validateClientServiceForm(formData: FormData, updating = false):
  | { ok: true; data: ClientServiceInsert; id: string | null; values: Partial<Record<ClientServiceField, string>> }
  | { ok: false; state: ClientServiceFormState } {
  const values: Partial<Record<ClientServiceField, string>> = {};
  const errors: Partial<Record<ClientServiceField, string>> = {};
  for (const field of fields) {
    const entries = formData.getAll(field);
    if (entries.length > 1 || entries.some((entry) => typeof entry !== "string")) {
      errors[field] = "Valeur invalide.";
      continue;
    }
    values[field] = typeof entries[0] === "string" ? entries[0].trim() : "";
  }
  const id = values.id ?? "";
  const clientId = values.client_id ?? "";
  const serviceType = values.service_type ?? "";
  const status = values.status ?? "";
  const fee = values.monthly_fee_eur ?? "";
  const notes = values.notes ?? "";
  if (updating && !uuid.test(id)) errors.id = "Service indisponible.";
  if (!uuid.test(clientId)) errors.client_id = "Client invalide.";
  if (!serviceType || serviceType.length > 120 || serviceType.includes("\0")) errors.service_type = "Type de service invalide (120 caractères maximum).";
  if (!status || status.length > 80 || status.includes("\0")) errors.status = "Statut invalide (80 caractères maximum).";
  if (fee && (!/^(?:\d+)(?:\.\d{1,2})?$/.test(fee) || !Number.isFinite(Number(fee)) || Number(fee) < 0 || Number(fee) > 1000000)) errors.monthly_fee_eur = "Renseignez un montant entre 0 et 1 000 000 €.";
  if (notes.length > 3000 || notes.includes("\0")) errors.notes = "Maximum 3 000 caractères.";
  if (Object.keys(errors).length) return { ok: false, state: { errors, values } };
  return {
    ok: true,
    id: updating ? id : null,
    values,
    data: { client_id: clientId, service_type: serviceType, status, monthly_fee_eur: fee ? Number(fee) : null, notes: notes || null },
  };
}