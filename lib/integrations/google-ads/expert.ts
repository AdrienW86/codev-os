// Diagnostic expert Google Ads (pur, testable, sans réseau ni écriture).
// Méthode d'un spécialiste SEA, dans l'ordre où elle rapporte le plus :
//   1. mesure fiable (sinon tout le reste est aveugle) ;
//   2. couper le gaspillage (termes de recherche hors cible → mots-clés négatifs) ;
//   3. accélérer ce qui marche (budget limitant une campagne rentable, termes qui convertissent) ;
//   4. gagner en classement (Quality Score, part d'impressions perdue au classement) ;
//   5. affiner (appareils, rythme de dépense par rapport au budget mensuel, coût par lead cible).
// Chaque constat cite des chiffres lus dans Google Ads ; aucun n'est inventé ni extrapolé au-delà
// de la période. Les seuils sont volontairement prudents : une proposition n'est jamais une écriture.
import type { CampaignRow } from "./dashboard";
import type { AdsBusinessContext } from "./business-context";
import type { AdsExpertSignals } from "./types";

export type ExpertKind =
  | "wasted_terms" | "excluded_terms" | "converting_terms" | "budget_limited" | "budget_limited_unproven"
  | "rank_limited" | "low_quality" | "device_gap" | "cpa_above_target" | "cpa_below_target" | "pacing_over" | "pacing_under"
  | "organic_gap" | "organic_overlap" | "keyword_ideas";

export type ExpertFinding = {
  id: string; kind: ExpertKind; /** null : constat du périmètre entier (rythme de dépense). */
  campaignId: string | null; priority: "high" | "medium" | "low";
  title: string; detail: string; action: string; expectedImpact: string;
  /** Éléments concrets (termes, mots-clés, appareils) repris tels que lus dans Google Ads. */
  items: string[];
};

const MAX_ITEMS = 12;
const norm = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Mots d'exclusion fournis par l'équipe (services et demandes à exclure), découpés et normalisés. */
export function exclusionWords(exclusions: string | undefined | null) {
  return [...new Set(norm(exclusions ?? "").split(/[\n,;/|]+|\s+-\s+/).map((item) => item.trim()).filter((item) => item.length >= 3 && item.length <= 60))].slice(0, 80);
}
const matchesExclusion = (term: string, words: string[]) => {
  const value = ` ${norm(term)} `;
  return words.find((word) => value.includes(` ${word} `) || (word.length >= 5 && value.includes(word)));
};
const pct = (value: number) => `${Math.round(value * 100)} %`;

/**
 * Seuil de « dépense sans résultat » : le coût par lead cible s'il est connu, sinon le coût par conversion
 * observé sur le périmètre, sinon trois clics moyens (et 15 au minimum). Un terme qui a déjà coûté ce seuil
 * sans conversion a statistiquement peu de chances de convertir au même coût.
 */
export function wasteThreshold(rows: CampaignRow[], business: AdsBusinessContext | null) {
  if (business?.targetCostPerLead) return business.targetCostPerLead;
  const cost = rows.reduce((sum, row) => sum + (row.metrics.cost ?? 0), 0);
  const conversions = rows.reduce((sum, row) => sum + (row.metrics.conversions ?? 0), 0);
  if (conversions >= 3) return cost / conversions;
  const clicks = rows.reduce((sum, row) => sum + (row.metrics.clicks ?? 0), 0);
  return Math.max(15, clicks ? 3 * cost / clicks : 15);
}

