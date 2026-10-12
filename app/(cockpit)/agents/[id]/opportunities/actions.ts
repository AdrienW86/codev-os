"use server";

import { redirect } from "next/navigation";
import { adminMutation, formText, type MutationState } from "@/lib/core/mutation";
import { changeOpportunityStatus, openRecommendation, prepareGithubChange, recordDeployment, recordIntervention, runOpportunityAnalysis, scheduleSeoAnalyses } from "@/lib/seo/opportunity-service";

const paths = ["/agents", "/recommendations", "/actions", "/dashboard"];

export async function runAnalysisAction(_: MutationState, form: FormData): Promise<MutationState> {
  return adminMutation("seo-opportunities", async (actor) => {
    const result = await runOpportunityAnalysis(actor, formText(form, "client_id", 40));
    return { ok: result.ok, message: result.message ?? "Analyse lancée." };
  }, paths);
}

export async function scheduleAnalysesAction(_: MutationState, form: FormData): Promise<MutationState> {
  return adminMutation("seo-opportunities", (actor) => scheduleSeoAnalyses(actor, formText(form, "client_id", 40)), [...paths, "/settings"]);
}

export async function changeStatusAction(_: MutationState, form: FormData): Promise<MutationState> {
  return adminMutation("seo-opportunities", (actor) => changeOpportunityStatus(actor, formText(form, "id", 40), formText(form, "status", 20), formText(form, "reason", 2000) || null), paths);
}

export async function openRecommendationAction(_: MutationState, form: FormData): Promise<MutationState> {
  let target: string | null = null;
  const result = await adminMutation("seo-opportunities", async (actor) => {
    const outcome = await openRecommendation(actor, formText(form, "id", 40));
    if (outcome.ok && outcome.id) target = outcome.id;
    return outcome;
  }, paths);
  if (target) redirect(`/recommendations/${target}`);
  return result;
}

export async function prepareChangeAction(_: MutationState, form: FormData): Promise<MutationState> {
  return adminMutation("seo-opportunities", (actor) => prepareGithubChange(actor, formText(form, "id", 40), {
    title: formText(form, "title", 200) || undefined, description: formText(form, "description", 400) || undefined, h1: formText(form, "h1", 200) || undefined,
  }), paths);
}

export async function recordInterventionAction(_: MutationState, form: FormData): Promise<MutationState> {
  return adminMutation("seo-opportunities", (actor) => recordIntervention(actor, formText(form, "id", 40), formText(form, "deployed_at", 10) || null), paths);
}

export async function recordDeploymentAction(_: MutationState, form: FormData): Promise<MutationState> {
  return adminMutation("seo-opportunities", (actor) => recordDeployment(actor, formText(form, "intervention_id", 40), formText(form, "deployed_at", 10)), paths);
}
