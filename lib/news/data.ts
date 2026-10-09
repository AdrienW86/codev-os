import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { NewsItem } from "@/lib/news/types";

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
    picked.push({ id: row.id, title: row.title, category: row.category, source: row.source_name, summary: row.summary, date: (row.published_at ?? since).slice(0, 10), url: row.url });
    if (picked.length >= limit) break;
  }
  return picked;
}
