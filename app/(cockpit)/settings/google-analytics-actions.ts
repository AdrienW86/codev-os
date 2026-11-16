"use server";

import { redirect } from "next/navigation";
import { adminMutation, type MutationState } from "@/lib/core/mutation";
import { requireAdminWriter, SimulationWriteBlocked } from "@/lib/core/guards";
import { writeAudit } from "@/lib/core/audit";
import { disconnectGoogleAnalytics, refreshGoogleAnalyticsProperties, startGoogleAnalyticsOAuth } from "@/lib/integrations/google-analytics/connection";

// « Connecter Google Analytics » : état à usage unique stocké côté serveur puis redirection vers la page de
// consentement Google officielle. Server Action : même origine uniquement (protection CSRF de Next.js).
export async function startGoogleAnalyticsOAuthAction(): Promise<MutationState> {
  let actor;
  try { actor = await requireAdminWriter(); } catch (error) {
    if (error instanceof SimulationWriteBlocked) return { ok: false, message: error.message };
    throw error;
  }
  const result = await startGoogleAnalyticsOAuth(actor.userId);
  if (!result.ok) return result;
  await writeAudit(actor, { action: "connection.google_analytics.oauth_started", resource_type: "client_connection", resource_id: null, metadata: { provider: "google-analytics" } }).catch(() => undefined);
  redirect(result.url);
}

export async function refreshGoogleAnalyticsPropertiesAction(): Promise<MutationState> {
  return adminMutation("google-analytics", async (actor) => {
    const result = await refreshGoogleAnalyticsProperties();
    if (!result.ok) return result;
    await writeAudit(actor, { action: "connection.google_analytics.properties_refreshed", resource_type: "client_connection", resource_id: null, metadata: { provider: "google-analytics", properties: result.count } });
    return { ok: true, message: `${result.count} propriété${result.count > 1 ? "s" : ""} GA4 accessible${result.count > 1 ? "s" : ""} avec ce compte Google.` };
  }, ["/settings"]);
}

export async function disconnectGoogleAnalyticsAction(): Promise<MutationState> {
  return adminMutation("google-analytics", async (actor) => {
    const result = await disconnectGoogleAnalytics();
    await writeAudit(actor, { action: "connection.google_analytics.disconnected", resource_type: "client_connection", resource_id: null, metadata: { provider: "google-analytics" } });
    return result;
  }, ["/settings"]);
}
