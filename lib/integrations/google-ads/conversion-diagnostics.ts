import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import { getGoogleAdsConnection } from "./service";
import { createGoogleAdsReadClient } from "./client";
import type { ConversionActionDiagnostic } from "./types";

export async function getClientConversionDiagnostics(clientId: string): Promise<{
  ok: true; actions: ConversionActionDiagnostic[]; warning: string | null
} | { ok: false; message: string }> {
  await requireAdmin();
  const connection = await getGoogleAdsConnection(clientId);
  if (!connection || connection.status !== "connected" || !connection.external_account_id) {
    return { ok: false, message: "Compte Google Ads non connecté." };
  }
  try {
    const actions = await createGoogleAdsReadClient().getConversionActionDiagnostics(
      connection.external_account_id, connection.metadata.manager_customer_id);
    return { ok: true, actions, warning: actions.length
      ? "Le statut API ne prouve pas à lui seul que les conversions se déclenchent dans le navigateur. Vérifiez également Google Ads et Tag Assistant."
      : "Aucune action de conversion renvoyée par le compte. Vérifiez également les objectifs gérés par un éventuel compte administrateur." };
  } catch {
    return { ok: false, message: "Actions de conversion indisponibles via Google Ads. Aucun état n’a été supposé." };
  }
}
