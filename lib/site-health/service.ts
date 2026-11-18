import "server-only";
// Santé technique hebdomadaire des sites (lot 5), portée par l'Agent Monitoring (étape « site_health »). Un site dû par
// passage : certificat, domaine, DNS, robots.txt, sitemap, échantillon de pages, Core Web Vitals réels (dernier audit
// Lighthouse mobile) et indexation Google (Search Console, si reliée). Archivé dans site_health_checks ; chaque
// constat important ouvre un incident dédoublonné, résolu automatiquement quand il disparaît. Aucun correctif appliqué.
// Sans la migration 20261216000000 : rien ne tourne (comportement d'avant).
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import { clientContextDenied, getAgentByType, openIncident, recordRecommendation, resolveIncident } from "@/lib/agents/outputs";
import { siteUrl } from "@/lib/monitoring/evaluate";
import { inAuditWindow } from "@/lib/performance/weekly-model";
import { clientProperty } from "@/lib/integrations/search-console/sync";
import { searchConsoleAccess } from "@/lib/integrations/search-console/connection";
import { inspectUrl } from "@/lib/providers/search-console";
import { fetchSitePage, readCertificate, readDns, readRdap } from "@/lib/integrations/site-health";
import {
  CRAWL_SAMPLE, HEALTH_CODES, INSPECT_SAMPLE, crawlSample, evaluateHealth, healthDue, healthFingerprint, opensIncident, rdapExpiration, readInspection,
  readRobots, readSitemap, registrableDomain, type CrawlResult, type FieldVitals, type HealthInput, type InspectionResult,
} from "./model";

const ACTOR: Actor = { kind: "system", worker: "site-health-weekly" };
const FAILURE_ACTION = "site_health.check_failed";
const TABLE = "site_health_checks";
const missingTable = (error: unknown) => { const e = error as { code?: string; message?: string } | null; return e?.code === "42P01" || e?.code === "PGRST205" || /could not find the table|does not exist/i.test(e?.message ?? ""); };

export type SiteHealthSummary = { disabled?: "agent" | "migration"; outside_window?: 1; checked: number; failed: number; pending: number; alerts: number; resolved: number };

/** options.clientId : lancement manuel pour ce client seulement, hors fenêtre de nuit et sans attendre l'échéance. */
export async function runSiteHealthTick(now = new Date(), options: { clientId?: string } = {}): Promise<SiteHealthSummary> {
  const summary: SiteHealthSummary = { checked: 0, failed: 0, pending: 0, alerts: 0, resolved: 0 };
  // La nuit (1 h – 6 h, heure de Paris), comme l'audit Lighthouse : aucune charge sur les sites en journée.
  if (!options.clientId && !inAuditWindow(now)) return { ...summary, outside_window: 1 };
  const agent = await getAgentByType("monitoring");
  if (!agent || !agent.enabled || agent.status !== "Actif") return { ...summary, disabled: "agent" };
  const db = getSupabaseServerClient() as unknown as SupabaseClient;
  const since = new Date(now.getTime() - 8 * 86_400_000).toISOString();
  const last = await db.from(TABLE).select("client_id,checked_at").gte("checked_at", since).order("checked_at", { ascending: false }).limit(1000);
  if (last.error) { if (missingTable(last.error)) return { ...summary, disabled: "migration" }; throw new Error("site health read"); }
  const { data: clients, error } = await db.from("clients").select("id,name,website").limit(500);
  if (error) throw new Error("clients read");
  const sites = ((clients ?? []) as { id: string; name: string; website: string | null }[]).filter((client) => !options.clientId || client.id === options.clientId).flatMap((client) => { const url = siteUrl(client.website); return url ? [{ id: client.id, name: client.name, url }] : []; });
  if (!sites.length) return summary;
  const failures = await db.from("audit_logs").select("resource_id,created_at").eq("action", FAILURE_ACTION).eq("resource_type", "client").gte("created_at", since).order("created_at", { ascending: false }).limit(500);
  const lastCheck = new Map<string, string>(), lastFailure = new Map<string, string>();
  for (const row of (last.data ?? []) as { client_id: string; checked_at: string }[]) if (!lastCheck.has(row.client_id)) lastCheck.set(row.client_id, row.checked_at);
  for (const row of (failures.data ?? []) as { resource_id: string | null; created_at: string }[]) if (row.resource_id && !lastFailure.has(row.resource_id)) lastFailure.set(row.resource_id, row.created_at);
  const due = sites.filter((site) => Boolean(options.clientId) || healthDue({ lastCheckAt: lastCheck.get(site.id) ?? null, lastFailureAt: lastFailure.get(site.id) ?? null }, now))
    .sort((a, b) => (lastCheck.get(a.id) ?? "").localeCompare(lastCheck.get(b.id) ?? ""));
  if (!due.length) return summary;
  const [site] = due;
  summary.pending = due.length - 1;
  let input: HealthInput;
  try { input = await gather(db, site, now); }
  catch { summary.failed++; await writeAudit(ACTOR, { action: FAILURE_ACTION, resource_type: "client", resource_id: site.id, metadata: { kind: "gather" } }).catch(() => undefined); return summary; }
  const result = evaluateHealth(input);
  const saved = await db.from(TABLE).insert({ client_id: site.id, url: site.url.slice(0, 2048), score: result.score, checks: result.checks, findings: result.findings, checked_at: now.toISOString() });
  if (saved.error) throw new Error("site health write");
  summary.checked++;
  const canRecommend = (await clientContextDenied(agent, site.id)) === null;
  const host = new URL(site.url).hostname;
  const open = new Set<string>();
  for (const finding of result.findings.filter(opensIncident)) {
    const fingerprint = healthFingerprint(site.id, finding.code);
    open.add(fingerprint);
    const incident = await openIncident(ACTOR, { clientId: site.id, agentId: agent.id, source: "monitoring", severity: finding.severity, title: `${host} : ${finding.title}`, fingerprint, details: { code: finding.code, detail: finding.detail, checked_at: now.toISOString(), source: "Santé technique (Agent Monitoring)" } });
    if (!incident.created) continue;
    summary.alerts++;
    if (!canRecommend) continue;
    const recommendation = await recordRecommendation(ACTOR, { agentId: agent.id, clientId: site.id, title: `${finding.title} sur ${host}`, severity: finding.severity, reason: `${finding.detail} Correction proposée : ${finding.fix}`, payload: { incident_id: incident.id, url: site.url, code: finding.code, score: result.score } });
    await db.from("incidents").update({ recommendation_id: recommendation.id }).eq("id", incident.id);
  }
  // Un contrôle « non vérifié » ne résout rien : seul un contrôle réellement passé ferme l'incident correspondant.
  const verified = new Set(result.checks.filter((check) => check.state !== "unverified").map((check) => check.key));
  const checkOf: Record<string, string> = { ssl_expired: "tls", ssl_expiring: "tls", ssl_hostname: "tls", domain_expired: "domain", domain_expiring: "domain", dns_unresolved: "dns", dns_www_missing: "dns", robots_block_all: "robots", sitemap_missing: "sitemap", broken_pages: "crawl", sitemap_redirects: "crawl", vitals_poor: "vitals", vitals_weak: "vitals", home_not_indexed: "index", pages_not_indexed: "index" };
  for (const code of HEALTH_CODES) {
    const fingerprint = healthFingerprint(site.id, code);
    if (!open.has(fingerprint) && verified.has(checkOf[code])) summary.resolved += await resolveIncident(ACTOR, fingerprint);
  }
  return summary;
}

