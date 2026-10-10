import "server-only";
// Handler « news.fetch » : FETCH → NORMALIZE → DEDUPLICATE → RANK → stockage.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { safeGet } from "@/lib/providers/safe-http";
import { newsSources } from "@/lib/news/sources";
import { parseFeed } from "@/lib/news/parse";
import { dedupeKey, scoreItem } from "@/lib/news/rank";
import { RunError, type RunHandler } from "@/lib/runs/types";

export const fetchNewsRun: RunHandler = async ({ now }) => {
  const supabase = getSupabaseServerClient();
  let stored = 0, failedSources = 0;
  const seen = new Set<string>();
  for (const source of newsSources) {
    let items;
    try {
      const response = await safeGet(source.url, { provider: "rss", timeoutMs: 10_000, maxBytes: 2_000_000, accept: "application/rss+xml,application/atom+xml,application/xml,text/xml" });
      if (response.status !== 200) { failedSources++; continue; }
      items = parseFeed(response.body);
    } catch { failedSources++; continue; }
    const rows = items.filter((item) => !item.publishedAt || now.getTime() - new Date(item.publishedAt).getTime() < 30 * 86_400_000).map((item) => ({
      source_id: source.id, source_name: source.name, title: item.title, url: item.url.slice(0, 2048), category: source.category,
      summary: item.summary, published_at: item.publishedAt, score: scoreItem(item, source.category, source.weight, now), dedupe_key: dedupeKey(item.url),
    })).filter((row) => !seen.has(row.dedupe_key) && seen.add(row.dedupe_key));
    if (!rows.length) continue;
    const { data, error } = await supabase.from("news_items").upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
    if (error) throw new RunError("Stockage de la veille indisponible.");
    stored += data?.length ?? 0;
  }
  if (failedSources === newsSources.length) throw new RunError("Aucune source de veille joignable.");
  return { status: "succeeded", summary: `${stored} nouvelle(s) actualité(s)${failedSources ? `, ${failedSources} source(s) indisponible(s)` : ""}.`, data: { stored, failedSources } };
};
