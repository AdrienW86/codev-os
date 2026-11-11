import "server-only";
// Faits d'un client pour le chef de projet (lecture seule). Une table absente (migration non appliquée) = donnée absente.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { describeSchedule, nextRun, scheduleSchema, type Frequency, type Schedule } from "@/lib/scheduler/recurrence";
import { buildClientPlan, type ClientFacts, type ClientPlan } from "./client-plan";
import { buildWeekPlan, type WeekEvent, type WeekPlan } from "./week-plan";
import type { HarnessAgentId } from "./charter";

const DAY = 86_400_000;
const platformNames: Record<string, string> = {
  facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", google_business: "Google Business Profile", gbp: "Google Business Profile",
  tiktok: "TikTok", snapchat: "Snapchat", youtube: "YouTube", pinterest: "Pinterest", x: "X",
};

type AutomationLite = { run_type: string; client_id: string | null; status: string; frequency: string; schedule: unknown; timezone: string; next_run_at: string | null; config: unknown };
/** Agent et libellé d'une exécution planifiée ; null = hors semaine du client (veille commune, etc.). */
function automationAgent(row: AutomationLite): { agent: HarnessAgentId; text: string } | null {
  const depth = row.config && typeof row.config === "object" ? (row.config as Record<string, unknown>).depth : null;
  switch (row.run_type) {
    case "report.generate": return { agent: "report", text: "Rapports de la semaine" };
    case "monitoring.check_sites": return { agent: "monitoring", text: "Contrôle du site" };
    case "seo.analyze": return { agent: "seo", text: depth === "weekly" ? "Analyse SEO hebdomadaire" : "Analyse SEO quotidienne" };
    case "ads.monitor": return { agent: "google-ads", text: "Surveillance des campagnes" };
    case "ads.report.prepare": return { agent: "report", text: "Rapport Google Ads" };
    default: return null;
  }
}

/** Occurrences d'une automatisation dans la fenêtre, calculées avec sa propre récurrence. */
function occurrences(row: AutomationLite, now: Date, end: Date): string[] {
  const parsed = scheduleSchema.safeParse({ frequency: row.frequency, timezone: row.timezone, schedule: row.schedule });
  if (!parsed.success || !row.next_run_at) return [];
  const out: string[] = [];
  let at: Date | null = new Date(row.next_run_at);
  while (at && at.getTime() < end.getTime() && out.length < 14) {
    if (at.getTime() >= now.getTime() - 60_000) out.push(at.toISOString());
    at = nextRun(parsed.data.frequency as Frequency, parsed.data.schedule as Schedule, parsed.data.timezone, at);
  }
  return out;
}

export type ClientSnapshot = { facts: ClientFacts; plan: ClientPlan; week: WeekPlan };

