"use server";
import { requireAdmin } from "@/lib/require-admin";
import { getGoogleAdsConnection } from "@/lib/integrations/google-ads/service";
import { saveCampaignTracking } from "@/lib/integrations/google-ads/tracking";
import { revalidatePath } from "next/cache";

export async function saveTrackedCampaignsAction(clientId: unknown, ids: unknown, revision: unknown) {
  await requireAdmin();
  if (typeof clientId !== "string") return { ok: false, message: "Client invalide." };
  try {
    const connection = await getGoogleAdsConnection(clientId);
    if (!connection) return { ok: false, message: "Compte non associé." };
    const result = await saveCampaignTracking(connection, ids, revision);
    if (result.ok) { revalidatePath("/advertising"); revalidatePath(`/clients/${clientId}`); }
    return result;
  } catch { return { ok: false, message: "Sélection non enregistrée. Rechargez la page et vérifiez la connexion." }; }
}
