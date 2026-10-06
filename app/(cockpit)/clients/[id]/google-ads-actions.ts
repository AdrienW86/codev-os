"use server";

import { requireAdmin } from "@/lib/require-admin";
import { revalidatePath } from "next/cache";
import { saveGoogleAdsConnection, testGoogleAdsConnection, buildGoogleAdsAnalysisContext } from "@/lib/integrations/google-ads/service";
import { readFormText } from "@/lib/integrations/google-ads/validation";
import type { AdsFormState } from "@/lib/integrations/google-ads/types";

export async function configureGoogleAdsAction(_previous: AdsFormState, form: FormData): Promise<AdsFormState> {
  await requireAdmin();
  const clientId = readFormText(form, "client_id") ?? "";
  const result = await saveGoogleAdsConnection(clientId, readFormText(form, "customer_id"), readFormText(form, "manager_customer_id"));
  revalidatePath(`/clients/${clientId}`);
  return result;
}

export async function testGoogleAdsConnectionAction(_previous: AdsFormState, form: FormData): Promise<AdsFormState> {
  await requireAdmin();
  const clientId = readFormText(form, "client_id") ?? "";
  const result = await testGoogleAdsConnection(clientId);
  revalidatePath(`/clients/${clientId}`);
  return result;
}

export async function refreshGoogleAdsAction(_previous: AdsFormState, form: FormData): Promise<AdsFormState> {
  await requireAdmin();
  const clientId = readFormText(form, "client_id") ?? "";
  try {
    // Refresh tests accessibility and reloads the server-rendered metrics; no metrics cache is written.
    const result = await testGoogleAdsConnection(clientId);
    if (!result.ok) return result;
    await buildGoogleAdsAnalysisContext(clientId);
    revalidatePath(`/clients/${clientId}`);
    return { ok: true, message: "Données Google Ads actualisées en lecture seule." };
  } catch { return { message: "Impossible d’actualiser Google Ads. Vérifiez la connexion, puis réessayez." }; }
}
