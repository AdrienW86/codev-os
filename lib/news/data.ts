import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { NewsItem } from "@/lib/news/types";
import { impactNote } from "@/lib/news/rank";

/** Les actualités les plus pertinentes des 7 derniers jours (une par source au plus). */
export async function topNews(limit = 3): Promise<NewsItem[]> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data, error } = await getSupabaseServerClient().from("news_items").select("id,title,category,source_id,source_name,summary,published_at,url,score").gte("fetched_at", since).order("score", { ascending: false }).limit(30);
  if (error) return [];
  const picked: NewsItem[] = [];
  const sources = new Set<string>();
  for (const row of data ?? []) {
    if (sources.has(row.source_id)) continue;
    sources.add(row.source_id);
    picked.push({ id: row.id, title: row.title, category: row.category, source: row.source_name, summary: row.summary, date: (row.published_at ?? since).slice(0, 10), url: row.url, impact: impactNote(row) });
    if (picked.length >= limit) break;
  }
  return picked;
}

/** Fil de la veille : actualités des `days` derniers jours, éventuellement d'une catégorie, les plus pertinentes d'abord. */
export async function newsFeed(options: { category?: "IA" | "SEO" | null; days?: number; limit?: number } = {}): Promise<NewsItem[]> {
  const since = new Date(Date.now() - (options.days ?? 14) * 86_400_000).toISOString();
  let query = getSupabaseServerClient().from("news_items").select("id,title,category,source_id,source_name,summary,published_at,url,score,fetched_at").gte("fetched_at", since);
  if (options.category) query = query.eq("category", options.category);
  const { data, error } = await query.order("score", { ascending: false }).limit(Math.min(options.limit ?? 60, 200));
  if (error) throw new Error("Veille indisponible.");
  return (data ?? []).map((row) => ({ id: row.id, title: row.title, category: row.category, source: row.source_name, summary: row.summary, date: (row.published_at ?? row.fetched_at ?? since).slice(0, 10), url: row.url, impact: impactNote(row) }));
}
