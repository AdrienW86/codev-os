import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import { getSourceDefinition, normalizeSourceValue, sourceDefinitions } from "@/lib/connections/sources";

const db = () => getSupabaseServerClient();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ClientSource = { provider: string; value: string | null; status: string | null; lastError: string | null; lastSyncAt: string | null };

export async function listClientSources(clientId: string): Promise<ClientSource[]> {
  if (!uuid.test(clientId)) return [];
  const { data, error } = await db().from("client_connections").select("provider,status,metadata,last_error,last_sync_at").eq("client_id", clientId).in("provider", sourceDefinitions.map((item) => item.provider));
  if (error) throw new Error("sources read");
  return sourceDefinitions.map((definition) => {
    const row = (data ?? []).find((item) => item.provider === definition.provider);
    const value = (row?.metadata as Record<string, unknown> | undefined)?.[definition.field];
    return { provider: definition.provider, value: typeof value === "string" ? value : null, status: row?.status ?? null, lastError: row?.last_error ?? null, lastSyncAt: row?.last_sync_at ?? null };
  });
}

export async function saveClientSource(actor: Actor & { kind: "admin" }, clientId: string, provider: string, raw: string): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const definition = getSourceDefinition(provider);
  const normalized = normalizeSourceValue(provider, raw);
  if (!definition || !normalized.ok) return { ok: false, message: normalized.ok ? "Source inconnue." : normalized.message };
  if (!uuid.test(clientId)) return { ok: false, message: "Client introuvable." };
  const { data: client, error: clientError } = await db().from("clients").select("id").eq("id", clientId).maybeSingle();
  if (clientError) throw new Error("client read");
  if (!client) return { ok: false, message: "Client introuvable." };
  const { data: existing, error } = await db().from("client_connections").select("id").eq("client_id", clientId).eq("provider", provider).maybeSingle();
  if (error) throw new Error("source read");
  const patch = { status: normalized.value ? "configured" : "disconnected", metadata: normalized.value ? { [definition.field]: normalized.value } : {}, last_error: null };
  const result = existing
    ? await db().from("client_connections").update(patch).eq("id", existing.id).eq("client_id", clientId)
    : await db().from("client_connections").insert({ client_id: clientId, provider, scope: "client", ...patch });
  if (result.error) throw new Error("source write");
  await writeAudit(actor, { action: normalized.value ? "connection.configured" : "connection.removed", resource_type: "client_connection", resource_id: existing?.id ?? null, metadata: { client_id: clientId, provider } });
  return { ok: true, message: normalized.value ? `${definition.label} enregistré pour ce client.` : `${definition.label} retiré.` };
}
