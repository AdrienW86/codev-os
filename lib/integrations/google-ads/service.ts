import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import { getActiveScenario } from "@/lib/simulation/server";
import type { Json } from "@/lib/supabase/database.types";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getClient as getClientById } from "@/lib/clients/data";
import { getAgentById, listClientsForAgent } from "@/lib/agents/data";
import { writeAuditLog } from "@/lib/audit-logs";
import { createAgentRun, completeAgentRun, failAgentRun } from "@/lib/agent-runs/data";
import { createRecommendation } from "@/lib/recommendations/data";
import { isAgentUuid } from "@/lib/agents/validation";
import { createGoogleAdsReadClient, GoogleAdsError } from "./client";
import { getAdsPeriod, normalizeCustomerId } from "./validation";
import type { AdsAnalysisContext, AdsFormState, AdsMetrics, AdsPeriod, CampaignDashboardRaw, GoogleAdsConnection } from "./types";
import { normalizeMetrics } from "./client";
import { PeriodError, describeDates, previousPeriod, resolvePeriod, type PeriodSelection } from "./periods";
import { parseScope, storeScope, type AdsScope } from "./scope";
import { sumCampaigns, type CampaignRow, type DashboardData, type DashboardFilters } from "./dashboard";
import { readCampaignTracking } from "./tracking-store";
import { loadCampaignTracking } from "./tracking";
import { selectAIProvider } from "@/lib/ai/providers";
import { analyzeAdsWithAI } from "./ai-analysis";
import { analyzeRecommendation } from "./recommendation-core";
import { getAdsBusinessContext } from "./context-service";
import { reserveAdsAnalysis, saveAdsAnalysisMetadata } from "./analysis-state";
import type { AdsInstructionSnapshot } from "./business-context";

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
  const { campaigns } = await client.getCampaignPerformance(account, period, connection.metadata.manager_customer_id);
  const tracking = await loadCampaignTracking(connection);
  const selected = campaigns.filter((row) => tracking.ids === null || tracking.ids.includes(row.id));
  const totals = sumCampaigns(selected.map((row) => ({ ...row, type: row.channel, subType: null, localServices: row.channel === "LOCAL_SERVICES", budget: { amount: row.budget, shared: null, period: null }, hasActivity: true, previous: null }))).metrics;
  return { account, period, campaigns: selected, totals, anomalies: findAdsAnomalies(selected) };
}

/** Agent éligible à l'analyse réelle : identifié par le registre (agent_type), jamais par son nom. */
export function isGoogleAdsAgent(agent: { agent_type?: string | null } | null | undefined) {
  return agent?.agent_type === "google-ads";
}

export const ANALYSIS_ENGINE_NOTE = "Les règles déterministes détectent les dépenses sans conversion. L’analyse IA facultative utilise les instructions globales, celles du client et son contexte commercial ; elle produit uniquement des recommandations.";

/**
 * Analyse réelle en lecture seule sur un périmètre EXPLICITE (dates + campagnes). Sans périmètre
 * (formulaire de la page agent), la période choisie et toutes les campagnes actuellement actives.
 * Le périmètre est enregistré dans le run et dans la recommandation.
 */
