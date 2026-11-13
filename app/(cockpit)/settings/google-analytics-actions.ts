"use server";

import { redirect } from "next/navigation";
import { adminMutation, type MutationState } from "@/lib/core/mutation";
import { requireAdminWriter, SimulationWriteBlocked } from "@/lib/core/guards";
import { writeAudit } from "@/lib/core/audit";
import { startGa4OAuth, refreshGa4Properties, disconnectGa4 } from "@/lib/integrations/ga4/connection";

export async function startGa4OAuthAction(): Promise<MutationState> {
  let actor;
  try { actor = await requireAdminWriter(); } catch (error) {
    if (error instanceof SimulationWriteBlocked) return { ok: false, message: error.message };
    throw error;
  }
  const result = await startGa4OAuth(actor.userId);
  if (!result.ok) return result;
  await writeAudit(actor, { action: "connection.google_analytics.oauth_started", resource_type: "client_connection", resource_id: null, metadata: { provider: "google-analytics" } }).catch(() => undefined);
  redirect(result.url);
}
export async function refreshGa4PropertiesAction(): Promise<MutationState> {
  return adminMutation("google-analytics", async (actor) => {
    const result = await refreshGa4Properties();
    if (result.ok) await writeAudit(actor, { action: "connection.google_analytics.refreshed", resource_type: "client_connection", resource_id: null, metadata: { provider: "google-analytics" } });
    return result;
  }, ["/settings", "/analytics"]);
}
export async function disconnectGa4Action(): Promise<MutationState> {
  return adminMutation("google-analytics", async (actor) => {
    const result = await disconnectGa4();
    await writeAudit(actor, { action: "connection.google_analytics.disconnected", resource_type: "client_connection", resource_id: null, metadata: { provider: "google-analytics" } });
    return result;
  }, ["/settings", "/analytics"]);
}
