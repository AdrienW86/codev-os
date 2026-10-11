import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { dailyTrend, webAnalyticsCount, webAnalyticsEvents, webAnalyticsSummary, type VercelAnalyticsRow, type VercelAnalyticsTrendPoint } from "@/lib/providers/vercel";
import { recordSync } from "@/lib/connections/sync";
import type { Json } from "@/lib/supabase/database.types";

const day = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function periodDays(period: { start: string; end: string }) {
  return Math.floor((Date.parse(`${period.end}T00:00:00Z`) - Date.parse(`${period.start}T00:00:00Z`)) / DAY_MS) + 1;
}

function previousPeriod(period: { start: string; end: string }) {
  const days = periodDays(period);
  const end = new Date(`${period.start}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function pctChange(now: number, before: number) {
  if (before <= 0) return now > 0 ? null : 0;
  return Math.round(((now - before) / before) * 1000) / 10;
}

// Période précédente : volumes, série quotidienne et événements, pour les comparaisons du tableau de bord.
type PreviousPeriod = { pageviews: number; visitors: number; period: { start: string; end: string }; trend?: VercelAnalyticsTrendPoint[]; events?: VercelAnalyticsRow[] };

function buildInsights(data: Awaited<ReturnType<typeof webAnalyticsSummary>> & {
  previous?: PreviousPeriod;
}) {
  const insights: { kind: "positive" | "warning" | "info"; title: string; detail: string }[] = [];
  const previous = data.previous;
  if (previous) {
    const visitorsDelta = pctChange(data.visitors, previous.visitors);
    const viewsDelta = pctChange(data.pageviews, previous.pageviews);
    if (visitorsDelta !== null && Math.abs(visitorsDelta) >= 20) insights.push({
      kind: visitorsDelta > 0 ? "positive" : "warning",
      title: visitorsDelta > 0 ? "Audience en progression" : "Audience en baisse",
      detail: `${data.visitors} visiteurs sur la période, soit ${visitorsDelta > 0 ? "+" : ""}${visitorsDelta.toLocaleString("fr-FR")} % par rapport à la période précédente.`,
    });
    if (viewsDelta !== null && Math.abs(viewsDelta) >= 25 && (visitorsDelta === null || Math.abs(viewsDelta - visitorsDelta) >= 10)) insights.push({
      kind: viewsDelta > 0 ? "positive" : "warning",
      title: viewsDelta > 0 ? "Consommation de contenu en hausse" : "Pages vues en recul",
      detail: `${data.pageviews} pages vues, soit ${viewsDelta > 0 ? "+" : ""}${viewsDelta.toLocaleString("fr-FR")} % par rapport à la période précédente.`,
    });
  }
  const top = data.topPages[0];
  if (top?.pageviews && data.pageviews > 0) {
    const share = Math.round((top.pageviews / data.pageviews) * 1000) / 10;
    if (share >= 45) insights.push({ kind: "info", title: "Trafic très concentré", detail: `${share.toLocaleString("fr-FR")} % des pages vues se concentrent sur ${top.label}. Vérifier que cette page oriente clairement vers les actions commerciales utiles.` });
  }
  if (!data.events.length) insights.push({ kind: "warning", title: "Conversions non instrumentées", detail: "Aucun événement personnalisé n’est remonté. Les formulaires, clics téléphone, WhatsApp et CTA ne peuvent donc pas encore être attribués." });
  if (data.topReferrers[0]?.label && data.visitors > 0) {
    const lead = data.topReferrers[0];
    const share = typeof lead.visitors === "number" ? Math.round((lead.visitors / data.visitors) * 1000) / 10 : null;
    if (share !== null && share >= 50) insights.push({ kind: "info", title: "Acquisition concentrée", detail: `${lead.label} représente environ ${share.toLocaleString("fr-FR")} % des visiteurs identifiés sur la période.` });
  }
  return insights.slice(0, 6);
}

export async function syncVercelAnalytics(
  clientId: string,
  period: { start: string; end: string },
): Promise<{ ok: true; data: Awaited<ReturnType<typeof webAnalyticsSummary>> & { previous?: PreviousPeriod; insights: ReturnType<typeof buildInsights> } } | { ok: false; reason: "not_configured" | "unavailable" }> {
  if (!day.test(period.start) || !day.test(period.end) || period.start > period.end) return { ok: false, reason: "unavailable" };
  const db = getSupabaseServerClient();
  const { data: connection, error } = await db.from("client_connections").select("metadata").eq("client_id", clientId).eq("provider", "vercel").maybeSingle();
  if (error) throw new Error("vercel connection read");
  const projectId = (connection?.metadata as { project_id?: string } | null)?.project_id;
  if (!projectId) return { ok: false, reason: "not_configured" };
  try {
    const analytics = await webAnalyticsSummary(projectId, period, { limit: 30 });
    const priorPeriod = previousPeriod(period);
    let previous: PreviousPeriod | undefined;
    try {
      const [count, trend, events] = await Promise.all([
        webAnalyticsCount(projectId, priorPeriod),
        dailyTrend(projectId, priorPeriod).catch(() => undefined),
        webAnalyticsEvents(projectId, priorPeriod, { limit: 30 }).catch(() => undefined),
      ]);
      previous = { ...count, period: priorPeriod, trend, events };
    } catch {
      previous = undefined;
    }
    const enriched = { ...analytics, previous, insights: buildInsights({ ...analytics, previous }) };
    const { error: writeError } = await db.from("metric_snapshots").upsert({
      client_id: clientId,
      provider: "vercel",
      metric_key: "web_analytics",
      period_start: period.start,
      period_end: period.end,
      data: enriched as unknown as Json,
    }, { onConflict: "client_id,provider,metric_key,period_start,period_end" });
    if (writeError) throw new Error("vercel analytics write");
    await recordSync(clientId, "vercel", null);
    return { ok: true, data: enriched };
  } catch (failure) {
    await recordSync(clientId, "vercel", failure);
    return { ok: false, reason: "unavailable" };
  }
}