export async function runGoogleAdsAnalysis(agentId: string, clientId: string, input: { scope?: AdsScope; period?: PeriodSelection; mode?: "deterministic" | "ai"; dashboard?: DashboardData } = {}): Promise<AdsFormState> {
  await requireAdmin();
  if (await getActiveScenario()) return { message: "Simulation active : aucune analyse réelle n’est lancée." };
  if (!isAgentUuid(agentId) || !isAgentUuid(clientId)) return { message: genericMessage };
  let runId: string | null = null;
  let connectionId: string | null = null;
  let lease: { release: () => Promise<void> } | null = null;
  if (input.scope && !parseScope(input.scope) || input.mode !== undefined && !["ai", "deterministic"].includes(input.mode)) return { message: "Périmètre ou mode invalide." };
  try {
    const agent = await getAgentById(agentId);
    const assignments = await listClientsForAgent(agentId);
    if (!isGoogleAdsAgent(agent) || !agent?.enabled || agent.status !== "Actif" || !assignments.some((item) => item.client_id === clientId && item.enabled)) return { message: "Un agent Google Ads (type google-ads) actif et assigné à ce client est nécessaire." };
    const connection = await checkedConnection(clientId);
    if (connection.status !== "connected") return { message: "Connectez et testez Google Ads sur la fiche client avant de lancer une analyse." };
    const reservation = await reserveAdsAnalysis(clientId);
    if (!reservation.acquired) return { message: reservation.message };
    lease = reservation;
    connectionId = connection.id;
    const client = createGoogleAdsReadClient();
    const supplied = input.dashboard;
    const suppliedAge = supplied ? Date.now() - Date.parse(supplied.fetchedAt) : Infinity;
    const loaded = supplied && suppliedAge >= 0 && suppliedAge <= 30_000 && supplied.account.id === connection.external_account_id && input.scope?.start === supplied.period.start && input.scope.end === supplied.period.end ? supplied : null;
    const account = loaded?.account ?? await client.getAccountSummary(connection.external_account_id!, connection.metadata.manager_customer_id);
    let period: AdsPeriod;
    try {
      const resolved = input.scope ? resolvePeriod({ preset: "custom", start: input.scope.start, end: input.scope.end }, account.timezone) : resolvePeriod(input.period ?? { preset: "last_30" }, account.timezone);
      period = { start: resolved.start, end: resolved.end, days: resolved.days };
    } catch (error) { return { message: error instanceof PeriodError ? error.message : "Période invalide." }; }
    const rows = loaded?.campaigns ?? buildCampaignRows(await client.getCampaignDashboard(account, period, null, connection.metadata.manager_customer_id));
    const dataFetchedAt = loaded?.fetchedAt ?? new Date().toISOString();
    const tracking = await loadCampaignTracking(connection);
    const requested: AdsScope = input.scope ?? { start: period.start, end: period.end, status: "enabled", types: [], campaignIds: rows.filter((row) => row.status === "ENABLED" && (tracking.ids === null || tracking.ids.includes(row.id))).map((row) => row.id) };
    if (!requested.campaignIds.length) return { message: "Aucune campagne dans ce périmètre." };
    const scope = storeScope(requested, rows, { days: period.days, timezone: account.timezone, currency: account.currency, accountId: account.id });
    if (!scope) return { message: "Le périmètre contient une campagne inconnue pour ce compte : rechargez le tableau de bord." };
    const selected = rows.filter((row) => scope.campaignIds.includes(row.id));
    const business = await getAdsBusinessContext(clientId);
    const assignment = assignments.find((item) => item.client_id === clientId)!;
    const instructionSnapshot: AdsInstructionSnapshot = { global: (agent.instructions ?? "").slice(0, 10000), client: (assignment.client_instructions ?? "").slice(0, 3000), business: business.context };
    const provider = input.mode === "ai" ? selectAIProvider() : null;
    const metadata: Record<string, unknown> = { run_type: "google_ads_read_only", engine: input.mode === "ai" ? "ai" : "deterministic", requested_mode: input.mode ?? "deterministic", provider: provider?.id ?? null, model: provider?.model ?? null, scope, instruction_snapshot: instructionSnapshot };
    const started = await createAgentRun({ agent_id: agentId, client_id: clientId, metadata });
    if (!started.ok) return { message: started.message };
    runId = started.run.id;
    await audit("google_ads.analysis_started", clientId, connectionId, { run_id: runId });
    // Règle déterministe : dépenses sans conversion enregistrée. Local Services exclu (pas de conversions comparables).
    const anomalies = selected.filter((row) => !row.localServices && row.metrics.cost !== null && row.metrics.cost > 0 && row.metrics.conversions === 0)
      .map((row) => ({ rule: "spend_without_conversions" as const, campaignId: row.id, cost: row.metrics.cost! }));
    const totals = sumCampaigns(selected).metrics;
    const analyzed = await analyzeRecommendation(selected, scope, instructionSnapshot, input.mode ?? "deterministic");
    const aiResult: Awaited<ReturnType<typeof analyzeAdsWithAI>> | null = analyzed.ai;
    const aiFailed = analyzed.engine === "deterministic_fallback";
    metadata.engine = analyzed.engine;
    metadata.ai_ms = analyzed.aiMs;
    if (aiFailed) metadata.fallback_reason = "IA indisponible ou sortie structurée refusée. Repli déterministe explicite.";
    let recommendationId: string | undefined;
    if (aiResult?.output.recommendations.length) {
      const reason = aiResult.text.length > 4000 ? `${aiResult.text.slice(0, 3700)}\nAnalyse complète enregistrée avec le run ${runId}.` : aiResult.text;
      const created = await createRecommendation({ agent_id: agentId, client_id: clientId, title: "Google Ads : analyse personnalisée", severity: "medium", status: "pending", reason,
        payload: { source: "google_ads_read_only", engine: "ai", run_id: runId, scope: { ...scope, campaignNames: { ...scope.campaignNames } }, provider: provider!.id, model: provider!.model, analysis: aiResult.output as unknown as Json } });
      if (!created.ok) throw new Error();
      recommendationId = created.recommendation.id;
    } else if (!aiResult && anomalies.length) {
      const money = new Intl.NumberFormat("fr-FR", { style: "currency", currency: account.currency });
      const lines = anomalies.slice(0, 5).map((signal) => `« ${scope.campaignNames[signal.campaignId] ?? signal.campaignId} » (${money.format(signal.cost)})`).join(", ");
      const created = await createRecommendation({
        agent_id: agentId, client_id: clientId, title: "Google Ads : dépenses sans conversion enregistrée", severity: "medium", status: "pending",
        reason: `${anomalies.length} campagne(s) ont dépensé sans conversion enregistrée ${describeDates(period)} : ${lines}. Vérifiez le suivi des conversions et les performances. Constat issu de règles déterministes (sans IA) ; aucune modification Google Ads n’a été effectuée.`,
        payload: { source: "google_ads_read_only", engine: "deterministic", run_id: runId, account_id: account.id, currency: account.currency, scope: { ...scope, campaignNames: { ...scope.campaignNames } }, period: { ...period }, totals: { ...totals }, signals: anomalies.slice(0, 50).map((item) => ({ ...item })), signals_total: anomalies.length },
      });
      if (!created.ok) throw new Error();
      recommendationId = created.recommendation.id;
      await audit("google_ads.recommendation_created", clientId, connectionId, { run_id: runId, recommendation_id: recommendationId });
    }
    metadata.analysis_text = analyzed.text;
    metadata.data_fetched_at = dataFetchedAt;
    if (aiResult) { metadata.analysis = aiResult.output; metadata.evidence = aiResult.evidence; }
    await saveAdsAnalysisMetadata(runId, clientId, agentId, metadata);
    const summary = `${aiFailed ? "IA indisponible : repli déterministe explicite. " : ""}${aiResult ? "Analyse IA personnalisée" : "Analyse réelle (règles déterministes, sans IA)"} sur ${selected.length} campagne(s) ${describeDates(period)} : ${recommendationId ? "recommandation créée" : aiResult ? "analyse enregistrée" : "aucun signal"}.`;
    const completed = await completeAgentRun(runId, summary);
    if (!completed.ok) throw new Error();
    await audit("google_ads.analysis_completed", clientId, connectionId, { run_id: runId, ...(recommendationId ? { recommendation_id: recommendationId } : {}) });
    return { ok: true, message: summary, runId, ...(recommendationId ? { recommendationId } : {}) };
  } catch (error) {
    safeFailure("analysis", error);
    // Les lectures Google Ads précèdent la création du run (le périmètre enregistré en dépend) :
    // un échec de lecture est donc tracé par l'audit seul ; un échec ultérieur marque aussi le run.
    if (runId) try { await failAgentRun(runId, "Échec de l’analyse Google Ads en lecture seule. Vérifiez la connexion et réessayez."); } catch { safeFailure("fail_run", null); }
    try { await audit("google_ads.analysis_failed", clientId, connectionId, runId ? { run_id: runId } : {}); } catch { safeFailure("audit_failed_run", null); }
    return { message: genericMessage };
  } finally { if (lease) try { await lease.release(); } catch { safeFailure("release_analysis", null); } }
}

