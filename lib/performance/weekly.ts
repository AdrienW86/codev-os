import "server-only";
// Audit Lighthouse hebdomadaire des sites clients, porté par l'Agent Monitoring (étape « lighthouse » du planificateur).
// Chaque nuit (1 h – 6 h, heure de Paris), au plus un site dû par passage : audit mobile et ordinateur via le moteur
// CODE-V Performance (performance, accessibilité, bonnes pratiques, SEO), archivé dans performance_audits comme les
// audits manuels de /performance. Score faible ou baisse nette → incident dédoublonné, résolu automatiquement au
// retour à la normale. Aucun correctif n'est appliqué aux sites.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import { clientContextDenied, getAgentByType, openIncident, recordRecommendation, resolveIncident } from "@/lib/agents/outputs";
import { siteUrl } from "@/lib/monitoring/evaluate";
import { EngineError, engineConfig, runEngineAudit, saveAudit, type EngineReport } from "@/lib/performance/engine";
import {
  BASELINE_AUDITS, BASELINE_DAYS, STRATEGIES, allFingerprints, auditDue, auditOrder, evaluateAudit, findingFingerprint, findingTitle,
  inAuditWindow, readScores, strategyLabel, topOpportunities, type Strategy,
} from "@/lib/performance/weekly-model";

const ACTOR: Actor = { kind: "system", worker: "lighthouse-weekly" };
const FAILURE_ACTION = "performance.weekly_audit_failed";
/** Un audit du moteur prend de 15 à 45 s ; mobile et ordinateur sont lancés en parallèle. */
const AUDIT_TIMEOUT_MS = 55_000;

export type LighthouseTickSummary = { disabled?: true; outside_window?: 1; audited: number; failed: number; pending: number; alerts: number; resolved: number };

/** options.clientId : lancement manuel par l'administrateur pour ce client seulement, hors fenêtre de nuit et sans attendre l'échéance. */
export async function runLighthouseTick(now = new Date(), options: { clientId?: string } = {}): Promise<LighthouseTickSummary> {
  const summary: LighthouseTickSummary = { audited: 0, failed: 0, pending: 0, alerts: 0, resolved: 0 };
  if (!engineConfig().ok) return { ...summary, disabled: true };
  if (!options.clientId && !inAuditWindow(now)) return { ...summary, outside_window: 1 };
  const agent = await getAgentByType("monitoring");
  if (!agent || !agent.enabled || agent.status !== "Actif") return { ...summary, disabled: true };

  const db = getSupabaseServerClient();
  const { data: clients, error } = await db.from("clients").select("id,name,website").limit(500);
  if (error) throw new Error("clients read");
  const sites = (clients ?? []).filter((client) => !options.clientId || client.id === options.clientId).flatMap((client) => { const url = siteUrl(client.website); return url ? [{ id: client.id, name: client.name, url }] : []; });
  if (!sites.length) return summary;
  const ids = sites.map((site) => site.id);
  const since = new Date(now.getTime() - 8 * 86_400_000).toISOString();
  const [audits, failures] = await Promise.all([
    db.from("performance_audits").select("client_id,analyzed_at").eq("strategy", "mobile").in("client_id", ids).gte("analyzed_at", since).order("analyzed_at", { ascending: false }).limit(1000),
    db.from("audit_logs").select("resource_id,created_at").eq("action", FAILURE_ACTION).eq("resource_type", "client").gte("created_at", since).order("created_at", { ascending: false }).limit(500),
  ]);
  if (audits.error) throw new Error("performance audits read");
  if (failures.error) throw new Error("audit logs read");
  const lastAudit = new Map<string, string>(), lastFailure = new Map<string, string>();
  for (const row of audits.data ?? []) if (row.client_id && !lastAudit.has(row.client_id)) lastAudit.set(row.client_id, row.analyzed_at);
  for (const row of failures.data ?? []) if (row.resource_id && !lastFailure.has(row.resource_id)) lastFailure.set(row.resource_id, row.created_at);
  const due = auditOrder(sites.map((site) => ({ ...site, lastAuditAt: lastAudit.get(site.id) ?? null, lastFailureAt: lastFailure.get(site.id) ?? null }))
    .filter((site) => Boolean(options.clientId) || auditDue(site, now)));
  if (!due.length) return summary;
  // Un site par passage : le passage reste borné (pire cas ≈ 55 s) et les autres étapes ne sont pas retardées.
  const [site] = due;
  summary.pending = due.length - 1;
  const results = await Promise.allSettled(STRATEGIES.map((strategy) => runEngineAudit({ url: site.url, strategy }, { timeoutMs: AUDIT_TIMEOUT_MS })));
  const reports = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  if (!reports.length) {
    summary.failed++;
    const reason = results.find((result): result is PromiseRejectedResult => result.status === "rejected")?.reason;
    await writeAudit(ACTOR, { action: FAILURE_ACTION, resource_type: "client", resource_id: site.id, metadata: { kind: reason instanceof EngineError ? reason.kind : "internal", status: reason instanceof EngineError ? reason.status : null } });
    return summary;
  }
  const canRecommend = (await clientContextDenied(agent, site.id)) === null;
  for (const report of reports) {
    if (!await saveAudit(db, site.id, report)) throw new Error("performance audit write");
    summary.audited++;
    const outcome = await evaluateReport(db, agent.id, canRecommend, site, report);
    summary.alerts += outcome.alerts;
    summary.resolved += outcome.resolved;
  }
  return summary;
}

