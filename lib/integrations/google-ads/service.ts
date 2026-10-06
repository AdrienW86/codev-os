import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getClient as getClientById } from "@/lib/clients/data";
import { getAgentById, listClientsForAgent } from "@/lib/agents/data";
import { writeAuditLog } from "@/lib/audit-logs";
import { createAgentRun, completeAgentRun, failAgentRun } from "@/lib/agent-runs/data";
import { createRecommendation } from "@/lib/recommendations/data";
import { isAgentUuid } from "@/lib/agents/validation";
import { createGoogleAdsReadClient, GoogleAdsError } from "./client";
import { getAdsPeriod, normalizeCustomerId } from "./validation";
import type { AdsAnalysisContext, AdsFormState, GoogleAdsConnection } from "./types";

const connectionColumns = "id,client_id,provider,status,external_account_id,metadata,last_checked_at,created_at,updated_at";
const genericMessage = "Google Ads est indisponible. Vérifiez la configuration et les droits du compte, puis réessayez.";
type Metadata = GoogleAdsConnection["metadata"];
// Rebuild from an allowlist, never forward arbitrary JSON from storage or a form.
function safeMetadata(value: unknown): Metadata {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const metadata: Metadata = { auth_strategy: "single_user", connection_version: 1 };
  for (const key of ["account_name", "currency_code", "timezone"] as const) {
    if (typeof input[key] === "string" && input[key].length <= 1000) metadata[key] = input[key];
  }
  const manager = normalizeCustomerId(input.manager_customer_id);
  if (manager) metadata.manager_customer_id = manager;
  return metadata;
}
async function audit(action: string, clientId: string, resourceId: string | null, extra: { run_id?: string; recommendation_id?: string } = {}) {
  const { userId } = await requireAdmin();
  await writeAuditLog({ action, actor_type: "admin", actor_id: userId, resource_type: "client", resource_id: clientId, before_data: null, after_data: null, metadata: { connection_id: resourceId, ...extra } });
}
function safeFailure(operation: string, error: unknown) {
  console.error("[google-ads]", { operation, type: error instanceof GoogleAdsError ? error.kind : "storage_or_analysis" });
}

export async function getGoogleAdsConnection(clientId: string): Promise<GoogleAdsConnection | null> {
  await requireAdmin();
  if (!isAgentUuid(clientId)) throw new Error(genericMessage);
  const { data, error } = await getSupabaseServerClient().from("client_connections").select(connectionColumns).eq("client_id", clientId).eq("provider", "google_ads").maybeSingle();
  if (error) throw new Error(genericMessage);
  if (!data) return null;
  return { ...data, metadata: safeMetadata(data.metadata) };
}

export async function saveGoogleAdsConnection(clientId: string, customerIdInput: unknown, managerIdInput?: unknown): Promise<AdsFormState> {
  await requireAdmin();
  const customerId = normalizeCustomerId(customerIdInput);
  const managerId = managerIdInput === "" || managerIdInput === undefined ? undefined : normalizeCustomerId(managerIdInput);
  if (!isAgentUuid(clientId) || !customerId || managerId === null) return { message: "Les identifiants Google Ads doivent contenir exactement 10 chiffres." };
  try {
    if (!await getClientById(clientId)) return { message: "Client indisponible." };
    const existing = await getGoogleAdsConnection(clientId);
    const input = { external_account_id: customerId, status: "disconnected", last_checked_at: null, metadata: { auth_strategy: "single_user", connection_version: 1, ...(managerId ? { manager_customer_id: managerId } : {}) } };
    const supabase = getSupabaseServerClient();
    const query = existing ? supabase.from("client_connections").update(input).eq("id", existing.id).eq("client_id", clientId).eq("provider", "google_ads") : supabase.from("client_connections").insert({ client_id: clientId, provider: "google_ads", ...input });
    const { data, error } = await query.select("id").single();
    if (error || !data) throw new Error();
    await audit(existing ? "google_ads.connection_updated" : "google_ads.connection_created", clientId, data.id);
    return { ok: true, message: "Association enregistrée. Testez la connexion pour vérifier l’accès au compte." };
  } catch (error) { safeFailure("save_connection", error); return { message: genericMessage }; }
}

async function checkedConnection(clientId: string) {
  if (!await getClientById(clientId)) throw new Error(genericMessage);
  const connection = await getGoogleAdsConnection(clientId);
  if (!connection?.external_account_id || normalizeCustomerId(connection.external_account_id) !== connection.external_account_id) throw new Error(genericMessage);
  return connection;
}

async function setConnectionStatus(connection: GoogleAdsConnection, status: "connected" | "error", metadata = connection.metadata) {
  await requireAdmin();
  const { data, error } = await getSupabaseServerClient().from("client_connections").update({ status, metadata: { ...safeMetadata(metadata) }, ...(status === "connected" ? { last_checked_at: new Date().toISOString() } : {}) }).eq("id", connection.id).eq("client_id", connection.client_id).eq("provider", "google_ads").eq("external_account_id", connection.external_account_id!).eq("updated_at", connection.updated_at).select("id").maybeSingle();
  if (error || !data) throw new Error(genericMessage);
}