async function gather(db: SupabaseClient, site: { id: string; url: string }, now: Date): Promise<HealthInput> {
  const home = new URL(site.url);
  const host = home.hostname;
  const domain = registrableDomain(host);
  const [certificate, dnsResult, rdap, robots, audit] = await Promise.all([
    home.protocol === "https:" ? readCertificate(host) : Promise.resolve(null),
    readDns(host),
    domain ? readRdap(domain) : Promise.resolve(undefined),
    fetchSitePage(new URL("/robots.txt", home).toString(), 200_000),
    db.from("performance_audits").select("field").eq("client_id", site.id).eq("strategy", "mobile").order("analyzed_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const parsedRobots = robots.status === 200 ? readRobots(robots.body) : { blocksAll: false, sitemaps: [] };
  // Sitemap : déclaré dans robots.txt, sinon /sitemap.xml ; un index est suivi sur son premier sitemap.
  let sitemapUrl: string | null = null, urls: string[] = [];
  for (const candidate of [...parsedRobots.sitemaps, new URL("/sitemap.xml", home).toString()].slice(0, 3)) {
    const page = await fetchSitePage(candidate);
    if (page.status !== 200 || !page.body) continue;
    let parsed = readSitemap(page.body);
    if (parsed.index && parsed.urls[0]) { const child = await fetchSitePage(parsed.urls[0]); parsed = child.status === 200 ? readSitemap(child.body) : { index: false, urls: [] }; }
    if (parsed.urls.length) { sitemapUrl = candidate; urls = parsed.urls; break; }
  }
  const pages = urls.filter((url) => { try { return new URL(url).hostname.replace(/^www\./, "") === host.replace(/^www\./, "") && new URL(url).pathname !== "/"; } catch { return false; } });
  const sample = crawlSample(pages, CRAWL_SAMPLE);
  const crawl: CrawlResult[] = [];
  for (let i = 0; i < sample.length; i += 5) {
    const batch = await Promise.all(sample.slice(i, i + 5).map(async (url) => { const page = await fetchSitePage(url, 300_000); return { url, status: page.status, finalUrl: page.finalUrl }; }));
    crawl.push(...batch);
  }
  const field = (audit.data as { field?: unknown } | null)?.field;
  const vitals: FieldVitals = field && typeof field === "object" ? field as FieldVitals : null;
  return {
    host, homeUrl: site.url, now, certificate, domainExpiry: rdap === undefined ? undefined : rdapExpiration(rdap), dns: dnsResult,
    robots: { status: robots.status, text: robots.status === 200 ? robots.body : null },
    sitemap: { url: sitemapUrl, urls }, crawl, vitals,
    inspections: await inspections(db, site, pages.slice(0, INSPECT_SAMPLE - 1)),
  };
}

async function inspections(db: SupabaseClient, site: { id: string; url: string }, pages: string[]): Promise<InspectionResult[] | null> {
  const property = await clientProperty(db as never, site.id).catch(() => null);
  if (!property) return null;
  const access = await searchConsoleAccess().catch(() => null);
  if (!access) return null;
  const results: InspectionResult[] = [];
  for (const url of [site.url, ...pages]) {
    try { const parsed = readInspection(url, await inspectUrl(property, url, { accessToken: access.accessToken })); if (parsed) results.push(parsed); } catch { /* page non inspectée : non vérifiée */ }
  }
  return results;
}
