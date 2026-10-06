import "server-only";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit-logs";
import { validateClientForm, clientFieldLimits } from "./validation";
import type { Client, ClientFormState } from "./types";

const columns = "id,name,company_name,activity,email,phone,website,geographic_area,notes,created_at,updated_at";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function storageFailure(operation: "list" | "detail" | "create" | "update" | "delete"): never {
  // Aucun objet d’erreur, contenu SQL, identifiant, clé ou donnée client.
  console.error(`[clients] Échec du stockage (${operation}).`);
  throw new Error("Le stockage clients est indisponible. Réessayez plus tard.");
}

export async function listClients(): Promise<Client[]> {
  await requireAdmin();
  try {
    const supabase = getSupabaseServerClient();
    const clients: Client[] = [];
    const pageSize = 100;
    // Évite de tronquer silencieusement la liste à la limite REST Supabase.
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.from("clients").select(columns).order("created_at", { ascending: false }).order("id").range(offset, offset + pageSize - 1);
      if (error) throw new Error();
      clients.push(...(data ?? []));
      if (!data || data.length < pageSize) return clients;
    }
  } catch { storageFailure("list"); }
}

export async function getClient(id: string): Promise<Client | null> {
  await requireAdmin();
  if (!uuid.test(id)) return null;
  try {
    const { data, error } = await getSupabaseServerClient().from("clients").select(columns).eq("id", id).maybeSingle();
    if (error) throw new Error();
    return data;
  } catch { storageFailure("detail"); }
}

export async function getClientOrNotFound(id: string): Promise<Client> {
  const client = await getClient(id); // getClient vérifie requireAdmin avant Supabase.
  if (!client) notFound();
  return client;
}

export async function createClientRecord(formData: FormData): Promise<
  { ok: true; client: Client } | { ok: false; state: ClientFormState }
> {
  await requireAdmin();
  const validation = validateClientForm(formData);
  const values: NonNullable<ClientFormState["values"]> = {};
  for (const field of Object.keys(clientFieldLimits) as (keyof typeof clientFieldLimits)[]) {
    const value = formData.get(field);
    if (typeof value === "string") values[field] = value.trim().slice(0, clientFieldLimits[field]);
  }
  if (!validation.ok) return { ok: false, state: { values, errors: validation.errors, message: "Corrigez les champs indiqués." } };
  try {
    const { data, error } = await getSupabaseServerClient().from("clients").insert(validation.data).select(columns).single();
    if (error || !data) throw new Error();
    return { ok: true, client: data };
  } catch {
    console.error("[clients] Échec du stockage (create).");
    return { ok: false, state: { values, message: "Impossible de confirmer la création. Vérifiez la liste des clients avant de réessayer." } };
  }
}

export async function updateClientRecord(formData: FormData): Promise<
  { ok: true; client: Client } | { ok: false; state: ClientFormState }
> {
  const { userId } = await requireAdmin();
  const idEntries = formData.getAll("id");
  const id = idEntries.length === 1 && typeof idEntries[0] === "string" ? idEntries[0] : "";
  const validation = validateClientForm(formData);
  const values: NonNullable<ClientFormState["values"]> = {};
  for (const field of Object.keys(clientFieldLimits) as (keyof typeof clientFieldLimits)[]) {
    const value = formData.get(field);
    if (typeof value === "string") values[field] = value.trim().slice(0, clientFieldLimits[field]);
  }
  if (!uuid.test(id)) return { ok: false, state: { message: "Client indisponible.", values } };
  if (!validation.ok) return { ok: false, state: { values, errors: validation.errors, message: "Corrigez les champs indiqués." } };

  try {
    const supabase = getSupabaseServerClient();
    const { data: before, error: readError } = await supabase.from("clients").select(columns).eq("id", id).maybeSingle();
    if (readError) throw new Error();
    if (!before) return { ok: false, state: { message: "Client indisponible.", values } };
    const { data: after, error: updateError } = await supabase.from("clients").update(validation.data).eq("id", id).select(columns).single();
    if (updateError || !after) throw new Error();
    await writeAuditLog({
      action: "client.updated",
      actor_type: "admin",
      actor_id: userId,
      resource_type: "client",
      resource_id: id,
      before_data: before,
      after_data: after,
      metadata: {},
    });
    return { ok: true, client: after };
  } catch {
    console.error("[clients] Échec du stockage (update).");
    return { ok: false, state: { values, message: "Impossible de confirmer la modification. Actualisez la fiche avant de réessayer." } };
  }
}

export async function deleteClient(id: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const { userId } = await requireAdmin();
  if (!uuid.test(id)) return { ok: false, message: "Impossible de supprimer ce client. Actualisez la liste et réessayez." };
  try {
    const supabase = getSupabaseServerClient();
    const { data: before, error: readError } = await supabase.from("clients").select(columns).eq("id", id).maybeSingle();
    if (readError) throw new Error();
    if (!before) return { ok: false, message: "Impossible de supprimer ce client. Actualisez la liste et réessayez." };
    const { data: deleted, error: deleteError } = await supabase.from("clients").delete().eq("id", id).select("id").maybeSingle();
    if (deleteError || !deleted) throw new Error();
    await writeAuditLog({
      action: "client.deleted",
      actor_type: "admin",
      actor_id: userId,
      resource_type: "client",
      resource_id: id,
      before_data: before,
      after_data: null,
      metadata: {},
    });
    return { ok: true };
  } catch {
    console.error("[clients] Échec du stockage (delete).");
    return { ok: false, message: "Impossible de confirmer la suppression. Rechargez la liste avant de réessayer." };
  }
}
