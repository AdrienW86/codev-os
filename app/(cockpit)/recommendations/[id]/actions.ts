"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-admin";
import { updateRecommendationStatus } from "@/lib/recommendations/data";
import type { RecommendationActionState, RecommendationStatus } from "@/lib/recommendations/types";
import { createAdminMessage } from "@/lib/agent-messages/data";
import { createAction } from "@/lib/actions/data";
import { getRecommendationById } from "@/lib/recommendations/data";
import type { Json } from "@/lib/supabase/database.types";

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

const asRecord = (value: Json | null): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export async function createSeoSiteChangeAction(_previousState: RecommendationActionState, formData: FormData): Promise<RecommendationActionState> {
  await requireAdmin();
  const id = singleString(formData, "id");
  if (!id) return { message: "Impossible de préparer cette action SEO." };
  const recommendation = await getRecommendationById(id);
  if (!recommendation || recommendation.status !== "accepted") return { message: "Acceptez d’abord la recommandation SEO avant de préparer une action." };

  const payload = asRecord(recommendation.payload);
  const kind = typeof payload.kind === "string" ? payload.kind : "";
  const key = typeof payload.key === "string" ? payload.key.trim() : "";
  const targetPage = typeof payload.target_page === "string" ? payload.target_page.trim() : "";
  const suggested = typeof payload.suggested_action === "string" ? payload.suggested_action.trim() : "";
  if (!["page_drop", "emerging_query", "low_ctr"].includes(kind) || !key) return { message: "Cette recommandation n’est pas une opportunité SEO transformable en modification de site." };

  const page = kind === "page_drop" ? key : targetPage;
  if (!page) return { message: "La page cible n’est pas identifiée dans Search Console. Relancez l’analyse SEO avant de préparer l’action." };

  const change = kind === "page_drop"
    ? "Auditer cette page puis préparer uniquement les corrections confirmées : indexation, redirections, canonical, contenu et maillage interne."
    : kind === "low_ctr"
      ? `Proposer une amélioration du title et de la meta description pour mieux répondre à l’intention de la requête « ${key} », sans promettre de gain ni modifier le fond sans justification.`
      : `Renforcer cette page pour mieux couvrir l’intention de la requête « ${key} » : title, structure, contenu ou maillage uniquement si l’audit le justifie. Ne créer une nouvelle page que si une intention distincte est confirmée.`;

  const rationale = [recommendation.reason ?? "", suggested].filter(Boolean).join(" ").slice(0, 2000);
  const result = await createAction({ recommendation_id: id, action_type: "seo.site_change", parameters: { page, change, rationale } });
  if (!result.ok) return { message: result.message };
  revalidatePath(`/recommendations/${id}`);
  revalidatePath("/actions");
  revalidatePath("/work");
  revalidatePath("/dashboard");
  return { message: "Action SEO structurée créée et en attente de votre approbation." };
}