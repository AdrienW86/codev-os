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

const day = (date: Date, offset: number) => { const value = new Date(date); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); };

export const monitorAdsRun: RunHandler = async ({ job, agent, actor, now }) => {
  if (!job.client_id) throw new RunError("Client requis pour la veille Google Ads.", false);
  const supabase = getSupabaseServerClient();
  const { data: connection, error } = await supabase.from("client_connections").select("external_account_id,metadata").eq("client_id", job.client_id).eq("provider", "google_ads").maybeSingle();
  if (error) throw new RunError("Connexion Google Ads illisible.");
  if (!connection?.external_account_id) return { status: "skipped", summary: "Identifiant client Google Ads non renseigné (fiche client → Agents → Google Ads)." };
  const manager = (connection.metadata as { manager_customer_id?: string } | null)?.manager_customer_id ?? null;
  const current = { start: day(now, -7), end: day(now, -1) }, previous = { start: day(now, -14), end: day(now, -8) };
  let thisWeek, lastWeek;
  try {
    [thisWeek, lastWeek] = await Promise.all([campaignMetrics(connection.external_account_id, current, { managerId: manager }), campaignMetrics(connection.external_account_id, previous, { managerId: manager })]);
    await recordSync(job.client_id, "google_ads", null);
  } catch (failure) {
    await recordSync(job.client_id, "google_ads", failure);
    if (failure instanceof ProviderError) throw new RunError(failure.message, failure.retryable);
    throw failure;
  }
  const totals = summarize(thisWeek);
  await supabase.from("metric_snapshots").upsert({ client_id: job.client_id, provider: "google-ads", metric_key: "weekly_summary", period_start: current.start, period_end: current.end, data: totals as unknown as Json }, { onConflict: "client_id,provider,metric_key,period_start,period_end" });
  const anomalies = detectAdsAnomalies(thisWeek, lastWeek);
  for (const anomaly of anomalies) {
    const incident = await openIncident(actor, { clientId: job.client_id, agentId: agent.id, source: "ads", severity: anomaly.severity, title: `${anomaly.campaign} : ${anomaly.rule === "spend_without_conversions" ? "dépenses sans conversion" : anomaly.rule === "cpa_spike" ? "coût par conversion en hausse" : "dépenses en forte hausse"}`, fingerprint: `ads:${job.client_id}:${anomaly.campaignId}:${anomaly.rule}`, details: { detail: anomaly.detail, period: current } });
    if (!incident.created) continue;
    const recommendation = await recordRecommendation(actor, { agentId: agent.id, clientId: job.client_id, title: `Revoir la campagne « ${anomaly.campaign} »`, reason: `${anomaly.detail} Vérifiez les termes de recherche, les enchères et le suivi des conversions.`, severity: anomaly.severity, payload: { campaign_id: anomaly.campaignId, rule: anomaly.rule, incident_id: incident.id } });
    await supabase.from("incidents").update({ recommendation_id: recommendation.id }).eq("id", incident.id);
    await prepareAction(actor, { recommendationId: recommendation.id, type: "ads.optimization", parameters: { campaign: anomaly.campaign, change: "Analyser les termes de recherche, exclure les requêtes non pertinentes et ajuster les enchères.", expected_effect: "Réduire le coût par conversion." }, incidentId: incident.id });
  }
  return { status: "succeeded", summary: `${totals.campaigns} campagne(s) analysée(s) : ${totals.cost.toFixed(2)} € dépensés, ${totals.conversions} conversion(s), ${anomalies.length} anomalie(s).`, data: { anomalies: anomalies.length } };
};
