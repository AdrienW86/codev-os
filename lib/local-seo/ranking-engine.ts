/**
 * Local visibility engine. Input rankings must come from an observed, dated
 * provider response; Google Places proximity order is NOT a Maps rank.
 */
export type Surface = "maps" | "organic";
export type Evidence = {
  source: string;
  capturedAt: string;
  query: string;
  location: { latitude: number; longitude: number; language: string; device: "desktop" | "mobile" };
  surface: Surface;
  verified: boolean;
};
export type RankedBusiness = {
  id: string;
  name: string;
  rank: number;
  website?: string;
  placeId?: string;
  rating?: number;
  reviewCount?: number;
  primaryCategory?: string;
};
export type Observation = { evidence: Evidence; results: RankedBusiness[]; targetId: string };
export type Recommendation = {
  code: string;
  title: string;
  rationale: string;
  priority: "high" | "medium";
  evidence: string;
  disclaimer: string;
};
export type Competitor = RankedBusiness & { gap: number; recommendations: Recommendation[] };
export type RankingReport = {
  status: "verified" | "unverified" | "target_not_found";
  evidence: Evidence;
  target: RankedBusiness | null;
  competitorsAhead: Competitor[];
  totalAhead: number | null;
  top3: boolean | null;
  warnings: string[];
};
const DISCLAIMER = "Facteur indicatif : aucune action ne garantit une position Google.";
function recommendations(target: RankedBusiness, competitor: RankedBusiness): Recommendation[] {
  const items: Recommendation[] = [];
  if (competitor.reviewCount !== undefined && target.reviewCount !== undefined &&
      competitor.reviewCount > target.reviewCount) {
    items.push({
      code: "review_gap", title: "Développer les avis clients authentiques",
      rationale: `Concurrent : ${competitor.reviewCount} avis ; client : ${target.reviewCount}.`,
      priority: "high", evidence: "Comparaison des nombres d'avis observés",
      disclaimer: DISCLAIMER
    });
  }
  if (competitor.rating !== undefined && target.rating !== undefined &&
      competitor.rating > target.rating) {
    items.push({
      code: "rating_gap", title: "Améliorer la satisfaction et les réponses aux avis",
      rationale: `Concurrent : ${competitor.rating}/5 ; client : ${target.rating}/5.`,
      priority: "medium", evidence: "Notes publiques observées",
      disclaimer: DISCLAIMER
    });
  }
  if (competitor.primaryCategory && target.primaryCategory &&
      competitor.primaryCategory !== target.primaryCategory) {
    items.push({
      code: "category_review", title: "Vérifier la pertinence de la catégorie principale",
      rationale: `Catégorie concurrente : ${competitor.primaryCategory} ; client : ${target.primaryCategory}. Ne changer que si l'activité réelle le justifie.`,
      priority: "medium", evidence: "Catégories publiques observées",
      disclaimer: DISCLAIMER
    });
  }
  if (competitor.website && !target.website) {
    items.push({
      code: "website_missing", title: "Associer un site officiel pertinent",
      rationale: "Le concurrent dispose d'un site référencé dans l'observation, pas le client.",
      priority: "high", evidence: "Présence d'URL dans les données observées",
      disclaimer: DISCLAIMER
    });
  }
  return items;
}
export function buildRankingReport(observation: Observation): RankingReport {
  const { evidence, results, targetId } = observation;
  if (!evidence.source.trim() || !evidence.query.trim() ||
      !Number.isFinite(Date.parse(evidence.capturedAt)) ||
      !Number.isFinite(evidence.location.latitude) || !Number.isFinite(evidence.location.longitude) ||
      Math.abs(evidence.location.latitude) > 90 || Math.abs(evidence.location.longitude) > 180) {
    throw new Error("Source, date, requête et coordonnées valides obligatoires.");
  }
  if (!targetId.trim()) throw new Error("Identifiant client obligatoire.");
  const warnings: string[] = [];
  const ranks = new Set<number>();
  const ids = new Set<string>();
  for (const result of results) {
    if (!result.id.trim() || !result.name.trim() || !Number.isSafeInteger(result.rank) || result.rank < 1)
      throw new Error("Résultat de classement invalide.");
    if (ranks.has(result.rank) || ids.has(result.id))
      throw new Error("Positions ou identifiants en double.");
    ranks.add(result.rank); ids.add(result.id);
  }
  if (!evidence.verified) warnings.push("Classement non vérifié : ne pas afficher comme position réelle.");
  const target = results.find(item => item.id === targetId) ?? null;
  if (!target) warnings.push("Client absent des résultats fournis : classement complet inconnu.");
  const competitorsAhead = target && evidence.verified
    ? results.filter(item => item.rank < target.rank).sort((a,b) => a.rank-b.rank)
      .map(item => ({...item, gap: target.rank-item.rank, recommendations: recommendations(target,item)}))
    : [];
  if (target && competitorsAhead.length !== target.rank-1)
    warnings.push("Résultats incomplets : certains concurrents mieux classés sont manquants.");
  return {
    status: !evidence.verified ? "unverified" : !target ? "target_not_found" : "verified",
    evidence, target, competitorsAhead,
    totalAhead: target && evidence.verified ? target.rank-1 : null,
    top3: target && evidence.verified ? target.rank<=3 : null,
    warnings
  };
}
