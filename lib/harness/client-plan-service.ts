import "server-only";
// Faits d'un client pour le chef de projet (lecture seule). Une table absente (migration non appliquée) = donnée absente.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { buildClientPlan, type ClientFacts, type ClientPlan } from "./client-plan";

const DAY = 86_400_000;

export async function loadClientPlan(clientId: string, now = new Date()): Promise<ClientPlan> {
  const db = getSupabaseServerClient();
  const soon = new Date(now.getTime() + 7 * DAY).toISOString(), recent = new Date(now.getTime() - 7 * DAY).toISOString();
  const optional = async <T,>(query: PromiseLike<{ data: T | null; error: unknown }>) => { try { const r = await query; return r.error ? null : r.data; } catch { return null; } };
  const [client, services, assignments, agents, automations, pubSettings, pending, scheduled, failed, blog, visual, video, media] = await Promise.all([
    db.from("clients").select("id,website").eq("id", clientId).maybeSingle(),
    optional(db.from("client_services").select("service_key,lifecycle").eq("client_id", clientId)),
    optional(db.from("agent_client_assignments").select("enabled,agent:agents(agent_type,enabled,status)").eq("client_id", clientId)),
    optional(db.from("agents").select("agent_type,enabled,status")),
    optional(db.from("automations").select("run_type,client_id,status").neq("status", "archived")),
    optional(db.from("publication_client_settings").select("auto_approve_enabled").eq("client_id", clientId).maybeSingle()),
    optional(db.from("publications").select("id", { count: "exact", head: false }).eq("client_id", clientId).eq("status", "pending_review").is("archived_at", null).limit(1000)),
    optional(db.from("publication_deliveries").select("id").eq("client_id", clientId).eq("status", "scheduled").lte("scheduled_for", soon).limit(1000)),
    optional(db.from("publication_deliveries").select("id").eq("client_id", clientId).in("status", ["failed", "blocked", "uncertain"]).gte("updated_at", recent).limit(1000)),
    optional(db.from("client_blog_agents").select("enabled").eq("client_id", clientId).maybeSingle()),
    optional(db.from("client_visual_agents").select("enabled").eq("client_id", clientId).maybeSingle()),
    optional(db.from("client_video_agents").select("enabled").eq("client_id", clientId).maybeSingle()),
    optional(db.from("client_media_profiles").select("ai_classification_enabled").eq("client_id", clientId).maybeSingle()),
  ]);
  if (client.error || !client.data) throw new Error("client read");
  const runnable = (a: { enabled: boolean; status: string } | null | undefined) => Boolean(a && a.enabled && a.status === "Actif");
  type AssignmentRow = { enabled: boolean; agent: { agent_type: string | null; enabled: boolean; status: string } | { agent_type: string | null; enabled: boolean; status: string }[] | null };
  const assigned = new Set<string>();
  for (const row of (assignments ?? []) as AssignmentRow[]) {
    const agent = Array.isArray(row.agent) ? row.agent[0] : row.agent;
    if (row.enabled && runnable(agent) && agent?.agent_type) assigned.add(agent.agent_type);
  }
  const flag = (row: unknown, key: string) => Boolean(row && (row as Record<string, unknown>)[key]);
  const facts: ClientFacts = {
    clientId, website: client.data.website ?? null,
    services: (services ?? []).map((s) => ({ key: s.service_key ?? "", lifecycle: s.lifecycle ?? "" })),
    assignedTypes: assigned,
    activeTypes: new Set((agents ?? []).filter(runnable).map((a) => a.agent_type).filter((t): t is string => Boolean(t))),
    automations: automations ?? [],
    publication: pubSettings ? { configured: true, autoApprove: flag(pubSettings, "auto_approve_enabled"), pendingReview: pending?.length ?? 0, scheduledNext7Days: scheduled?.length ?? 0, failedDeliveries: failed?.length ?? 0 } : null,
    blog: blog ? { enabled: flag(blog, "enabled") } : null,
    visual: visual ? { enabled: flag(visual, "enabled") } : null,
    video: video ? { enabled: flag(video, "enabled") } : null,
    mediaLibrary: media ? { classification: flag(media, "ai_classification_enabled") } : null,
  };
  return buildClientPlan(facts);
}
