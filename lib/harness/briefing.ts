// Point de situation de chaque agent : un format commun (constats datés, manques, état) que le Directeur et le
// Rapport lisent pour TOUS les agents de la charte. Fonctions pures : aucune lecture, aucun appel externe.
// Règle : un constat vient toujours d'une ligne enregistrée et porte sa date ; une donnée absente devient un manque,
// jamais un « tout va bien ».
import type { HarnessAgentId, HarnessCharter, HarnessTeam } from "./charter";
import type { AgentHealth, HealthState } from "./health";

export type BriefingFact = { statement: string; at: string | null; href?: string };
export type BriefingSignals = { facts: BriefingFact[]; gaps: string[] };
export type BriefingState = HealthState | "unavailable";
export type AgentBriefing = {
  agent: HarnessAgentId; name: string; team: HarnessTeam; mission: string;
  state: BriefingState; health: string[]; facts: BriefingFact[]; gaps: string[];
  lastActivityAt: string | null; stale: boolean;
};

const DAY = 86_400_000;
/** Au-delà de ce délai sans constat, un agent planifié est signalé « sans activité récente ». */
export const BRIEFING_STALE_DAYS = 14;

export const briefingStateLabels: Record<BriefingState, string> = {
  ok: "Opérationnel", attention: "À vérifier", failed: "En échec", off: "En pause", manual: "À la demande", unavailable: "Point de situation illisible",
};

const validTime = (value: string | null | undefined): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const latest = (values: (string | null | undefined)[]) => values.filter(validTime).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
const ageDays = (at: string, now: Date) => (now.getTime() - Date.parse(at)) / DAY;
export const withinDays = (at: string | null | undefined, now: Date, days: number) => validTime(at) && ageDays(at, now) <= days && ageDays(at, now) >= -1;
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
const clean = (value: string, max = 160) => value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

/**
 * Assemble le point de situation d'un agent. signals = null : la lecture de ses données a échoué ; l'état devient
 * « illisible » (jamais « opérationnel » par défaut).
 */
export function buildAgentBriefing(charter: HarnessCharter, health: AgentHealth, signals: BriefingSignals | null, now: Date): AgentBriefing {
  const facts = (signals?.facts ?? []).slice(0, 8).map((fact) => ({ ...fact, statement: clean(fact.statement, 240) }));
  const gaps = [...new Set((signals?.gaps ?? []).map((gap) => clean(gap, 240)))].slice(0, 6);
  if (!signals) gaps.unshift("Lecture des données de l’agent impossible : aucun constat ne peut être affirmé.");
  const lastActivityAt = latest(facts.map((fact) => fact.at));
  const scheduled = charter.triggers.some((trigger) => trigger.kind !== "manual");
  const stale = scheduled && health.state !== "off" && (!lastActivityAt || ageDays(lastActivityAt, now) > BRIEFING_STALE_DAYS);
  if (stale) gaps.push(lastActivityAt ? `Aucun constat depuis plus de ${BRIEFING_STALE_DAYS} jours.` : "Aucun constat enregistré.");
  return {
    agent: charter.id, name: charter.name, team: charter.team, mission: charter.mission,
    state: signals ? health.state : "unavailable", health: health.lines.slice(0, 4), facts, gaps, lastActivityAt, stale,
  };
}

/** Agents dont l'état demande l'attention du Directeur, du plus grave au moins grave. */
export function briefingAlerts(briefings: readonly AgentBriefing[]) {
  const rank: Record<BriefingState, number> = { failed: 0, unavailable: 1, attention: 2, off: 3, manual: 4, ok: 5 };
  return briefings.filter((item) => item.state === "failed" || item.state === "unavailable" || item.state === "attention" || item.stale)
    .sort((a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name, "fr"));
}

/** Phrase courte, lisible à voix haute. */
export function briefingsSummary(briefings: readonly AgentBriefing[]) {
  const alerts = briefingAlerts(briefings);
  if (!briefings.length) return "Aucun agent consulté.";
  if (!alerts.length) return `${briefings.length} agents consultés : aucun en échec ni sans activité récente.`;
  return `${briefings.length} agents consultés, ${plural(alerts.length, "à examiner", "à examiner")} : ${alerts.slice(0, 4).map((item) => `${item.name} (${item.stale && item.state === "ok" ? "sans activité récente" : briefingStateLabels[item.state].toLowerCase()})`).join(", ")}${alerts.length > 4 ? "…" : ""}.`;
}

