import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { webAnalyticsSummary } from "@/lib/providers/vercel";
import { recordSync } from "@/lib/connections/sync";
import type { Json } from "@/lib/supabase/database.types";

const day = /^\d{4}-\d{2}-\d{2}$/;

export async function syncVercelAnalytics(
  clientId: string,
  period: { start: string; end: string },
): Promise<{ ok: true; data: Awaited<ReturnType<typeof webAnalyticsSummary>> } | { ok: false; reason: "not_configured" | "unavailable" }> {
  if (!day.test(period.start) || !day.test(period.end) || period.start > period.end) return { ok: false, reason: "unavailable" };
  const db = getSupabaseServerClient();
  const { data: connection, error } = await db.from("client_connections").select("metadata").eq("client_id", clientId).eq("provider", "vercel").maybeSingle();
  if (error) throw new Error("vercel connection read");
  const projectId = (connection?.metadata as { project_id?: string } | null)?.project_id;
  if (!projectId) return { ok: false, reason: "not_configured" };
  try {
    const analytics = await webAnalyticsSummary(projectId, period);
    const { error: writeError } = await db.from("metric_snapshots").upsert({
      client_id: clientId,
      provider: "vercel",
      metric_key: "web_analytics",
      period_start: period.start,
      period_end: period.end,
      data: analytics as unknown as Json,
    }, { onConflict: "client_id,provider,metric_key,period_start,period_end" });
    if (writeError) throw new Error("vercel analytics write");
    await recordSync(clientId, "vercel", null);
    return { ok: true, data: analytics };
  } catch (failure) {
    await recordSync(clientId, "vercel", failure);
    return { ok: false, reason: "unavailable" };
  }
}
