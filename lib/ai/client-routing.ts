import "server-only";
// Activation de Claude client par client : avec la clé Anthropic, seuls les clients cochés (fiche client → Agents)
// passent sur Claude ; les autres gardent OpenAI comme avant. Table absente (migration non appliquée) : aucun client.
import { getSupabaseServerClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TTL_MS = 60_000;
const cache = new Map<string, { value: boolean; at: number }>();
const missingTable = (error: unknown) => {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === "42P01" || e?.code === "PGRST205" || /could not find the table|does not exist/i.test(e?.message ?? "");
};
export const ROUTING_NOT_INSTALLED = "Choix du modèle non installé : appliquez la migration 20261208000000_agents_model_routing.";

/** Le client a-t-il ses agents sur Claude ? Lecture mise en cache 1 minute ; en cas d'erreur, non (comportement d'avant). */
export async function claudeEnabledFor(clientId: string | undefined | null): Promise<boolean> {
  if (!clientId || !UUID.test(clientId)) return false;
  const hit = cache.get(clientId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const { data, error } = await getSupabaseServerClient().from("client_ai_settings" as never).select("claude_enabled").eq("client_id", clientId).maybeSingle();
  if (error && !missingTable(error)) console.error("[ai] Choix du modèle du client illisible.");
  const value = !error && (data as { claude_enabled?: unknown } | null)?.claude_enabled === true;
  cache.set(clientId, { value, at: Date.now() });
  return value;
}

/** Réglage affiché sur la fiche client : true / false, null si la migration n'est pas appliquée. Erreur : exception. */
export async function readClientClaude(clientId: string): Promise<boolean | null> {
  if (!UUID.test(clientId)) throw new Error("client invalid");
  const { data, error } = await getSupabaseServerClient().from("client_ai_settings" as never).select("claude_enabled").eq("client_id", clientId).maybeSingle();
  if (error) { if (missingTable(error)) return null; throw new Error("routing read"); }
  return (data as { claude_enabled?: unknown } | null)?.claude_enabled === true;
}

/** Réglage par l'administrateur (fiche client → Agents). */
export async function saveClientClaude(userId: string, clientId: string, enabled: boolean): Promise<{ ok: boolean; message: string }> {
  if (!/^user_[a-zA-Z0-9_-]{1,200}$/.test(userId) || !UUID.test(clientId)) return { ok: false, message: "Requête invalide." };
  const { error } = await getSupabaseServerClient().from("client_ai_settings" as never).upsert(
    { client_id: clientId, claude_enabled: enabled, updated_by: userId, updated_at: new Date().toISOString() } as never, { onConflict: "client_id" });
  if (error) return { ok: false, message: missingTable(error) ? ROUTING_NOT_INSTALLED : "Réglage non enregistré." };
  cache.delete(clientId);
  return { ok: true, message: enabled ? "Agents de ce client sur Claude." : "Agents de ce client sur OpenAI." };
}