export function buildExpertDiagnosis(rows: CampaignRow[], signals: AdsExpertSignals | null | undefined, business: AdsBusinessContext | null, period: { days: number }, currency: string): ExpertFinding[] {
  const money = new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 2 });
  const scoped = new Map(rows.filter((row) => !row.localServices).map((row) => [row.id, row]));
  const findings: ExpertFinding[] = [];
  const name = (id: string) => scoped.get(id)?.name ?? id;
  const target = business?.targetCostPerLead ?? null;
  const threshold = wasteThreshold([...scoped.values()], business);
  const exclusions = exclusionWords(business?.exclusions);

  // 2. Gaspillage : termes de recherche (Search) par campagne.
  const terms = (signals?.searchTerms ?? []).filter((term) => scoped.has(term.campaignId) && !["EXCLUDED", "ADDED_EXCLUDED"].includes(term.status));
  for (const campaignId of new Set(terms.map((term) => term.campaignId))) {
    const own = terms.filter((term) => term.campaignId === campaignId);
    const excluded = own.flatMap((term) => { const word = matchesExclusion(term.term, exclusions); return word && term.cost > 0 ? [{ term, word }] : []; });
    if (excluded.length) {
      const cost = excluded.reduce((sum, item) => sum + item.term.cost, 0);
      findings.push({ id: `expert:excluded_terms:${campaignId}`, kind: "excluded_terms", campaignId, priority: "high",
        title: "Recherches que le client exclut explicitement",
        detail: `${name(campaignId)} : ${excluded.length} terme(s) de recherche contiennent une exclusion déclarée par le client, pour ${money.format(cost)} sur la période.`,
        action: "Ajouter ces expressions en mots-clés négatifs (expression exacte ou expression) au niveau de la campagne, après validation.",
        expectedImpact: `Jusqu’à ${money.format(cost)} de dépenses réorientées vers les recherches utiles sur une période équivalente.`,
        items: excluded.slice(0, MAX_ITEMS).map(({ term, word }) => `« ${term.term} » (${money.format(term.cost)}, exclusion « ${word} »)`) });
    }
    const flagged = new Set(excluded.map((item) => item.term.term));
    const wasted = own.filter((term) => !flagged.has(term.term) && term.conversions === 0 && term.clicks >= 2 && term.cost >= threshold);
    if (wasted.length) {
      const cost = wasted.reduce((sum, term) => sum + term.cost, 0);
      findings.push({ id: `expert:wasted_terms:${campaignId}`, kind: "wasted_terms", campaignId, priority: cost >= 2 * threshold ? "high" : "medium",
        title: "Termes de recherche coûteux sans conversion",
        detail: `${name(campaignId)} : ${wasted.length} terme(s) ont chacun coûté au moins ${money.format(threshold)} sans conversion (total ${money.format(cost)}).`,
        action: "Examiner chaque terme : s’il ne correspond pas à un service vendu, l’ajouter en mot-clé négatif ; s’il est pertinent, vérifier l’annonce et la page d’atterrissage.",
        expectedImpact: `Jusqu’à ${money.format(cost)} récupérables sur une période équivalente si les termes sont hors cible.`,
        items: wasted.slice(0, MAX_ITEMS).map((term) => `« ${term.term} » (${money.format(term.cost)}, ${term.clicks} clics, 0 conversion)`) });
    }
    // 3. Termes qui convertissent sans être des mots-clés : les sécuriser en mot-clé exact.
    const winners = own.filter((term) => term.status !== "ADDED" && term.conversions >= 2 && (!target || term.cost / term.conversions <= target * 1.2));
    if (winners.length) findings.push({ id: `expert:converting_terms:${campaignId}`, kind: "converting_terms", campaignId, priority: "medium",
      title: "Recherches qui convertissent, pas encore mots-clés",
      detail: `${name(campaignId)} : ${winners.length} terme(s) génèrent des conversions sans être ciblés explicitement.`,
      action: "Les ajouter en mots-clés exacts (avec une annonce qui reprend l’expression) pour contrôler enchère et message.",
      expectedImpact: "Meilleur Quality Score et coût par conversion plus stable sur les requêtes qui rapportent déjà.",
      items: winners.slice(0, MAX_ITEMS).map((term) => `« ${term.term} » (${term.conversions.toLocaleString("fr-FR")} conversions, ${money.format(term.cost)})`) });
  }

  // 3-4. Part d'impressions : budget ou classement ?
  for (const share of signals?.impressionShare ?? []) {
    const row = scoped.get(share.campaignId);
    if (!row || row.metrics.cost === null || row.metrics.cost <= 0) continue;
    const conversions = row.metrics.conversions ?? 0;
    const cpa = conversions > 0 ? row.metrics.cost / conversions : null;
    if (share.budgetLost !== null && share.budgetLost >= 0.15) {
      const profitable = cpa !== null && (target === null || cpa <= target);
      findings.push(profitable ? {
        id: `expert:budget_limited:${row.id}`, kind: "budget_limited", campaignId: row.id, priority: share.budgetLost >= 0.3 ? "high" : "medium",
        title: "Campagne rentable bridée par son budget",
        detail: `${row.name} : ${pct(share.budgetLost)} des impressions possibles perdues faute de budget, avec un coût par conversion de ${money.format(cpa!)}${target ? ` (cible ${money.format(target)})` : ""}.`,
        action: "Augmenter progressivement le budget quotidien (par paliers de 20 % environ) ou y réallouer le budget des campagnes moins rentables, après validation.",
        expectedImpact: `Jusqu’à ${pct(share.budgetLost)} d’impressions supplémentaires au même niveau de qualité, si la demande et la capacité suivent.`,
        items: [`Part d’impressions : ${share.impressionShare === null ? "indisponible" : pct(share.impressionShare)}`, `Perdue (budget) : ${pct(share.budgetLost)}`],
      } : {
        id: `expert:budget_limited_unproven:${row.id}`, kind: "budget_limited_unproven", campaignId: row.id, priority: "low",
        title: "Budget limitant, rentabilité non démontrée",
        detail: `${row.name} : ${pct(share.budgetLost)} des impressions perdues faute de budget, mais ${cpa === null ? "aucune conversion enregistrée" : `un coût par conversion de ${money.format(cpa)} au-dessus de la cible`}.`,
        action: "Ne pas augmenter le budget : nettoyer d’abord les termes et le suivi, puis réévaluer.",
        expectedImpact: "Évite d’amplifier une campagne qui ne prouve pas encore sa rentabilité.",
        items: [`Perdue (budget) : ${pct(share.budgetLost)}`],
      });
    }
    if (share.rankLost !== null && share.rankLost >= 0.4 && (row.metrics.impressions ?? 0) >= 100) findings.push({
      id: `expert:rank_limited:${row.id}`, kind: "rank_limited", campaignId: row.id, priority: "medium",
      title: "Visibilité perdue au classement",
      detail: `${row.name} : ${pct(share.rankLost)} des impressions possibles perdues à cause du classement de l’annonce (qualité et enchère).`,
      action: "Améliorer la pertinence (annonces qui reprennent les mots-clés, extensions, page d’atterrissage) avant toute hausse d’enchère.",
      expectedImpact: "Plus d’impressions et un coût par clic plus bas lorsque la qualité progresse.",
      items: [`Perdue (classement) : ${pct(share.rankLost)}`, `Haut de page : ${share.topImpressionShare === null ? "indisponible" : pct(share.topImpressionShare)}`],
    });
  }

  // 4. Quality Score faible sur des mots-clés qui dépensent.
  const weak = (signals?.keywords ?? []).filter((keyword) => scoped.has(keyword.campaignId) && keyword.qualityScore !== null && keyword.qualityScore <= 4 && keyword.cost > 0);
  for (const campaignId of new Set(weak.map((keyword) => keyword.campaignId))) {
    const own = weak.filter((keyword) => keyword.campaignId === campaignId);
    const below = (field: "adRelevance" | "landingPage" | "expectedCtr") => own.filter((keyword) => keyword[field] === "BELOW_AVERAGE").length;
    const causes = [below("landingPage") && "page d’atterrissage", below("adRelevance") && "pertinence de l’annonce", below("expectedCtr") && "taux de clics attendu"].filter(Boolean);
    findings.push({ id: `expert:low_quality:${campaignId}`, kind: "low_quality", campaignId, priority: own.reduce((sum, item) => sum + item.cost, 0) >= threshold ? "medium" : "low",
      title: "Quality Score faible sur des mots-clés qui dépensent",
      detail: `${name(campaignId)} : ${own.length} mot(s)-clé(s) avec un Quality Score de 4/10 ou moins${causes.length ? ` ; composantes sous la moyenne : ${causes.join(", ")}` : ""}.`,
      action: "Regrouper ces mots-clés dans des groupes d’annonces serrés, reprendre l’expression dans les titres et aligner la page d’atterrissage sur l’intention.",
      expectedImpact: "Un meilleur Quality Score fait baisser le coût par clic et améliore la position à budget égal.",
      items: own.slice(0, MAX_ITEMS).map((keyword) => `« ${keyword.text} » (QS ${keyword.qualityScore}/10, ${money.format(keyword.cost)})`) });
  }

  // 5. Appareils : un appareil qui consomme sans convertir alors que les autres convertissent.
  const devices = (signals?.devices ?? []).filter((item) => scoped.has(item.campaignId));
  for (const campaignId of new Set(devices.map((item) => item.campaignId))) {
    const own = devices.filter((item) => item.campaignId === campaignId && item.cost > 0);
    const total = own.reduce((sum, item) => sum + item.cost, 0), conversions = own.reduce((sum, item) => sum + item.conversions, 0);
    if (conversions < 3 || total <= 0) continue;
    const average = total / conversions;
    const gaps = own.filter((item) => item.cost >= 0.2 * total && (item.conversions === 0 ? item.cost >= average : item.cost / item.conversions >= 2 * average));
    if (gaps.length) findings.push({ id: `expert:device_gap:${campaignId}`, kind: "device_gap", campaignId, priority: "medium",
      title: "Appareil nettement moins rentable",
      detail: `${name(campaignId)} : coût par conversion moyen ${money.format(average)} ; ${gaps.map((item) => `${deviceLabel(item.device)} ${item.conversions ? money.format(item.cost / item.conversions) : "sans conversion"}`).join(", ")}.`,
      action: "Vérifier l’expérience sur cet appareil (page, formulaire, bouton d’appel) puis, en enchères manuelles ou au CPC amélioré, appliquer un ajustement d’enchère négatif.",
      expectedImpact: "Réduction du coût par conversion de la campagne en réorientant la dépense vers les appareils qui convertissent.",
      items: gaps.map((item) => `${deviceLabel(item.device)} : ${money.format(item.cost)}, ${item.conversions.toLocaleString("fr-FR")} conversion(s)`) });
  }

  // 5. Coût par lead face à la cible du client.
  if (target) for (const row of scoped.values()) {
    const conversions = row.metrics.conversions ?? 0;
    if (row.metrics.cost === null || conversions < 2) continue;
    const cpa = row.metrics.cost / conversions;
    if (cpa > target * 1.3) findings.push({ id: `expert:cpa_above_target:${row.id}`, kind: "cpa_above_target", campaignId: row.id, priority: "high",
      title: "Coût par conversion au-dessus de la cible", detail: `${row.name} : ${money.format(cpa)} par conversion pour une cible de ${money.format(target)}.`,
      action: "Couper les termes et appareils non rentables, puis abaisser l’objectif de CPA ou les enchères par paliers de 10 à 15 %.",
      expectedImpact: `Rapprocher le coût par conversion de ${money.format(target)}.`, items: [`CPA observé : ${money.format(cpa)}`, `CPA cible : ${money.format(target)}`] });
    else if (cpa < target * 0.7) findings.push({ id: `expert:cpa_below_target:${row.id}`, kind: "cpa_below_target", campaignId: row.id, priority: "medium",
      title: "Coût par conversion nettement sous la cible", detail: `${row.name} : ${money.format(cpa)} par conversion pour une cible de ${money.format(target)}.`,
      action: "Marge disponible pour gagner du volume : augmenter le budget ou l’objectif de CPA si la capacité commerciale le permet.",
      expectedImpact: "Plus de conversions en restant sous le coût par lead cible.", items: [`CPA observé : ${money.format(cpa)}`, `CPA cible : ${money.format(target)}`] });
  }

  // 5. Rythme de dépense face au budget mensuel déclaré (compte entier du périmètre).
  const monthly = business?.advertisingMonthlyBudget ?? null;
  const spent = [...scoped.values()].reduce((sum, row) => sum + (row.metrics.cost ?? 0), 0);
  if (monthly && period.days >= 7 && spent > 0) {
    const projected = spent / period.days * 30.4;
    const ratioToBudget = projected / monthly;
    if (ratioToBudget > 1.1) findings.push({ id: "expert:pacing_over", kind: "pacing_over", campaignId: null, priority: "high",
      title: "Rythme de dépense au-dessus du budget mensuel", detail: `Au rythme de la période, environ ${money.format(projected)} par mois pour un budget de ${money.format(monthly)}.`,
      action: "Aligner les budgets quotidiens sur le budget mensuel (budget mensuel / 30,4) en préservant les campagnes les plus rentables.",
      expectedImpact: "Évite un dépassement du budget convenu avec le client.", items: [`Projection : ${money.format(projected)} / mois`, `Budget : ${money.format(monthly)} / mois`] });
    else if (ratioToBudget < 0.6) findings.push({ id: "expert:pacing_under", kind: "pacing_under", campaignId: null, priority: "medium",
      title: "Budget mensuel sous-consommé", detail: `Au rythme de la période, environ ${money.format(projected)} par mois pour un budget de ${money.format(monthly)} (${pct(ratioToBudget)}).`,
      action: "Identifier la cause (budget quotidien trop bas, ciblage trop étroit, enchères trop faibles, perte au classement) avant d’élargir.",
      expectedImpact: "Utiliser le budget prévu pour générer davantage de demandes qualifiées.", items: [`Projection : ${money.format(projected)} / mois`, `Budget : ${money.format(monthly)} / mois`] });
  }

  findings.push(...organicOpportunities(signals, business, money));
  findings.push(...keywordOpportunities(signals, business, money));

  const rank = { high: 0, medium: 1, low: 2 };
  return findings.sort((a, b) => rank[a.priority] - rank[b.priority] || a.id.localeCompare(b.id));
}

