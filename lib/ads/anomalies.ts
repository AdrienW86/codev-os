// Détection d'anomalies Google Ads (pure). Une observation, jamais un verdict : le suivi des conversions
// peut être incomplet. Comparaison période courante / période précédente de même durée.
import type { CampaignMetrics } from "@/lib/providers/google-ads";

export type AdsAnomaly = { campaignId: string; campaign: string; rule: "spend_without_conversions" | "cpa_spike" | "cost_spike"; severity: "medium" | "high"; detail: string };

const cpa = (metrics: Pick<CampaignMetrics, "cost" | "conversions">) => (metrics.conversions > 0 ? metrics.cost / metrics.conversions : null);
const euros = (value: number) => `${value.toFixed(2).replace(".", ",")} €`;

export function detectAdsAnomalies(current: CampaignMetrics[], previous: CampaignMetrics[]): AdsAnomaly[] {
  const before = new Map(previous.map((item) => [item.id, item]));
  const anomalies: AdsAnomaly[] = [];
  for (const campaign of current.filter((item) => item.status === "ENABLED")) {
    const prior = before.get(campaign.id);
    if (campaign.cost >= 50 && campaign.conversions === 0) {
      anomalies.push({ campaignId: campaign.id, campaign: campaign.name, rule: "spend_without_conversions", severity: campaign.cost >= 200 ? "high" : "medium", detail: `${euros(campaign.cost)} dépensés sans conversion sur la période.` });
      continue;
    }
    const now = cpa(campaign), then = prior ? cpa(prior) : null;
    if (now !== null && then !== null && then > 0 && now / then >= 1.5 && campaign.conversions >= 3) {
      anomalies.push({ campaignId: campaign.id, campaign: campaign.name, rule: "cpa_spike", severity: now / then >= 2 ? "high" : "medium", detail: `Coût par conversion passé de ${euros(then)} à ${euros(now)} (×${(now / then).toFixed(1).replace(".", ",")}).` });
      continue;
    }
    if (prior && prior.cost >= 30 && campaign.cost / prior.cost >= 1.8 && campaign.conversions <= prior.conversions) {
      anomalies.push({ campaignId: campaign.id, campaign: campaign.name, rule: "cost_spike", severity: "medium", detail: `Dépenses ×${(campaign.cost / prior.cost).toFixed(1).replace(".", ",")} sans hausse des conversions.` });
    }
  }
  return anomalies;
}

export function summarize(campaigns: CampaignMetrics[]) {
  const totals = campaigns.reduce((acc, item) => ({ impressions: acc.impressions + item.impressions, clicks: acc.clicks + item.clicks, cost: acc.cost + item.cost, conversions: acc.conversions + item.conversions }), { impressions: 0, clicks: 0, cost: 0, conversions: 0 });
  return { ...totals, cost: Math.round(totals.cost * 100) / 100, cpa: totals.conversions > 0 ? Math.round((totals.cost / totals.conversions) * 100) / 100 : null, campaigns: campaigns.length };
}
