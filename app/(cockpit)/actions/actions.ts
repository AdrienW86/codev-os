"use server";

import { revalidatePath } from "next/cache";
import { requireAdminWriter, SimulationWriteBlocked } from "@/lib/core/guards";
import { approveAction, cancelAction, completeManualAction, executeAction, rejectAction } from "@/lib/actions/data";
import type { RecommendationActionState } from "@/lib/recommendations/types";

function actionId(formData: FormData) {
  const values = formData.getAll("id");
  return values.length === 1 && typeof values[0] === "string" ? values[0] : null;
}

/** Session admin vérifiée et simulation refusée avant toute transition d'action réelle. */
async function transition(formData: FormData, operation: typeof approveAction, done: string): Promise<RecommendationActionState> {
  try { await requireAdminWriter(); } catch (error) {
    if (error instanceof SimulationWriteBlocked) return { message: error.message };
    throw error;
  }
  const id = actionId(formData);
  if (!id) return { message: "Impossible de traiter cette action. Rechargez l’état et réessayez." };
  const result = await operation(id);
  if (!result.ok) return { message: result.message };
  for (const path of ["/actions", "/recommendations", "/dashboard", "/work"]) revalidatePath(path);
  return { message: done };
}

export async function approveActionAction(_previousState: RecommendationActionState, formData: FormData): Promise<RecommendationActionState> {
  return transition(formData, approveAction, "Action approuvée : son contenu est désormais figé.");
}

export async function cancelActionAction(_previousState: RecommendationActionState, formData: FormData): Promise<RecommendationActionState> {
  return transition(formData, cancelAction, "Action annulée.");
}

export async function rejectActionAction(_previousState: RecommendationActionState, formData: FormData): Promise<RecommendationActionState> {
  return transition(formData, rejectAction, "Action refusée. L’historique est conservé.");
}

export async function executeActionAction(_previousState: RecommendationActionState, formData: FormData): Promise<RecommendationActionState> {
  return transition(formData, executeAction, "Action interne exécutée.");
}

export async function completeManualActionAction(_previousState: RecommendationActionState, formData: FormData): Promise<RecommendationActionState> {
  return transition(formData, completeManualAction, "Réalisation manuelle consignée.");
}
