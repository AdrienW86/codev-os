import "server-only";
import { ga4Deps, readGa4Connection } from "@/lib/integrations/ga4/connection";
import { GA4_PROVIDER, normalizeGa4Property } from "@/lib/integrations/ga4/model";
import { syncGa4 } from "@/lib/integrations/ga4/sync";

/**
 * Une propriété client par passage du planificateur, synchronisation quotidienne
 * de la fenêtre glissante 7 jours. Périodes 30/90 jours synchronisées à l'ouverture
 * du tableau de bord. Aucune écriture chez Google.
 */
export async function syncDueGa4(now = new Date()) {
  const deps = ga4Deps();
  const global = await readGa4Connection(deps.db);
  if (!global || global.status !== "active") return { disabled: true };
  const { data, error } = await deps.db.from("client_connections")
    .select("client_id,metadata,last_sync_at").eq("provider", GA4_PROVIDER).not("client_id", "is", null)
    .order("last_sync_at", { ascending: true, nullsFirst: true }).limit(20);
  if (error) throw new Error("GA4 daily list");
  const due = (data ?? []).find(row => normalizeGa4Property((row.metadata as Record<string, unknown> | null)?.property_id)
    && (!row.last_sync_at || now.getTime() - Date.parse(row.last_sync_at) >= 23 * 60 * 60 * 1000));
  if (!due?.client_id) return { clients: 0, synced: 0 };
  const dayInParis = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const endDate = new Date(Date.parse(dayInParis + "T00:00:00Z") - 86_400_000);
  const startDate = new Date(endDate.getTime() - 6 * 86_400_000);
  const period = { start: startDate.toISOString().slice(0, 10), end: endDate.toISOString().slice(0, 10) };
  const result = await syncGa4(due.client_id, period, deps);
  return { clients: 1, synced: result.ok ? 1 : 0, failed: result.ok ? 0 : 1 };
}
