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
  IA: /\b(ai|ia|llm|gpt|claude|gemini|agent|model|modèle)\b/i,
  Développement: /\b(next\.?js|react|typescript|node|release|api|github|vercel)\b/i,
  SEO: /\b(seo|search|ranking|core update|google search|indexing|crawl)\b/i,
  Ads: /\b(ads|ad|campaign|bidding|performance max|pmax|shopping)\b/i,
  Web: /\b(web|css|chrome|browser|performance|core web vitals|lighthouse|accessibility)\b/i,
};

/** Score 0–100 : récence (7 jours), poids de la source, mots-clés de la catégorie. */
export function scoreItem(item: { title: string; summary: string; publishedAt: string | null }, category: NewsCategory, weight: number, now: Date) {
  const ageDays = item.publishedAt ? Math.max(0, (now.getTime() - new Date(item.publishedAt).getTime()) / 86_400_000) : 14;
  const recency = Math.max(0, 1 - ageDays / 7);
  const relevance = keywords[category].test(`${item.title} ${item.summary}`) ? 1 : 0.4;
  return Math.round((recency * 50 + relevance * 30 + weight * 20) * 100) / 100;
}
