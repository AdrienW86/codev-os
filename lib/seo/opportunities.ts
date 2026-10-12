// Détection des opportunités de mots-clés (pure, testable) : positions à améliorer, CTR sous-performant,
// requêtes émergentes, pages en baisse, cannibalisation, sujets et zones absents du site.
//
// Règles de fiabilité :
//  - les métriques (clics, impressions, CTR, position) viennent uniquement de Search Console ;
//  - aucun volume de recherche n'est inventé : une opportunité « contexte métier » n'a AUCUNE métrique ;
//  - le potentiel de clics est une ESTIMATION (courbe de CTR de référence), affichée comme telle ;
//  - la priorité est expliquée par des facteurs lisibles, jamais par un score présenté comme une certitude.
import type { QueryRow } from "@/lib/providers/search-console";

export type OpportunityCategory =
  | "striking_distance" | "page_two" | "declining_page" | "low_ctr" | "emerging_query" | "content_gap" | "local_gap" | "cannibalization";
export type SearchIntent = "transactional" | "local" | "commercial" | "informational" | "navigational" | "unknown";
export type Level = "high" | "medium" | "low";
export type ActionKind = "optimize_page" | "improve_snippet" | "internal_linking" | "add_content" | "create_page" | "consolidate" | "investigate";
export type DataSource = "search_console" | "business_context";
export type TargetStatus = "existing" | "missing" | "multiple";
export type Metrics = { clicks: number; impressions: number; ctr: number | null; position: number | null };
export type Period = { start: string; end: string };

export type BusinessContext = {
  /** Nom du client, domaine : requêtes de marque (intention navigationnelle). */
  brandTerms: string[];
  /** Prestations réelles (services suivis, activité, services prioritaires renseignés). */
  services: string[];
  /** Zones d'intervention renseignées par l'agence (jamais déduites). */
  areas: string[];
  /** Prestations ou demandes à exclure. */
  exclusions: string[];
};

/** Page du site lue dans le code (GitHub) : sert à l'analyse des contenus et des sujets manquants. */
export type SitePage = { url: string; path?: string | null; title: string | null; h1: string | null; description: string | null };

export type DetectedOpportunity = {
  fingerprint: string;
  category: OpportunityCategory;
  keyword: string;
  /** Variantes regroupées (même page cible, mêmes mots principaux). */
  keywords: string[];
  targetUrl: string | null;
  targetStatus: TargetStatus;
  intent: SearchIntent;
  intentBasis: string;
  priority: Level;
  confidence: Level;
  source: DataSource;
  /** true : métriques mesurées par Google ; false : hypothèse fondée sur le contexte métier. */
  verified: boolean;
  metrics: Metrics | null;
  previous: Metrics | null;
  /** Estimation de clics supplémentaires (courbe de référence), jamais une donnée Google. */
  potentialClicks: number | null;
  factors: string[];
  rationale: string;
  recommendedAction: string;
  actionKind: ActionKind;
  evidence: Record<string, unknown>;
};

export type DetectionInput = {
  period: Period;
  previousPeriod: Period;
  queries: QueryRow[];
  previousQueries: QueryRow[];
  queryPages: QueryRow[];
  previousQueryPages?: QueryRow[];
  pages: QueryRow[];
  previousPages: QueryRow[];
  context: BusinessContext;
  sitePages?: SitePage[];
  depth: "daily" | "weekly";
  limit?: number;
};

export const categoryLabels: Record<OpportunityCategory, string> = {
  striking_distance: "Position 4 à 10",
  page_two: "Position 11 à 20",
  declining_page: "Page en baisse",
  low_ctr: "CTR sous-performant",
  emerging_query: "Requête émergente",
  content_gap: "Sujet absent",
  local_gap: "Opportunité locale",
  cannibalization: "Cannibalisation",
};
export const intentLabels: Record<SearchIntent, string> = {
  transactional: "Transactionnelle", local: "Locale", commercial: "Commerciale", informational: "Informationnelle", navigational: "Marque", unknown: "Indéterminée",
};
export const actionKindLabels: Record<ActionKind, string> = {
  optimize_page: "Optimiser la page existante", improve_snippet: "Retravailler title et meta description", internal_linking: "Améliorer le maillage interne",
  add_content: "Ajouter un contenu pertinent", create_page: "Créer une page dédiée", consolidate: "Consolider les pages concurrentes", investigate: "Diagnostiquer avant d’agir",
};
export const levelLabels: Record<Level, string> = { high: "Haute", medium: "Moyenne", low: "Faible" };

// ——— Texte ———

const STOPWORDS = new Set(["de", "des", "du", "la", "le", "les", "un", "une", "et", "en", "a", "au", "aux", "pour", "par", "sur", "dans", "avec", "sans", "d", "l", "the", "of", "for", "and", "mon", "ma", "mes", "son", "sa", "ses", "chez", "moi", "est", "qui", "que"]);