// --- Tableau de bord des campagnes ------------------------------------------------------------

const zeroMetrics = (): AdsMetrics => ({ impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0, ctr: null, averageCpc: null, costPerConversion: null });
const loadMessages: Record<GoogleAdsError["kind"], string> = {
  configuration: "Google Ads n’est pas configuré côté serveur pour ce client.",
  authentication: "Authentification Google Ads refusée : l’autorisation OAuth du serveur est à renouveler.",
  access: "Accès refusé à ce compte Google Ads (droits du compte ou du compte administrateur).",
  quota: "Quota de l’API Google Ads atteint : réessayez dans quelques minutes.",
  unavailable: "Google Ads ne répond pas pour le moment : réessayez.",
  response: "Réponse Google Ads inattendue : aucune donnée affichée.",
};

/**
 * Lignes de campagnes : une campagne sans ligne de métriques n'a pas eu d'activité sur la période
 * (Google Ads omet ces lignes) → zéros explicites et hasActivity = false. Exception : Local Services,
 * dont les métriques de campagne ne sont pas garanties par l'API → « indisponible » (null), jamais zéro.
 * Une campagne supprimée sans activité sur la période est écartée.
 */
export function buildCampaignRows(raw: CampaignDashboardRaw): CampaignRow[] {
  return raw.inventory.flatMap((item) => {
    const metrics = raw.current[item.id];
    const localServices = item.type === "LOCAL_SERVICES";
    if (!metrics && item.status === "REMOVED") return [];
    const empty = localServices ? normalizeMetrics() : zeroMetrics();
    const previous = raw.previous ? raw.previous[item.id] ?? empty : null;
    return [{ id: item.id, name: item.name, status: item.status, type: item.type, subType: item.subType, localServices, budget: item.budget, hasActivity: Boolean(metrics), metrics: metrics ?? empty, previous }];
  });
}

