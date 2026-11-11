import "server-only";
// Étape experte de la veille hebdomadaire Google Ads (job « ads.monitor ») : diagnostic expert sur 30 jours
// (termes, part d'impressions, Quality Score, appareils, Search Console) → recommandations dédoublonnées, puis
// pilote automatique prudent si le client l'a activé. Lecture via le transport principal, gardé par le bail du job.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { createGoogleAdsReadClient } from "@/lib/integrations/google-ads/client";
import { buildCampaignRows } from "@/lib/integrations/google-ads/service";
import { buildExpertDiagnosis } from "@/lib/integrations/google-ads/expert";
import { adsBusinessSchema } from "@/lib/integrations/google-ads/business-context";
import { loadOrganicQueries } from "@/lib/integrations/google-ads/organic";
import { openIncident, recordRecommendation } from "@/lib/agents/outputs";
import { planAutopilot } from "@/lib/ads/autopilot";
import { applyAutopilot, autopilotJournal, readAutopilotSettings } from "@/lib/ads/autopilot-service";
import type { RunContext } from "@/lib/runs/types";

const day = (date: Date, offset: number) => { const value = new Date(date); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); };

export async function runExpertAndAutopilot(context: Pick<RunContext, "job" | "agent" | "actor" | "now">, connection: { external_account_id: string; metadata: unknown }, trackedIds: string[] | null) {
  const { job, agent, actor, now } = context;
  const clientId = job.client_id!;
  const supabase = getSupabaseServerClient();
  // Chaque requête Google Ads revérifie que le job détient toujours son bail.
  const authorize = async () => {
    const lease = await supabase.from("jobs").select("id").eq("id", job.id).eq("client_id", clientId).eq("run_type", "ads.monitor").eq("status", "running").gt("lease_expires_at", new Date().toISOString()).maybeSingle();
    if (lease.error || !lease.data) throw new Error("Bail de la veille Google Ads perdu.");
  };
  const manager = (connection.metadata as { manager_customer_id?: string } | null)?.manager_customer_id?.replace(/-/g, "") || undefined;
  const account = connection.external_account_id.replace(/-/g, "");
  const reader = createGoogleAdsReadClient(authorize);
  const summary = await reader.getAccountSummary(account, manager);
  const period = { start: day(now, -30), end: day(now, -1), days: 30 };
  const rows = buildCampaignRows(await reader.getCampaignDashboard(summary, period, null, manager))
    .filter((row) => !row.localServices && row.status === "ENABLED" && (trackedIds === null || trackedIds.includes(row.id)));
  if (!rows.length) return { findings: 0, recommendations: 0, autopilot: null };
  const signals = reader.getExpertSignals ? await reader.getExpertSignals(summary, period, rows.map((row) => row.id), manager) : null;
  const organicQueries = await loadOrganicQueries(clientId);
  const [{ data: contextRow }, { data: client }] = await Promise.all([
    supabase.from("client_ads_context").select("context").eq("client_id", clientId).maybeSingle(),
    supabase.from("clients").select("name").eq("id", clientId).maybeSingle(),
  ]);
  const parsed = adsBusinessSchema.safeParse(contextRow?.context);
  const business = parsed.success ? parsed.data : null;
  const enriched = signals ? { ...signals, organicQueries } : null;
  const findings = buildExpertDiagnosis(rows, enriched, business, period, summary.currency);

  // Recommandations : une par constat haute ou moyenne priorité, tant que le constat reste ouvert (incident dédoublonné).
  let recommendations = 0;
  for (const finding of findings.filter((item) => item.priority !== "low").slice(0, 10)) {
    const incident = await openIncident(actor, { clientId, agentId: agent.id, source: "ads", severity: finding.priority === "high" ? "high" : "medium", title: finding.title, fingerprint: `ads-expert:${clientId}:${finding.id}`, details: { detail: finding.detail, items: finding.items, period } });
    if (!incident.created) continue;
    const recommendation = await recordRecommendation(actor, { agentId: agent.id, clientId, title: finding.title, reason: `${finding.detail}${finding.items.length ? ` Détail : ${finding.items.join(" ; ")}.` : ""} Action : ${finding.action} Impact attendu : ${finding.expectedImpact}`, severity: finding.priority === "high" ? "high" : "medium", payload: { source: "ads_expert", kind: finding.kind, campaign_id: finding.campaignId, items: finding.items, incident_id: incident.id } });
    await supabase.from("incidents").update({ recommendation_id: recommendation.id }).eq("id", incident.id);
    recommendations++;
  }

  // Pilote automatique : uniquement si le client l'a activé ET si le serveur l'autorise (sinon aucun appel d'écriture).
  const settings = await readAutopilotSettings(clientId);
  let autopilot: { mode: string; planned: number; applied: number; uncertain: number; skipped: number } | null = null;
  if (settings.available && settings.mode !== "off") {
    const candidates = planAutopilot({ mode: settings.mode, rows, signals, business, clientName: client?.name ?? "", journal: await autopilotJournal(clientId), now, maxPerCampaignWeek: settings.maxPerCampaignWeek });
    await authorize();
    const applied = await applyAutopilot(actor, { clientId, account, managerId: manager ?? null, candidates, jobId: job.id });
    autopilot = { mode: settings.mode, planned: candidates.length, ...applied };
  }
  return { findings: findings.length, recommendations, autopilot };
}
