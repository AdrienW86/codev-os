"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-admin";
import { updateRecommendationStatus } from "@/lib/recommendations/data";
import type { RecommendationActionState, RecommendationStatus } from "@/lib/recommendations/types";
import { createAdminMessage } from "@/lib/agent-messages/data";
import { createAction } from "@/lib/actions/data";
import { prepareAction } from "@/lib/agents/outputs";
import { getRecommendationById } from "@/lib/recommendations/data";
import type { Json } from "@/lib/supabase/database.types";
import { requireAdminWriter, SimulationWriteBlocked, isSimulationActive } from "@/lib/core/guards";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import { recordRecommendation } from "@/lib/agents/outputs";
import { syncOpportunityFromRecommendation } from "@/lib/seo/opportunity-store";
import { answerOpportunityMessage } from "@/lib/seo/conversation";
import { changeOpportunityStatus } from "@/lib/seo/opportunity-service";

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
  // Opportunité de l'Agent SEO liée : elle suit la décision (approuvée ou écartée).
  const { userId } = await requireAdmin();
  const actor = { kind: "admin" as const, userId };
  await syncOpportunityFromRecommendation({ db: getSupabaseServerClient(), recommend: (input) => recordRecommendation(actor, input), audit: (entry) => writeAudit(actor, entry) }, id, status)
    .catch(() => console.error("[recommendations] Synchronisation de l’opportunité différée."));
  revalidatePath("/agents", "layout");
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
  // Recommandation issue d'une opportunité SEO : l'agent répond dans la conversation (aucune exécution).
  let answered = false;
  try { answered = Boolean(await answerOpportunityMessage(id, message, await isSimulationActive())); } catch { console.error("[recommendations] Réponse de l’agent indisponible."); }
  revalidatePath(`/recommendations/${id}`);
  return { message: answered ? "Message ajouté ; l’Agent SEO a répondu." : "Message ajouté." };
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
  const { userId } = await requireAdmin();
  const id = singleString(formData, "id");
  if (!id) return { message: "Impossible de préparer cette action SEO." };
  const recommendation = await getRecommendationById(id);
  if (!recommendation || recommendation.status !== "accepted") return { message: "Acceptez d’abord la recommandation SEO avant de préparer une action." };

  const payload = asRecord(recommendation.payload);
  const kind = typeof payload.kind === "string" ? payload.kind : "";
  const key = typeof payload.key === "string" ? payload.key.trim() : "";
  const targetPage = typeof payload.target_page === "string" ? payload.target_page.trim() : "";
  const suggested = typeof payload.suggested_action === "string" ? payload.suggested_action.trim() : "";
  const repositoryContext = asRecord(payload.repository_context as Json);
  const sourcePath = typeof repositoryContext.path === "string" ? repositoryContext.path.trim() : "";
  const currentTitle = typeof repositoryContext.title === "string" ? repositoryContext.title.trim() : "";
  const currentDescription = typeof repositoryContext.description === "string" ? repositoryContext.description.trim() : "";
  const currentH1 = typeof repositoryContext.h1 === "string" ? repositoryContext.h1.trim() : "";
  if (kind === "keyword_opportunity" && key) {
    // Opportunité de l'Agent SEO V2 : modification manuelle structurée (la PR GitHub se prépare depuis la fiche de l'opportunité).
    const page = targetPage || key;
    const result = await prepareAction({ kind: "admin", userId }, { recommendationId: id, type: "seo.site_change", parameters: { page: page.slice(0, 300), change: (suggested || `Traiter l’opportunité « ${key} ».`).slice(0, 2000), rationale: (recommendation.reason ?? "").slice(0, 2000) || undefined } });
    if (!result.ok) return { message: result.message };
    revalidatePath(`/recommendations/${id}`);
    revalidatePath("/actions");
    return { message: "Action SEO structurée créée et en attente de votre approbation." };
  }
  if (!["page_drop", "emerging_query", "low_ctr"].includes(kind) || !key) return { message: "Cette recommandation n’est pas une opportunité SEO transformable en modification de site." };

  const page = kind === "page_drop" ? key : targetPage;
  if (!page) return { message: "La page cible n’est pas identifiée dans Search Console. Relancez l’analyse SEO avant de préparer l’action." };

  const sourcePrefix = sourcePath ? `Dans le fichier « ${sourcePath} », ` : "";
  const currentSignals = [
    currentTitle ? `title actuel « ${currentTitle} »` : "",
    currentDescription ? `description actuelle « ${currentDescription} »` : "",
    currentH1 ? `H1 actuel « ${currentH1} »` : "",
  ].filter(Boolean).join(" ; ");
  const change = kind === "page_drop"
    ? `${sourcePrefix}auditer la page en baisse et ne modifier que les éléments dont la cause est confirmée : indexation, redirections, canonical, contenu ou maillage interne.${currentSignals ? ` Contexte du code : ${currentSignals}.` : ""}`
    : kind === "low_ctr"
      ? `${sourcePrefix}retravailler le title et la meta description pour mieux répondre à l’intention de la requête « ${key} », sans promettre de gain et sans modifier le fond sans justification.${currentSignals ? ` Contexte du code : ${currentSignals}.` : ""}`
      : `${sourcePrefix}renforcer la page pour mieux couvrir l’intention de la requête « ${key} » : title, structure, contenu ou maillage uniquement si l’audit le justifie. Ne créer une nouvelle page que si une intention distincte est confirmée.${currentSignals ? ` Contexte du code : ${currentSignals}.` : ""}`;

  const rationale = [recommendation.reason ?? "", suggested, sourcePath ? `Fichier source lu en GitHub : ${sourcePath}.` : ""].filter(Boolean).join(" ").slice(0, 2000);
  const result = await prepareAction({ kind: "admin", userId }, { recommendationId: id, type: "seo.site_change", parameters: { page, change, rationale } });
  if (!result.ok) return { message: result.message };
  revalidatePath(`/recommendations/${id}`);
  revalidatePath("/actions");
  revalidatePath("/work");
  revalidatePath("/dashboard");
  return { message: "Action SEO structurée créée et en attente de votre approbation." };
}

/** Confirmation d'une proposition de l'Agent SEO (écarter l'opportunité) : la justification est relue en base, jamais reçue du navigateur. */
export async function confirmAgentProposalAction(_previousState: RecommendationActionState, formData: FormData): Promise<RecommendationActionState> {
  let actor;
  try { actor = await requireAdminWriter(); } catch (error) {
    if (error instanceof SimulationWriteBlocked) return { message: error.message };
    throw error;
  }
  const messageId = singleString(formData, "message_id");
  const recommendationId = singleString(formData, "id");
  if (!messageId || !recommendationId) return { message: "Proposition introuvable." };
  const { data } = await getSupabaseServerClient().from("agent_messages").select("id,recommendation_id,sender_type,metadata").eq("id", messageId).maybeSingle();
  const metadata = asRecord((data?.metadata ?? null) as Json);
  const proposal = asRecord(metadata.proposal as Json);
  if (!data || data.sender_type !== "agent" || data.recommendation_id !== recommendationId || proposal.type !== "dismiss" || typeof proposal.reason !== "string" || typeof metadata.opportunity_id !== "string") return { message: "Proposition introuvable ou expirée." };
  const result = await changeOpportunityStatus(actor, metadata.opportunity_id, "dismissed", proposal.reason);
  revalidatePath(`/recommendations/${recommendationId}`);
  revalidatePath("/agents", "layout");
  return { message: result.message };
}
