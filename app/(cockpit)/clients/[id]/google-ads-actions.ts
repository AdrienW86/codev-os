"use server";

import { getAdsRecommendation } from "@/lib/integrations/google-ads/recommendations-service";
import { requireAdmin } from "@/lib/require-admin";
import { revalidatePath } from "next/cache";
import { saveGoogleAdsConnection, testGoogleAdsConnection, buildGoogleAdsAnalysisContext, loadCampaignDashboard, isGoogleAdsAgent, type DashboardResult } from "@/lib/integrations/google-ads/service";
import { parseScope } from "@/lib/integrations/google-ads/scope";
import { listAgentsForClient } from "@/lib/agents/data";
import { parseFilters } from "@/lib/integrations/google-ads/dashboard";
import { readFormText } from "@/lib/integrations/google-ads/validation";
import { adminMutation } from "@/lib/core/mutation";
import { prepareGoogleAdsReport } from "@/lib/reports/google-ads-service";
import type { AdsFormState } from "@/lib/integrations/google-ads/types";

export async function configureGoogleAdsAction(_previous: AdsFormState, form: FormData): Promise<AdsFormState> {
  await requireAdmin();
  const clientId = readFormText(form, "client_id") ?? "";
  const result = await saveGoogleAdsConnection(clientId, readFormText(form, "customer_id"), readFormText(form, "manager_customer_id"));
  revalidatePath(`/clients/${clientId}`);
  return result;
}

export async function testGoogleAdsConnectionAction(_previous: AdsFormState, form: FormData): Promise<AdsFormState> {
  await requireAdmin();
  const clientId = readFormText(form, "client_id") ?? "";
  const result = await testGoogleAdsConnection(clientId);
  revalidatePath(`/clients/${clientId}`);
  return result;
}

export async function refreshGoogleAdsAction(_previous: AdsFormState, form: FormData): Promise<AdsFormState> {
  await requireAdmin();
  const clientId = readFormText(form, "client_id") ?? "";
  try {
    // Refresh tests accessibility and reloads the server-rendered metrics; no metrics cache is written.
    const result = await testGoogleAdsConnection(clientId);
    if (!result.ok) return result;
    await buildGoogleAdsAnalysisContext(clientId);
    revalidatePath(`/clients/${clientId}`);
    return { ok: true, message: "Données Google Ads actualisées en lecture seule." };
  } catch { return { message: "Impossible d’actualiser Google Ads. Vérifiez la connexion, puis réessayez." }; }
}

/**
 * Chargement du tableau de bord pour les filtres de l'URL (appel direct depuis le composant client,
 * sans navigation). Lecture seule ; aucun cache écrit ; la requête est revalidée côté serveur.
 */
export async function loadGoogleAdsDashboardAction(clientId: unknown, query: unknown): Promise<DashboardResult> {
  await requireAdmin();
  if (typeof clientId !== "string" || typeof query !== "string" || query.length > 2_000) return { ok: false, message: "Requête invalide." };
  return loadCampaignDashboard(clientId, parseFilters(new URLSearchParams(query)));
}

/** Analyse réelle de l'agent google-ads assigné à ce client, sur le périmètre exact du tableau de bord. */
export async function runGoogleAdsScopeAnalysisAction(clientId: unknown, scopeInput: unknown, refresh = false): Promise<{ ok?: boolean; message?: string; href?: string; detail?: string; reused?: boolean }> {
  await requireAdmin();
  const scope = parseScope(scopeInput);
  if (typeof clientId !== "string" || !scope) return { ok: false, message: "Périmètre invalide : rechargez le tableau de bord." };
  const agent = (await listAgentsForClient(clientId)).find((assignment) => assignment.enabled && isGoogleAdsAgent(assignment.agent));
  if (!agent) return { ok: false, message: "Aucun agent Google Ads (type google-ads) assigné et actif pour ce client." };
  const result = await getAdsRecommendation(clientId, scope, "deterministic", refresh === true);
  revalidatePath("/recommendations", "layout");
  revalidatePath("/advertising");
  revalidatePath(`/agents/${agent.agent_id}`);
  return result.ok ? { ok: true, message: `${result.summary} · ${result.reused ? "Résultat réutilisé (moins de 5 minutes)" : "Nouvelle analyse"} · ${result.elapsedMs} ms`, detail: `Récupéré le ${result.fetchedAt}\n${result.text}`, reused: result.reused, href: `/advertising/analyses/${result.runId}` } : { ok: false, message: result.message };
}

export async function runGoogleAdsScopeAIAnalysisAction(clientId: unknown, scopeInput: unknown, refresh = false): Promise<{ ok?: boolean; message?: string; href?: string; detail?: string; reused?: boolean }> {
  await requireAdmin();
  const scope = parseScope(scopeInput);
  if (typeof clientId !== "string" || !scope) return { ok: false, message: "Périmètre invalide." };
  const assignment = (await listAgentsForClient(clientId)).find((item) => item.enabled && item.agent?.enabled && item.agent.status === "Actif" && isGoogleAdsAgent(item.agent));
  if (!assignment) return { ok: false, message: "Assignez un agent Google Ads actif à ce client." };
  const result = await getAdsRecommendation(clientId, scope, "ai", refresh === true);
  revalidatePath("/recommendations", "layout");
  revalidatePath("/advertising");
  revalidatePath(`/agents/${assignment.agent_id}`);
  return result.ok ? { ok: true, message: `${result.summary} · ${result.reused ? "Résultat réutilisé (moins de 5 minutes)" : "Nouvelle analyse"} · ${result.elapsedMs} ms`, detail: `Récupéré le ${result.fetchedAt}\n${result.text}`, reused: result.reused, href: `/advertising/analyses/${result.runId}` } : { ok: false, message: result.message };
}

/**
 * Rapport Google Ads pour le périmètre EXACT affiché (dates + campagnes) : enregistré avec le rapport et
 * sa version 1, puis indépendant des filtres. Écriture en base CODE-V uniquement ; Google Ads est lu.
 */
export async function prepareGoogleAdsReportAction(clientId: unknown, scopeInput: unknown): Promise<{ ok?: boolean; message?: string; href?: string; detail?: string; reused?: boolean }> {
  await requireAdmin();
  const scope = parseScope(scopeInput);
  if (typeof clientId !== "string" || !scope) return { ok: false, message: "Périmètre invalide : rechargez le tableau de bord." };
  let href: string | undefined;
  const result = await adminMutation("reports", async (actor) => {
    const outcome = await prepareGoogleAdsReport(actor, clientId, scope);
    if (!outcome.ok) return outcome;
    href = `/reports/${outcome.id}`;
    return { ok: true, message: "Rapport Google Ads enregistré : il est prêt à relire." };
  }, ["/reports", "/dashboard"]);
  return { ...result, href };
}