// --- Opportunités croisées Google Ads × Search Console ----------------------------------------
const STOP = new Set(["pour", "avec", "dans", "votre", "notre", "leur", "plus", "moins", "comment", "quel", "quelle", "quels", "quelles", "pourquoi", "avis", "prix", "tarif", "tarifs", "cout", "pres", "chez", "mois", "entre", "sans", "the", "and", "for"]);
const tokens = (value: string) => norm(value).split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !STOP.has(word));

/**
 * Requêtes réellement tapées sur Google (Search Console) où le site est peu visible en organique (au-delà de la
 * 8e position ou sans position) et que les annonces ne couvrent pas encore : nouvelles opportunités de mots-clés.
 * Une requête n'est retenue que si elle partage un mot significatif avec les services prioritaires du client ou
 * les mots-clés déjà achetés (pertinence métier), et jamais si elle contient une exclusion déclarée.
 * À l'inverse, une requête déjà payée où le site est dans le top 3 organique avec un bon CTR est signalée pour
 * un test d'incrémentalité (risque de payer des clics qui seraient venus gratuitement).
 */
export function organicOpportunities(signals: AdsExpertSignals | null | undefined, business: AdsBusinessContext | null, money: Intl.NumberFormat): ExpertFinding[] {
  const organic = signals?.organicQueries;
  if (!organic?.length) return [];
  const exclusions = exclusionWords(business?.exclusions);
  const bought = [...(signals?.keywords ?? []).map((item) => item.text), ...(signals?.searchTerms ?? []).filter((item) => item.status === "ADDED").map((item) => item.term)];
  const covered = new Set([...bought, ...(signals?.searchTerms ?? []).map((item) => item.term)].map((item) => norm(item).replace(/[[\]"+]/g, "").trim()));
  const vocabulary = new Set([...tokens(business?.priorityServices ?? ""), ...bought.flatMap(tokens)]);
  if (!vocabulary.size) return [];
  const relevant = (query: string) => tokens(query).some((word) => vocabulary.has(word));
  const findings: ExpertFinding[] = [];

  const gaps = organic.filter((row) => row.impressions >= 30 && (row.position === null || row.position > 8) && !covered.has(norm(row.query).trim()) && relevant(row.query) && !matchesExclusion(row.query, exclusions))
    .sort((a, b) => b.impressions - a.impressions);
  if (gaps.length) findings.push({ id: "expert:organic_gap", kind: "organic_gap", campaignId: null, priority: gaps.some((row) => row.impressions >= 200) ? "high" : "medium",
    title: "Recherches Google à capter : peu visibles en organique, absentes des annonces",
    detail: `${gaps.length} requête(s) liées aux services du client totalisent ${gaps.reduce((sum, row) => sum + row.impressions, 0).toLocaleString("fr-FR")} impressions Google sans que le site soit en première page ni que les annonces les ciblent.`,
    action: "Les ajouter en mots-clés « expression » dans le groupe d’annonces du service correspondant, avec une annonce qui reprend la requête ; en parallèle, créer ou renforcer la page qui y répond (SEO).",
    expectedImpact: "Demande réelle et déjà mesurée captée immédiatement par les annonces, pendant que le référencement progresse.",
    items: gaps.slice(0, MAX_ITEMS).map((row) => `« ${row.query} » (${row.impressions.toLocaleString("fr-FR")} impressions, position ${row.position === null ? "inconnue" : row.position.toLocaleString("fr-FR", { maximumFractionDigits: 1 })})`) });

  const paid = new Map((signals?.searchTerms ?? []).filter((term) => term.cost > 0).map((term) => [norm(term.term).trim(), term]));
  const overlap = organic.filter((row) => row.position !== null && row.position <= 3 && (row.ctr ?? 0) >= 0.15 && paid.has(norm(row.query).trim()));
  if (overlap.length) findings.push({ id: "expert:organic_overlap", kind: "organic_overlap", campaignId: null, priority: "low",
    title: "Clics payés sur des requêtes déjà dominées en organique",
    detail: `${overlap.length} requête(s) achetées en Ads où le site est déjà dans le top 3 naturel avec un bon taux de clic.`,
    action: "Tester une baisse d’enchère ou une exclusion temporaire (deux à quatre semaines) et mesurer les clics totaux, organiques + payés, avant de généraliser.",
    expectedImpact: `Jusqu’à ${money.format(overlap.reduce((sum, row) => sum + (paid.get(norm(row.query).trim())?.cost ?? 0), 0))} réallouables si les clics organiques compensent.`,
    items: overlap.slice(0, MAX_ITEMS).map((row) => `« ${row.query} » (organique position ${row.position!.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}, Ads ${money.format(paid.get(norm(row.query).trim())!.cost)})`) });
  return findings;
}

/**
 * Graines du Planificateur de mots-clés : services prioritaires déclarés, termes qui convertissent, puis requêtes
 * Search Console les plus vues liées à ces services ; au plus 20, jamais une exclusion.
 */
export function keywordSeeds(signals: AdsExpertSignals | null | undefined, business: AdsBusinessContext | null): string[] {
  const exclusions = exclusionWords(business?.exclusions);
  const services = (business?.priorityServices ?? "").split(/[\n,;/|]+|\s+-\s+/).map((item) => item.trim()).filter((item) => item.length >= 3 && item.length <= 60);
  const converting = (signals?.searchTerms ?? []).filter((term) => term.conversions > 0).sort((a, b) => b.conversions - a.conversions).map((term) => term.term);
  const vocabulary = new Set([...services.flatMap(tokens), ...(signals?.keywords ?? []).flatMap((item) => tokens(item.text))]);
  const organic = (signals?.organicQueries ?? []).filter((row) => tokens(row.query).some((word) => vocabulary.has(word))).sort((a, b) => b.impressions - a.impressions).map((row) => row.query);
  const seen = new Set<string>(), seeds: string[] = [];
  for (const seed of [...services, ...converting.slice(0, 8), ...organic.slice(0, 8)]) {
    const value = norm(seed).replace(/[[\]"+]/g, " ").replace(/\s+/g, " ").trim();
    if (value.length < 3 || value.length > 80 || seen.has(value) || matchesExclusion(value, exclusions)) continue;
    seen.add(value); seeds.push(value);
    if (seeds.length >= 20) break;
  }
  return seeds;
}

// --- Nouvelles opportunités de mots-clés : Planificateur × recommandations Google × Search Console ----------
/** Intentions sans valeur commerciale pour une entreprise locale (emploi, formation, gratuit, bricolage, documents). */
const NOISE = /\b(gratuit\w*|emploi|emplois|recrutement|salaire|formation|stage|ecole|diplome|cap|pdf|youtube|wikipedia|definition|soi meme|tuto\w*|occasion|leboncoin|leroy|castorama|brico\w*)\b/;
const MIN_VOLUME = 20;
/**
 * Mots-clés absents des annonces, liés aux services du client, jamais exclus, classés par demande réelle :
 * volume mensuel du Planificateur de mots-clés (Google), confirmés par une recommandation Google du compte et/ou
 * des impressions Search Console. Les volumes et enchères sont ceux renvoyés par Google ; rien n'est estimé ici.
 * Une proposition n'est jamais une écriture : l'ajout reste soumis à validation.
 */
export function keywordOpportunities(signals: AdsExpertSignals | null | undefined, business: AdsBusinessContext | null, money: Intl.NumberFormat): ExpertFinding[] {
  const ideas = signals?.keywordIdeas ?? [], recommended = signals?.recommendedKeywords ?? [];
  if (!ideas.length && !recommended.length) return [];
  const exclusions = exclusionWords(business?.exclusions);
  const bought = [...(signals?.keywords ?? []).map((item) => item.text), ...(signals?.searchTerms ?? []).filter((item) => item.status === "ADDED").map((item) => item.term)];
  const key = (value: string) => norm(value).replace(/[[\]"+]/g, " ").replace(/\s+/g, " ").trim();
  const covered = new Set([...bought, ...(signals?.searchTerms ?? []).map((item) => item.term)].map(key));
  const vocabulary = new Set([...tokens(business?.priorityServices ?? ""), ...bought.flatMap(tokens)]);
  if (!vocabulary.size) return [];
  const organic = new Map((signals?.organicQueries ?? []).map((row) => [key(row.query), row]));
  const googleSays = new Set(recommended.map((item) => key(item.text)));
  const keep = (text: string) => !covered.has(key(text)) && !NOISE.test(key(text)) && tokens(text).some((word) => vocabulary.has(word)) && !matchesExclusion(text, exclusions);
  type Candidate = { text: string; volume: number | null; low: number | null; high: number | null; competition: string | null; google: boolean; impressions: number | null; score: number };
  const candidates = new Map<string, Candidate>();
  for (const idea of ideas) {
    if ((idea.avgMonthlySearches ?? 0) < MIN_VOLUME || !keep(idea.text)) continue;
    candidates.set(key(idea.text), { text: idea.text, volume: idea.avgMonthlySearches, low: idea.lowBid, high: idea.highBid, competition: idea.competition, google: false, impressions: null, score: 0 });
  }
  for (const item of recommended) {
    if (!keep(item.text)) continue;
    const found = candidates.get(key(item.text));
    if (found) found.google = true; else candidates.set(key(item.text), { text: item.text, volume: null, low: null, high: null, competition: null, google: true, impressions: null, score: 0 });
  }
  for (const [k, candidate] of candidates) {
    candidate.google ||= googleSays.has(k);
    candidate.impressions = organic.get(k)?.impressions ?? null;
    // Demande mesurée d'abord (log du volume), puis confirmation par une autre source, puis concurrence faible.
    candidate.score = Math.log10(1 + (candidate.volume ?? 0)) * 10 + (candidate.google ? 12 : 0) + (candidate.impressions ? 8 : 0) + (candidate.competition === "LOW" ? 3 : candidate.competition === "HIGH" ? -2 : 0);
  }
  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score || a.text.localeCompare(b.text));
  if (!ranked.length) return [];
  const level: Record<string, string> = { LOW: "faible", MEDIUM: "moyenne", HIGH: "forte" };
  const volume = ranked.reduce((sum, item) => sum + (item.volume ?? 0), 0);
  const confirmed = ranked.filter((item) => (item.volume !== null ? 1 : 0) + (item.google ? 1 : 0) + (item.impressions ? 1 : 0) >= 2).length;
  const sources = [ideas.length ? "Planificateur de mots-clés" : null, recommended.length ? "recommandations Google du compte" : null, signals?.organicQueries?.length ? "Search Console" : null].filter(Boolean).join(", ");
  return [{ id: "expert:keyword_ideas", kind: "keyword_ideas", campaignId: null, priority: volume >= 500 || confirmed >= 3 ? "high" : "medium",
    title: "Nouveaux mots-clés à fort potentiel, absents des annonces",
    detail: `${ranked.length} mot(s)-clé(s) liés aux services du client et non couverts${volume ? `, ${volume.toLocaleString("fr-FR")} recherches par mois selon Google` : ""}${confirmed ? ` ; ${confirmed} confirmé(s) par au moins deux sources` : ""}. Sources : ${sources}.`,
    action: "Ajouter les plus pertinents en « expression » ou « exact » dans le groupe d’annonces du service correspondant, avec une annonce et une page qui y répondent ; enchère de départ dans la fourchette haut de page indiquée.",
    expectedImpact: "Demande nouvelle et chiffrée captée sans élargir le ciblage à l’aveugle ; volumes et coûts estimés par Google, à valider sur deux à quatre semaines.",
    items: ranked.slice(0, MAX_ITEMS).map((item) => [
      `« ${item.text} »`,
      item.volume !== null ? `${item.volume.toLocaleString("fr-FR")} recherches/mois` : null,
      item.low !== null && item.high !== null ? `haut de page ${money.format(item.low)} à ${money.format(item.high)}` : item.high !== null ? `haut de page jusqu’à ${money.format(item.high)}` : null,
      item.competition ? `concurrence ${level[item.competition] ?? item.competition}` : null,
      item.google ? "recommandé par Google" : null,
      item.impressions ? `${item.impressions.toLocaleString("fr-FR")} impressions Search Console` : null,
    ].filter(Boolean).join(" · ")) }];
}

const deviceNames: Record<string, string> = { MOBILE: "Mobile", DESKTOP: "Ordinateur", TABLET: "Tablette", CONNECTED_TV: "TV connectée", OTHER: "Autre" };
export const deviceLabel = (device: string) => deviceNames[device] ?? device;

/** Lecture des signaux experts disponibles / indisponibles (affichée dans les limites de l'analyse). */
export function expertCoverage(signals: AdsExpertSignals | null | undefined) {
  const labels: Record<keyof AdsExpertSignals, string> = { searchTerms: "termes de recherche", impressionShare: "part d’impressions", keywords: "Quality Score des mots-clés", devices: "répartition par appareil", organicQueries: "requêtes Search Console", keywordIdeas: "Planificateur de mots-clés", recommendedKeywords: "recommandations Google" };
  const keys = Object.keys(labels) as (keyof AdsExpertSignals)[];
  const present = (key: keyof AdsExpertSignals) => Boolean(signals) && signals![key] !== null && signals![key] !== undefined;
  return { read: keys.filter(present).map((key) => labels[key]), missing: keys.filter((key) => !present(key)).map((key) => labels[key]) };
}
