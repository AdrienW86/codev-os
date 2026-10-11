"use server";

import { redirect } from "next/navigation";
import { adminMutation, type MutationState } from "@/lib/core/mutation";
import { requireAdminWriter, SimulationWriteBlocked } from "@/lib/core/guards";
import { writeAudit } from "@/lib/core/audit";
import { disconnectSearchConsole, refreshSearchConsoleProperties, startSearchConsoleOAuth } from "@/lib/integrations/search-console/connection";

// « Connecter Google Search Console » : état à usage unique stocké côté serveur puis redirection vers la page de
// consentement Google officielle. Server Action : même origine uniquement (protection CSRF de Next.js).
export async function startSearchConsoleOAuthAction(): Promise<MutationState> {
  let actor;
  try { actor = await requireAdminWriter(); } catch (error) {
    if (error instanceof SimulationWriteBlocked) return { ok: false, message: error.message };
    throw error;
  }
  const result = await startSearchConsoleOAuth(actor.userId);
  if (!result.ok) return result;
  await writeAudit(actor, { action: "connection.search_console.oauth_started", resource_type: "client_connection", resource_id: null, metadata: { provider: "search-console" } }).catch(() => undefined);
  redirect(result.url);
}

export async function refreshSearchConsolePropertiesAction(): Promise<MutationState> {
  return adminMutation("search-console", async (actor) => {
    const result = await refreshSearchConsoleProperties();
    if (!result.ok) return result;
    await writeAudit(actor, { action: "connection.search_console.properties_refreshed", resource_type: "client_connection", resource_id: null, metadata: { provider: "search-console", properties: result.count } });
    return { ok: true, message: `${result.count} propriété${result.count > 1 ? "s" : ""} accessible${result.count > 1 ? "s" : ""} avec ce compte Google.` };
  }, ["/settings", "/analytics"]);
}

export async function disconnectSearchConsoleAction(): Promise<MutationState> {
  return adminMutation("search-console", async (actor) => {
    const result = await disconnectSearchConsole();
    await writeAudit(actor, { action: "connection.search_console.disconnected", resource_type: "client_connection", resource_id: null, metadata: { provider: "search-console" } });
    return result;
  }, ["/settings", "/analytics"]);
}
