// Lecture déterministe des demandes Google Ads (pur, testable) : période, statut, types, comparaison,
// client. Sert au repli sans IA et aux demandes de suivi (« et sur 7 jours ? », « uniquement Local
// Services ») ; ne produit que des paramètres validés ensuite par le serveur, jamais une requête.
import { normalize } from "@/lib/assistant/text";
import type { PeriodSelection } from "@/lib/integrations/google-ads/periods";
import type { StatusFilter } from "@/lib/integrations/google-ads/dashboard";

export type AdsRequest = {
  /** Mentionne Google Ads / des campagnes. */
  mentionsAds: boolean;
  /** Demande de consultation (affiche, montre, combien, dépenses…), par opposition à « lance / vérifie ». */
  display: boolean;
  /** Suite de conversation (« et … », « maintenant … », « même chose pour … »). */
  followUp: boolean;
  period?: PeriodSelection; status?: StatusFilter; types?: string[]; compare?: boolean; client?: string;
  /** Question à poser plutôt qu'une période devinée (ex. « sur 10 jours »). */
  clarify?: string;
};

const presetDays: Record<string, PeriodSelection["preset"]> = { 7: "last_7", 14: "last_14", 30: "last_30", 90: "last_90" };
const typeWords: [RegExp, string][] = [
  [/\b(local services|services locaux|lsa)\b/, "LOCAL_SERVICES"], [/\b(search|reseau de recherche)\b/, "SEARCH"],
  [/\b(performance max|pmax)\b/, "PERFORMANCE_MAX"], [/\bdisplay\b/, "DISPLAY"], [/\b(video|youtube)\b/, "VIDEO"], [/\bdemand gen\b/, "DEMAND_GEN"], [/\bshopping\b/, "SHOPPING"],
];
const notAClient = /^(la |le |les |l |mes |nos |ces |ce |cette |ma |mon |son |sa |toutes?|tous|\d|semaine|mois|jours?|periode|campagnes?|google|ads|adwords|local|search|hier|aujourd|derni|compte|resultats?|performances?)/;

function period(value: string): Pick<AdsRequest, "period" | "clarify"> {
  const range = value.match(/\bdu (\d{4}-\d{2}-\d{2}) au (\d{4}-\d{2}-\d{2})\b/);
  if (range) return { period: { preset: "custom", start: range[1], end: range[2] } };
  const day = value.match(/\b(?:le|du|pour le) (\d{4}-\d{2}-\d{2})\b/);
  if (day) return { period: { preset: "day", date: day[1] } };
  const days = value.match(/\b(\d{1,3}) (?:derniers )?jours\b/);
  if (days) return presetDays[days[1]] ? { period: { preset: presetDays[days[1]] } } : { clarify: `Périodes disponibles : 7, 14, 30 ou 90 derniers jours, une semaine, un mois, une journée ou des dates précises (« du 2026-09-01 au 2026-09-30 »). Quelle période pour « ${days[1]} jours » ?` };
  if (/\baujourd hui\b/.test(value)) return { period: { preset: "today" } };
  if (/\bhier\b/.test(value)) return { period: { preset: "yesterday" } };
  if (/\b(semaine (derniere|precedente|passee)|derniere semaine)\b/.test(value)) return { period: { preset: "last_week" } };
  if (/\bcette semaine\b/.test(value)) return { period: { preset: "this_week" } };
  if (/\b(mois (dernier|precedent|passe)|dernier mois)\b/.test(value)) return { period: { preset: "last_month" } };
  if (/\bce mois\b/.test(value)) return { period: { preset: "this_month" } };
  return {};
}

