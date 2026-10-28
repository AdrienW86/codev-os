import "server-only";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { auditedMutation } from "@/lib/core/audited-mutation";
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
  const { userId } = await requireAdmin();
  const validation = validateClientForm(formData);
  const values: NonNullable<ClientFormState["values"]> = {};
  for (const field of Object.keys(clientFieldLimits) as (keyof typeof clientFieldLimits)[]) {
    const value = formData.get(field);
    if (typeof value === "string") values[field] = value.trim().slice(0, clientFieldLimits[field]);
  }
  if (!validation.ok) return { ok: false, state: { values, errors: validation.errors, message: "Corrigez les champs indiqués." } };
  try {
    // Création et journal dans la même transaction (audit P1-03).
    const data = await auditedMutation<Client>({ table: "clients", operation: "insert", values: validation.data, columns: columns.split(","),
      audit: { action: "client.created", resource_type: "client", actor_type: "admin", actor_id: userId } });
    if (!data) throw new Error();
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
    const after = await auditedMutation<Client>({ table: "clients", operation: "update", id, values: validation.data, columns: columns.split(","), auditColumns: columns.split(","),
      audit: { action: "client.updated", resource_type: "client", resource_id: id, actor_type: "admin", actor_id: userId } });
    if (!after) return { ok: false, state: { message: "Client indisponible.", values } };
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
    const deleted = await auditedMutation({ table: "clients", operation: "delete", id, columns: ["id"], auditColumns: columns.split(","),
      audit: { action: "client.deleted", resource_type: "client", resource_id: id, actor_type: "admin", actor_id: userId } });
    if (!deleted) return { ok: false, message: "Impossible de supprimer ce client. Actualisez la liste et réessayez." };
    return { ok: true };
  } catch {
    console.error("[clients] Échec du stockage (delete).");
    return { ok: false, message: "Impossible de confirmer la suppression. Rechargez la liste avant de réessayer." };
  }
}
