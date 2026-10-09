import "server-only";
// Trace de synchronisation d'une source (dernier succès / dernière erreur normalisée).
// Le message est celui de ProviderError (générique), jamais une réponse brute du fournisseur.
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function recordSync(clientId: string, provider: string, error: unknown | null) {
  const message = error === null ? null : (typeof (error as { message?: unknown })?.message === "string" ? (error as { message: string }).message : "Erreur inconnue").slice(0, 300);
  const patch = message === null ? { last_sync_at: new Date().toISOString(), last_error: null } : { last_error: message };
  // Best effort : une trace manquée ne doit jamais faire échouer l'exécution de l'agent.
  await getSupabaseServerClient().from("client_connections").update(patch).eq("client_id", clientId).eq("provider", provider).then(() => undefined, () => undefined);
}