async function evaluateReport(db: ReturnType<typeof getSupabaseServerClient>, agentId: string, canRecommend: boolean, site: { id: string; name: string; url: string }, report: EngineReport) {
  const strategy: Strategy = report.strategy === "desktop" ? "desktop" : "mobile";
  const since = new Date(Date.parse(report.analyzedAt) - BASELINE_DAYS * 86_400_000).toISOString();
  const { data, error } = await db.from("performance_audits").select("scores,analyzed_at").eq("client_id", site.id).eq("strategy", strategy)
    .lt("analyzed_at", report.analyzedAt).gte("analyzed_at", since).order("analyzed_at", { ascending: false }).limit(BASELINE_AUDITS);
  if (error) throw new Error("performance history read");
  const findings = evaluateAudit(readScores(report.scores), (data ?? []).map((row) => readScores(row.scores)));
  const host = (() => { try { return new URL(report.url).hostname; } catch { return site.url; } })();
  const opportunities = topOpportunities(report.opportunities);
  const open = new Set<string>();
  let alerts = 0, resolved = 0;
  for (const finding of findings) {
    const fingerprint = findingFingerprint(site.id, strategy, finding.category, finding.kind);
    open.add(fingerprint);
    const title = findingTitle(host, strategy, finding);
    const incident = await openIncident(ACTOR, {
      clientId: site.id, agentId, source: "monitoring", severity: finding.severity, title, fingerprint,
      details: { url: report.url, strategy, category: finding.category, kind: finding.kind, score: finding.score, baseline: finding.baseline, analyzed_at: report.analyzedAt, opportunities, source: "Lighthouse (CODE-V Performance)" },
    });
    if (!incident.created) continue;
    alerts++;
    if (!canRecommend) continue;
    const measured = finding.kind === "low" ? `Score Lighthouse ${finding.label} ${strategyLabel[strategy]} : ${finding.score}/100.` : `Score Lighthouse ${finding.label} ${strategyLabel[strategy]} passé de ${finding.baseline} (médiane des audits précédents) à ${finding.score}/100.`;
    const recommendation = await recordRecommendation(ACTOR, {
      agentId, clientId: site.id, title, severity: finding.severity,
      reason: `${measured}${opportunities.length ? ` Pistes relevées par Lighthouse : ${opportunities.join(" ; ")}.` : ""} Vérifier le dernier déploiement puis corriger ; audit détaillé dans Performance.`,
      payload: { incident_id: incident.id, url: report.url, strategy, category: finding.category, kind: finding.kind, score: finding.score, baseline: finding.baseline },
    });
    await db.from("incidents").update({ recommendation_id: recommendation.id }).eq("id", incident.id);
  }
  for (const fingerprint of allFingerprints(site.id, strategy)) if (!open.has(fingerprint)) resolved += await resolveIncident(ACTOR, fingerprint);
  return { alerts, resolved };
}
