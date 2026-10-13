import "server-only";
import type { UsageHistoryRow } from "./types";

// Historique d'utilisation des photos de la photothèque : modèle de lecture partagé (photothèque, supervision, agent,
// rapports…). Pour chaque photo : publication, plateforme, date d'utilisation, auteur, sujet et état de la publication,
// état et date de la diffusion sur cette plateforme. Toujours limité à un client. Lit la RPC
// whatsapp_asset_usage_history (migration 20261103000000) ; avant cette migration, repli sur les tables existantes
// (sans l'état de diffusion). Le client Supabase est injecté (service_role côté serveur uniquement).
export type AssetUsage = {
  publicationId: string; platform: UsageHistoryRow["platform"]; usedAt: string; usedBy: string; subject: string | null;
  publicationStatus: string | null; archived: boolean; deliveryStatus: string | null; scheduledFor: string | null; publishedAt: string | null;
};
type Result<T> = PromiseLike<{ data: T | null; error: { code?: string } | null }>;
type Query = { eq(column: string, value: string): Query; in(column: string, values: string[]): Query; order(column: string, options: { ascending: boolean }): Query } & Result<unknown[]>;
export type UsageHistoryDb = { rpc(name: "whatsapp_asset_usage_history", args: { p_client_id: string; p_asset_ids: string[] }): Result<unknown[]>; from(table: string): { select(columns: string): Query } };
const MISSING = ["PGRST202", "42883"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Utilisations par photo (plus récentes d'abord) ; une photo jamais utilisée a une liste vide. */
export async function listAssetUsageHistory(db: UsageHistoryDb, clientId: string, assetIds: string[]): Promise<Map<string, AssetUsage[]>> {
  const ids = [...new Set(assetIds.filter(id => UUID.test(id)))].slice(0, 200);
  const byAsset = new Map<string, AssetUsage[]>(ids.map(id => [id, []]));
  if (!UUID.test(clientId) || !ids.length) return byAsset;
  let rows: UsageHistoryRow[];
  const history = await db.rpc("whatsapp_asset_usage_history", { p_client_id: clientId, p_asset_ids: ids });
  if (!history.error) rows = (history.data ?? []) as UsageHistoryRow[];
  else if (MISSING.includes(history.error.code ?? "")) rows = await legacyHistory(db, clientId, ids);
  else throw Error("usage_history_unavailable");
  for (const row of rows) byAsset.get(row.asset_id)?.push({
    publicationId: row.publication_id, platform: row.platform, usedAt: row.used_at, usedBy: row.used_by, subject: row.subject, publicationStatus: row.publication_status,
    archived: row.archived === true, deliveryStatus: row.delivery_status, scheduledFor: row.scheduled_for, publishedAt: row.published_at,
  });
  for (const list of byAsset.values()) list.sort((a, b) => b.usedAt.localeCompare(a.usedAt));
  return byAsset;
}

async function legacyHistory(db: UsageHistoryDb, clientId: string, ids: string[]): Promise<UsageHistoryRow[]> {
  const uses = await db.from("whatsapp_asset_uses").select("asset_id,publication_id,platform,used_at,used_by").eq("client_id", clientId).in("asset_id", ids).order("used_at", { ascending: false });
  if (uses.error) throw Error("usage_history_unavailable");
  const list = (uses.data ?? []) as Pick<UsageHistoryRow, "asset_id" | "publication_id" | "platform" | "used_at" | "used_by">[];
  const publicationIds = [...new Set(list.map(use => use.publication_id))];
  const publications = publicationIds.length ? await db.from("publications").select("id,subject,status,archived_at").eq("client_id", clientId).in("id", publicationIds) : { data: [], error: null };
  const byId = new Map(((publications.error ? [] : publications.data ?? []) as { id: string; subject: string | null; status: string | null; archived_at: string | null }[]).map(p => [p.id, p]));
  return list.map(use => { const p = byId.get(use.publication_id);
    return { ...use, subject: p?.subject ?? null, publication_status: p?.status ?? null, archived: Boolean(p?.archived_at), delivery_status: null, scheduled_for: null, published_at: null }; });
}

/** Résumé d'utilisation d'une photo au regard du réglage de réemploi du client (même règle que la sélection de l'agent). */
export function reuseState(uses: Pick<AssetUsage, "usedAt">[], settings: { allowed: boolean; afterDays: number }, now: Date): { used: boolean; reusable: boolean; reusableFrom: string | null; reason: "never_used" | "reuse_disabled" | "too_recent" | "reusable" } {
  if (!uses.length) return { used: false, reusable: true, reusableFrom: null, reason: "never_used" };
  if (!settings.allowed) return { used: true, reusable: false, reusableFrom: null, reason: "reuse_disabled" };
  const from = new Date(Math.max(...uses.map(use => Date.parse(use.usedAt))) + settings.afterDays * 86400000);
  return from.getTime() < now.getTime() ? { used: true, reusable: true, reusableFrom: from.toISOString(), reason: "reusable" } : { used: true, reusable: false, reusableFrom: from.toISOString(), reason: "too_recent" };
}
