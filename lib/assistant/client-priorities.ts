import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export type Priority = {
  title: string; source: "seo" | "ads"; priority: "critical" | "high" | "medium" | "low" | "info" | "unrated";
  date: string; href: string;
};
const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

/**
 * Prioritise uniquement les recommandations effectivement enregistrées.
 * Aucune estimation d'impact, d'effort ou de confiance n'est inventée.
 * Exige un client résolu et une route déjà protégée par requireAdmin.
 */
export async function topClientPriorities(clientId: string): Promise<Priority[]> {
  const db = getSupabaseServerClient();
  const { data: agents, error: agentError } = await db.from("agents")
    .select("id,agent_type").in("agent_type", ["seo", "google-ads"]);
  if (agentError) throw new Error("priority agents read failed");
  const source = new Map((agents ?? []).map((agent) => [agent.id, agent.agent_type]));
  if (!source.size) return [];
  const { data, error } = await db.from("recommendations")
    .select("id,agent_id,title,severity,created_at")
    .eq("client_id", clientId).eq("status", "pending")
    .in("agent_id", [...source.keys()])
    .order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error("priority recommendations read failed");
  return (data ?? [])
    .filter((item) => source.get(item.agent_id) === "seo" || source.get(item.agent_id) === "google-ads")
    .sort((a, b) => (rank[a.severity] ?? 5) - (rank[b.severity] ?? 5) || b.created_at.localeCompare(a.created_at))
    .slice(0, 3).map((item) => ({
      title: item.title,
      source: source.get(item.agent_id) === "seo" ? "seo" as const : "ads" as const,
      priority: (Object.hasOwn(rank, item.severity) ? item.severity : "unrated") as Priority["priority"],
      date: item.created_at,
      href: `/recommendations/${item.id}`,
    }));
}
