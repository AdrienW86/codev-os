import "server-only";
// Exécution standardisée d'une mutation admin depuis une Server Action :
// session vérifiée, simulation refusée, erreurs techniques jamais renvoyées au navigateur.
import { revalidatePath } from "next/cache";
import { requireAdminWriter, SimulationWriteBlocked } from "@/lib/core/guards";
import type { Actor } from "@/lib/core/actor";

export type MutationState = { ok?: boolean; message?: string };

export async function adminMutation(scope: string, operation: (actor: Actor & { kind: "admin" }) => Promise<MutationState>, revalidate: string[] = []): Promise<MutationState> {
  let actor;
  try { actor = await requireAdminWriter(); } catch (error) {
    if (error instanceof SimulationWriteBlocked) return { ok: false, message: error.message };
    throw error;
  }
  try {
    const result = await operation(actor);
    if (result.ok) for (const path of revalidate) revalidatePath(path);
    return result;
  } catch {
    console.error(`[${scope}] Opération indisponible.`);
    return { ok: false, message: "Opération indisponible. Réessayez dans quelques instants." };
  }
}

/** Lecture d'un champ texte borné. */
export function formText(form: FormData, name: string, max = 200) {
  const values = form.getAll(name);
  return values.length === 1 && typeof values[0] === "string" ? values[0].trim().slice(0, max) : "";
}
