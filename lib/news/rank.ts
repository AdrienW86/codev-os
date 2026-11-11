// Normalisation, déduplication et score de pertinence (purs).
import { createHash } from "node:crypto";
import type { NewsCategory } from "@/lib/news/sources";

export function normalizeUrl(raw: string) {
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|ref$|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    return url.toString().replace(/\/$/, "");
  } catch { return raw.trim(); }
}

export function dedupeKey(url: string) {
  return createHash("sha256").update(normalizeUrl(url)).digest("hex").slice(0, 40);
}

const keywords: Record<NewsCategory, RegExp> = {
  IA: /\b(ai|ia|llm|gpt|chatgpt|claude|gemini|mistral|agents?|models?|modèles?|intelligence artificielle|generative|générative)\b/i,
  Développement: /\b(next\.?js|react|typescript|node|release|api|github|vercel)\b/i,
  SEO: /\b(seo|search|ranking|core update|google search|indexing|crawl|référencement|serp|ai overviews?|ai mode|search console|google business profile|local)\b/i,
  Ads: /\b(ads|ad|campaign|bidding|performance max|pmax|shopping)\b/i,
  Web: /\b(web|css|chrome|browser|performance|core web vitals|lighthouse|accessibility)\b/i,
};

/**
 * Actualités qui exigent une action pour les clients d'une agence (regard d'un consultant senior) :
 * mises à jour d'algorithme, changements de règles, fonctionnalités retirées ou lancées, sécurité.
 */
const highImpact = /\b(core update|spam update|algorithm update|mise à jour (?:de l’algorithme|de l'algorithme|principale|du core)|helpful content|ai overviews?|ai mode|deprecat\w*|sunset|breaking changes?|policy|politique|règles?|end of support|fin (?:du support|de prise en charge)|launch(?:es|ed)?|lance(?:ment)?|disponible|now available|general availability|ga\b|vulnerabilit\w*|faille|security|sécurité|google business profile|search console|consent mode|price|tarifs?)\b/i;
/** Annonces sans action concrète (événements, récapitulatifs, contenus promotionnels). */
const lowImpact = /\b(webinar|webinaire|podcast|recap|récap|roundup|événement|event|conference|conférence|sponsored|sponsorisé|promo)\b/i;

/** Score 0–100 : récence (7 jours), poids de la source, pertinence de la catégorie, impact actionnable. */
export function scoreItem(item: { title: string; summary: string; publishedAt: string | null }, category: NewsCategory, weight: number, now: Date) {
  const ageDays = item.publishedAt ? Math.max(0, (now.getTime() - new Date(item.publishedAt).getTime()) / 86_400_000) : 14;
  const recency = Math.max(0, 1 - ageDays / 7);
  const text = `${item.title} ${item.summary}`;
  const relevance = keywords[category].test(text) ? 1 : 0.4;
  const impact = highImpact.test(text) ? 1 : lowImpact.test(text) ? 0 : 0.4;
  return Math.round((recency * 45 + relevance * 25 + weight * 15 + impact * 15) * 100) / 100;
}

/** Pourquoi l'actualité compte pour un client (affichage du digest) ; null si rien d'actionnable. */
export function impactNote(item: { title: string; summary: string }) {
  const text = `${item.title} ${item.summary}`;
  if (/core update|spam update|algorithm update|mise à jour (?:principale|de l.algorithme)|helpful content/i.test(text)) return "Mise à jour d’algorithme : surveiller positions et trafic des clients dans les jours qui suivent.";
  if (/ai overviews?|ai mode/i.test(text)) return "Recherche générative : impact possible sur le taux de clic des requêtes informationnelles.";
  if (/deprecat|sunset|end of support|fin (?:du support|de prise en charge)|breaking changes?/i.test(text)) return "Fonctionnalité retirée ou modifiée : vérifier les sites et intégrations concernés.";
  if (/vulnerabilit|faille|security|sécurité/i.test(text)) return "Sécurité : vérifier si les sites ou outils des clients sont exposés.";
  if (/policy|politique|règles?|consent mode/i.test(text)) return "Changement de règles : vérifier la conformité des comptes et des sites.";
  return null;
}