export type DashboardResult = { ok: true; data: DashboardData } | { ok: false; message: string };

/** Lecture seule, à la demande : vérifie le client et SON compte associé, résout la période dans le fuseau du compte. */
export async function loadCampaignDashboard(clientId: string, filters: DashboardFilters, now = new Date()): Promise<DashboardResult> {
  await requireAdmin();
  if (!isAgentUuid(clientId)) return { ok: false, message: "Client invalide." };
  let connection: GoogleAdsConnection;
  try { connection = await checkedConnection(clientId); } catch { return { ok: false, message: "Aucun compte Google Ads associé à ce client." }; }
  if (connection.status !== "connected") return { ok: false, message: "Connexion Google Ads à tester depuis l’onglet Agents avant d’afficher les campagnes." };
  return readDashboard(connection, filters, now);
}

/** Internal worker repository: caller must be the authenticated scheduler, never a browser action. */
export async function loadCampaignDashboardForSystem(clientId: string, filters: DashboardFilters, now = new Date()): Promise<DashboardResult> {
  if (!isAgentUuid(clientId)) return { ok: false, message: "Client invalide." };
  const { data, error } = await getSupabaseServerClient().from("client_connections").select(connectionColumns).eq("client_id", clientId).eq("provider", "google_ads").eq("status", "connected").maybeSingle();
  if (error || !data || !normalizeCustomerId(data.external_account_id)) return { ok: false, message: "Connexion Google Ads indisponible." };
  const connection = { ...data, metadata: safeMetadata(data.metadata) } as GoogleAdsConnection;
  return readDashboard(connection, filters, now);
}

async function readDashboard(connection: GoogleAdsConnection, filters: DashboardFilters, now: Date): Promise<DashboardResult> {
  try {
    const started = performance.now();
    const client = createGoogleAdsReadClient();
    const account = await client.getAccountSummary(connection.external_account_id!, connection.metadata.manager_customer_id);
    let period;
    try { period = resolvePeriod(filters.period, account.timezone, now); } catch (error) {
      return { ok: false, message: error instanceof PeriodError ? error.message : "Période invalide." };
    }
    const previous = filters.compare ? previousPeriod(period) : null;
    const tracking = await readCampaignTracking(connection);
    const raw = await client.getCampaignDashboard(account, { start: period.start, end: period.end, days: period.days }, previous, connection.metadata.manager_customer_id);
    return { ok: true, data: {
      account, period: { start: period.start, end: period.end, days: period.days, includesToday: period.includesToday, today: period.today, preset: period.preset },
      previousPeriod: previous, campaigns: buildCampaignRows(raw), accountTotals: raw.accountTotals, accountPrevious: raw.accountPrevious, leads: raw.leads, fetchedAt: new Date().toISOString(), googleReadMs: Math.round(performance.now() - started), tracking,
    } };
  } catch (error) {
    safeFailure("dashboard", error);
    return { ok: false, message: error instanceof GoogleAdsError ? loadMessages[error.kind] : genericMessage };
  }
}
