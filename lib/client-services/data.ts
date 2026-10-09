import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit-logs";
import type { ClientServiceDeleteResult, ClientServiceMutationResult, ClientServiceRecord } from "./types";
import { validateClientServiceForm } from "./validation";

const columns = "id,client_id,service_type,status,monthly_fee_eur,notes,created_at";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const genericError = "Impossible de traiter ce service. Actualisez la fiche client et réessayez.";

function storageFailure(operation: "list" | "create" | "update" | "delete"): never {
  console.error(`[client-services] Échec du stockage (${operation}).`);
  throw new Error("Le stockage des services client est indisponible. Réessayez plus tard.");
}

function serviceSnapshot(service: ClientServiceRecord) {
  return { id: service.id, client_id: service.client_id, service_type: service.service_type, status: service.status, monthly_fee_eur: service.monthly_fee_eur, created_at: service.created_at };
}

export async function listClientServices(clientId: string): Promise<ClientServiceRecord[]> {
  await requireAdmin();
  if (!uuid.test(clientId)) return [];
  try {
    const { data, error } = await getSupabaseServerClient().from("client_services").select(columns).eq("client_id", clientId).order("created_at", { ascending: false });
    if (error) throw new Error();
    return data ?? [];
  } catch { storageFailure("list"); }
}

async function clientExists(clientId: string) {
  const { data, error } = await getSupabaseServerClient().from("clients").select("id").eq("id", clientId).maybeSingle();
  if (error) throw new Error();
  return Boolean(data);
}

export async function createClientService(formData: FormData): Promise<ClientServiceMutationResult> {
  const { userId } = await requireAdmin();
  const validation = validateClientServiceForm(formData);
  if (!validation.ok) return { ok: false, state: validation.state };
  try {
    if (!await clientExists(validation.data.client_id)) return { ok: false, state: { errors: { client_id: "Client indisponible." }, values: validation.values } };
    const { data, error } = await getSupabaseServerClient().from("client_services").insert(validation.data).select(columns).single();
    if (error || !data) throw new Error();
    await writeAuditLog({ action: "client_service.created", actor_type: "admin", actor_id: userId, resource_type: "client_service", resource_id: data.id, before_data: null, after_data: serviceSnapshot(data), metadata: {} });
    return { ok: true, service: data };
  } catch {
    console.error("[client-services] Échec du stockage (create).");
    return { ok: false, state: { values: validation.values, message: "Impossible de confirmer la création. Rechargez la fiche avant de réessayer." } };
  }
}

export async function updateClientService(formData: FormData): Promise<ClientServiceMutationResult> {
  const { userId } = await requireAdmin();
  const validation = validateClientServiceForm(formData, true);
  if (!validation.ok) return { ok: false, state: validation.state };
  const id = validation.id as string;
  try {
    if (!await clientExists(validation.data.client_id)) return { ok: false, state: { errors: { client_id: "Client indisponible." }, values: validation.values } };
    const supabase = getSupabaseServerClient();
    const { data: before, error: readError } = await supabase.from("client_services").select(columns).eq("id", id).eq("client_id", validation.data.client_id).maybeSingle();
    if (readError) throw new Error();
    if (!before) return { ok: false, state: { errors: { id: "Service indisponible." }, values: validation.values } };
    const { data: after, error: updateError } = await supabase.from("client_services").update({ service_type: validation.data.service_type, status: validation.data.status, monthly_fee_eur: validation.data.monthly_fee_eur, notes: validation.data.notes }).eq("id", id).eq("client_id", validation.data.client_id).select(columns).single();
    if (updateError || !after) throw new Error();
    await writeAuditLog({ action: "client_service.updated", actor_type: "admin", actor_id: userId, resource_type: "client_service", resource_id: id, before_data: serviceSnapshot(before), after_data: serviceSnapshot(after), metadata: {} });
    return { ok: true, service: after };
  } catch {
    console.error("[client-services] Échec du stockage (update).");
    return { ok: false, state: { values: validation.values, message: "Impossible de confirmer la modification. Rechargez la fiche avant de réessayer." } };
  }
}

export async function deleteClientService(id: string, clientId: string): Promise<ClientServiceDeleteResult> {
  const { userId } = await requireAdmin();
  if (!uuid.test(id) || !uuid.test(clientId)) return { ok: false, message: genericError };
  try {
    const supabase = getSupabaseServerClient();
    const { data: before, error: readError } = await supabase.from("client_services").select(columns).eq("id", id).eq("client_id", clientId).maybeSingle();
    if (readError) throw new Error();
    if (!before) return { ok: false, message: genericError };
    const { data: deleted, error: deleteError } = await supabase.from("client_services").delete().eq("id", id).eq("client_id", clientId).select("id").maybeSingle();
    if (deleteError || !deleted) throw new Error();
    await writeAuditLog({ action: "client_service.deleted", actor_type: "admin", actor_id: userId, resource_type: "client_service", resource_id: id, before_data: serviceSnapshot(before), after_data: null, metadata: {} });
    return { ok: true };
  } catch {
    console.error("[client-services] Échec du stockage (delete).");
    return { ok: false, message: "Impossible de confirmer la suppression. Rechargez la fiche avant de réessayer." };
  }
}