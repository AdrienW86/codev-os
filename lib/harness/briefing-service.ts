import "server-only";
// Lecture (seule) du point de situation de chaque agent de la charte. Le Directeur et le Rapport parcourent ce
// registre : un agent ajouté à la charte DOIT avoir un lecteur ici (Record exhaustif, vérifié par TypeScript).
// Aucun agent n'est relancé, aucune API externe n'est appelée, rien n'est écrit.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { harnessCharters, type HarnessAgentId } from "./charter";
import { loadTeam } from "./team-service";
import {
  blogSignals, buildAgentBriefing, coherenceSignals, competitionSignals, geogridSignals, localSignals, photoSignals, countSignals, directorSignals, monitoringSignals, newsletterSignals, prospectionSignals, prospectingEmailSignals, type ProspectingMessageRow,
  publicationsSignals, reportSignals, reviewSignals, scoreSignals, snapshotSignals, visualSignals,
  type AgentBriefing, type AuditRow, type BlogRow, type BriefingSignals, type CoherenceRow, type CompetitionRow, type GeneratedImageRow, type HealthRow, type LocalRow, type PostStatsRow, type DeliveryRow, type DiscoveryRow, type IncidentRow,
  type NewsletterRow, type ReportRow, type ReviewLogRow, type ScoreLogRow, type SiteCheckRow, type SnapshotRow, type VisualRow,
} from "./briefing";

type Ctx = { db: SupabaseClient; clientId: string | null; now: Date; since: (days: number) => string };
type Reader = (ctx: Ctx) => Promise<BriefingSignals>;
type Result<T> = { data: T[] | null; error: unknown };

const TIMEOUT = 10_000;
async function rows<T>(query: PromiseLike<Result<T>>): Promise<T[]> {
  const { data, error } = await query;
  if (error || !data) throw new Error("briefing read");
  return data;
}
/** Filtre client facultatif : sans client, le point de situation couvre tous les clients. */
function scoped<Q>(query: Q, clientId: string | null, column = "client_id"): Q {
  return clientId ? (query as unknown as { eq: (name: string, value: string) => Q }).eq(column, clientId) : query;
}

const snapshots = (providers: string[]): Reader => async ({ db, clientId, now, since }) => snapshotSignals(await rows<SnapshotRow>(
  scoped(db.from("metric_snapshots").select("provider,metric_key,period_end,fetched_at,data").in("provider", providers).gte("fetched_at", since(60)), clientId)
    .order("fetched_at", { ascending: false }).limit(300).abortSignal(AbortSignal.timeout(TIMEOUT))), providers, now);

const reviewLogs = (check: "fact" | "duplicate"): Reader => async ({ db, clientId, now, since }) => {
  const query = db.from("audit_logs").select("created_at,metadata").eq("action", "editorial_review.checked").gte("created_at", since(30));
  return reviewSignals(await rows<ReviewLogRow>(scoped(query, clientId, "resource_id").order("created_at", { ascending: false }).limit(500).abortSignal(AbortSignal.timeout(TIMEOUT))), check, now);
};

const missingTable = (error: unknown) => {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === "42P01" || e?.code === "PGRST205" || /could not find the table|does not exist/i.test(e?.message ?? "");
};
/** Table d'une migration facultative : absente → null (agent « non installé »), autre erreur → échec de lecture. */
async function optionalRows<T>(query: PromiseLike<Result<T>>): Promise<T[] | null> {
  const { data, error } = await query;
  if (error) { if (missingTable(error)) return null; throw new Error("briefing read"); }
  return data ?? [];
}

