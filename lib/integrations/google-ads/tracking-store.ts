import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { CampaignTracking } from "./tracking";
/** Internal repository for authenticated admin services and scheduler workers. Never a browser entrypoint. */
export async function readCampaignTracking(connection: { id: string; client_id: string; external_account_id: string | null }): Promise<CampaignTracking> {
  const db = getSupabaseServerClient();
  const { data, error } = await db.from("client_ads_scopes").select("revision,account_id,connection_id").eq("client_id", connection.client_id).maybeSingle();
  if (["42P01", "PGRST205"].includes(error?.code ?? "")) return { available: false, revision: 0, ids: null };
  if (error) throw new Error("Sélection des campagnes indisponible.");
  if (!data) return { available: true, revision: 0, ids: null };
  if (data.connection_id !== connection.id || data.account_id !== connection.external_account_id) throw new Error("Sélection liée à un autre compte.");
  const selected = await db.from("client_ads_campaigns").select("campaign_id").eq("client_id", connection.client_id).eq("account_id", data.account_id);
  if (selected.error) throw new Error("Sélection des campagnes indisponible.");
  return { available: true, revision: data.revision, ids: (selected.data ?? []).map((row) => row.campaign_id) };
}
