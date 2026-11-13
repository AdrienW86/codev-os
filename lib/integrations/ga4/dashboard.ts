import "server-only";
import { listClients } from "@/lib/clients/data";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GA4_PROVIDER, GA4_METRIC_KEY, isGa4Snapshot, normalizeGa4Property, type Ga4Snapshot } from "@/lib/integrations/ga4/model";
import { ga4Deps, readGa4Connection } from "@/lib/integrations/ga4/connection";
import { syncGa4 } from "@/lib/integrations/ga4/sync";

const FRESH_MS = 6 * 60 * 60 * 1000;
export type Ga4ClientOption = { id: string; name: string; property: string | null; lastSyncAt: string | null; lastError: string | null };
export type Ga4DashboardState =
  | { status: "ready"; snapshot: Ga4Snapshot; fetchedAt: string; stale: boolean; syncError: string | null }
  | { status: "not_connected"; reason: "connection" | "property"; properties: number }
  | { status: "unavailable"; error: string | null };

export async function listGa4Clients(): Promise<Ga4ClientOption[]> {
  const clients = await listClients();
  const { data, error } = await getSupabaseServerClient().from("client_connections")
    .select("client_id,metadata,last_sync_at,last_error").eq("provider", GA4_PROVIDER).not("client_id", "is", null);
  if (error) throw new Error("GA4 clients read");
  const byClient = new Map((data ?? []).map(x => [x.client_id, x]));
  return clients.map(client => {
    const connection = byClient.get(client.id);
    return {
      id: client.id, name: client.name,
      property: normalizeGa4Property((connection?.metadata as Record<string, unknown> | null)?.property_id),
      lastSyncAt: connection?.last_sync_at ?? null,
      lastError: connection?.last_error ?? null,
    };
  });
}

export async function getGa4Dashboard(client: Ga4ClientOption, period: { start: string; end: string }): Promise<Ga4DashboardState> {
  const deps = ga4Deps();
  const conn = await readGa4Connection(deps.db);
  const properties = conn?.properties.length ?? 0;
  if (!client.property) return { status: "not_connected", reason: "property", properties };
  const { data, error } = await deps.db.from("metric_snapshots").select("fetched_at,data")
    .eq("client_id", client.id).eq("provider", GA4_PROVIDER).eq("metric_key", GA4_METRIC_KEY)
    .eq("period_start", period.start).eq("period_end", period.end).order("fetched_at", { ascending: false }).limit(1);
  if (error) return { status: "unavailable", error: "Lecture de l'historique GA4 indisponible." };
  const row = data?.[0];
  const exact = row && isGa4Snapshot(row.data, client.property, period.start, period.end)
    ? { snapshot: row.data as unknown as Ga4Snapshot, fetchedAt: row.fetched_at } : null;
  if (exact && Date.now() - Date.parse(exact.fetchedAt) < FRESH_MS) return { status: "ready", ...exact, stale: false, syncError: null };
  if (!conn || conn.status !== "active") {
    if (exact) return { status: "ready", ...exact, stale: true, syncError: "Google Analytics déconnecté." };
    return { status: "not_connected", reason: "connection", properties };
  }
  const result = await syncGa4(client.id, period, deps);
  if (result.ok) return { status: "ready", snapshot: result.snapshot, fetchedAt: new Date().toISOString(), stale: false, syncError: result.warning };
  if (exact) return { status: "ready", ...exact, stale: true, syncError: result.error };
  return { status: "unavailable", error: result.error };
}
