import "server-only";
// Lancement manuel d'une tâche d'agent (catalogue lib/launch/catalog.ts) : même code que le planificateur, pour un client
// ou pour tous. Un lancement identique (même tâche, même client) déjà parti il y a moins de 2 minutes est refusé.
// Aucune confirmation cruciale n'est contournée : ce qui part chez un tiers ou coûte attend toujours l'administrateur.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import { launchTask, type LaunchTask } from "./catalog";
import { countSummary, lighthouseDetails, resultHref, siteHealthDetails } from "./outcome";
import { competitionSignals, geogridSignals, localSignals } from "@/lib/harness/briefing";
import { runHarnessControl } from "@/lib/harness/control-service";
import { runAutoDecisions } from "@/lib/review/auto-decisions";
import { runPhotoAgentTick } from "@/lib/publications/photo-agent/service";
import { collectPublicationStats } from "@/lib/publications/stats/service";
import { generateBlogArticle } from "@/lib/blog-agent/service";
import { generateVisual } from "@/lib/visual-agent/service";
import { generateAgentVideo } from "@/lib/video-agent/service";
import { classifyClientMedia, syncDriveLibrary } from "@/lib/media-intelligence/service";
import { syncSearchConsole } from "@/lib/integrations/search-console/sync";
import { syncGoogleAnalytics } from "@/lib/integrations/google-analytics/sync";
import { runLocalSeoTick, productionLocalSeoDeps } from "@/lib/local-seo/service";
import { runLocalCompetitionTick, productionLocalCompetitionDeps } from "@/lib/local-competition/service";
import { runLocalGeogridTick, productionLocalGeogridDeps } from "@/lib/local-geogrid/service";
import { runLighthouseTick } from "@/lib/performance/weekly";
import { runSiteHealthTick } from "@/lib/site-health/service";
import { runAcquisitionDiscoveryTick } from "@/lib/acquisition/background";
import { runProspectingSendTick } from "@/lib/acquisition/send-service";
import { runProspectingWriterTick } from "@/lib/acquisition/writer-service";
import { runNow } from "@/lib/automations/service";
import { runLeadsTick } from "@/lib/leads/service";
import type { RunType } from "@/lib/agents/registry";

