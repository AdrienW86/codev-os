import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAgentUuid } from "@/lib/agents/validation";
import { adsBusinessSchema, type AdsBusinessContext } from "./business-context";
import { writeAuditLog } from "@/lib/audit-logs";
import type { Json } from "@/lib/supabase/database.types";

export type BusinessContextResult = { available: boolean; revision: number; context: AdsBusinessContext | null };
export async function getAdsBusinessContext(clientId: string): Promise<BusinessContextResult> {
  await requireAdmin();
  if (!isAgentUuid(clientId)) throw new Error("Client invalide.");
  const { data, error } = await getSupabaseServerClient().from("client_ads_context").select("context,revision").eq("client_id", clientId).maybeSingle();
  if (["42P01", "PGRST205"].includes(error?.code ?? "")) return { available: false, revision: 0, context: null };
  if (error) throw new Error("Contexte client indisponible.");
  if (!data) return { available: true, revision: 0, context: null };
  return { available: true, revision: data.revision, context: adsBusinessSchema.parse(data.context) };
}
export async function saveAdsBusinessContext(clientId: unknown, input: unknown, revision: unknown) {
  const { userId } = await requireAdmin();
  const parsed = adsBusinessSchema.safeParse(input);
  if (typeof clientId !== "string" || !isAgentUuid(clientId) || !parsed.success || !Number.isInteger(revision) || Number(revision) < 0) return { ok: false, message: "Contexte invalide : vérifiez les champs et les budgets." };
  const { error } = await getSupabaseServerClient().rpc("codev_save_ads_context", { p_client_id: clientId, p_context: parsed.data as Json, p_revision: Number(revision) });
  if (error) return { ok: false, message: error.code === "40001" ? "Contexte modifié entre-temps : rechargez la page." : "Contexte non enregistré. Vérifiez la migration 20261018000000." };
  await writeAuditLog({ action: "google_ads.business_context_updated", actor_type: "admin", actor_id: userId, resource_type: "client", resource_id: clientId, before_data: null, after_data: null, metadata: { revision: Number(revision) + 1 } });
  return { ok: true, message: "Contexte commercial enregistré." };
}
