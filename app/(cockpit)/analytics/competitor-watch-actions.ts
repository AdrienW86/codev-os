"use server";

import { revalidatePath } from "next/cache";
import { requireAdminWriter, SimulationWriteBlocked } from "@/lib/core/guards";
import { writeAudit } from "@/lib/core/audit";
import { parseCompetitorLines } from "@/lib/competitor-watch/model";
import { saveCompetitorWatchSettings } from "@/lib/competitor-watch/dashboard";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type WatchSettingsState = { ok?: boolean; message?: string };

/** Réglages de l'Agent Veille concurrence pour un client : veille active et concurrents à suivre (« Nom | site »). */
export async function saveCompetitorWatchAction(_: WatchSettingsState, form: FormData): Promise<WatchSettingsState> {
  let actor;
  try { actor = await requireAdminWriter(); } catch (error) {
    if (error instanceof SimulationWriteBlocked) return { ok: false, message: error.message };
    throw error;
  }
  const clientId = String(form.get("client") ?? "");
  if (!uuid.test(clientId)) return { ok: false, message: "Client invalide." };
  const parsed = parseCompetitorLines(form.get("competitors"));
  if (!parsed.ok) return { ok: false, message: parsed.message };
  const result = await saveCompetitorWatchSettings(actor.userId, clientId, { enabled: form.get("enabled") === "on", competitors: parsed.competitors });
  if (result.ok) {
    await writeAudit(actor, { action: "competitor_watch.settings_saved", resource_type: "client", resource_id: clientId, metadata: { enabled: form.get("enabled") === "on", competitors: parsed.competitors.length } }).catch(() => undefined);
    revalidatePath("/analytics");
  }
  return result;
}