// ---------------------------------------------------------------------------------------------
// Constats par agent, à partir des lignes lues par le service. Chaque fonction reste pure.
// ---------------------------------------------------------------------------------------------

export const platformLabels: Record<string, string> = {
  facebook: "Facebook", instagram: "Instagram", google_business_profile: "Google Business Profile", tiktok: "TikTok", snapchat: "Snapchat",
};
const platformName = (value: string) => platformLabels[value] ?? clean(value, 40);
const byPlatform = (rows: readonly { platform: string }[]) => {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.platform, (counts.get(row.platform) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([platform, n]) => `${platformName(platform)} ${n}`).join(", ");
};

export type DeliveryRow = { platform: string; status: string; scheduled_for: string; published_at: string | null };
export type PostStatsRow = { platform: string; status: string; metrics: unknown; fetched_at: string };
const statCount = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0);
/** stats : relevés des posts (lot 3) ; undefined ou null = relevé non installé ou illisible (manque, jamais zéro). */
export function publicationsSignals(rows: readonly DeliveryRow[], now: Date, stats?: readonly PostStatsRow[] | null): BriefingSignals {
  const published = rows.filter((row) => row.status === "published" && withinDays(row.published_at ?? row.scheduled_for, now, 30));
  const upcoming = rows.filter((row) => row.status === "scheduled" && Date.parse(row.scheduled_for) >= now.getTime() && Date.parse(row.scheduled_for) - now.getTime() <= 14 * DAY);
  const failing = rows.filter((row) => ["failed", "blocked", "uncertain", "retryable_error"].includes(row.status) && withinDays(row.scheduled_for, now, 30));
  const facts: BriefingFact[] = [];
  if (published.length) facts.push({ statement: `${plural(published.length, "publication diffusée", "publications diffusées")} sur 30 jours (${byPlatform(published)}).`, at: latest(published.map((row) => row.published_at ?? row.scheduled_for)), href: "/publications" });
  if (upcoming.length) facts.push({ statement: `${plural(upcoming.length, "diffusion programmée", "diffusions programmées")} dans les 14 jours (${byPlatform(upcoming)}).`, at: latest(upcoming.map((row) => row.scheduled_for)), href: "/publications" });
  if (failing.length) facts.push({ statement: `${plural(failing.length, "diffusion en échec ou bloquée", "diffusions en échec ou bloquées")} sur 30 jours (${byPlatform(failing)}).`, at: latest(failing.map((row) => row.scheduled_for)), href: "/publications" });
  const gaps: string[] = [];
  if (!upcoming.length) gaps.push("Aucune diffusion programmée dans les 14 prochains jours.");
  if (!stats) gaps.push("Statistiques des publications (portée, interactions, clics) non récupérées.");
  else {
    const ok = stats.filter((row) => row.status === "ok" && withinDays(row.fetched_at, now, 30));
    const networks = [...new Set(ok.map((row) => row.platform))].sort();
    if (networks.length) facts.push({ statement: `Interactions relevées (30 jours) : ${networks.map((key) => {
      const own = ok.filter((row) => row.platform === key);
      const total = own.reduce((sum, row) => { const m = (row.metrics ?? {}) as Record<string, unknown>; return sum + statCount(m.reactions ?? m.likes) + statCount(m.comments) + statCount(m.shares); }, 0);
      return `${platformName(key)} ${total} sur ${plural(own.length, "post", "posts")}`;
    }).join(", ")}.`, at: latest(ok.map((row) => row.fetched_at)), href: "/publications" });
    const unsupported = [...new Set(stats.filter((row) => row.status === "unsupported").map((row) => platformName(row.platform)))].sort();
    if (unsupported.length) gaps.push(`Pas de statistiques par post fournies par ${unsupported.join(", ")} avec les accès actuels.`);
    if (stats.some((row) => row.status === "error" && withinDays(row.fetched_at, now, 7))) gaps.push("Certains relevés de statistiques ont échoué cette semaine (connexion ou autorisation à vérifier).");
    gaps.push("Portée et impressions non relevées (autorisations Meta de statistiques non demandées).");
  }
  return { facts, gaps };
}

