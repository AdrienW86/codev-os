import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getAgentByType } from "@/lib/agents/outputs";

export type SeoEvidence = {
  lastRun: { status: string; at: string; summary: string | null } | null;
  recommendations: { id: string; title: string; severity: string; reason: string; createdAt: string; href: string }[];
};

/**
 * Read actual stored SEO evidence; never attribute an old recommendation to a new run.
 * The caller must have passed requireAdmin and a resolved client UUID.
 */
export async function readSeoEvidence(clientId: string): Promise<SeoEvidence> {
  const agent = await getAgentByType("seo");
  if (!agent) return { lastRun: null, recommendations: [] };
  const db = getSupabaseServerClient();
  const [run, recs] = await Promise.all([
    db.from("agent_runs").select("status,completed_at,created_at,summary")
      .eq("agent_id", agent.id).eq("client_id", clientId)
      .order("created_at", { ascending: false }).limit(1),
    db.from("recommendations").select("id,title,severity,reason,created_at")
      .eq("agent_id", agent.id).eq("client_id", clientId).eq("status", "pending")
      .order("created_at", { ascending: false }).limit(10),
  ]);
  if (run.error || recs.error) throw new Error("seo evidence read failed");
  const latest = run.data?.[0];
  const priorities: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  return {
    lastRun: latest ? { status: latest.status, at: latest.completed_at ?? latest.created_at, summary: latest.summary } : null,
    recommendations: (recs.data ?? []).map((r) => ({
      id: r.id, title: r.title, severity: r.severity, reason: r.reason,
      createdAt: r.created_at, href: `/recommendations/${r.id}`,
    })).sort((a,b) => (priorities[a.severity] ?? 5) - (priorities[b.severity] ?? 5)),
  };
}
