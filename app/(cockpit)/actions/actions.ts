"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-admin";
import { approveAction, cancelAction, executeAction } from "@/lib/actions/data";
import type { RecommendationActionState } from "@/lib/recommendations/types";

function actionId(formData: FormData) {
  const values = formData.getAll("id");
  return values.length === 1 && typeof values[0] === "string" ? values[0] : null;
}

async function finish(result: Awaited<ReturnType<typeof approveAction>>) {
  if (!result.ok) return { message: result.message };
  revalidatePath("/actions");
  revalidatePath("/recommendations");
  revalidatePath("/dashboard");
  return { message: "État de l’action enregistré." };
}

export async function approveActionAction(_previousState: RecommendationActionState, formData: FormData): Promise<RecommendationActionState> {
  await requireAdmin();
  const id = actionId(formData);
  if (!id) return { message: "Impossible de traiter cette action. Rechargez l’état et réessayez." };
  return finish(await approveAction(id));
}

export async function cancelActionAction(_previousState: RecommendationActionState, formData: FormData): Promise<RecommendationActionState> {
  await requireAdmin();
  const id = actionId(formData);
  if (!id) return { message: "Impossible de traiter cette action. Rechargez l’état et réessayez." };
  return finish(await cancelAction(id));
}

export async function executeActionAction(_previousState: RecommendationActionState, formData: FormData): Promise<RecommendationActionState> {
  await requireAdmin();
  const id = actionId(formData);
  if (!id) return { message: "Impossible de traiter cette action. Rechargez l’état et réessayez." };
  return finish(await executeAction(id));
}