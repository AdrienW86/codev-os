import "server-only";
// Chargeur de la vue « Référencement · Google Search Console » de « Données et performances ».
// Lit l'instantané de la période demandée (même client, même propriété, format courant) ; sinon synchronise ; sinon
// affiche l'instantané plus ancien de CETTE période signalé comme tel. Jamais les données d'une autre période ni
// d'une autre propriété à la place.
import { listClients } from "@/lib/clients/data";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { readSearchConsoleConnection, searchConsoleAccess, productionSearchConsoleDeps } from "@/lib/integrations/search-console/connection";
import { syncSearchConsole } from "@/lib/integrations/search-console/sync";
import { SEARCH_CONSOLE_METRIC_KEY, SEARCH_CONSOLE_PROVIDER, SEARCH_CONSOLE_SNAPSHOT_VERSION, normalizeProperty, type Period, type SearchConsoleSnapshot } from "@/lib/integrations/search-console/model";

/** Les données Search Console changent une fois par jour : un instantané de moins de 6 h est réutilisé tel quel. */
const FRESH_MS = 6 * 60 * 60 * 1000;

export type SeoClientOption = { id: string; name: string; property: string | null; lastSyncAt: string | null; lastError: string | null };
export type SeoDashboardState =
  | { status: "ready"; snapshot: SearchConsoleSnapshot; fetchedAt: string; stale: boolean; syncError: string | null }
  | { status: "not_connected"; reason: "connection" | "revoked" | "property"; properties: number }
  | { status: "unavailable"; error: string | null };

export async function listSeoClients(): Promise<SeoClientOption[]> {
  const clients = await listClients(); // listClients vérifie requireAdmin.
  const { data, error } = await getSupabaseServerClient().from("client_connections").select("client_id,metadata,last_sync_at,last_error").eq("provider", SEARCH_CONSOLE_PROVIDER).not("client_id", "is", null);
  if (error) throw new Error("search console clients read");
  const byClient = new Map((data ?? []).map((row) => [row.client_id, row]));
  return clients.map((client) => {
    const row = byClient.get(client.id);
    const property = normalizeProperty((row?.metadata as Record<string, unknown> | null)?.property);
    return { id: client.id, name: client.name, property, lastSyncAt: row?.last_sync_at ?? null, lastError: row?.last_error ?? null };
  });
}

const isSnapshot = (value: unknown, property: string): value is SearchConsoleSnapshot => Boolean(value && typeof value === "object"
  && (value as SearchConsoleSnapshot).version === SEARCH_CONSOLE_SNAPSHOT_VERSION && (value as SearchConsoleSnapshot).property === property
  && Array.isArray((value as SearchConsoleSnapshot).daily) && (value as SearchConsoleSnapshot).totals !== undefined);

export async function getSeoDashboard(client: SeoClientOption, requested: Period): Promise<SeoDashboardState> {
  const deps = productionSearchConsoleDeps();
  const connection = await readSearchConsoleConnection(deps.db);
  const properties = connection?.status === "active" ? connection.properties.length : 0;
  if (!client.property) return { status: "not_connected", reason: "property", properties };
  const { data, error } = await deps.db.from("metric_snapshots").select("fetched_at,data").eq("client_id", client.id).eq("provider", SEARCH_CONSOLE_PROVIDER).eq("metric_key", SEARCH_CONSOLE_METRIC_KEY)
    .eq("period_start", requested.start).eq("period_end", requested.end).order("fetched_at", { ascending: false }).limit(1);
  if (error) throw new Error("search console snapshot read");
  const row = data?.[0];
  const exact = row && isSnapshot(row.data, client.property) ? { snapshot: row.data as unknown as SearchConsoleSnapshot, fetchedAt: row.fetched_at } : null;
  if (exact && Date.now() - Date.parse(exact.fetchedAt) < FRESH_MS) return { status: "ready", ...exact, stale: false, syncError: null };
  if (!await searchConsoleAccess(deps)) {
    if (exact) return { status: "ready", ...exact, stale: true, syncError: "Google Search Console n’est plus connecté : synchronisation impossible." };
    return { status: "not_connected", reason: connection?.status === "revoked" ? "revoked" : "connection", properties };
  }
  const synced = await syncSearchConsole(client.id, requested, "dashboard", deps);
  if (synced.ok) return { status: "ready", snapshot: synced.snapshot, fetchedAt: new Date().toISOString(), stale: false, syncError: null };
  if (synced.reason === "no_property") return { status: "not_connected", reason: "property", properties };
  if (synced.reason === "not_connected") return { status: "not_connected", reason: "connection", properties };
  if (exact) return { status: "ready", ...exact, stale: true, syncError: synced.error };
  return { status: "unavailable", error: synced.error ?? client.lastError };
}