export type LaunchOutcome = { ok: boolean; message: string; href?: string; details?: string[] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCK_MS = 2 * 60_000;
const db = () => getSupabaseServerClient();

const count = countSummary;

/** Vrai résultat d'un relevé pour un client : lu dans ce que la tâche vient d'enregistrer (jamais inventé). */
async function details(taskId: string, clientId: string | null, since: string): Promise<string[]> {
  if (!clientId) return [];
  const recent = (table: string, column: string, select: string, extra?: (q: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    let query = db().from(table).select(select).eq("client_id", clientId).gte(column, since);
    if (extra) query = extra(query);
    return query.order(column, { ascending: false }).limit(20).then(({ data, error }: { data: unknown; error: unknown }) => (error ? [] : ((data ?? []) as never[])));
  };
  switch (taskId) {
    case "local-seo": { const rows = await recent("local_seo_snapshots", "fetched_at", "location_title,metrics,reviews,fetched_at"); return rows.length ? localSignals(rows).facts.map((f) => f.statement) : ["Aucune statistique de fiche Google enregistrée par ce relevé (fiche non connectée ou Google sans réponse)."]; }
    case "local-competition": return competitionSignals(await recent("metric_snapshots", "fetched_at", "metric_key,fetched_at,data", (q) => q.eq("provider", "local-competition"))).facts.map((f) => f.statement);
    case "local-geogrid": return geogridSignals(await recent("metric_snapshots", "fetched_at", "metric_key,fetched_at,data", (q) => q.eq("provider", "local-geogrid"))).map((f) => f.statement);
    case "lighthouse": { const rows = await recent("performance_audits", "analyzed_at", "strategy,scores,analyzed_at"); return lighthouseDetails(rows.filter((r: { strategy: string }, i, all: { strategy: string }[]) => all.findIndex((o) => o.strategy === r.strategy) === i)); }
    case "site-health": { const [row] = await recent("site_health_checks", "checked_at", "url,score,findings,checked_at"); return siteHealthDetails(row ?? null); }
    default: return [];
  }
}

type LaunchActor = Extract<Actor, { userId: string }>;

async function automationFor(runType: string, clientId: string | null) {
  let query = db().from("automations").select("id,run_type,client_id,agent_id,config").eq("run_type", runType).neq("status", "archived").limit(1);
  query = clientId ? query.eq("client_id", clientId) : query.is("client_id", null);
  const { data, error } = await query;
  if (error) throw new Error("automations read");
  return (data?.[0] as { id: string; run_type: string; client_id: string | null; agent_id: string | null; config: unknown } | undefined) ?? null;
}

async function run(task: LaunchTask, clientId: string | null, actor: LaunchActor): Promise<LaunchOutcome> {
  const now = new Date();
  const need = () => { if (!clientId) throw new Error("client required"); return clientId; };
  switch (task.id) {
    case "harness-control": return { ok: true, message: count(await runHarnessControl(now, { force: true }), ["findings", "opened", "resolved", "failed"]) };
    case "auto-decisions": return { ok: true, message: count(await runAutoDecisions(now), ["approved", "archived", "failed"]) };
    case "publication-photo": return { ok: true, message: count(await runPhotoAgentTick(now), ["candidates", "generated", "budget", "failed"]), href: "/publications/images" };
    case "publication-stats": return { ok: true, message: count(await collectPublicationStats(), ["due", "ok", "failed"]) };
    case "blog": { const r = await generateBlogArticle(need(), { trigger: "manual", actorId: actor.userId, now }); return r.ok ? { ok: true, message: `Article rédigé : « ${r.title} ».`, href: `/blog/${r.id}` } : { ok: false, message: r.message }; }
    case "visual": { const r = await generateVisual(need(), { trigger: "manual", actorId: actor.userId }); return r.ok ? { ok: true, message: `Visuel créé : « ${r.headline} ».`, href: `/clients/${clientId}?tab=media` } : { ok: false, message: r.message }; }
    case "video": { const r = await generateAgentVideo(need(), { trigger: "manual", actorId: actor.userId }); return r.ok ? { ok: true, message: `Vidéo montée (${r.seconds} s) : « ${r.headline} ».`, href: "/studio" } : { ok: false, message: r.message }; }
    case "media-library": {
      const sync = await syncDriveLibrary(need());
      const classified = await classifyClientMedia(need(), { limit: 20 });
      return { ok: true, message: `${sync.added} photo(s) importée(s), ${classified.analyzed} classée(s)${classified.quarantined ? `, ${classified.quarantined} en quarantaine` : ""}${classified.stopped ? ` (arrêt : ${classified.stopped})` : ""}.`, href: `/clients/${clientId}?tab=media` };
    }
    case "search-console": {
      const end = new Date(now.getTime() - 2 * 86_400_000), start = new Date(end.getTime() - 27 * 86_400_000);
      const r = await syncSearchConsole(need(), { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }, "manual");
      return r.ok ? { ok: true, message: r.warning ?? "Search Console synchronisée.", href: "/analytics" } : { ok: false, message: r.reason === "no_property" ? "Aucune propriété Search Console associée à ce client." : r.reason === "not_connected" ? "Search Console n’est pas connecté." : r.error ?? "Synchronisation indisponible." };
    }
    case "google-analytics": {
      const r = await syncGoogleAnalytics(need());
      return r.ok ? { ok: true, message: r.warning ?? "Google Analytics synchronisé.", href: "/analytics" } : { ok: false, message: r.reason === "no_property" ? "Aucune propriété GA4 associée à ce client." : r.reason === "not_connected" ? "Google Analytics n’est pas connecté." : r.error ?? "Synchronisation indisponible." };
    }
    case "local-seo": return { ok: true, message: count(await runLocalSeoTick(now, productionLocalSeoDeps(), { clientId: need() }), ["collected", "failed", "alerts"]) };
    case "local-competition": return { ok: true, message: count(await runLocalCompetitionTick(now, productionLocalCompetitionDeps(), { clientId: need() }), ["collected", "failed", "alerts"]) };
    case "local-geogrid": return { ok: true, message: count(await runLocalGeogridTick(now, productionLocalGeogridDeps(), { clientId: need() }), ["collected", "points", "failed"]) };
    case "lighthouse": return { ok: true, message: count(await runLighthouseTick(now, { clientId: need() }), ["audited", "failed", "alerts"]), href: "/performance" };
    case "site-health": return { ok: true, message: count(await runSiteHealthTick(now, { clientId: need() }), ["checked", "failed", "alerts"]) };
    case "prospection-writer": return { ok: true, message: count(await runProspectingWriterTick({ deadline: Date.now() + 55_000 }), ["written", "template"]), href: "/acquisition" };
    case "prospection-email": return { ok: true, message: count(await runProspectingSendTick(new Date()), ["sent", "failed", "stopped"]), href: "/acquisition" };
    case "leads": return { ok: true, message: count(await runLeadsTick(new Date(), { deadline: Date.now() + 50_000 }), ["processed", "followups", "auto_sent", "closed", "failed"]), href: "/leads" };
    case "prospection": return { ok: true, message: count(await runAcquisitionDiscoveryTick({ deadline: Date.now() + 50_000 }), ["runs"]), href: "/acquisition" };
    case "seo-analyze": case "monitoring": case "ads-monitor": case "veille": {
      const runType = task.covers.runType!;
      const automation = await automationFor(runType, task.scope === "global" ? null : need());
      if (!automation) return { ok: false, message: "Aucune tâche programmée de ce type pour ce client : activez le service sur la fiche client (Agents).", href: clientId ? `/clients/${clientId}?tab=agents` : "/agents" };
      // Même exécution que « Lancer maintenant » d'une automatisation : file des jobs, dédoublonnée à la minute.
      const r = await runNow(actor, { runType: automation.run_type as RunType, clientId: automation.client_id, agentId: automation.agent_id, automationId: automation.id, payload: (automation.config ?? {}) as Record<string, unknown>, dedupeKey: `auto-${automation.id}-${new Date().toISOString().slice(0, 16)}`, trigger: actor.kind === "assistant" ? "assistant" : "manual" });
      return { ok: r.ok, message: r.message ?? (r.ok ? "Lancé." : "Échec.") };
    }
    default: return { ok: false, message: "Cette tâche se lance depuis son écran.", href: task.href?.(clientId) };
  }
}

/** actor : l'administrateur (bouton) ou le Directeur après confirmation explicite de l'administrateur. */
export async function launch(actor: LaunchActor, taskId: unknown, clientIdInput: unknown): Promise<LaunchOutcome> {
  const task = launchTask(taskId);
  if (!task) return { ok: false, message: "Tâche inconnue." };
  const clientId = typeof clientIdInput === "string" && UUID.test(clientIdInput) ? clientIdInput : null;
  if (task.href) return { ok: true, message: "Ouverture de l’écran de lancement.", href: task.href(clientId) };
  if (task.scope === "client" && !clientId) return { ok: false, message: "Choisissez un client." };
  const scopedClient = task.scope === "global" ? null : clientId;
  // Verrou anti-doublon : même tâche, même client, moins de 2 minutes.
  const since = new Date(Date.now() - LOCK_MS).toISOString();
  const recent = await db().from("audit_logs").select("id").eq("action", "launch.started").contains("metadata", { task: task.id, client: scopedClient ?? "all" }).gte("created_at", since).limit(1);
  if (recent.error) return { ok: false, message: "Vérification du verrou impossible : rien n’a été lancé." };
  if (recent.data?.length) return { ok: false, message: "Déjà lancée il y a moins de 2 minutes pour ce client : patientez." };
  await writeAudit(actor, { action: "launch.started", resource_type: "launch", resource_id: scopedClient, metadata: { task: task.id, client: scopedClient ?? "all" } });
  try {
    const startedAt = new Date(Date.now() - 5_000).toISOString();
    const raw = await run(task, scopedClient, actor);
    const lines = raw.ok ? await details(task.id, scopedClient, startedAt).catch(() => []) : [];
    const href = raw.href ?? resultHref(task.id, scopedClient) ?? undefined;
    const outcome: LaunchOutcome = { ...raw, ...(href ? { href } : {}), ...(lines.length ? { details: lines } : {}) };
    await writeAudit(actor, { action: outcome.ok ? "launch.succeeded" : "launch.refused", resource_type: "launch", resource_id: scopedClient, metadata: { task: task.id, client: scopedClient ?? "all" } }).catch(() => undefined);
    return outcome;
  } catch {
    await writeAudit(actor, { action: "launch.failed", resource_type: "launch", resource_id: scopedClient, metadata: { task: task.id, client: scopedClient ?? "all" } }).catch(() => undefined);
    return { ok: false, message: "Échec du lancement. Réessayez dans quelques minutes ; le planificateur reprendra de toute façon au prochain passage." };
  }
}