export async function loadClientSnapshot(clientId: string, now = new Date()): Promise<ClientSnapshot> {
  const db = getSupabaseServerClient();
  const soon = new Date(now.getTime() + 7 * DAY), recent = new Date(now.getTime() - 7 * DAY).toISOString();
  const optional = async <T,>(query: PromiseLike<{ data: T | null; error: unknown }>) => { try { const r = await query; return r.error ? null : r.data; } catch { return null; } };
  const [client, services, assignments, agents, automations, pubSettings, pending, scheduled, failed, blog, blogUpcoming, blogPublished, visual, video, media] = await Promise.all([
    db.from("clients").select("id,website").eq("id", clientId).maybeSingle(),
    optional(db.from("client_services").select("service_key,lifecycle").eq("client_id", clientId)),
    optional(db.from("agent_client_assignments").select("enabled,agent:agents(agent_type,enabled,status)").eq("client_id", clientId)),
    optional(db.from("agents").select("agent_type,enabled,status")),
    optional(db.from("automations").select("run_type,client_id,status,frequency,schedule,timezone,next_run_at,config").neq("status", "archived")),
    optional(db.from("publication_client_settings").select("auto_approve_enabled,generation_enabled,publishing_enabled,weekly_slots").eq("client_id", clientId).maybeSingle()),
    optional(db.from("publications").select("id", { count: "exact", head: false }).eq("client_id", clientId).eq("status", "pending_review").is("archived_at", null).limit(1000)),
    optional(db.from("publication_deliveries").select("id,platform,scheduled_for").eq("client_id", clientId).eq("status", "scheduled").lte("scheduled_for", soon.toISOString()).limit(1000)),
    optional(db.from("publication_deliveries").select("id").eq("client_id", clientId).in("status", ["failed", "blocked", "uncertain"]).gte("updated_at", recent).limit(1000)),
    optional(db.from("client_blog_agents").select("enabled,per_week,social_relay").eq("client_id", clientId).maybeSingle()),
    optional(db.from("blog_articles").select("title,publish_at").eq("client_id", clientId).eq("status", "scheduled").lte("publish_at", soon.toISOString()).limit(50)),
    optional(db.from("blog_articles").select("id").eq("client_id", clientId).eq("status", "published").gte("published_at", recent).limit(50)),
    optional(db.from("client_visual_agents").select("enabled,per_week").eq("client_id", clientId).maybeSingle()),
    optional(db.from("client_video_agents").select("enabled,per_week,pace").eq("client_id", clientId).maybeSingle()),
    optional(db.from("client_media_profiles").select("ai_classification_enabled,ai_monthly_budget_eur").eq("client_id", clientId).maybeSingle()),
  ]);
  if (client.error || !client.data) throw new Error("client read");
  const runnable = (a: { enabled: boolean; status: string } | null | undefined) => Boolean(a && a.enabled && a.status === "Actif");
  type AssignmentRow = { enabled: boolean; agent: { agent_type: string | null; enabled: boolean; status: string } | { agent_type: string | null; enabled: boolean; status: string }[] | null };
  const assigned = new Set<string>();
  for (const row of (assignments ?? []) as AssignmentRow[]) {
    const agent = Array.isArray(row.agent) ? row.agent[0] : row.agent;
    if (row.enabled && runnable(agent) && agent?.agent_type) assigned.add(agent.agent_type);
  }
  const field = (row: unknown, key: string) => (row ? (row as Record<string, unknown>)[key] : undefined);
  const flag = (row: unknown, key: string) => Boolean(field(row, key));
  const num = (row: unknown, key: string) => { const value = Number(field(row, key)); return Number.isFinite(value) ? value : undefined; };
  const clientAutomations = ((automations ?? []) as AutomationLite[]).filter((row) => row.status === "active" && (row.client_id === null || row.client_id === clientId));
  const scheduleLabel = (row: AutomationLite) => {
    const parsed = scheduleSchema.safeParse({ frequency: row.frequency, timezone: row.timezone, schedule: row.schedule });
    if (!parsed.success) return null;
    const what = automationAgent(row)?.text;
    return `${what ? `${what} : ` : ""}${describeSchedule(parsed.data.frequency as Frequency, parsed.data.schedule as Schedule, parsed.data.timezone).toLowerCase()}`;
  };
  const slots = field(pubSettings, "weekly_slots");
  const facts: ClientFacts = {
    clientId, website: client.data.website ?? null,
    services: (services ?? []).map((s) => ({ key: s.service_key ?? "", lifecycle: s.lifecycle ?? "" })),
    assignedTypes: assigned,
    activeTypes: new Set((agents ?? []).filter(runnable).map((a) => a.agent_type).filter((t): t is string => Boolean(t))),
    automations: ((automations ?? []) as AutomationLite[]).map((row) => ({ run_type: row.run_type, client_id: row.client_id, status: row.status })),
    publication: pubSettings ? {
      configured: true, autoApprove: flag(pubSettings, "auto_approve_enabled"), pendingReview: pending?.length ?? 0, scheduledNext7Days: scheduled?.length ?? 0, failedDeliveries: failed?.length ?? 0,
      generationEnabled: flag(pubSettings, "generation_enabled"), publishingEnabled: flag(pubSettings, "publishing_enabled"), slotsPerWeek: Array.isArray(slots) ? slots.length : undefined,
    } : null,
    blog: blog ? { enabled: flag(blog, "enabled"), perWeek: num(blog, "per_week"), socialRelay: flag(blog, "social_relay"), scheduledNext7Days: blogUpcoming?.length ?? 0, publishedLast7Days: blogPublished?.length ?? 0 } : null,
    visual: visual ? { enabled: flag(visual, "enabled"), perWeek: num(visual, "per_week") } : null,
    video: video ? { enabled: flag(video, "enabled"), perWeek: num(video, "per_week"), pace: typeof field(video, "pace") === "string" ? String(field(video, "pace")) : undefined } : null,
    mediaLibrary: media ? { classification: flag(media, "ai_classification_enabled"), monthlyBudgetEur: num(media, "ai_monthly_budget_eur") } : null,
    schedules: clientAutomations.flatMap((row) => { const label = scheduleLabel(row); return label ? [{ runType: row.run_type, label }] : []; }),
  };
  const plan = buildClientPlan(facts);

  // Semaine : seuls les agents « au travail » pour ce client y figurent (un contrôle global ne concerne pas un client sans site).
  const working = new Set(plan.seats.filter((seat) => seat.state === "working").map((seat) => seat.agent));
  const events: WeekEvent[] = [];
  for (const row of (scheduled ?? []) as { platform: string | null; scheduled_for: string | null }[]) {
    if (row.scheduled_for) events.push({ at: row.scheduled_for, agent: "publications", text: `Publication ${platformNames[row.platform ?? ""] ?? row.platform ?? ""}`.trim() });
  }
  for (const row of (blogUpcoming ?? []) as { title: string; publish_at: string }[]) events.push({ at: row.publish_at, agent: "blog", text: `Article « ${row.title} »` });
  for (const row of clientAutomations) {
    const target = automationAgent(row);
    if (!target || !working.has(target.agent)) continue;
    for (const at of occurrences(row, now, soon)) events.push({ at, agent: target.agent, text: target.text });
  }
  const cadence: { agent: HarnessAgentId; text: string }[] = [];
  if (working.has("visual") && facts.visual?.perWeek) cadence.push({ agent: "visual", text: `${facts.visual.perWeek} visuel(s) déposé(s) dans le Drive au fil de la semaine` });
  if (working.has("video") && facts.video?.perWeek) cadence.push({ agent: "video", text: `${facts.video.perWeek} vidéo(s) rangée(s) dans le Studio au fil de la semaine` });
  if (working.has("media-library")) cadence.push({ agent: "media-library", text: "Classement des nouvelles photos à chaque passage" });
  return { facts, plan, week: buildWeekPlan({ now, events, cadence }) };
}

export async function loadClientPlan(clientId: string, now = new Date()): Promise<ClientPlan & { week: WeekPlan }> {
  const snapshot = await loadClientSnapshot(clientId, now);
  return { ...snapshot.plan, week: snapshot.week };
}