export type GeneratedImageRow = { status: string; created_at: string; decided_at: string | null };
/** Agent Photo : propositions d'images générées (toutes soumises à la validation de l'administrateur). */
export function photoSignals(rows: readonly GeneratedImageRow[] | null, now: Date): BriefingSignals {
  if (!rows) return { facts: [], gaps: ["Agent Photo non installé (migration 20261214000000 non appliquée)."] };
  const recent = rows.filter((row) => withinDays(row.created_at, now, 30));
  const pending = rows.filter((row) => row.status === "pending_review");
  const approved = recent.filter((row) => row.status === "approved");
  const rejected = recent.filter((row) => row.status === "rejected");
  const failed = recent.filter((row) => row.status === "attach_failed");
  const skipped = recent.filter((row) => row.status === "skipped");
  const facts: BriefingFact[] = [];
  if (pending.length) facts.push({ statement: `${plural(pending.length, "image générée attend", "images générées attendent")} ta validation.`, at: latest(pending.map((row) => row.created_at)), href: "/publications/images" });
  if (approved.length || rejected.length) facts.push({ statement: `Sur 30 jours : ${plural(approved.length, "image validée", "images validées")}, ${plural(rejected.length, "refusée", "refusées")}.`, at: latest([...approved, ...rejected].map((row) => row.decided_at ?? row.created_at)), href: "/publications/images" });
  if (skipped.length) facts.push({ statement: `${plural(skipped.length, "préparation jugée impossible à illustrer", "préparations jugées impossibles à illustrer")} sans inventer (30 jours).`, at: latest(skipped.map((row) => row.created_at)) });
  if (failed.length) facts.push({ statement: `${plural(failed.length, "image validée n’a pas pu être attachée", "images validées n’ont pas pu être attachées")} (30 jours).`, at: latest(failed.map((row) => row.decided_at ?? row.created_at)), href: "/publications/images" });
  return { facts, gaps: facts.length ? [] : ["Aucune préparation sans photo sur 30 jours : aucune image proposée."] };
}

export type CoherenceRow = { coherent: boolean; checked_at: string };
/** Agent Contrôle et diffusion : verdicts de cohérence texte / image (la diffusion est lue par l'agent Rédacteur). */
export function coherenceSignals(rows: readonly CoherenceRow[] | null, now: Date): BriefingSignals {
  if (!rows) return { facts: [], gaps: ["Contrôle de cohérence non installé (migration 20261214000000 non appliquée) : la validation automatique se fait sans lui."] };
  const recent = rows.filter((row) => withinDays(row.checked_at, now, 30));
  const incoherent = recent.filter((row) => !row.coherent);
  if (!recent.length) return { facts: [], gaps: ["Aucun contrôle de cohérence sur 30 jours."] };
  const facts: BriefingFact[] = [{ statement: `${plural(recent.length, "publication contrôlée", "publications contrôlées")} sur 30 jours, ${plural(incoherent.length, "jugée incohérente", "jugées incohérentes")} (laissées à ta validation).`, at: latest(recent.map((row) => row.checked_at)), href: "/publications/review" }];
  return { facts, gaps: [] };
}

export type BlogRow = { status: string; publish_at: string | null; published_at: string | null; title: string };
export function blogSignals(rows: readonly BlogRow[], now: Date): BriefingSignals {
  const published = rows.filter((row) => row.status === "published" && withinDays(row.published_at, now, 30));
  const scheduled = rows.filter((row) => row.status === "scheduled" && validTime(row.publish_at) && Date.parse(row.publish_at) >= now.getTime());
  const facts: BriefingFact[] = [];
  if (published.length) facts.push({ statement: `${plural(published.length, "article publié", "articles publiés")} sur 30 jours, dernier : « ${clean(published.sort((a, b) => Date.parse(b.published_at!) - Date.parse(a.published_at!))[0].title, 90)} ».`, at: latest(published.map((row) => row.published_at)), href: "/blog" });
  if (scheduled.length) facts.push({ statement: `${plural(scheduled.length, "article programmé", "articles programmés")}.`, at: latest(scheduled.map((row) => row.publish_at)), href: "/blog" });
  return { facts, gaps: published.length || scheduled.length ? [] : ["Aucun article publié ni programmé sur 30 jours."] };
}

export type VisualRow = { enabled: boolean; per_week: number | null; last_generated_at: string | null };
export function visualSignals(rows: readonly VisualRow[]): BriefingSignals {
  const enabled = rows.filter((row) => row.enabled);
  if (!enabled.length) return { facts: [], gaps: ["Agent non activé pour ce périmètre."] };
  const last = latest(enabled.map((row) => row.last_generated_at));
  return { facts: [{ statement: `Activé pour ${plural(enabled.length, "client", "clients")}${last ? ", dernier visuel produit" : ", aucun visuel produit à ce jour"}.`, at: last }], gaps: [] };
}

