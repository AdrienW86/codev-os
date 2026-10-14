// Pure, auditable Google Ads decision-support rules. No API calls, no automatic writes.
// Observations about Google Ads conversions are not proofs of actual customer leads.
import type { CampaignRow } from "./dashboard";
import type { StoredAdsScope } from "./scope";

export type AdsFinding = { id: string; priority: "high" | "medium" | "low"; title: string; detail: string; nextStep: string; campaignId: string; evidence: string[] };
export function buildAdsFindings(rows: CampaignRow[], scope: Pick<StoredAdsScope, "currency">): AdsFinding[] {
  const money = new Intl.NumberFormat("fr-FR", { style: "currency", currency: scope.currency });
  const findings: AdsFinding[] = [];
  for (const row of rows) {
    const m = row.metrics;
    const campaign = `${row.name} (ID ${row.id})`;
    // Local Services has its own lead lifecycle; never infer lead cost/quality from Search metrics.
    if (row.localServices) {
      findings.push({ id: `lsa:${row.id}`, priority: "low", title: "Contrôler les leads Local Services",
        detail: `${campaign} : dépenses ${m.cost === null ? "indisponibles" : money.format(m.cost)}. Les conversions Google Ads ne sont pas un décompte vérifié des leads facturés.`,
        nextStep: "Comparer séparément les leads facturés, appels, litiges et rendez-vous dans Local Services.", campaignId: row.id,
        evidence: ["type LOCAL_SERVICES", "métriques de la campagne"] });
      continue;
    }
    if (!row.hasActivity || m.cost === null) continue;
    if (m.cost >= 50 && m.conversions === 0) findings.push({
      id: `tracking:${row.id}`, priority: "high", title: "Dépenses sans conversion enregistrée",
      detail: `${campaign} : ${money.format(m.cost)} dépensés et aucune conversion enregistrée sur la période.`,
      nextStep: "Contrôler les actions principales (formulaire, appel), Consent Mode et les termes de recherche avant d'envisager une exclusion.", campaignId: row.id,
      evidence: [`coût : ${money.format(m.cost)}`, "conversions enregistrées : 0"] });
    if (m.conversions !== null && m.conversions > 0 && m.cost !== null) {
      const cpa = m.cost / m.conversions;
      findings.push({
        id: `cpa:${row.id}`, priority: "low", title: "Mesurer le coût par conversion",
        detail: `${campaign} : ${money.format(cpa)} par conversion enregistrée (${m.conversions} conversions).`,
        nextStep: "Comparer au coût par prospect qualifié et à la marge du client ; ne pas conclure à la rentabilité sans données commerciales.", campaignId: row.id,
        evidence: [`coût : ${money.format(m.cost)}`, `conversions enregistrées : ${m.conversions}`] });
    }
    if (m.clicks !== null && m.clicks >= 30 && m.ctr !== null && m.ctr < 0.02 && row.type === "SEARCH") findings.push({
      id: `ctr:${row.id}`, priority: "medium", title: "CTR Search à examiner",
      detail: `${campaign} : CTR ${(m.ctr * 100).toFixed(2)} % sur ${m.clicks} clics.`,
      nextStep: "Vérifier la pertinence des annonces, les groupes de mots-clés et les intentions de recherche ; comparer aux segments appropriés.", campaignId: row.id,
      evidence: [`CTR : ${(m.ctr * 100).toFixed(2)} %`, `clics : ${m.clicks}`] });
    if (row.status === "PAUSED" && m.cost > 0) findings.push({
      id: `paused:${row.id}`, priority: "low", title: "Historique de dépenses sur campagne en pause",
      detail: `${campaign} : statut actuel « en pause », mais ${money.format(m.cost)} dépensés sur la période sélectionnée.`,
      nextStep: "Ne pas interpréter ces dépenses passées comme une diffusion en cours.", campaignId: row.id,
      evidence: ["statut actuel : PAUSED", `coût période : ${money.format(m.cost)}`] });
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return findings.sort((a, b) => rank[a.priority] - rank[b.priority] || a.campaignId.localeCompare(b.campaignId));
}