function clientIn(original: string): string | undefined {
  const match = original.match(/(?:^|\s)(?:(?:pour le client|du client|pour|chez|client|de)\s+|d['’]\s*)([^,.;:!?]+?)(?=\s+(?:sur|en|depuis|du|des|au|aux|uniquement|seulement|hier|aujourd|cette|ce|et|avec|par|compar\S*|vs|pendant|la semaine|le mois)\b|[,.;:!?]|$)/i);
  const candidate = match?.[1]?.trim();
  if (!candidate || candidate.length < 2 || notAClient.test(normalize(candidate))) return undefined;
  return candidate.slice(0, 120);
}

export function parseAdsRequest(text: string): AdsRequest {
  const original = text.trim().slice(0, 500);
  const value = normalize(original);
  const request: AdsRequest = {
    mentionsAds: /\b(google ads|adwords|campagnes?|ads|local services|lsa|pmax|performance max)\b/.test(value),
    display: /\b(montre|montrez|affiche|affichez|voir|vois|consulte|ouvre|quelles?|combien|depense\w*|performances?|resultats?|chiffres|bilan|stats?|statistiques|cout\w*|clics|conversions)\b/.test(value),
    followUp: /^(et|puis|maintenant|ok et|alors|meme chose|pareil)\b/.test(value),
    ...period(value),
  };
  if (/\b(en pause|pausees?|suspendues?)\b/.test(value)) request.status = "paused";
  else if (/\b(toutes les campagnes|tous (les )?statuts|y compris (celles )?en pause|actives et en pause)\b/.test(value)) request.status = "all";
  else if (/\b(actives?|en cours|qui tournent)\b/.test(value)) request.status = "enabled";
  if (/\btous (les )?types\b/.test(value)) request.types = [];
  else {
    const types = typeWords.filter(([pattern]) => pattern.test(value)).map(([, type]) => type);
    if (types.length) request.types = types;
  }
  if (/\b(sans comparaison|ne compare plus|sans comparer|arrete de comparer)\b/.test(value)) request.compare = false;
  else if (/\b(compar\w*|par rapport (a|au)|vs|versus|periode precedente|evolution)\b/.test(value)) request.compare = true;
  const client = clientIn(original);
  if (client) request.client = client;
  return request;
}

/** La demande change-t-elle quelque chose à la vue courante ? */
export const hasAdsChange = (request: AdsRequest) => Boolean(request.period || request.status || request.types || request.compare !== undefined || request.clarify);

/** Toute demande de modification Google Ads (pause, budget, enchères…) : indisponible dans ce lot. */
export function isAdsMutationRequest(text: string) {
  const value = normalize(text);
  const ads = /\b(google ads|campagnes?|ads|budgets?|encheres?|mots? cles?|annonces?)\b/.test(value);
  const verb = /\b(mets? en pause|mettre en pause|pause[rz]?|suspend\w*|arrete\w*|stoppe\w*|reactive\w*|active[rz]?|desactive\w*|augmente\w*|baisse\w*|diminue\w*|modifie\w*|change[rz]?|ajuste\w*|supprime\w*|cree[rz]? (une|la|des) campagnes?|double\w*|relance la campagne)\b/.test(value);
  const notTask = !/\b(tache|rappel|note|periode|filtres?|affichage|vue|dates?|comparaison)\b/.test(value);
  return ads && verb && notTask && !/^(et )?(montre|affiche|voir|quelles?)\b/.test(value) && !/\b(en pause|actives?)\s*\??$/.test(value);
}

export const ADS_READ_ONLY_REPLY = "Les modifications Google Ads (pause, budget, enchères, campagnes) ne sont pas disponibles : l’intégration est en lecture seule. Je peux afficher les campagnes, changer la période, filtrer ou comparer, préparer un rapport ou lancer l’analyse.";

/** « oui », « confirme », « vas-y »… : jamais une confirmation d'écriture (bouton obligatoire). */
export function isBareConfirmation(text: string) {
  return /^(oui|ouais|ok|okay|d accord|confirme[rz]?|je confirme|valide[rz]?|vas[ -]y|go|c est bon|execute|lance|fais le|allez)( (le|la|stp|s il te plait|merci|oui))?[ !.]*$/.test(normalize(text));
}

export const CONFIRM_WITH_BUTTON_REPLY = "Pour exécuter une action, utilisez le bouton « Confirmer » de la proposition affichée. Une réponse écrite ou dictée ne suffit pas : rien n’a été modifié.";