export function countSignals(rows: readonly { at: string | null }[], now: Date, label: { one: string; many: string; href?: string; empty: string }): BriefingSignals {
  const recent = rows.filter((row) => withinDays(row.at, now, 30));
  return recent.length
    ? { facts: [{ statement: `${plural(recent.length, label.one, label.many)} sur 30 jours.`, at: latest(recent.map((row) => row.at)), href: label.href }], gaps: [] }
    : { facts: [], gaps: [label.empty] };
}

export type SnapshotRow = { provider: string; metric_key: string; period_end: string | null; fetched_at: string; data: unknown };
const providerNames: Record<string, string> = { "search-console": "Search Console", "google-analytics": "Google Analytics 4", pagespeed: "PageSpeed", "google-ads": "Google Ads", vercel: "Vercel Analytics" };
export function snapshotSignals(rows: readonly SnapshotRow[], providers: readonly string[], now: Date): BriefingSignals {
  const facts: BriefingFact[] = [];
  const gaps: string[] = [];
  for (const provider of providers) {
    const own = rows.filter((row) => row.provider === provider);
    const last = latest(own.map((row) => row.fetched_at));
    if (!last) { gaps.push(`${providerNames[provider] ?? provider} : aucune donnée enregistrée.`); continue; }
    const row = own.find((item) => item.fetched_at === last)!;
    facts.push({ statement: `${providerNames[provider] ?? provider} : dernière donnée relevée${row.period_end ? ` (période close le ${row.period_end})` : ""}.`, at: last });
    if (!withinDays(last, now, 10)) gaps.push(`${providerNames[provider] ?? provider} : donnée de plus de 10 jours.`);
  }
  return { facts, gaps };
}

export type SiteCheckRow = { ok: boolean; checked_at: string };
export type AuditRow = { strategy: string; scores: unknown; analyzed_at: string };
export function monitoringSignals(checks: readonly SiteCheckRow[], audits: readonly AuditRow[], now: Date): BriefingSignals {
  const facts: BriefingFact[] = [];
  const gaps: string[] = [];
  const week = checks.filter((row) => withinDays(row.checked_at, now, 7));
  if (week.length) {
    const uptime = Math.round(week.filter((row) => row.ok).length / week.length * 1000) / 10;
    facts.push({ statement: `Disponibilité ${String(uptime).replace(".", ",")} % sur ${week.length} contrôles (7 jours).`, at: latest(week.map((row) => row.checked_at)) });
  } else gaps.push("Aucun contrôle de disponibilité sur 7 jours.");
  const lastAudit = latest(audits.map((row) => row.analyzed_at));
  if (lastAudit) {
    const row = audits.find((item) => item.analyzed_at === lastAudit)!;
    const scores = row.scores && typeof row.scores === "object" ? row.scores as Record<string, unknown> : {};
    const perf = typeof scores.performance === "number" ? ` performance ${Math.round(scores.performance)}/100` : "";
    facts.push({ statement: `Dernier audit Lighthouse (${row.strategy === "desktop" ? "ordinateur" : "mobile"})${perf ? " :" + perf : ""}.`, at: lastAudit, href: "/performance" });
    if (!withinDays(lastAudit, now, 10)) gaps.push("Audit Lighthouse de plus de 10 jours.");
  } else gaps.push("Aucun audit Lighthouse enregistré.");
  return { facts, gaps };
}

export type ReportRow = { status: string; kind: string; created_at: string };
export function reportSignals(rows: readonly ReportRow[], now: Date): BriefingSignals {
  const recent = rows.filter((row) => withinDays(row.created_at, now, 35));
  const toReview = rows.filter((row) => row.status === "ready_for_review");
  const facts: BriefingFact[] = [];
  if (recent.length) facts.push({ statement: `${plural(recent.length, "rapport généré", "rapports générés")} sur 35 jours.`, at: latest(recent.map((row) => row.created_at)), href: "/reports" });
  if (toReview.length) facts.push({ statement: `${plural(toReview.length, "rapport attend", "rapports attendent")} une relecture.`, at: latest(toReview.map((row) => row.created_at)), href: "/reports" });
  return { facts, gaps: recent.length ? [] : ["Aucun rapport généré sur 35 jours."] };
}

