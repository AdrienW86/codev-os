// Résultats structurés de l'assistant (pur, partagé serveur / navigateur).
// Les vues sont des DONNÉES typées produites par le serveur (outils métier) et rendues par des
// composants React connus : jamais de HTML, de script ni de SQL venant du modèle.
import { z } from "zod";
import type { DashboardData, DashboardFilters } from "@/lib/integrations/google-ads/dashboard";

export type ViewLink = { label: string; href: string };
export type MetricItem = { label: string; value: string; tone?: "neutral" | "amber" | "green"; href?: string };
export type TableView = { type: "table"; title: string; caption?: string; columns: string[]; rows: { cells: string[]; href?: string }[]; empty: string };
export type MetricsView = { type: "metrics"; title: string; caption?: string; items: MetricItem[] };
export type AdsCampaignsView = { type: "ads_campaigns"; title: string; clientId: string; clientName: string; filters: DashboardFilters; data: DashboardData };
export type AdsRecommendationsView = { type: "ads_recommendations"; title: string; clientId: string; scope: string; result: Extract<import("@/lib/integrations/google-ads/recommendations-service").RecommendationResult, { ok: true }> };
export type AssistantView = (TableView | MetricsView | AdsCampaignsView | AdsRecommendationsView) & { link?: ViewLink };

/** Liens affichables : chemin interne ou https uniquement (jamais javascript:, data:, //hôte). */
export const isSafeHref = (href: unknown): href is string => typeof href === "string" && href.length <= 2000 && (/^\/(?!\/)[^\s\\]*$/.test(href) || /^https:\/\/[^\s\\]+$/.test(href));

// --- Contexte de conversation -----------------------------------------------------------------
// Conservé par le navigateur et renvoyé à chaque demande ; le serveur le REVALIDE (client existant,
// filtres analysés par parseFilters) : il ne confère aucun droit et ne contient aucune donnée chiffrée.

export const contextSchema = z.object({
  clientId: z.string().uuid().optional(),
  clientName: z.string().trim().min(1).max(120).optional(),
  view: z.enum(["ads_campaigns"]).optional(),
  /** Filtres du tableau de bord sérialisés (même format que l'URL de l'onglet Campagnes). */
  adsQuery: z.string().max(2000).optional(),
}).strict();
export type AssistantContext = z.infer<typeof contextSchema>;

export function parseContext(value: unknown): AssistantContext {
  const parsed = contextSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}