export function normalizeText(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’']/g, " ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/** Mots significatifs ; racine de 5 lettres pour rapprocher singulier/pluriel et genre. */
export function significantTokens(value: string) {
  return [...new Set(normalizeText(value).split(" ").filter((word) => word.length >= 3 && !STOPWORDS.has(word)).map((word) => word.slice(0, 5)))];
}

function containsAll(haystack: string, tokens: string[]) {
  if (!tokens.length) return false;
  const words = normalizeText(haystack).split(" ").map((word) => word.slice(0, 5));
  return tokens.every((token) => words.includes(token));
}

const hasPhrase = (text: string, phrase: string) => ` ${text} `.includes(` ${phrase} `);

// ——— Intention ———

const TRANSACTIONAL = ["devis", "prix", "tarif", "tarifs", "cout", "combien", "acheter", "achat", "commander", "reserver", "reservation", "location", "louer", "pas cher", "promo", "urgence", "urgent", "depannage", "rendez vous", "rdv"];
const COMMERCIAL = ["meilleur", "meilleure", "meilleurs", "avis", "comparatif", "comparaison", "vs", "top", "entreprise", "societe", "artisan", "professionnel", "specialiste", "agence", "cabinet", "prestataire"];
const LOCAL = ["pres de chez moi", "a proximite", "autour de moi", "near me", "proche de moi", "dans ma ville"];
const INFORMATIONAL = ["comment", "pourquoi", "quand", "quoi", "quel", "quelle", "quels", "quelles", "qu est ce", "definition", "guide", "tuto", "tutoriel", "idee", "idees", "exemple", "difference", "c est quoi"];

/** Intention ESTIMÉE par règles lisibles (mots-clés, marque, zones, prestations) : jamais présentée comme certaine. */
export function classifyIntent(query: string, context: BusinessContext): { intent: SearchIntent; basis: string; serviceMatch: string | null; excluded: boolean } {
  const text = normalizeText(query);
  const serviceMatch = context.services.find((service) => containsAll(text, significantTokens(service).slice(0, 2))) ?? null;
  const excluded = context.exclusions.some((exclusion) => containsAll(text, significantTokens(exclusion).slice(0, 2)));
  const brand = context.brandTerms.map(normalizeText).find((term) => term.length >= 3 && hasPhrase(text, term));
  if (brand) return { intent: "navigational", basis: `contient la marque « ${brand} »`, serviceMatch, excluded };
  const area = context.areas.map(normalizeText).find((term) => term.length >= 3 && hasPhrase(text, term));
  const localPhrase = LOCAL.find((phrase) => hasPhrase(text, phrase));
  if (area || localPhrase) return { intent: "local", basis: area ? `mentionne la zone « ${area} »` : `formulation locale « ${localPhrase} »`, serviceMatch, excluded };
  const transactional = TRANSACTIONAL.find((word) => hasPhrase(text, word));
  if (transactional) return { intent: "transactional", basis: `terme transactionnel « ${transactional} »`, serviceMatch, excluded };
  const commercial = COMMERCIAL.find((word) => hasPhrase(text, word));
  if (commercial) return { intent: "commercial", basis: `terme commercial « ${commercial} »`, serviceMatch, excluded };
  if (serviceMatch) return { intent: "commercial", basis: `correspond à la prestation « ${serviceMatch} »`, serviceMatch, excluded };
  const informational = INFORMATIONAL.find((word) => hasPhrase(text, word));
  if (informational) return { intent: "informational", basis: `formulation de question « ${informational} »`, serviceMatch, excluded };
  return { intent: "unknown", basis: "aucun indice d’intention reconnu", serviceMatch, excluded };
}

/** Pertinence commerciale (0 à 3) : demande exclue = 0. */
export function commercialRelevance(intent: SearchIntent, serviceMatch: string | null, excluded: boolean) {
  if (excluded) return 0;
  const base = intent === "transactional" || intent === "local" ? 3 : intent === "commercial" ? 2 : 1;
  return Math.min(3, base + (serviceMatch && base < 3 ? 1 : 0));
}

// ——— CTR de référence ———

// Courbe de CTR organique moyenne par position (ordre de grandeur publié par les études de marché) :
// sert UNIQUEMENT à comparer un CTR à sa position et à estimer un potentiel, jamais comme donnée mesurée.
const CTR_CURVE = [0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];

export function expectedCtr(position: number, intent: SearchIntent = "unknown") {
  const rounded = Math.max(1, Math.round(position));
  const base = rounded <= 10 ? CTR_CURVE[rounded - 1] : rounded <= 20 ? 0.01 : 0.003;
  // Marque : CTR naturellement plus élevé ; question informationnelle : souvent captée par les extraits enrichis.
  return intent === "navigational" ? base * 1.5 : intent === "informational" ? base * 0.8 : base;
}

/** Clics supplémentaires estimés si la requête atteignait la position cible (≥ 0, arrondi). */
export function estimatePotential(metrics: Metrics, targetPosition: number, intent: SearchIntent) {
  if (!metrics.impressions || metrics.position === null || metrics.position <= targetPosition) return 0;
  const gain = metrics.impressions * expectedCtr(targetPosition, intent) - metrics.clicks;
  return Math.max(0, Math.round(gain));
}

// ——— Lignes Search Console ———

const metricsOf = (row: QueryRow): Metrics => ({
  clicks: row.clicks, impressions: row.impressions,
  ctr: row.impressions > 0 ? row.clicks / row.impressions : null,
  position: row.impressions > 0 && row.position >= 1 ? row.position : null,
});

function byKey(rows: QueryRow[]) {
  const map = new Map<string, QueryRow>();
  for (const row of rows) if (typeof row.keys[0] === "string" && row.keys[0]) map.set(row.keys[0], row);
  return map;
}

type PageShare = { url: string; clicks: number; impressions: number; position: number | null; share: number };

function pagesByQuery(rows: QueryRow[]) {
  const map = new Map<string, PageShare[]>();
  for (const row of rows) {
    const [query, page] = row.keys;
    if (!query || !page) continue;
    const list = map.get(query) ?? [];
    list.push({ url: page, clicks: row.clicks, impressions: row.impressions, position: row.impressions > 0 && row.position >= 1 ? row.position : null, share: 0 });
    map.set(query, list);
  }
  for (const list of map.values()) {
    const total = list.reduce((sum, item) => sum + item.impressions, 0);
    for (const item of list) item.share = total ? item.impressions / total : 0;
    list.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
  }
  return map;
}

export function pathOf(url: string) {
  try { return new URL(url).pathname || "/"; } catch { return url; }
}

const pct = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(1)} %`;
const pos = (value: number | null) => value === null ? "—" : value.toFixed(1);

// ——— Priorité et confiance ———

type Draft = Omit<DetectedOpportunity, "priority" | "confidence" | "factors"> & { relevance: number; factors: string[]; trend: "up" | "down" | "flat" | "severe_down" };

function prioritize(draft: Draft): DetectedOpportunity {
  const factors = [...draft.factors];
  let points = draft.relevance * 2;
  if (draft.relevance >= 3) factors.unshift("Forte pertinence commerciale (intention estimée)");
  else if (draft.relevance === 0) factors.unshift("Demande exclue par le contexte client");
  const impressions = draft.metrics?.impressions ?? 0;
  if (impressions >= 1000) points += 3; else if (impressions >= 300) points += 2; else if (impressions >= 100) points += 1;
  if ((draft.potentialClicks ?? 0) >= 30) points += 2; else if ((draft.potentialClicks ?? 0) >= 10) points += 1;
  if (draft.trend === "severe_down") points += 2; else if (draft.trend === "down" || draft.trend === "up") points += 1;
  // Difficulté d'intervention : un title se corrige vite, une nouvelle page demande un vrai chantier.
  if (draft.actionKind === "improve_snippet" || draft.actionKind === "internal_linking") { points += 1; factors.push("Intervention légère"); }
  if (draft.actionKind === "create_page") { points -= 2; factors.push("Intervention lourde (nouvelle page)"); }
  if (draft.actionKind === "consolidate") points -= 1;
  const confidence: Level = !draft.verified ? "low"
    : draft.category === "cannibalization" ? (impressions >= 200 ? "medium" : "low")
      : impressions >= 200 ? "high" : impressions >= 50 ? "medium" : "low";
  if (confidence === "low") points -= 1;
  const priority: Level = draft.relevance === 0 ? "low" : points >= 9 ? "high" : points >= 5 ? "medium" : "low";
  const { relevance: _relevance, trend: _trend, ...rest } = draft;
  void _relevance; void _trend;
  return { ...rest, priority, confidence, factors: [...new Set(factors)].slice(0, 8) };
}

const LEVEL_ORDER: Record<Level, number> = { high: 0, medium: 1, low: 2 };

export function compareOpportunities(a: DetectedOpportunity, b: DetectedOpportunity) {
  return LEVEL_ORDER[a.priority] - LEVEL_ORDER[b.priority] || LEVEL_ORDER[a.confidence] - LEVEL_ORDER[b.confidence]
    || (b.potentialClicks ?? 0) - (a.potentialClicks ?? 0) || (b.metrics?.impressions ?? 0) - (a.metrics?.impressions ?? 0) || a.keyword.localeCompare(b.keyword);
}

/** Clé de déduplication stable d'une semaine à l'autre (la catégorie d'une même requête peut évoluer). */
export function opportunityFingerprint(category: OpportunityCategory, keyword: string, targetUrl?: string | null) {
  const family = category === "cannibalization" ? "cannibalization" : category === "declining_page" ? "page" : category === "content_gap" || category === "local_gap" ? "gap" : "query";
  const key = family === "page" ? pathOf(targetUrl ?? keyword).toLowerCase() : normalizeText(keyword);
  return `${family}:${key}`.slice(0, 500);
}

// ——— Détection ———

export function detectOpportunities(input: DetectionInput): DetectedOpportunity[] {
  const { context } = input;
  const previousByQuery = byKey(input.previousQueries);
  const pagesNow = pagesByQuery(input.queryPages);
  const drafts: Draft[] = [];
  const periodNote = `${input.period.start} → ${input.period.end}`;

  for (const row of input.queries) {
    const keyword = row.keys[0];
    if (!keyword || row.impressions <= 0) continue;
    const metrics = metricsOf(row);
    const priorRow = previousByQuery.get(keyword);
    const previous = priorRow ? metricsOf(priorRow) : null;
    const { intent, basis, serviceMatch, excluded } = classifyIntent(keyword, context);
    const relevance = commercialRelevance(intent, serviceMatch, excluded);
    const pages = pagesNow.get(keyword) ?? [];
    const target = pages[0]?.url ?? null;
    const position = metrics.position;
    const common = { keyword, keywords: [keyword], intent, intentBasis: basis, source: "search_console" as const, verified: true, metrics, previous };
    const growth = previous && previous.impressions > 0 ? metrics.impressions / previous.impressions : null;
    const isNew = !previous || previous.impressions < 10;
    const emerging = intent !== "navigational" && ((isNew && metrics.impressions >= 20) || (growth !== null && growth >= 2 && metrics.impressions >= 50) || (previous !== null && previous.clicks >= 5 && metrics.clicks >= previous.clicks * 2));
    const emergingFactor = emerging ? (isNew ? "Nouvelle requête sur la période" : `Impressions ${previous ? `${previous.impressions} → ${metrics.impressions}` : "en hausse"}`) : null;

    // E. Cannibalisation : plusieurs pages se partagent réellement la requête (hors marque).
    const competing = pages.filter((page) => page.impressions >= 20 && page.share >= 0.15 && page.position !== null && page.position <= 30);
    if (competing.length >= 2 && intent !== "navigational" && metrics.impressions >= 50) {
      const list = competing.slice(0, 4).map((page) => `${pathOf(page.url)} (pos. ${pos(page.position)}, ${Math.round(page.share * 100)} % des impressions)`).join(" ; ");
      drafts.push({
        ...common, fingerprint: opportunityFingerprint("cannibalization", keyword), category: "cannibalization", targetUrl: competing[0].url, targetStatus: "multiple",
        potentialClicks: null, relevance, trend: "flat", actionKind: "consolidate",
        factors: [`${competing.length} pages concurrentes`, `${metrics.impressions} impressions`],
        rationale: `Sur ${periodNote}, « ${keyword} » fait apparaître ${competing.length} pages du site : ${list}. Google hésite entre ces pages, ce qui peut freiner chacune d’elles.`,
        recommendedAction: "Comparer l’intention réelle de chaque page avant toute consolidation. Si elles répondent à la même intention : choisir une page principale (fusion, redirection ou canonique) et rediriger le maillage vers elle. Si les intentions sont distinctes : différencier titles, H1 et ancres internes.",
        evidence: { competingPages: competing.slice(0, 4) },
      });
      continue;
    }

    // B. CTR sous-performant, comparé au CTR attendu pour cette position et cette intention.
    if (position !== null && position <= 10 && metrics.impressions >= 150 && metrics.ctr !== null && metrics.ctr < expectedCtr(position, intent) * 0.5) {
      const expected = expectedCtr(position, intent);
      drafts.push({
        ...common, fingerprint: opportunityFingerprint("low_ctr", keyword), category: "low_ctr", targetUrl: target, targetStatus: target ? "existing" : "missing",
        potentialClicks: Math.max(0, Math.round(metrics.impressions * expected - metrics.clicks)), relevance, trend: "flat", actionKind: "improve_snippet",
        factors: [`CTR ${pct(metrics.ctr)} pour une position ${pos(position)} (référence ≈ ${pct(expected)})`, `${metrics.impressions} impressions`, ...(emergingFactor ? [emergingFactor] : [])],
        rationale: `« ${keyword} » est en position ${pos(position)} avec ${metrics.impressions} impressions mais un CTR de ${pct(metrics.ctr)}, moins de la moitié du CTR habituellement observé à cette position (≈ ${pct(expected)}, repère indicatif). Le résultat affiché attire peu de clics.`,
        recommendedAction: `Revoir le title et la meta description${target ? ` de ${pathOf(target)}` : ""} pour refléter précisément l’intention (${intentLabels[intent].toLowerCase()}) et la promesse réelle de la page, sans promettre ce que la page ne contient pas.`,
        evidence: { expectedCtr: expected, pages: pages.slice(0, 3) },
      });
      continue;
    }

    // A. Positions 4 à 10 : proche du haut de page.
    if (position !== null && position >= 4 && position <= 10 && metrics.impressions >= 30 && relevance >= 1) {
      const potential = estimatePotential(metrics, 3, intent);
      drafts.push({
        ...common, fingerprint: opportunityFingerprint("striking_distance", keyword), category: "striking_distance", targetUrl: target, targetStatus: target ? "existing" : "missing",
        potentialClicks: potential, relevance, trend: emerging ? "up" : "flat", actionKind: target ? "optimize_page" : "add_content",
        factors: [`Position ${pos(position)}`, `${metrics.impressions} impressions`, ...(potential ? [`≈ ${potential} clics supplémentaires estimés en position 3`] : []), ...(emergingFactor ? [emergingFactor] : [])],
        rationale: `« ${keyword} » est en position moyenne ${pos(position)} (${metrics.impressions} impressions, ${metrics.clicks} clics, ${periodNote}). Gagner quelques places la ferait entrer dans les trois premiers résultats, où se concentre l’essentiel des clics.`,
        recommendedAction: target
          ? `Renforcer ${pathOf(target)} sur « ${keyword} » : title et H1 alignés sur l’intention, section qui répond précisément à la demande, liens internes depuis les pages proches. Ne pas créer de nouvelle page tant que celle-ci répond à l’intention.`
          : `Identifier la page du site qui répond le mieux à « ${keyword} » et la renforcer ; aucune page n’est associée à cette requête dans Search Console.`,
        evidence: { pages: pages.slice(0, 3) },
      });
      continue;
    }

    // A. Positions 11 à 20 : uniquement avec un intérêt commercial ou une dynamique favorable.
    if (position !== null && position > 10 && position <= 20 && metrics.impressions >= 60 && (relevance >= 2 || emerging)) {
      const potential = estimatePotential(metrics, 5, intent);
      drafts.push({
        ...common, fingerprint: opportunityFingerprint("page_two", keyword), category: "page_two", targetUrl: target, targetStatus: target ? "existing" : "missing",
        potentialClicks: potential, relevance, trend: emerging ? "up" : "flat", actionKind: target ? "add_content" : relevance >= 3 ? "create_page" : "add_content",
        factors: [`Position ${pos(position)} (deuxième page)`, `${metrics.impressions} impressions`, ...(potential ? [`≈ ${potential} clics estimés en position 5`] : []), ...(emergingFactor ? [emergingFactor] : [])],
        rationale: `« ${keyword} » apparaît en deuxième page (position ${pos(position)}, ${metrics.impressions} impressions). La demande existe et le site est déjà jugé pertinent, mais la page ne répond pas encore assez complètement.`,
        recommendedAction: target
          ? `Enrichir ${pathOf(target)} avec un contenu qui répond directement à « ${keyword} » (section dédiée, FAQ, preuves) et ajouter des liens internes vers cette page.`
          : `Vérifier qu’aucune page existante ne couvre « ${keyword} » ; si l’intention est distincte et commerciale, envisager une page dédiée unique, jamais une série de pages artificielles.`,
        evidence: { pages: pages.slice(0, 3) },
      });
      continue;
    }

    // C. Requête émergente (nouvelle ou en forte croissance), hors marque.
    if (emerging && relevance >= 1) {
      drafts.push({
        ...common, fingerprint: opportunityFingerprint("emerging_query", keyword), category: "emerging_query", targetUrl: target, targetStatus: target ? "existing" : "missing",
        potentialClicks: position !== null && position > 3 ? estimatePotential(metrics, 3, intent) : null, relevance, trend: "up", actionKind: target ? "optimize_page" : "add_content",
        factors: [emergingFactor ?? "Croissance récente", `${metrics.impressions} impressions`, `Position ${pos(position)}`],
        rationale: isNew
          ? `« ${keyword} » est apparue sur la période (${metrics.impressions} impressions, position ${pos(position)}) alors qu’elle était absente ou marginale auparavant.`
          : `« ${keyword} » progresse : ${previous?.impressions ?? 0} → ${metrics.impressions} impressions et ${previous?.clicks ?? 0} → ${metrics.clicks} clics.`,
        recommendedAction: target
          ? `Vérifier que ${pathOf(target)} répond bien à cette demande nouvelle ; compléter la page si l’intention n’est que partiellement couverte, puis suivre l’évolution avant d’investir davantage.`
          : `Suivre cette requête et identifier la page qui devrait y répondre ; ne créer un contenu que si la demande se confirme sur plusieurs semaines.`,
        evidence: { pages: pages.slice(0, 3) },
      });
    }
  }

  // A. Pages dont les positions ou les clics se dégradent significativement.
  const previousPages = byKey(input.previousPages);
  for (const row of input.pages) {
    const url = row.keys[0];
    const priorRow = url ? previousPages.get(url) : undefined;
    if (!url || !priorRow) continue;
    const metrics = metricsOf(row), previous = metricsOf(priorRow);
    const clickDrop = previous.clicks >= 20 && metrics.clicks <= previous.clicks * 0.7;
    const positionDrop = metrics.impressions >= 100 && previous.position !== null && metrics.position !== null && metrics.position - previous.position >= 3;
    if (!clickDrop && !positionDrop) continue;
    const severe = (previous.clicks >= 20 && metrics.clicks <= previous.clicks * 0.5) || (positionDrop && metrics.position! - previous.position! >= 6);
    const { intent, basis } = classifyIntent(pathOf(url).replace(/[/-]/g, " "), context);
    drafts.push({
      fingerprint: opportunityFingerprint("declining_page", url, url), category: "declining_page", keyword: pathOf(url), keywords: [pathOf(url)], targetUrl: url, targetStatus: "existing",
      intent, intentBasis: `estimée depuis l’adresse de la page (${basis})`, source: "search_console", verified: true, metrics, previous, potentialClicks: null,
      relevance: 2, trend: severe ? "severe_down" : "down", actionKind: "investigate",
      factors: [clickDrop ? `Clics ${previous.clicks} → ${metrics.clicks}` : `Position ${pos(previous.position)} → ${pos(metrics.position)}`, `${metrics.impressions} impressions`],
      rationale: `${pathOf(url)} recule : clics ${previous.clicks} → ${metrics.clicks}, impressions ${previous.impressions} → ${metrics.impressions}, position ${pos(previous.position)} → ${pos(metrics.position)} (${input.previousPeriod.start} → ${input.previousPeriod.end} comparé à ${periodNote}).`,
      recommendedAction: "Diagnostiquer avant toute modification : indexation, disponibilité, redirections et canonique, changements récents du code, saisonnalité et requêtes perdues. Corriger uniquement la cause confirmée.",
      evidence: {},
    });
  }
  // Pages qui ne reçoivent plus aucun clic alors qu'elles en avaient.
  const pagesNowKeys = new Set(input.pages.map((row) => row.keys[0]));
  for (const priorRow of input.previousPages) {
    const url = priorRow.keys[0];
    if (!url || priorRow.clicks < 20 || pagesNowKeys.has(url)) continue;
    const previous = metricsOf(priorRow);
    drafts.push({
      fingerprint: opportunityFingerprint("declining_page", url, url), category: "declining_page", keyword: pathOf(url), keywords: [pathOf(url)], targetUrl: url, targetStatus: "existing",
      intent: "unknown", intentBasis: "page absente de la période actuelle", source: "search_console", verified: true,
      metrics: { clicks: 0, impressions: 0, ctr: null, position: null }, previous, potentialClicks: null, relevance: 2, trend: "severe_down", actionKind: "investigate",
      factors: [`Clics ${previous.clicks} → 0`, "Page absente des résultats sur la période"],
      rationale: `${pathOf(url)} ne reçoit plus aucune impression sur ${periodNote} (${previous.clicks} clics auparavant).`,
      recommendedAction: "Vérifier en priorité l’indexation, le code HTTP, les redirections et la balise canonique avant toute modification éditoriale.",
      evidence: {},
    });
  }

  // D. Sujets absents (analyse hebdomadaire) : prestations réelles et zones renseignées non couvertes.
  if (input.depth === "weekly") drafts.push(...contentGaps(input));

  const grouped = groupVariants(drafts);
  return grouped.map(prioritize).sort(compareOpportunities).slice(0, input.limit ?? 30);
}

/** Regroupe les requêtes d'une même catégorie, même page cible et mêmes mots principaux. */
function groupVariants(drafts: Draft[]): Draft[] {
  const groupable = new Set<OpportunityCategory>(["striking_distance", "page_two", "low_ctr", "emerging_query"]);
  const result: Draft[] = [];
  const sorted = [...drafts].sort((a, b) => (b.metrics?.impressions ?? 0) - (a.metrics?.impressions ?? 0));
  for (const draft of sorted) {
    if (!groupable.has(draft.category) || !draft.targetUrl) { result.push(draft); continue; }
    const tokens = significantTokens(draft.keyword);
    const leader = result.find((item) => item.category === draft.category && item.targetUrl === draft.targetUrl && overlap(tokens, significantTokens(item.keyword)) >= 0.6);
    if (!leader) { result.push(draft); continue; }
    if (leader.keywords.length < 12) leader.keywords.push(draft.keyword);
    const group = (leader.evidence.variants as { keyword: string; impressions: number; clicks: number; position: number | null }[] | undefined) ?? [];
    group.push({ keyword: draft.keyword, impressions: draft.metrics?.impressions ?? 0, clicks: draft.metrics?.clicks ?? 0, position: draft.metrics?.position ?? null });
    leader.evidence = { ...leader.evidence, variants: group.slice(0, 12) };
    leader.potentialClicks = leader.potentialClicks === null && draft.potentialClicks === null ? null : (leader.potentialClicks ?? 0) + (draft.potentialClicks ?? 0);
  }
  for (const item of result) if (item.keywords.length > 1) item.factors.push(`${item.keywords.length - 1} variante(s) regroupée(s)`);
  return result;
}

function overlap(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;
  const shared = a.filter((token) => b.includes(token)).length;
  return shared / Math.min(a.length, b.length);
}

function contentGaps(input: DetectionInput): Draft[] {
  const { context } = input;
  const queryTexts = input.queries.map((row) => row.keys[0] ?? "").filter(Boolean);
  const pages = input.sitePages ?? [];
  const drafts: Draft[] = [];
  const services = [...new Set(context.services.map((value) => value.trim()).filter((value) => significantTokens(value).length > 0))].slice(0, 8);
  for (const service of services) {
    const tokens = significantTokens(service).slice(0, 2);
    if (context.exclusions.some((exclusion) => containsAll(service, significantTokens(exclusion).slice(0, 2)))) continue;
    const coveringQueries = queryTexts.filter((query) => containsAll(query, tokens));
    const coveringPage = pages.find((page) => containsAll([page.title, page.h1, page.path ?? pathOf(page.url).replace(/[/-]/g, " ")].filter(Boolean).join(" "), tokens));
    if (!coveringQueries.length) {
      drafts.push({
        fingerprint: opportunityFingerprint("content_gap", service), category: "content_gap", keyword: service, keywords: [service],
        targetUrl: coveringPage?.url ?? null, targetStatus: coveringPage ? "existing" : "missing", intent: "commercial", intentBasis: "prestation renseignée pour ce client",
        source: "business_context", verified: false, metrics: null, previous: null, potentialClicks: null, relevance: 2, trend: "flat",
        actionKind: coveringPage ? "optimize_page" : "add_content",
        factors: ["Hypothèse issue du contexte client (aucune donnée de volume)", coveringPage ? "Page existante sans visibilité" : "Aucune page dédiée détectée dans le code"],
        rationale: coveringPage
          ? `La prestation « ${service} » a une page (${pathOf(coveringPage.url)}) mais aucune requête correspondante n’apparaît dans Search Console sur ${input.period.start} → ${input.period.end}.`
          : `La prestation « ${service} » n’apparaît dans aucune requête Search Console et aucune page lue dans le code ne la traite. Ceci est une hypothèse à vérifier : aucun volume de recherche n’est connu.`,
        recommendedAction: coveringPage
          ? `Vérifier l’indexation de ${pathOf(coveringPage.url)}, puis aligner title, H1 et contenu sur la façon dont les clients formulent « ${service} ».`
          : `Ajouter un contenu sur « ${service} » dans la page de prestations la plus proche ; créer une page dédiée seulement si l’offre est réelle et importante pour le client.`,
        evidence: { coveringPage: coveringPage ?? null, servicesSource: "contexte client" },
      });
      continue;
    }
    // Opportunité locale : la prestation est recherchée, mais jamais avec une zone d'intervention renseignée.
    for (const area of context.areas.slice(0, 3)) {
      const areaText = normalizeText(area);
      if (areaText.length < 3 || queryTexts.some((query) => hasPhrase(normalizeText(query), areaText) && containsAll(query, tokens))) continue;
      const keyword = `${service} ${area}`.trim();
      drafts.push({
        fingerprint: opportunityFingerprint("local_gap", keyword), category: "local_gap", keyword, keywords: [keyword],
        targetUrl: coveringPage?.url ?? null, targetStatus: coveringPage ? "existing" : "missing", intent: "local", intentBasis: "prestation × zone d’intervention renseignée",
        source: "business_context", verified: false, metrics: null, previous: null, potentialClicks: null, relevance: 3, trend: "flat",
        actionKind: "add_content",
        factors: ["Hypothèse issue du contexte client (aucune donnée de volume)", `${coveringQueries.length} requête(s) sur la prestation, aucune avec « ${area} »`],
        rationale: `« ${service} » génère des impressions (${coveringQueries.slice(0, 3).map((query) => `« ${query} »`).join(", ")}) mais aucune requête n’associe cette prestation à la zone « ${area} », renseignée comme zone d’intervention.`,
        recommendedAction: `Mentionner explicitement l’intervention à « ${area} » dans la page de la prestation (zone desservie, réalisations locales vérifiables). Pas de création en série de pages locales artificielles.`,
        evidence: { coveringQueries: coveringQueries.slice(0, 5) },
      });
    }
  }
  return drafts.slice(0, 6);
}

// ——— Mesure après intervention ———

export type MeasurementWindow = 7 | 28 | 60;
export const MEASUREMENT_WINDOWS: MeasurementWindow[] = [7, 28, 60];
export type WindowResult = {
  before: Metrics; after: Metrics; beforePeriod: Period; afterPeriod: Period;
  verdict: "improved" | "degraded" | "stable" | "insufficient_data"; notes: string[];
};

export function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Périodes comparées pour une fenêtre : N jours avant le déploiement / N jours après (jour du déploiement exclu). */
export function measurementPeriods(deployedAt: string, window: MeasurementWindow) {
  return { before: { start: addDays(deployedAt, -window), end: addDays(deployedAt, -1) }, after: { start: addDays(deployedAt, 1), end: addDays(deployedAt, window) } };
}

/** Une fenêtre n'est mesurable que lorsque toutes ses journées sont consolidées dans Search Console. */
export function windowReady(deployedAt: string, window: MeasurementWindow, lastAvailableDate: string) {
  return measurementPeriods(deployedAt, window).after.end <= lastAvailableDate;
}

/**
 * Verdict prudent : « amélioration » ou « dégradation » seulement si l'écart est net et le volume suffisant.
 * Ne prétend jamais que la modification est la cause : saisonnalité, mises à jour Google et concurrence jouent aussi.
 */
export function compareWindow(before: Metrics, after: Metrics): Pick<WindowResult, "verdict" | "notes"> {
  if (before.impressions + after.impressions < 50) return { verdict: "insufficient_data", notes: ["Moins de 50 impressions sur les deux périodes : pas de conclusion."] };
  const notes: string[] = [];
  let score = 0;
  if (before.clicks >= 5 || after.clicks >= 5) {
    const ratio = before.clicks ? after.clicks / before.clicks : after.clicks > 0 ? 2 : 1;
    if (ratio >= 1.2) { score++; notes.push(`Clics ${before.clicks} → ${after.clicks}`); } else if (ratio <= 0.8) { score--; notes.push(`Clics ${before.clicks} → ${after.clicks}`); }
  }
  if (before.position !== null && after.position !== null) {
    const delta = before.position - after.position;
    if (delta >= 1) { score++; notes.push(`Position ${before.position.toFixed(1)} → ${after.position.toFixed(1)}`); } else if (delta <= -1) { score--; notes.push(`Position ${before.position.toFixed(1)} → ${after.position.toFixed(1)}`); }
  }
  if (before.ctr !== null && after.ctr !== null && before.impressions >= 100 && after.impressions >= 100) {
    if (after.ctr >= before.ctr * 1.2) { score++; notes.push(`CTR ${pct(before.ctr)} → ${pct(after.ctr)}`); } else if (after.ctr <= before.ctr * 0.8) { score--; notes.push(`CTR ${pct(before.ctr)} → ${pct(after.ctr)}`); }
  }
  return { verdict: score >= 1 ? "improved" : score <= -1 ? "degraded" : "stable", notes };
}

/** Totaux d'une série de lignes Search Console (positions pondérées par les impressions). */
export function sumRows(rows: QueryRow[]): Metrics {
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const weighted = rows.reduce((sum, row) => sum + (row.position >= 1 ? row.position * row.impressions : 0), 0);
  return { clicks, impressions, ctr: impressions ? clicks / impressions : null, position: impressions ? weighted / impressions : null };
}

/**
 * Changement significatif entre deux relevés d'une même opportunité (déjà traitée ou écartée) :
 * impressions ou clics doublés avec un volume minimal, ou position décalée d'au moins 3 places.
 */
export function isSignificantChange(before: Metrics | null, after: Metrics | null) {
  if (!before || !after) return false;
  if (after.impressions >= before.impressions * 2 && after.impressions - before.impressions >= 100) return true;
  if (before.impressions >= 100 && after.impressions <= before.impressions / 2) return true;
  if (after.clicks >= before.clicks * 2 && after.clicks - before.clicks >= 10) return true;
  if (before.clicks >= 20 && after.clicks <= before.clicks / 2) return true;
  return before.position !== null && after.position !== null && Math.abs(after.position - before.position) >= 3;
}

/** Lecture du title / H1 / description de la page cible (code GitHub) au regard de la requête. */
export function pageSignals(keyword: string, page: Pick<SitePage, "title" | "h1" | "description">) {
  const tokens = significantTokens(keyword).slice(0, 3);
  const notes: string[] = [];
  if (!tokens.length) return notes;
  if (!page.title) notes.push("Aucun title statique détecté dans le fichier source");
  else if (!containsAll(page.title, tokens)) notes.push(`Le title actuel ne reprend pas « ${keyword} »`);
  if (page.h1 && !containsAll(page.h1, tokens)) notes.push("Le H1 ne reprend pas les mots principaux de la requête");
  if (!page.description) notes.push("Aucune meta description statique détectée");
  else if (page.description.length < 70) notes.push("Meta description courte (moins de 70 caractères)");
  return notes;
}