export async function testGoogleAdsConnection(clientId: string): Promise<AdsFormState> {
  await requireAdmin();
  let connection: GoogleAdsConnection | null = null;
  try {
    connection = await checkedConnection(clientId);
    const account = await createGoogleAdsReadClient().getAccountSummary(connection.external_account_id!, connection.metadata.manager_customer_id);
    await setConnectionStatus(connection, "connected", { ...connection.metadata, account_name: account.name ?? "", currency_code: account.currency, timezone: account.timezone });
    await audit("google_ads.connection_tested", clientId, connection.id);
    return { ok: true, message: "Connexion Google Ads vérifiée en lecture seule." };
  } catch (error) {
    safeFailure("test_connection", error);
    if (connection && error instanceof GoogleAdsError) {
      try { await setConnectionStatus(connection, "error"); await audit("google_ads.connection_failed", clientId, connection.id); } catch { safeFailure("record_connection_failure", null); }
    }
    return { message: genericMessage };
  }
}

export function findAdsAnomalies(campaigns: AdsAnalysisContext["campaigns"]): AdsAnalysisContext["anomalies"] {
  // An observation, not a profitability verdict: conversion tracking may be incomplete.
  return campaigns.filter((campaign) => campaign.status === "ENABLED" && campaign.metrics.cost !== null && campaign.metrics.cost > 0 && campaign.metrics.conversions === 0).map((campaign) => ({ rule: "spend_without_conversions", campaignId: campaign.id, cost: campaign.metrics.cost! }));
}

export async function buildGoogleAdsAnalysisContext(clientId: string, days = 30): Promise<AdsAnalysisContext> {
  await requireAdmin();
  const connection = await checkedConnection(clientId);
  if (connection.status !== "connected") throw new Error(genericMessage);
  const client = createGoogleAdsReadClient();
  const account = await client.getAccountSummary(connection.external_account_id!, connection.metadata.manager_customer_id);
  const period = getAdsPeriod(account.timezone, days);
  const { campaigns, totals } = await client.getCampaignPerformance(account, period, connection.metadata.manager_customer_id);
  return { account, period, campaigns, totals, anomalies: findAdsAnomalies(campaigns) };
}

export async function runGoogleAdsAnalysis(agentId: string, clientId: string): Promise<AdsFormState> {
  await requireAdmin();
  if (!isAgentUuid(agentId) || !isAgentUuid(clientId)) return { message: genericMessage };
  let runId: string | null = null;
  let connectionId: string | null = null;
  try {
    const agent = await getAgentById(agentId);
    const assignments = await listClientsForAgent(agentId);
    // Existing schema has no agent kind: only the explicitly named Ads Agent is eligible.
    if (!agent?.enabled || agent.status !== "Actif" || agent.name.trim().toLowerCase() !== "ads agent" || !assignments.some((item) => item.client_id === clientId && item.enabled)) return { message: "Un Agent Ads actif et une assignation active sont nécessaires." };
    const connection = await checkedConnection(clientId);
    if (connection.status !== "connected") return { message: "Connectez et testez Google Ads sur la fiche client avant de lancer une analyse." };
    connectionId = connection.id;
    const started = await createAgentRun({ agent_id: agentId, client_id: clientId, metadata: { run_type: "google_ads_read_only" } });
    if (!started.ok) return { message: started.message };
    runId = started.run.id;
    await audit("google_ads.analysis_started", clientId, connectionId, { run_id: runId });
    const context = await buildGoogleAdsAnalysisContext(clientId);
    let recommendationId: string | undefined;
    if (context.anomalies.length) {
      const signal = context.anomalies[0];
      const amount = new Intl.NumberFormat("fr-FR", { style: "currency", currency: context.account.currency }).format(signal.cost);
      const created = await createRecommendation({
        agent_id: agentId, client_id: clientId, title: "Google Ads : dépenses sans conversion enregistrée", severity: "medium", status: "pending",
        reason: `La campagne ${signal.campaignId} a dépensé ${amount} sur ${context.period.days} jours sans conversion enregistrée. Vérifiez le suivi des conversions et les performances. Aucune modification Google Ads n’a été effectuée.`,
        payload: { source: "google_ads_read_only", run_id: runId, account_id: context.account.id, currency: context.account.currency, period: { ...context.period }, totals: { ...context.totals }, signals: context.anomalies.slice(0, 50).map((item) => ({ ...item })), signals_total: context.anomalies.length },
      });
      if (!created.ok) throw new Error();
      recommendationId = created.recommendation.id;
      await audit("google_ads.recommendation_created", clientId, connectionId, { run_id: runId, recommendation_id: recommendationId });
    }
    const summary = recommendationId ? "Analyse Google Ads en lecture seule : recommandation déterministe créée." : "Analyse Google Ads en lecture seule : aucune recommandation.";
    const completed = await completeAgentRun(runId, summary);
    if (!completed.ok) throw new Error();
    await audit("google_ads.analysis_completed", clientId, connectionId, { run_id: runId, ...(recommendationId ? { recommendation_id: recommendationId } : {}) });
    return { ok: true, message: summary, ...(recommendationId ? { recommendationId } : {}) };
  } catch (error) {
    safeFailure("analysis", error);
    if (runId) {
      try { await failAgentRun(runId, "Échec de l’analyse Google Ads en lecture seule. Vérifiez la connexion et réessayez."); } catch { safeFailure("fail_run", null); }
      try { await audit("google_ads.analysis_failed", clientId, connectionId, { run_id: runId }); } catch { safeFailure("audit_failed_run", null); }
    }
    return { message: genericMessage };
  }
}
