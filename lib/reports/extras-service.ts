import "server-only";
// Agent Rapport : lecture (seule) des sources ajoutées au rapport — audience GA4, audits Lighthouse, diffusions par
// réseau, articles de blog et newsletters. Une source illisible (table absente, erreur) est simplement omise :
// le rapport se génère sans elle, jamais avec un chiffre inventé.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { emptyExtras, readPostStats, readReportAnalytics, type Period, type ReportArticle, type ReportDelivery, type ReportExtras, type ReportLighthouse, type ReportNewsletter, type ReportLocal, type ReportSiteHealth } from "@/lib/reports/insights";

type Result<T> = { data: T[] | null; error: unknown };
const TIMEOUT = 12_000;
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
async function read<T>(query: PromiseLike<Result<T>>): Promise<T[] | null> {
  try { const { data, error } = await query; return error || !data ? null : data; } catch { return null; }
}

export async function gatherReportExtras(clientId: string, period: Period): Promise<ReportExtras> {
  const db = getSupabaseServerClient() as unknown as SupabaseClient;
  const from = `${period.start}T00:00:00Z`;
  const to = `${shift(period.end, 1)}T00:00:00Z`;
  const [analytics, audits, deliveries, articles, newsletters] = await Promise.all([
    // Fenêtre GA4 de 30 jours la plus récente close au plus tard à la fin de la période (et pas avant son début).
    read<{ data: unknown }>(db.from("metric_snapshots").select("data").eq("client_id", clientId).eq("provider", "google-analytics").eq("metric_key", "ga4")
      .lte("period_end", period.end).gte("period_end", period.start).order("period_end", { ascending: false }).limit(1).abortSignal(AbortSignal.timeout(TIMEOUT))),
    read<ReportLighthouse>(db.from("performance_audits").select("strategy,url,analyzed_at,scores,field").eq("client_id", clientId)
      .gte("analyzed_at", `${shift(period.start, -7)}T00:00:00Z`).lt("analyzed_at", to).order("analyzed_at", { ascending: false }).limit(20).abortSignal(AbortSignal.timeout(TIMEOUT))),
    read<{ id: string; platform: string; published_at: string | null; publication: { subject: string | null } | { subject: string | null }[] | null }>(db.from("publication_deliveries")
      .select("id,platform,published_at,publication:publications(subject)").eq("client_id", clientId).eq("status", "published")
      .gte("published_at", from).lt("published_at", to).order("published_at").limit(500).abortSignal(AbortSignal.timeout(TIMEOUT))),
    // Articles de la période et des 90 jours précédents (leur audience GA4 est mise en regard).
    read<{ id: string; title: string; slug: string; published_at: string | null }>(db.from("blog_articles").select("id,title,slug,published_at").eq("client_id", clientId)
      .eq("status", "published").gte("published_at", `${shift(period.end, -90)}T00:00:00Z`).lt("published_at", to).order("published_at", { ascending: false }).limit(60).abortSignal(AbortSignal.timeout(TIMEOUT))),
    read<{ subject: string; sent_at: string | null; sent_count: number | null }>(db.from("email_newsletters").select("subject,sent_at,sent_count").eq("client_id", clientId)
      .eq("status", "sent").gte("sent_at", from).lt("sent_at", to).limit(50).abortSignal(AbortSignal.timeout(TIMEOUT))),
  ]);
  const extras = emptyExtras();
  // Santé technique (lot 5) : dernier contrôle clos avant la fin de la période (table facultative).
  const health = await read<ReportSiteHealth>(db.from("site_health_checks").select("checked_at,score,checks,findings").eq("client_id", clientId)
    .gte("checked_at", `${shift(period.start, -7)}T00:00:00Z`).lt("checked_at", to).order("checked_at", { ascending: false }).limit(1).abortSignal(AbortSignal.timeout(TIMEOUT)));
  extras.siteHealth = health?.[0] ?? null;
  // Fiches Google Business Profile (lot 6) : dernier relevé de chaque fiche, clos avant la fin de la période.
  const locals = await read<ReportLocal & { location_name: string }>(db.from("local_seo_snapshots").select("location_name,location_title,period_start,period_end,metrics,previous_metrics,keywords,reviews").eq("client_id", clientId)
    .lte("period_end", period.end).gte("period_end", shift(period.start, -10)).order("period_end", { ascending: false }).limit(10).abortSignal(AbortSignal.timeout(TIMEOUT)));
  extras.local = locals ? locals.filter((row, index, all) => all.findIndex((other) => other.location_name === row.location_name) === index) : null;
  extras.analytics = analytics?.[0] ? readReportAnalytics(analytics[0].data) : null;
  extras.lighthouse = audits ?? [];
  // Statistiques des posts (lot 3) : table facultative, illisible → posts sans chiffres (jamais zéro).
  const ids = (deliveries ?? []).map((row) => row.id).filter(Boolean);
  const stats = ids.length ? await read<{ delivery_id: string; status: string; metrics: unknown }>(db.from("publication_delivery_stats").select("delivery_id,status,metrics").in("delivery_id", ids.slice(0, 500)).abortSignal(AbortSignal.timeout(TIMEOUT))) : null;
  const statsBy = new Map((stats ?? []).map((row) => [row.delivery_id, row]));
  extras.deliveries = (deliveries ?? []).flatMap((row): ReportDelivery[] => {
    if (!row.published_at) return [];
    const s = statsBy.get(row.id);
    return [{ platform: row.platform, published_at: row.published_at, subject: (Array.isArray(row.publication) ? row.publication[0]?.subject : row.publication?.subject) ?? null,
      stats: s?.status === "ok" ? readPostStats(s.metrics) : null, statsStatus: s?.status ?? null }];
  });
  extras.newsletters = (newsletters ?? []).flatMap((row): ReportNewsletter[] => row.sent_at ? [{ subject: row.subject, sent_at: row.sent_at, sent_count: row.sent_count ?? 0 }] : []);
  const published = (articles ?? []).filter((row) => row.published_at);
  // Requête visée : conservée au journal par l'Agent Blog (blog_agent.article_written), sans colonne dédiée.
  const queries = new Map<string, string>();
  if (published.length) {
    const logs = await read<{ resource_id: string | null; metadata: unknown }>(db.from("audit_logs").select("resource_id,metadata").eq("action", "blog_agent.article_written")
      .in("resource_id", published.map((row) => row.id)).limit(200).abortSignal(AbortSignal.timeout(TIMEOUT)));
    for (const log of logs ?? []) {
      const query = log.metadata && typeof log.metadata === "object" ? (log.metadata as Record<string, unknown>).target_query : null;
      if (log.resource_id && typeof query === "string" && query.trim()) queries.set(log.resource_id, query.trim());
    }
  }
  extras.articles = published.map((row): ReportArticle => ({ title: row.title, slug: row.slug, published_at: row.published_at!, target_query: queries.get(row.id) ?? null }));
  return extras;
}
