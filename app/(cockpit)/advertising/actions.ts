"use server";
import { requireAdmin } from "@/lib/require-admin";
import { getGoogleAdsConnection } from "@/lib/integrations/google-ads/service";
import { saveCampaignTracking } from "@/lib/integrations/google-ads/tracking";
import { revalidatePath } from "next/cache";
import { saveAdsBusinessContext } from "@/lib/integrations/google-ads/context-service";
import { requireAdminWriter } from "@/lib/core/guards";

export async function saveTrackedCampaignsAction(clientId: unknown, ids: unknown, revision: unknown) {
  await requireAdmin();
  if (typeof clientId !== "string") return { ok: false, message: "Client invalide." };
  try {
    await requireAdminWriter();
    const connection = await getGoogleAdsConnection(clientId);
    if (!connection) return { ok: false, message: "Compte non associé." };
    const result = await saveCampaignTracking(connection, ids, revision);
    if (result.ok) { revalidatePath("/advertising"); revalidatePath(`/clients/${clientId}`); }
    return result;
  } catch { return { ok: false, message: "Sélection non enregistrée. Rechargez la page et vérifiez la connexion." }; }
}

export async function saveAdsContextAction(clientId: unknown, context: unknown, revision: unknown) {
  await requireAdmin();
  try {
    await requireAdminWriter();
    const result = await saveAdsBusinessContext(clientId, context, revision);
    if (result.ok) revalidatePath("/advertising");
    return result;
  } catch { return { ok: false, message: "Contexte non enregistré. Rechargez la page." }; }
}
