import "server-only";
// Requêtes Search Console du client pour l'Agent Google Ads : lecture du DERNIER instantané déjà synchronisé
// (aucun appel Google supplémentaire). Absent ou illisible → null (« non lues »), jamais une liste vide inventée.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { SEARCH_CONSOLE_METRIC_KEY, SEARCH_CONSOLE_PROVIDER } from "@/lib/integrations/search-console/model";
import type { OrganicQuery } from "./types";

const MAX_AGE_DAYS = 45;

export function parseOrganicQueries(data: unknown): OrganicQuery[] | null {
  const queries = (data as { queries?: unknown } | null)?.queries;
  if (!Array.isArray(queries)) return null;
  return queries.flatMap((row) => {
    const item = row as { key?: unknown; clicks?: unknown; impressions?: unknown; ctr?: unknown; position?: unknown };
    if (typeof item?.key !== "string" || !item.key.trim() || item.key.length > 200 || typeof item.impressions !== "number" || typeof item.clicks !== "number") return [];
    return [{ query: item.key.trim(), clicks: item.clicks, impressions: item.impressions, ctr: typeof item.ctr === "number" ? item.ctr : null, position: typeof item.position === "number" && item.position >= 1 ? item.position : null }];
  }).slice(0, 250);
}

export async function loadOrganicQueries(clientId: string): Promise<OrganicQuery[] | null> {
  try {
    const since = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000).toISOString();
    const { data, error } = await getSupabaseServerClient().from("metric_snapshots").select("data,fetched_at")
      .eq("client_id", clientId).eq("provider", SEARCH_CONSOLE_PROVIDER).eq("metric_key", SEARCH_CONSOLE_METRIC_KEY)
      .gte("fetched_at", since).order("fetched_at", { ascending: false }).limit(1).maybeSingle();
    if (error || !data) return null;
    return parseOrganicQueries(data.data);
  } catch { return null; }
}
