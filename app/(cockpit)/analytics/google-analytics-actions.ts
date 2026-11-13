"use server";
import { requireAdminWriter, SimulationWriteBlocked } from "@/lib/core/guards";
import { syncGa4 } from "@/lib/integrations/ga4/sync";
export async function syncGa4NowAction(clientId: string, start: string, end: string): Promise<{ ok: boolean; message: string }> {
  try { await requireAdminWriter(); } catch (error) {
    if (error instanceof SimulationWriteBlocked) return { ok: false, message: error.message };
    throw error;
  }
  const result = await syncGa4(clientId, { start, end });
  return result.ok ? { ok: true, message: result.warning ?? "Google Analytics actualisé." }
    : { ok: false, message: result.error };
}
