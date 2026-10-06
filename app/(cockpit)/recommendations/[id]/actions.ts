"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-admin";
import { updateRecommendationStatus } from "@/lib/recommendations/data";
import type { RecommendationActionState, RecommendationStatus } from "@/lib/recommendations/types";
import { createAdminMessage } from "@/lib/agent-messages/data";
import { createAction } from "@/lib/actions/data";

function singleString(formData: FormData, name: string) {
  const values = formData.getAll(name);
  return values.length === 1 && typeof values[0] === "string" ? values[0] : null;
}

export async function updateRecommendationAction(_previousState: RecommendationActionState, formData: FormData): Promise<RecommendationActionState> {
  await requireAdmin();
  const id = singleString(formData, "id");
  const status = singleString(formData, "status");
  if (!id || !status) return { message: "Impossible de mettre à jour cette recommandation. Rechargez l’état." };
  const result = await updateRecommendationStatus(id, status as RecommendationStatus);
  if (!result.ok) return { message: result.message };
  revalidatePath("/recommendations");
  revalidatePath(`/recommendations/${id}`);
  revalidatePath("/dashboard");
  revalidatePath("/clients");
  return { message: "Statut enregistré." };
}

export async function createRecommendationMessageAction(_previousState: RecommendationActionState, formData: FormData): Promise<RecommendationActionState> {
  await requireAdmin();
  const id = singleString(formData, "id");
  const message = singleString(formData, "message");
  if (!id || message === null) return { message: "Le message n’a pas pu être enregistré." };
  const result = await createAdminMessage(id, message);
  if (!result.ok) return { message: result.message };
  revalidatePath(`/recommendations/${id}`);
  return { message: "Message ajouté." };
}

export async function createInternalTestActionAction(_previousState: RecommendationActionState, formData: FormData): Promise<RecommendationActionState> {
  await requireAdmin();
  const id = singleString(formData, "id");
  if (!id) return { message: "Impossible de créer cette action." };
  const result = await createAction({ recommendation_id: id, action_type: "internal.test", parameters: {} });
  if (!result.ok) return { message: result.message };
  revalidatePath(`/recommendations/${id}`);
  revalidatePath("/actions");
  revalidatePath("/dashboard");
  return { message: "Action de test créée et en attente d’approbation." };
}