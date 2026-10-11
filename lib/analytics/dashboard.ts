import "server-only";
// Chargeur du tableau de bord « Données et performances ».
// Aucune logique de collecte propre : il lit les instantanés `metric_snapshots` (vercel/web_analytics)
// et, si besoin, déclenche la synchronisation existante (lib/vercel-analytics/sync.ts).
import { listClients } from "@/lib/clients/data";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isProviderConfigured } from "@/lib/system/providers";
import { syncVercelAnalytics } from "@/lib/vercel-analytics/sync";
import type { VercelAnalyticsSummary } from "@/lib/client-health/data";
import type { Json } from "@/lib/supabase/database.types";

/** Un instantané de la même période plus récent que ce délai est réutilisé sans appel à Vercel. */
const FRESH_MS = 2 * 60 * 60 * 1000;

export type AnalyticsClientOption = { id: string; name: string; connected: boolean; projectId: string | null; lastSyncAt: string | null; lastError: string | null };

export type AnalyticsDashboardState =
  | { status: "ready"; data: VercelAnalyticsSummary; fetchedAt: string; periodStart: string; periodEnd: string; stale: boolean }
  | { status: "not_connected"; reason: "project" | "token" }
  | { status: "unavailable"; lastError: string | null };

const object = (value: Json | null): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export async function listAnalyticsClients(): Promise<AnalyticsClientOption[]> {
  const clients = await listClients(); // listClients vérifie requireAdmin.
  const { data, error } = await getSupabaseServerClient().from("client_connections").select("client_id,last_sync_at,last_error,metadata").eq("provider", "vercel");
  if (error) throw new Error("analytics connections read");
  const connections = new Map((data ?? []).map((row) => [row.client_id, row]));
  return clients
    .map((client) => {
      const connection = connections.get(client.id);
      const projectId = connection ? object(connection.metadata).project_id : null;
      return {
        id: client.id,
        name: client.name,
        connected: typeof projectId === "string" && projectId.length > 0,
        projectId: typeof projectId === "string" ? projectId : null,
        lastSyncAt: connection?.last_sync_at ?? null,
        lastError: connection?.last_error ?? null,
      };
    })
    .sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name, "fr"));
}

async function readSnapshot(clientId: string, period: { start: string; end: string } | null) {
  let query = getSupabaseServerClient().from("metric_snapshots").select("period_start,period_end,fetched_at,data")
    .eq("client_id", clientId).eq("provider", "vercel").eq("metric_key", "web_analytics");
  if (period) query = query.eq("period_start", period.start).eq("period_end", period.end);
  const { data, error } = await query.order("fetched_at", { ascending: false }).limit(1);
  if (error) throw new Error("analytics snapshot read");
  const row = data?.[0];
  return row ? { periodStart: row.period_start, periodEnd: row.period_end, fetchedAt: row.fetched_at, data: object(row.data) as VercelAnalyticsSummary } : null;
}

/**
 * Données d'un client pour une période : instantané récent de la même période, sinon synchronisation
 * Vercel (qui enregistre l'instantané), sinon dernier instantané connu signalé comme ancien.
 */
export async function getAnalyticsDashboard(client: AnalyticsClientOption, period: { start: string; end: string }): Promise<AnalyticsDashboardState> {
  if (!client.connected) return { status: "not_connected", reason: "project" };
  const exact = await readSnapshot(client.id, period);
  if (exact && Date.now() - Date.parse(exact.fetchedAt) < FRESH_MS) return { status: "ready", ...exact, stale: false };
  if (!isProviderConfigured("vercel")) {
    if (exact) return { status: "ready", ...exact, stale: true };
    return { status: "not_connected", reason: "token" };
  }
  const synced = await syncVercelAnalytics(client.id, period);
  if (synced.ok) return { status: "ready", data: synced.data as unknown as VercelAnalyticsSummary, fetchedAt: new Date().toISOString(), periodStart: period.start, periodEnd: period.end, stale: false };
  if (synced.reason === "not_configured") return { status: "not_connected", reason: "project" };
  const fallback = exact ?? await readSnapshot(client.id, null);
  if (fallback) return { status: "ready", ...fallback, stale: true };
  return { status: "unavailable", lastError: client.lastError };
}
