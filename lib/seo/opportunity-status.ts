// Cycle de vie d'une opportunité (pur, partagé interface / serveur) et correspondance avec la recommandation existante.
// Même règle que le déclencheur en base (codev_private.seo_opportunity_guard).
import type { OpportunityStatus } from "@/lib/supabase/seo-opportunities.types";
import type { StatusTone } from "@/components/ui/status-badge";

export const opportunityStatuses: readonly OpportunityStatus[] = ["detected", "to_review", "approved", "in_progress", "done", "dismissed"];

export const opportunityStatusLabels: Record<OpportunityStatus, { label: string; tone: StatusTone }> = {
  detected: { label: "Détectée", tone: "neutral" },
  to_review: { label: "À examiner", tone: "amber" },
  approved: { label: "Approuvée", tone: "blue" },
  in_progress: { label: "En cours", tone: "blue" },
  done: { label: "Réalisée", tone: "green" },
  dismissed: { label: "Écartée", tone: "neutral" },
};

const transitions: Record<OpportunityStatus, readonly OpportunityStatus[]> = {
  detected: ["to_review", "approved", "dismissed"],
  to_review: ["approved", "dismissed"],
  approved: ["in_progress", "done", "dismissed"],
  in_progress: ["approved", "done", "dismissed"],
  done: ["to_review"],
  dismissed: ["to_review"],
};

export const isOpportunityStatus = (value: unknown): value is OpportunityStatus => typeof value === "string" && (opportunityStatuses as readonly string[]).includes(value);

export function canTransitionOpportunity(from: OpportunityStatus, to: OpportunityStatus) {
  return transitions[from].includes(to);
}

export function nextOpportunityStatuses(from: OpportunityStatus) {
  return transitions[from];
}

/** Statut attendu de la recommandation liée : en attente, acceptée ou refusée. */
export function recommendationStatusFor(status: OpportunityStatus): "pending" | "accepted" | "rejected" {
  if (status === "dismissed") return "rejected";
  if (status === "approved" || status === "in_progress" || status === "done") return "accepted";
  return "pending";
}

/** Statut d'opportunité déduit d'une décision prise depuis la page Recommandations (acceptée / refusée). */
export function opportunityStatusForRecommendation(recommendationStatus: string, current: OpportunityStatus): OpportunityStatus | null {
  if (recommendationStatus === "accepted" && (current === "detected" || current === "to_review")) return "approved";
  if (recommendationStatus === "rejected" && current !== "dismissed" && current !== "done") return "dismissed";
  return null;
}

/** Une opportunité close n'est plus relancée automatiquement ; seul un changement significatif est signalé. */
export const closedStatuses: readonly OpportunityStatus[] = ["done", "dismissed"];
