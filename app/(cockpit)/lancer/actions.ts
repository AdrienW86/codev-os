"use server";

import { revalidatePath } from "next/cache";
import { requireAdminWriter, SimulationWriteBlocked } from "@/lib/core/guards";
import { launch, type LaunchOutcome } from "@/lib/launch/service";

export type LaunchState = Partial<LaunchOutcome>;

/** « Lancer maintenant » : une tâche d'agent, pour un client ou pour tous (même code que le planificateur). */
export async function launchTaskAction(_: LaunchState, form: FormData): Promise<LaunchState> {
  let actor;
  try { actor = await requireAdminWriter(); } catch (error) {
    if (error instanceof SimulationWriteBlocked) return { ok: false, message: error.message };
    throw error;
  }
  const result = await launch(actor, form.get("task"), form.get("client")).catch(() => ({ ok: false, message: "Lancement indisponible. Réessayez dans quelques instants." }));
  if (result.ok) for (const path of ["/dashboard", "/agents", "/validation"]) revalidatePath(path);
  return result;
}
