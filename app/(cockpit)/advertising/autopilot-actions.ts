"use server";
import { revalidatePath } from "next/cache";
import { requireAdminWriter } from "@/lib/core/guards";
import { saveAutopilotMode, undoAutopilotChange } from "@/lib/ads/autopilot-service";

export async function saveAutopilotModeAction(clientId: unknown, mode: unknown) {
  if (typeof clientId !== "string") return { ok: false, message: "Client invalide." };
  try { await requireAdminWriter(); const result = await saveAutopilotMode(clientId, mode); if (result.ok) revalidatePath("/advertising/manage"); return result; }
  catch { return { ok: false, message: "Réglage non enregistré." }; }
}

export async function undoAutopilotChangeAction(changeId: unknown) {
  if (typeof changeId !== "string") return { ok: false, message: "Modification inconnue." };
  try { await requireAdminWriter(); const result = await undoAutopilotChange(changeId); if (result.ok) revalidatePath("/advertising/manage"); return result; }
  catch { return { ok: false, message: "Annulation impossible." }; }
}
