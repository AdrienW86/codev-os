import "server-only";
import { recordSync } from "@/lib/connections/sync";
// Handler « ads.monitor » : lecture des campagnes (7 jours vs 7 jours précédents), anomalies →
// incident + recommandation + action d'optimisation PRÉPARÉE (validation et réalisation manuelles).
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { campaignMetrics } from "@/lib/providers/google-ads";
import { ProviderError } from "@/lib/providers/errors";
import { detectAdsAnomalies, summarize } from "@/lib/ads/anomalies";
import { openIncident, prepareAction, recordRecommendation } from "@/lib/agents/outputs";
import { RunError, type RunHandler } from "@/lib/runs/types";
import type { Json } from "@/lib/supabase/database.types";
import { readCampaignTracking } from "@/lib/integrations/google-ads/tracking-store";
import { runExpertAndAutopilot } from "@/lib/ads/expert-run";

const day = (date: Date, offset: number) => { const value = new Date(date); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); };

export const monitorAdsRun: RunHandler = async ({ job, agent, actor, now, runId }) => {
  if (!job.client_id) throw new RunError("Client requis pour la veille Google Ads.", false);
  const supabase = getSupabaseServerClient();
  const { data: connection, error } = await supabase.from("client_connections").select("id,client_id,status,external_account_id,metadata").eq("client_id", job.client_id).eq("provider", "google_ads").maybeSingle();
  if (error) throw new RunError("Connexion Google Ads illisible.");
  if (!connection?.external_account_id || connection.status !== "connected") return { status: "skipped", summary: "Compte Google Ads non connecté pour ce client." };
  const tracking = await readCampaignTracking(connection);
  if (!tracking.available) throw new RunError("Migration de suivi des campagnes requise.", false);
  const manager = (connection.metadata as { manager_customer_id?: string } | null)?.manager_customer_id ?? null;
  const current = { start: day(now, -7), end: day(now, -1) }, previous = { start: day(now, -14), end: day(now, -8) };
  if (runId) {
    const { error: snapshotError } = await supabase.from("agent_runs").update({ metadata: { run_type: "ads.monitor", engine: "deterministic", provider: "google-ads", scope: { accountId: connection.external_account_id, period: current, campaignIds: tracking.ids, trackingRevision: tracking.revision }, instruction_mode: "not_used_by_deterministic_rules" } }).eq("id", runId).eq("client_id", job.client_id).eq("agent_id", agent.id).eq("status", "running");
    if (snapshotError) throw new RunError("Instantané du périmètre indisponible.", false);
  }
  let thisWeek, lastWeek;
  try {
    [thisWeek, lastWeek] = await Promise.all([campaignMetrics(connection.external_account_id, current, { managerId: manager }), campaignMetrics(connection.external_account_id, previous, { managerId: manager })]);
    await recordSync(job.client_id, "google_ads", null);
  } catch (failure) {
    await recordSync(job.client_id, "google_ads", failure);
    if (failure instanceof ProviderError) throw new RunError(failure.message, failure.retryable);
    throw failure;
  }
  const selected = (row: { id: string }) => tracking.ids === null || tracking.ids.includes(row.id);
  thisWeek = thisWeek.filter((row) => selected(row) && row.type !== "LOCAL_SERVICES"); lastWeek = lastWeek.filter((row) => selected(row) && row.type !== "LOCAL_SERVICES");
  const totals = summarize(thisWeek);
  await supabase.from("metric_snapshots").upsert({ client_id: job.client_id, provider: "google-ads", metric_key: "weekly_summary", period_start: current.start, period_end: current.end, data: totals as unknown as Json }, { onConflict: "client_id,provider,metric_key,period_start,period_end" });
  const anomalies = detectAdsAnomalies(thisWeek, lastWeek);
  for (const anomaly of anomalies) {
    const incident = await openIncident(actor, { clientId: job.client_id, agentId: agent.id, source: "ads", severity: anomaly.severity, title: `${anomaly.campaign} : ${anomaly.rule === "spend_without_conversions" ? "dépenses sans conversion" : anomaly.rule === "cpa_spike" ? "coût par conversion en hausse" : "dépenses en forte hausse"}`, fingerprint: `ads:${job.client_id}:${anomaly.campaignId}:${anomaly.rule}`, details: { detail: anomaly.detail, period: current } });
    if (!incident.created) continue;
    const proposed = anomaly.rule === "spend_without_conversions"
      ? { check: "Vérifier les conversions principales (appels/formulaires), le déclenchement des balises et les termes de recherche.", expected: "Fiabiliser le suivi avant une optimisation des mots-clés ou des enchères." }
      : anomaly.rule === "cpa_spike"
        ? { check: "Comparer les requêtes, appareils, zones, taux de conversion et changements récents avant d'ajuster les enchères.", expected: "Identifier la source de la hausse du coût par conversion sans couper les prospects qualifiés." }
        : { check: "Comparer le volume et les CPC, les requêtes non pertinentes et les changements de ciblage ou de budget.", expected: "Déterminer la cause des dépenses supplémentaires avant toute exclusion ou réduction." };
    const recommendation = await recordRecommendation(actor, { agentId: agent.id, clientId: job.client_id, title: `Revoir la campagne « ${anomaly.campaign} »`, reason: `${anomaly.detail} ${proposed.check} Proposition sans exécution automatique ; vérifier la qualité réelle des leads.`, severity: anomaly.severity, payload: { campaign_id: anomaly.campaignId, rule: anomaly.rule, incident_id: incident.id } });
    await supabase.from("incidents").update({ recommendation_id: recommendation.id }).eq("id", incident.id);
    await prepareAction(actor, { recommendationId: recommendation.id, type: "ads.optimization", parameters: { campaign: anomaly.campaign, change: proposed.check, expected_effect: proposed.expected }, incidentId: incident.id });
  }
  // Diagnostic expert sur 30 jours + pilote automatique : une panne ici n'annule pas la veille (résultat partiel).
  let expert: Awaited<ReturnType<typeof runExpertAndAutopilot>> | null = null;
  try { expert = await runExpertAndAutopilot({ job, agent, actor, now }, { external_account_id: connection.external_account_id, metadata: connection.metadata }, tracking.ids); }
  catch { expert = null; }
  const expertText = expert ? ` Diagnostic expert : ${expert.findings} levier(s), ${expert.recommendations} nouvelle(s) recommandation(s).${expert.autopilot ? ` Pilote automatique : ${expert.autopilot.applied} mot(s)-clé(s) négatif(s) appliqué(s)${expert.autopilot.uncertain ? `, ${expert.autopilot.uncertain} incertain(s)` : ""}${expert.autopilot.skipped ? `, ${expert.autopilot.skipped} non appliqué(s) (écriture désactivée côté serveur ou doublon)` : ""}.` : ""}` : " Diagnostic expert indisponible pour cette exécution.";
  return { status: "succeeded", summary: `${totals.campaigns} campagne(s) hors Local Services analysée(s) : ${totals.cost.toFixed(2)} € dépensés, ${totals.conversions} conversion(s), ${anomalies.length} anomalie(s).${expertText}`, data: { anomalies: anomalies.length, expert } };
};
