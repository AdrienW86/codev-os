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
export type HealthRow = { score: number; findings: unknown; checked_at: string };
/** health : contrôles de santé technique (lot 5) ; null = non installé. */
export function monitoringSignals(checks: readonly SiteCheckRow[], audits: readonly AuditRow[], now: Date, health?: readonly HealthRow[] | null): BriefingSignals {
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
  if (health) {
    const recent = health.filter((row) => withinDays(row.checked_at, now, 10));
    if (recent.length) {
      const problems = recent.reduce((sum, row) => sum + (Array.isArray(row.findings) ? row.findings.filter((f) => f && typeof f === "object" && ["critical", "high"].includes(String((f as { severity?: unknown }).severity))).length : 0), 0);
      facts.push({ statement: `Santé technique : ${plural(recent.length, "site contrôlé", "sites contrôlés")} (certificat, domaine, DNS, sitemap, indexation), ${plural(problems, "problème important", "problèmes importants")}.`, at: latest(recent.map((row) => row.checked_at)) });
    } else gaps.push("Aucun contrôle de santé technique depuis 10 jours.");
  }
  return { facts, gaps };
}

export type LocalRow = { location_title: string | null; metrics: unknown; reviews: unknown; fetched_at: string };
/** Référencement local (lot 6) : dernier relevé de chaque fiche Google ; null = non installé. */
export function localSignals(rows: readonly LocalRow[] | null): BriefingSignals {
  if (!rows) return { facts: [], gaps: [] };
  if (!rows.length) return { facts: [], gaps: ["Aucune statistique de fiche Google relevée (fiche non connectée ou relevé en attente)."] };
  const facts: BriefingFact[] = [];
  const latestRow = rows[0];
  const m = (latestRow.metrics ?? {}) as Record<string, unknown>, r = (latestRow.reviews ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const parts = [n(m.calls) !== null ? `${n(m.calls)} appels` : null, n(m.websiteClicks) !== null ? `${n(m.websiteClicks)} clics vers le site` : null, n(m.directions) !== null ? `${n(m.directions)} itinéraires` : null].filter(Boolean);
  if (parts.length) facts.push({ statement: `Fiche Google${latestRow.location_title ? ` « ${clean(latestRow.location_title, 50)} »` : ""} (28 jours) : ${parts.join(", ")}.`, at: latestRow.fetched_at });
  const recent = Array.isArray(r.recent) ? r.recent as Record<string, unknown>[] : [];
  const unanswered = recent.filter((x) => x && x.replied === false).length;
  if (n(r.average) !== null || n(r.total) !== null) facts.push({ statement: `Avis Google : ${n(r.average) !== null ? `${String(n(r.average)).replace(".", ",")}/5` : "note non communiquée"}${n(r.total) !== null ? ` sur ${n(r.total)} avis` : ""}${unanswered ? `, ${unanswered} récent(s) sans réponse` : ""}.`, at: latestRow.fetched_at });
  return { facts, gaps: [] };
}

export type CompetitionRow = { metric_key: string; fetched_at: string; data: unknown };
/** Concurrence locale (lot 7) : dernier relevé par source (metric_snapshots local-competition) ; null = illisible. */
export function competitionSignals(rows: readonly CompetitionRow[] | null): BriefingSignals {
  if (!rows) return { facts: [], gaps: [] };
  const facts: BriefingFact[] = [];
  for (const key of ["dataforseo-maps", "google-places"]) {
    const row = rows.find((item) => item.metric_key === key);
    const d = (row?.data ?? null) as Record<string, unknown> | null;
    if (!row || !d || typeof d.keyword !== "string") continue;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const own = (d.client ?? {}) as Record<string, unknown>;
    const label = key === "dataforseo-maps" ? "position Google Maps" : "rang indicatif Google Places";
    const rank = n(d.rank);
    const reviews = n(own.reviews) !== null && n(d.medianReviews) !== null ? `, ${n(own.reviews)} avis contre ${String(n(d.medianReviews)).replace(".", ",")} en médiane chez les 5 premiers concurrents` : "";
    facts.push({ statement: `Recherche locale « ${clean(d.keyword, 60)} » (${label}) : ${rank !== null ? `${rank}e place` : `absente des ${n(d.depth) ?? 20} premiers résultats`}${reviews}.`, at: row.fetched_at });
  }
  return { facts, gaps: facts.length ? [] : ["Concurrence locale non relevée (clé Google Places ou DataForSEO absente, ou client sans métier et ville)."] };
}

/** Carte de positions Google Maps (lot 7) : dernière grille de chaque recherche suivie. */
export function geogridSignals(rows: readonly CompetitionRow[] | null): BriefingFact[] {
  if (!rows) return [];
  const seen = new Set<string>();
  const facts: BriefingFact[] = [];
  for (const row of rows) {
    if (seen.has(row.metric_key) || facts.length >= 3) continue;
    seen.add(row.metric_key);
    const d = (row.data ?? null) as Record<string, unknown> | null;
    if (!d || typeof d.keyword !== "string" || !Array.isArray(d.cells)) continue;
    const failed = Array.isArray(d.failed) ? d.failed.length : 0, measured = d.cells.length - failed;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    facts.push({ statement: `Carte Google Maps « ${clean(d.keyword, 60)} » : top 3 sur ${n(d.top3) ?? 0} point(s) sur ${measured}, présente sur ${n(d.found) ?? 0}${n(d.average) !== null ? `, position moyenne ${String(n(d.average)).replace(".", ",")}` : ""}.`, at: row.fetched_at });
  }
  return facts;
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

export type ProspectingMessageRow = { state: string; sent_at: string | null; replied_at?: string | null; created_at: string };
/** Agent Envoi prospection : envois, réponses et file d'attente sur 30 jours. */
export function prospectingEmailSignals(rows: readonly ProspectingMessageRow[] | null, now: Date): BriefingSignals {
  if (rows === null) return { facts: [], gaps: ["Envoi de prospection non installé (migration 20261220000000)."] };
  const sent = rows.filter((row) => row.state === "sent" && withinDays(row.sent_at, now, 30));
  const queued = rows.filter((row) => row.state === "approved").length;
  if (!sent.length && !queued) return { facts: [], gaps: ["Aucun e-mail de prospection envoyé ni approuvé sur 30 jours."] };
  const replies = sent.filter((row) => row.replied_at).length;
  return { facts: [{ statement: `${plural(sent.length, "e-mail envoyé", "e-mails envoyés")} sur 30 jours, ${plural(replies, "réponse", "réponses")}${queued ? `, ${queued} en file` : ""}.`, at: latest(sent.map((row) => row.sent_at)), href: "/acquisition" }], gaps: [] };
}

export type GoogleReviewRow = { status: string; rating: number | null; first_seen_at: string; published_at: string | null };
/** Agent Avis Google : nouveaux avis, réponses publiées, à valider et avis négatifs encore ouverts (30 jours). */
export function googleReviewSignals(rows: readonly GoogleReviewRow[] | null, now: Date): BriefingSignals {
  if (rows === null) return { facts: [], gaps: ["Agent Avis Google non installé (migration 20261224010000)."] };
  const recent = rows.filter((row) => withinDays(row.first_seen_at, now, 30));
  const published = rows.filter((row) => row.status === "published" && withinDays(row.published_at, now, 30)).length;
  const toValidate = rows.filter((row) => row.status === "draft").length;
  const negative = rows.filter((row) => ["to_draft", "draft", "failed", "publishing"].includes(row.status) && row.rating !== null && row.rating <= 3).length;
  if (!recent.length && !published && !toValidate) return { facts: [], gaps: ["Aucun nouvel avis Google relevé sur 30 jours (fiche non connectée ou aucun avis)."] };
  const facts: BriefingFact[] = [{ statement: `${plural(recent.length, "nouvel avis Google", "nouveaux avis Google")} sur 30 jours, ${plural(published, "réponse publiée", "réponses publiées")}${toValidate ? `, ${toValidate} à valider` : ""}.`, at: latest([...recent.map((row) => row.first_seen_at), ...rows.map((row) => row.published_at)]), href: "/avis" }];
  if (negative) facts.push({ statement: `${plural(negative, "avis négatif", "avis négatifs")} sans réponse publiée.`, at: latest(rows.map((row) => row.first_seen_at)), href: "/avis" });
  return { facts, gaps: [] };
}

/** Agent Rédacteur prospection : brouillons personnalisés écrits ou repliés sur le modèle (30 jours). */
export function prospectingWriterSignals(rows: readonly { draft_source: string; created_at: string }[] | null, now: Date): BriefingSignals {
  if (rows === null) return { facts: [], gaps: ["Rédaction personnalisée non installée (migration 20261220000000)."] };
  const recent = rows.filter((row) => withinDays(row.created_at, now, 30));
  const written = recent.filter((row) => row.draft_source === "ai").length, pending = recent.filter((row) => row.draft_source === "ai_pending").length;
  if (!written && !pending) return { facts: [], gaps: ["Aucun brouillon personnalisé sur 30 jours."] };
  return { facts: [{ statement: `${plural(written, "brouillon personnalisé", "brouillons personnalisés")} sur 30 jours${pending ? `, ${pending} en cours` : ""}.`, at: latest(recent.map((row) => row.created_at)), href: "/acquisition" }], gaps: [] };
}

export type IncidentRow = { status: string; detected_at: string };
export function directorSignals(rows: readonly IncidentRow[]): BriefingSignals {
  const open = rows.filter((row) => row.status !== "resolved");
  return open.length
    ? { facts: [{ statement: `${plural(open.length, "écart ouvert", "écarts ouverts")} par le contrôle quotidien des clients.`, at: latest(open.map((row) => row.detected_at)), href: "/agents" }], gaps: [] }
    : { facts: [], gaps: [] };
}
