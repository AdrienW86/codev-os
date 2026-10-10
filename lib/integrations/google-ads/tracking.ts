import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit-logs";
import { createGoogleAdsReadClient } from "./client";
import { isAgentUuid } from "@/lib/agents/validation";
import { getAdsPeriod } from "./validation";
import type { GoogleAdsConnection } from "./types";

export type CampaignTracking = { available: boolean; revision: number; ids: string[] | null };
const missing = (code?: string) => ["42P01", "PGRST205"].includes(code ?? "");

export async function loadCampaignTracking(connection: GoogleAdsConnection): Promise<CampaignTracking> {
  await requireAdmin();
  const db = getSupabaseServerClient();
  const { data, error } = await db.from("client_ads_scopes").select("revision,account_id,connection_id").eq("client_id", connection.client_id).maybeSingle();
  if (missing(error?.code)) return { available: false, revision: 0, ids: null };
  if (error) throw new Error("Sélection des campagnes indisponible.");
  if (!data) return { available: true, revision: 0, ids: null };
  if (data.connection_id !== connection.id || data.account_id !== connection.external_account_id) throw new Error("Sélection liée à un autre compte.");
  const selected = await db.from("client_ads_campaigns").select("campaign_id").eq("client_id", connection.client_id).eq("account_id", data.account_id);
  if (selected.error) throw new Error("Sélection des campagnes indisponible.");
  return { available: true, revision: data.revision, ids: (selected.data ?? []).map((row) => row.campaign_id) };
}

export async function saveCampaignTracking(connection: GoogleAdsConnection, ids: unknown, revision: unknown) {
  const { userId } = await requireAdmin();
  if (!isAgentUuid(connection.client_id) || !isAgentUuid(connection.id) || connection.status !== "connected"
    || !/^\d{10}$/.test(connection.external_account_id ?? "") || !Number.isInteger(revision) || Number(revision) < 0
    || !Array.isArray(ids) || ids.length > 50 || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== "string" || !/^\d{1,20}$/.test(id))) {
    return { ok: false, message: "Sélection invalide (50 campagnes maximum)." };
  }
  // Inventaire relu sur LE compte associé avant toute persistance. Le RPC revérifie l'association sous verrou.
  const client = createGoogleAdsReadClient();
  const account = await client.getAccountSummary(connection.external_account_id!, connection.metadata.manager_customer_id);
  const inventory = await client.getCampaignPerformance(account, getAdsPeriod(account.timezone, 7), connection.metadata.manager_customer_id);
  if (ids.some((id) => !inventory.campaigns.some((campaign) => campaign.id === id))) return { ok: false, message: "Une campagne ne fait pas partie du compte associé. Rechargez la page." };
  const { data, error } = await getSupabaseServerClient().rpc("codev_set_ads_campaigns", { p_client_id: connection.client_id, p_connection_id: connection.id, p_account_id: account.id, p_campaign_ids: ids as string[], p_revision: Number(revision) });
  if (error) return { ok: false, message: error.code === "23505" ? "Une campagne est déjà suivie pour un autre client de ce compte. Aucun changement enregistré."
    : error.code === "40001" ? "La sélection a changé entre-temps. Rechargez la page."
    : "Sélection non enregistrée. Vérifiez la migration 20261017000000 et rechargez la page." };
  await writeAuditLog({ action: "google_ads.tracking_updated", actor_type: "admin", actor_id: userId, resource_type: "client", resource_id: connection.client_id, before_data: null, after_data: null, metadata: { account_id: account.id, campaign_ids: ids as string[], revision: data } });
  return { ok: true, message: "Campagnes suivies enregistrées. Les rapports existants conservent leur périmètre." };
}