export const briefingReaders: Record<HarnessAgentId, Reader> = {
  director: async ({ db, clientId, since }) => directorSignals(await rows<IncidentRow>(
    scoped(db.from("incidents").select("status,detected_at").eq("source", "system").like("fingerprint", "harness:%").gte("detected_at", since(30)), clientId)
      .limit(500).abortSignal(AbortSignal.timeout(TIMEOUT)))),
  report: async ({ db, clientId, now, since }) => reportSignals(await rows<ReportRow>(
    scoped(db.from("reports").select("status,kind,created_at").gte("created_at", since(60)), clientId).order("created_at", { ascending: false }).limit(300).abortSignal(AbortSignal.timeout(TIMEOUT))), now),
  publications: async ({ db, clientId, now, since }) => {
    const [deliveries, stats] = await Promise.all([
      rows<DeliveryRow>(scoped(db.from("publication_deliveries").select("platform,status,scheduled_for,published_at").gte("scheduled_for", since(30)), clientId)
        .order("scheduled_for", { ascending: false }).limit(1000).abortSignal(AbortSignal.timeout(TIMEOUT))),
      optionalRows<PostStatsRow>(scoped(db.from("publication_delivery_stats").select("platform,status,metrics,fetched_at").gte("fetched_at", since(30)), clientId)
        .limit(2000).abortSignal(AbortSignal.timeout(TIMEOUT))).catch(() => null),
    ]);
    return publicationsSignals(deliveries, now, stats);
  },
  "publication-photo": async ({ db, clientId, now, since }) => photoSignals(await optionalRows<GeneratedImageRow>(
    scoped(db.from("publication_generated_images").select("status,created_at,decided_at").or(`status.eq.pending_review,created_at.gte.${since(30)}`), clientId)
      .order("created_at", { ascending: false }).limit(500).abortSignal(AbortSignal.timeout(TIMEOUT))), now),
  "publication-check": async ({ db, clientId, now, since }) => coherenceSignals(await optionalRows<CoherenceRow>(
    scoped(db.from("publication_coherence_checks").select("coherent,checked_at").gte("checked_at", since(30)), clientId)
      .order("checked_at", { ascending: false }).limit(1000).abortSignal(AbortSignal.timeout(TIMEOUT))), now),
  blog: async ({ db, clientId, now, since }) => blogSignals(await rows<BlogRow>(
    scoped(db.from("blog_articles").select("status,publish_at,published_at,title").gte("updated_at", since(60)), clientId).limit(300).abortSignal(AbortSignal.timeout(TIMEOUT))), now),
  visual: async ({ db, clientId }) => visualSignals(await rows<VisualRow>(
    scoped(db.from("client_visual_agents").select("enabled,per_week,last_generated_at"), clientId).limit(200).abortSignal(AbortSignal.timeout(TIMEOUT)))),
  video: async ({ db, clientId, now, since }) => countSignals((await rows<{ created_at: string }>(
    scoped(db.from("studio_videos").select("created_at").gte("created_at", since(30)), clientId).limit(500).abortSignal(AbortSignal.timeout(TIMEOUT)))).map((row) => ({ at: row.created_at })),
  now, { one: "vidéo montée", many: "vidéos montées", empty: "Aucune vidéo montée sur 30 jours." }),
  "media-library": async ({ db, clientId, now, since }) => countSignals((await rows<{ created_at: string }>(
    scoped(db.from("whatsapp_assets").select("created_at").gte("created_at", since(30)), clientId).limit(2000).abortSignal(AbortSignal.timeout(TIMEOUT)))).map((row) => ({ at: row.created_at })),
  now, { one: "photo reçue", many: "photos reçues", empty: "Aucune photo reçue sur 30 jours." }),
  seo: async (ctx) => {
    const [base, local, competition, grids] = await Promise.all([
      snapshots(["search-console", "google-analytics", "pagespeed"])(ctx),
      optionalRows<LocalRow>(scoped(ctx.db.from("local_seo_snapshots").select("location_title,metrics,reviews,fetched_at").gte("fetched_at", ctx.since(30)), ctx.clientId)
        .order("fetched_at", { ascending: false }).limit(20).abortSignal(AbortSignal.timeout(TIMEOUT))).catch(() => null),
      optionalRows<CompetitionRow>(scoped(ctx.db.from("metric_snapshots").select("metric_key,fetched_at,data").eq("provider", "local-competition").gte("fetched_at", ctx.since(30)), ctx.clientId)
        .order("fetched_at", { ascending: false }).limit(20).abortSignal(AbortSignal.timeout(TIMEOUT))).catch(() => null),
      ctx.clientId ? optionalRows<CompetitionRow>(scoped(ctx.db.from("metric_snapshots").select("metric_key,fetched_at,data").eq("provider", "local-geogrid").gte("fetched_at", ctx.since(30)), ctx.clientId)
        .order("fetched_at", { ascending: false }).limit(20).abortSignal(AbortSignal.timeout(TIMEOUT))).catch(() => null) : Promise.resolve(null),
    ]);
    const extra = localSignals(local), rivals = ctx.clientId ? competitionSignals(competition) : { facts: [], gaps: [] };
    return { facts: [...base.facts, ...extra.facts, ...rivals.facts, ...geogridSignals(grids)], gaps: [...base.gaps, ...extra.gaps, ...rivals.gaps] };
  },
  monitoring: async ({ db, clientId, now, since }) => {
    const [checks, audits, health] = await Promise.all([
      rows<SiteCheckRow>(scoped(db.from("site_checks").select("ok,checked_at").gte("checked_at", since(7)), clientId).limit(5000).abortSignal(AbortSignal.timeout(TIMEOUT))),
      rows<AuditRow>(scoped(db.from("performance_audits").select("strategy,scores,analyzed_at").gte("analyzed_at", since(30)), clientId).order("analyzed_at", { ascending: false }).limit(50).abortSignal(AbortSignal.timeout(TIMEOUT))),
      optionalRows<HealthRow>(scoped(db.from("site_health_checks").select("score,findings,checked_at").gte("checked_at", since(30)), clientId).order("checked_at", { ascending: false }).limit(200).abortSignal(AbortSignal.timeout(TIMEOUT))).catch(() => null),
    ]);
    return monitoringSignals(checks, audits, now, health);
  },
  "google-ads": snapshots(["google-ads"]),
  prospection: async ({ db, clientId, now, since }) => {
    let query = db.from("acquisition_discovery_runs").select("status,found_count,finished_at,created_at").gte("created_at", since(30));
    if (clientId) {
      const workspaces = await rows<{ id: string }>(db.from("acquisition_workspaces").select("id").eq("client_id", clientId).limit(5).abortSignal(AbortSignal.timeout(TIMEOUT)));
      if (!workspaces.length) return { facts: [], gaps: ["Aucun espace de prospection pour ce client."] };
      query = query.in("workspace_id", workspaces.map((row) => row.id));
    }
    return prospectionSignals(await rows<DiscoveryRow>(query.limit(200).abortSignal(AbortSignal.timeout(TIMEOUT))), now);
  },
  "prospection-email": async ({ db, clientId, now, since }) => {
    let query = db.from("acquisition_messages").select("state,sent_at,replied_at,created_at").gte("created_at", since(60));
    if (clientId) {
      const workspaces = await rows<{ id: string }>(db.from("acquisition_workspaces").select("id").eq("client_id", clientId).limit(5).abortSignal(AbortSignal.timeout(TIMEOUT)));
      if (!workspaces.length) return { facts: [], gaps: ["Aucun espace de prospection pour ce client."] };
      query = query.in("workspace_id", workspaces.map((row) => row.id));
    }
    return prospectingEmailSignals(await optionalRows<ProspectingMessageRow>(query.limit(2000).abortSignal(AbortSignal.timeout(TIMEOUT))).catch(() => null), now);
  },
  newsletter: async ({ db, clientId, now, since }) => newsletterSignals(await rows<NewsletterRow>(
    scoped(db.from("email_newsletters").select("status,created_at,sent_at,sent_count").gte("created_at", since(90)), clientId).limit(200).abortSignal(AbortSignal.timeout(TIMEOUT))), now),
  copywriter: async ({ db, clientId, now, since }) => {
    // Note de naturel journalisée par l'Agent Blog (par article) et l'Agent Newsletter (client dans les métadonnées).
    const blog = db.from("audit_logs").select("created_at,metadata,resource_id").eq("action", "blog_agent.article_written").gte("created_at", since(30)).limit(500);
    const newsletter = db.from("audit_logs").select("created_at,metadata").eq("action", "newsletter.drafted").gte("created_at", since(30)).limit(200);
    const [blogRows, newsletterRows] = await Promise.all([
      rows<ScoreLogRow & { resource_id: string | null }>(blog.abortSignal(AbortSignal.timeout(TIMEOUT))),
      rows<ScoreLogRow>((clientId ? newsletter.eq("metadata->>client_id", clientId) : newsletter).abortSignal(AbortSignal.timeout(TIMEOUT))),
    ]);
    let ownBlog: ScoreLogRow[] = blogRows;
    if (clientId) {
      const ids = blogRows.flatMap((row) => row.resource_id ? [row.resource_id] : []);
      const articles = ids.length ? await rows<{ id: string }>(db.from("blog_articles").select("id").eq("client_id", clientId).in("id", ids.slice(0, 300)).abortSignal(AbortSignal.timeout(TIMEOUT))) : [];
      const own = new Set(articles.map((row) => row.id));
      ownBlog = blogRows.filter((row) => row.resource_id && own.has(row.resource_id));
    }
    return scoreSignals([...ownBlog, ...newsletterRows], "style_score", "note de naturel", now);
  },
  "fact-check": reviewLogs("fact"),
  "editorial-review": reviewLogs("duplicate"),
  veille: async ({ db, now, since }) => countSignals((await rows<{ fetched_at: string }>(
    db.from("news_items").select("fetched_at").gte("fetched_at", since(30)).limit(3000).abortSignal(AbortSignal.timeout(TIMEOUT)))).map((row) => ({ at: row.fetched_at })),
  now, { one: "actualité collectée", many: "actualités collectées", href: "/news", empty: "Aucune actualité collectée sur 30 jours." }),
};

/**
 * Point de situation de tous les agents (ou de ceux demandés), pour un client ou pour l'ensemble.
 * Une lecture qui échoue rend l'agent « illisible » ; elle n'interrompt jamais celle des autres.
 */
export async function loadAgentBriefings(options: { clientId?: string | null; agents?: readonly HarnessAgentId[]; now?: Date } = {}): Promise<AgentBriefing[]> {
  const now = options.now ?? new Date();
  const db = getSupabaseServerClient() as unknown as SupabaseClient;
  const ctx: Ctx = { db, clientId: options.clientId ?? null, now, since: (days) => new Date(now.getTime() - days * 86_400_000).toISOString() };
  const team = await loadTeam();
  const health = new Map(team.teams.flatMap((group) => group.members).map((member) => [member.charter.id, member.health]));
  const charters = options.agents?.length ? harnessCharters.filter((charter) => options.agents!.includes(charter.id)) : harnessCharters;
  return Promise.all(charters.map(async (charter) => {
    const signals = await briefingReaders[charter.id](ctx).catch(() => null);
    return buildAgentBriefing(charter, health.get(charter.id) ?? { state: "attention", lines: ["État d’exécution illisible."] }, signals, now);
  }));
}