export type NewsletterRow = { status: string; created_at: string; sent_at: string | null; sent_count: number | null };
export function newsletterSignals(rows: readonly NewsletterRow[], now: Date): BriefingSignals {
  const sent = rows.filter((row) => withinDays(row.sent_at, now, 60));
  const drafts = rows.filter((row) => row.status === "draft" || row.status === "approved");
  const facts: BriefingFact[] = [];
  if (sent.length) facts.push({ statement: `${plural(sent.length, "newsletter envoyée", "newsletters envoyées")} sur 60 jours (${sent.reduce((sum, row) => sum + (row.sent_count ?? 0), 0)} destinataires).`, at: latest(sent.map((row) => row.sent_at)), href: "/emailing" });
  if (drafts.length) facts.push({ statement: `${plural(drafts.length, "newsletter en attente", "newsletters en attente")} de relecture ou d’envoi.`, at: latest(drafts.map((row) => row.created_at)), href: "/emailing" });
  return { facts, gaps: [] };
}

export type ScoreLogRow = { created_at: string; metadata: unknown };
export function scoreSignals(rows: readonly ScoreLogRow[], key: string, label: string, now: Date): BriefingSignals {
  const scores = rows.filter((row) => withinDays(row.created_at, now, 30)).flatMap((row) => {
    const value = row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>)[key] : null;
    return typeof value === "number" && Number.isFinite(value) ? [{ value, at: row.created_at }] : [];
  });
  if (!scores.length) return { facts: [], gaps: [`Aucune ${label} enregistrée sur 30 jours.`] };
  const average = Math.round(scores.reduce((sum, item) => sum + item.value, 0) / scores.length);
  return { facts: [{ statement: `${label[0].toUpperCase()}${label.slice(1)} moyenne ${average}/100 sur ${plural(scores.length, "texte", "textes")} (30 jours).`, at: latest(scores.map((item) => item.at)) }], gaps: [] };
}

export type ReviewLogRow = { created_at: string; metadata: unknown };
/** Contrôles indépendants : verdicts journalisés par lib/editorial-review/service.ts. */
export function reviewSignals(rows: readonly ReviewLogRow[], check: "fact" | "duplicate", now: Date): BriefingSignals {
  const key = check === "fact" ? "fact_passed" : "duplicate_passed";
  const verdicts = rows.filter((row) => withinDays(row.created_at, now, 30)).flatMap((row) => {
    const value = row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>)[key] : undefined;
    return typeof value === "boolean" ? [{ passed: value, at: row.created_at }] : [];
  });
  if (!verdicts.length) return { facts: [], gaps: ["Aucun contrôle journalisé sur 30 jours."] };
  const refused = verdicts.filter((item) => !item.passed).length;
  return { facts: [{ statement: `${plural(verdicts.length, "texte contrôlé", "textes contrôlés")} sur 30 jours, ${plural(refused, "refusé", "refusés")}.`, at: latest(verdicts.map((item) => item.at)) }], gaps: [] };
}

export type DiscoveryRow = { status: string; found_count: number | null; finished_at: string | null; created_at: string };
export function prospectionSignals(rows: readonly DiscoveryRow[], now: Date): BriefingSignals {
  const recent = rows.filter((row) => withinDays(row.finished_at ?? row.created_at, now, 30));
  if (!recent.length) return { facts: [], gaps: ["Aucun balayage de zone sur 30 jours."] };
  const found = recent.reduce((sum, row) => sum + (row.found_count ?? 0), 0);
  const failed = recent.filter((row) => row.status === "failed").length;
  return { facts: [{ statement: `${plural(recent.length, "balayage", "balayages")} sur 30 jours, ${plural(found, "entreprise trouvée", "entreprises trouvées")}${failed ? `, ${failed} en échec` : ""}.`, at: latest(recent.map((row) => row.finished_at ?? row.created_at)), href: "/acquisition" }], gaps: [] };
}

export type IncidentRow = { status: string; detected_at: string };
export function directorSignals(rows: readonly IncidentRow[]): BriefingSignals {
  const open = rows.filter((row) => row.status !== "resolved");
  return open.length
    ? { facts: [{ statement: `${plural(open.length, "écart ouvert", "écarts ouverts")} par le contrôle quotidien des clients.`, at: latest(open.map((row) => row.detected_at)), href: "/agents" }], gaps: [] }
    : { facts: [], gaps: [] };
}
