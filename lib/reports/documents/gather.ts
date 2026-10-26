import "server-only";
// Collecte des documents d'un rapport complet : chaque agent n'apparaît que si sa source est branchée pour ce client.
// Lecture seule partout (Google Ads, instantanés Vercel, historique Search Console, diffusions des publications).
// Une source indisponible n'empêche jamais les autres : elle est signalée dans la version interne.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_FILTERS, type DashboardFilters } from "@/lib/integrations/google-ads/dashboard";
import { loadCampaignDashboard, loadCampaignDashboardForSystem } from "@/lib/integrations/google-ads/service";
import type { ReportInput } from "@/lib/reports/build";
import { buildAdsDocument, buildSearchDocument, buildSiteDocument, buildSocialDocument, previousOf, shiftDay, type DocumentPeriod, type SocialPost } from "./build";
import type { ReportDocument } from "./model";

export type DocumentAccess = { kind: "admin" } | { kind: "system"; lease: { jobId: string; worker: string } };
export type GatheredDocuments = { documents: ReportDocument[]; warnings: string[] };
const db = () => getSupabaseServerClient();
const platforms = new Set(["facebook", "instagram", "google_business_profile"]);
const parisDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

async function adsDocument(clientId: string, period: DocumentPeriod, access: DocumentAccess, warnings: string[]): Promise<ReportDocument | null> {
  const { data: connection, error } = await db().from("client_connections").select("status").eq("client_id", clientId).eq("provider", "google_ads").maybeSingle();
  if (error || connection?.status !== "connected") return null;
  const filters: DashboardFilters = { ...DEFAULT_FILTERS, period: { preset: "custom", start: period.start, end: period.end }, compare: true, status: "all", includeUntracked: true };
  const loaded = access.kind === "admin"
    ? await loadCampaignDashboard(clientId, filters, new Date(), { daily: true })
    : await loadCampaignDashboardForSystem(clientId, filters, new Date(), { ...access.lease, runType: "report.generate" }, { daily: true });
  if (!loaded.ok) { warnings.push(`Google Ads non inclus : ${loaded.message}`); return null; }
  const data = loaded.data;
  return buildAdsDocument({
    currency: data.account.currency, campaigns: data.campaigns, totals: data.accountTotals, previousTotals: data.accountPrevious,
    daily: data.daily?.map((point) => ({ date: point.date, cost: point.cost, clicks: point.clicks, impressions: point.impressions, conversions: point.conversions })) ?? null,
    leads: data.leads,
  }, period);
}

async function socialDocument(clientId: string, period: DocumentPeriod, warnings: string[]): Promise<ReportDocument | null> {
  const previous = previousOf(period);
  const [deliveries, channels] = await Promise.all([
    db().from("publication_deliveries").select("platform,published_at,publication_id").eq("client_id", clientId).eq("status", "published")
      .gte("published_at", `${shiftDay(previous.start, -1)}T00:00:00Z`).lt("published_at", `${shiftDay(period.end, 2)}T00:00:00Z`).limit(1000),
    db().from("publication_project_channels").select("platform").eq("client_id", clientId).eq("enabled", true).limit(20),
  ]);
  if (deliveries.error || channels.error) { warnings.push("Réseaux sociaux non inclus : diffusions illisibles."); return null; }
  const rows = (deliveries.data ?? []) as { platform: string; published_at: string | null; publication_id: string }[];
  const ids = [...new Set(rows.map((row) => row.publication_id))];
  const subjects = new Map<string, string>();
  if (ids.length) {
    const { data, error } = await db().from("publications").select("id,subject").in("id", ids);
    if (error) { warnings.push("Réseaux sociaux non inclus : sujets illisibles."); return null; }
    for (const row of data ?? []) subjects.set(row.id, row.subject);
  }
  const posts: SocialPost[] = rows.flatMap((row) => row.published_at && platforms.has(row.platform)
    ? [{ date: parisDay(row.published_at), platform: row.platform as SocialPost["platform"], subject: subjects.get(row.publication_id)?.trim() || "Publication" }] : []);
  const previousCount = posts.filter((post) => post.date >= previous.start && post.date <= previous.end).length;
  const active = [...new Set(((channels.data ?? []) as { platform: string }[]).map((row) => row.platform).filter((platform) => platforms.has(platform)))] as SocialPost["platform"][];
  return buildSocialDocument({ posts, previousCount: active.length ? previousCount : null, channels: active }, period);
}

/** Documents dans l'ordre fixe des agents : Google Ads, référencement, site web, réseaux sociaux. */
export async function gatherReportDocuments(clientId: string, period: DocumentPeriod, input: ReportInput, access: DocumentAccess): Promise<GatheredDocuments> {
  const warnings: string[] = [];
  const safely = async (label: string, work: () => Promise<ReportDocument | null>) => {
    try { return await work(); } catch { warnings.push(`${label} non inclus : lecture impossible.`); return null; }
  };
  const site = input.metrics.find((metric) => metric.provider === "vercel" && metric.metric_key === "web_analytics" && metric.period_start === period.start && metric.period_end === period.end);
  const documents = [
    await safely("Google Ads", () => adsDocument(clientId, period, access, warnings)),
    await safely("Référencement", async () => input.searchConsole ? buildSearchDocument({ days: input.searchConsole.days }, period) : null),
    await safely("Site web", async () => buildSiteDocument(site?.data ?? null, period)),
    await safely("Réseaux sociaux", () => socialDocument(clientId, period, warnings)),
  ].filter((document): document is ReportDocument => Boolean(document));
  return { documents, warnings };
}
