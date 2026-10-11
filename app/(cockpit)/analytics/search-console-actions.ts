"use server";

import { requireAdminWriter, SimulationWriteBlocked } from "@/lib/core/guards";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { syncSearchConsole } from "@/lib/integrations/search-console/sync";
import { dayCount, isPeriod } from "@/lib/integrations/search-console/model";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** « Synchroniser maintenant » : période affichée uniquement ; refusée si une synchronisation est déjà en cours. */
export async function syncSearchConsoleNowAction(clientId: string, start: string, end: string): Promise<{ ok: boolean; message: string }> {
  try { await requireAdminWriter(); } catch (error) {
    if (error instanceof SimulationWriteBlocked) return { ok: false, message: error.message };
    throw error;
  }
  const period = { start, end };
  if (!uuid.test(clientId) || !isPeriod(period) || dayCount(period) > 366) return { ok: false, message: "Période invalide." };
  try {
    const { data } = await getSupabaseServerClient().from("search_console_sync_runs").select("id").eq("client_id", clientId).eq("status", "running").gte("started_at", new Date(Date.now() - 2 * 60_000).toISOString()).limit(1);
    if (data?.length) return { ok: false, message: "Une synchronisation Search Console est déjà en cours pour ce client." };
    const result = await syncSearchConsole(clientId, period, "manual");
    if (result.ok) return { ok: true, message: result.warning ?? "Données Search Console synchronisées." };
    return { ok: false, message: result.reason === "no_property" ? "Aucune propriété Search Console n’est associée à ce client." : result.reason === "not_connected" ? "Google Search Console n’est pas connecté (Paramètres → Connexions)." : result.error ?? "Synchronisation indisponible." };
  } catch {
    console.error("[search-console] Synchronisation manuelle indisponible.");
    return { ok: false, message: "Synchronisation indisponible. Réessayez dans quelques instants." };
  }
}
