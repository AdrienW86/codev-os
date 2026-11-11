// Pilote automatique Google Ads (pur, testé) : choisit les SEULES modifications qu'un spécialiste appliquerait
// sans hésiter et qui ne peuvent que réduire le gaspillage. Tout ce qui augmente la dépense (mots-clés,
// budgets, enchères) reste une proposition à valider.
//
// Garde-fous, tous cumulatifs :
// - mode client explicite (désactivé par défaut) ;
// - campagnes Search uniquement, jamais Local Services ni Performance Max ;
// - mot-clé négatif en correspondance EXACTE sur le terme complet (le plus étroit possible) ;
// - termes retenus : exclusion déclarée par le client et déjà payée, OU terme sans conversion ayant coûté au
//   moins deux fois le seuil de gaspillage ET ne partageant aucun mot avec les services prioritaires, les
//   termes qui convertissent ou le nom du client (hors cible évident) ;
// - plafonds : N par campagne sur 7 jours glissants (journal), 25 par exécution ;
// - jamais un terme déjà exclu, déjà ajouté au journal ou déjà retiré par un humain (annulation respectée).
import type { CampaignRow } from "@/lib/integrations/google-ads/dashboard";
import type { AdsBusinessContext } from "@/lib/integrations/google-ads/business-context";
import type { AdsExpertSignals } from "@/lib/integrations/google-ads/types";
import { exclusionWords, wasteThreshold } from "@/lib/integrations/google-ads/expert";

export type AutopilotMode = "off" | "negatives" | "extended";
export const AUTOPILOT_MODES: readonly AutopilotMode[] = ["off", "negatives", "extended"];
export const MAX_PER_RUN = 25;
export const DEFAULT_MAX_PER_CAMPAIGN_WEEK = 10;

export type AutopilotCandidate = { campaignId: string; keyword: string; matchType: "EXACT"; reason: "client_exclusion" | "off_target_waste"; cost: number; clicks: number; detail: string };
export type JournalEntry = { campaignId: string; keyword: string; status: string; createdAt: string };

const norm = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const words = (value: string) => norm(value).split(/[^a-z0-9]+/).filter((word) => word.length >= 4);

export function planAutopilot(input: {
  mode: AutopilotMode; rows: CampaignRow[]; signals: AdsExpertSignals | null; business: AdsBusinessContext | null;
  clientName: string; journal: JournalEntry[]; now: Date; maxPerCampaignWeek?: number;
}): AutopilotCandidate[] {
  if (input.mode === "off" || !input.signals?.searchTerms?.length) return [];
  const search = new Map(input.rows.filter((row) => row.type === "SEARCH" && !row.localServices && row.status === "ENABLED").map((row) => [row.id, row]));
  if (!search.size) return [];
  const cap = Math.min(Math.max(input.maxPerCampaignWeek ?? DEFAULT_MAX_PER_CAMPAIGN_WEEK, 1), 25);
  const threshold = wasteThreshold([...search.values()], input.business);
  const exclusions = exclusionWords(input.business?.exclusions);
  const converting = input.signals.searchTerms.filter((term) => term.conversions > 0).map((term) => term.term);
  const protectedWords = new Set([...words(input.business?.priorityServices ?? ""), ...converting.flatMap(words), ...words(input.clientName)]);
  const weekAgo = input.now.getTime() - 7 * 86_400_000;
  // Déjà traité (appliqué, en cours, incertain OU annulé par un humain) : jamais reproposé automatiquement.
  const known = new Set(input.journal.map((entry) => `${entry.campaignId}|${norm(entry.keyword)}`));
  const used = new Map<string, number>();
  for (const entry of input.journal) if (["applied", "pending", "uncertain"].includes(entry.status) && Date.parse(entry.createdAt) >= weekAgo) used.set(entry.campaignId, (used.get(entry.campaignId) ?? 0) + 1);

  const candidates: AutopilotCandidate[] = [];
  const terms = [...input.signals.searchTerms].filter((term) => search.has(term.campaignId) && term.status === "NONE" && term.conversions === 0 && term.cost > 0)
    .sort((a, b) => b.cost - a.cost);
  for (const term of terms) {
    const keyword = term.term.trim().replace(/\s+/g, " ");
    if (!keyword || keyword.length > 80 || /[\r\n"[\]]/.test(keyword) || keyword.split(" ").length > 10) continue;
    const key = `${term.campaignId}|${norm(keyword)}`;
    if (known.has(key)) continue;
    // Comparaison par mots entiers, ponctuation neutralisée (« d'emploi » contient le mot « emploi »).
    const flat = (text: string) => norm(text).replace(/[^a-z0-9]+/g, " ").trim();
    const value = ` ${flat(keyword)} `;
    const excluded = exclusions.find((word) => flat(word) && value.includes(` ${flat(word)} `));
    const offTarget = !excluded && term.cost >= 2 * threshold && term.clicks >= 3 && !words(keyword).some((word) => protectedWords.has(word));
    if (!excluded && !offTarget) continue;
    if ((used.get(term.campaignId) ?? 0) >= cap) continue;
    used.set(term.campaignId, (used.get(term.campaignId) ?? 0) + 1);
    known.add(key);
    candidates.push({ campaignId: term.campaignId, keyword, matchType: "EXACT", reason: excluded ? "client_exclusion" : "off_target_waste", cost: term.cost, clicks: term.clicks,
      detail: excluded ? `Contient l’exclusion déclarée « ${excluded} »` : `Sans conversion, sans lien avec les services ni les recherches qui convertissent, au-delà de deux fois le seuil de gaspillage` });
    if (candidates.length >= MAX_PER_RUN) break;
  }
  return candidates;
}
