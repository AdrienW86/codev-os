// Construction déterministe des rapports (aucune IA requise) :
// - version interne détaillée (pilotage) ;
// - version client concise (partageable, sans détail technique interne).
// Fonctions pures : testables sans base ni réseau.

import type { ReportKind } from "@/lib/supabase/core.types";

/** Rapports récurrents (période close). Les rapports Google Ads ont leur propre construction (google-ads.ts). */
export type RecurringReportKind = "weekly" | "monthly";
export type Period = { start: string; end: string };

const fmt = (date: Date) => date.toISOString().slice(0, 10);

/** Période close précédente : semaine lundi→dimanche, ou mois civil, relative à `today` (AAAA-MM-JJ). */
export function previousPeriod(kind: RecurringReportKind, today: string): Period {
  const date = new Date(`${today}T00:00:00Z`);
  if (kind === "weekly") {
    const monday = new Date(date);
    monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) - 7);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return { start: fmt(monday), end: fmt(sunday) };
  }
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 0));
  return { start: fmt(start), end: fmt(end) };
}

export type ReportInput = {
  client: { id: string; name: string } | null;
  period: Period;
  projects: { name: string; status: string; progress: number }[];
  tasks: { title: string; status: string; priority: string; due_date: string | null; completed_at: string | null; created_at: string }[];
  publications: { subject: string; status: string; updated_at: string; target_date: string | null }[];
  recommendations: { title: string; status: string; severity: string; created_at: string }[];
  actions: { label: string; status: string; created_at: string; executed_at: string | null }[];
  incidents: { title: string; status: string; severity: string; detected_at: string; resolved_at: string | null }[];
  runs: { agent: string; status: string; started_at: string }[];
  siteChecks: { ok: boolean; response_ms: number | null; checked_at: string }[];
  metrics: { provider: string; metric_key: string; period_start?: string; period_end?: string; data: Record<string, unknown> }[];
  /** Historique quotidien Google Search Console de la propriété du client (période + période précédente de même durée). */
  searchConsole?: { property: string; days: { date: string; clicks: number; impressions: number; position: number | null }[] } | null;
};

export type ReportSection = { title: string; lines: string[] };
export type ReportContent = { summary: string; highlights: string[]; sections: ReportSection[]; empty: boolean };

const inPeriod = (value: string | null | undefined, period: Period) => Boolean(value) && value!.slice(0, 10) >= period.start && value!.slice(0, 10) <= period.end;
const plural = (count: number, singular: string, pluralForm: string) => `${count} ${count > 1 ? pluralForm : singular}`;
const frDate = (value: string) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));

const dayMs = 86_400_000;
const shiftDay = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * dayMs).toISOString().slice(0, 10);
const nf = (value: number, digits = 0) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value).replace(/\u202f|\u00a0/g, " ");

/**
 * Lignes Search Console d'un rapport, calculées sur l'historique quotidien : CTR = clics ÷ impressions, position moyenne
 * pondérée par les impressions. La comparaison n'est affichée que si la période précédente est entièrement synchronisée ;
 * une période partiellement disponible (retard Google ~3 jours) est signalée, jamais extrapolée.
 */
export function searchConsoleReportLines(input: NonNullable<ReportInput["searchConsole"]>, period: Period): string[] {
  const length = Math.round((Date.parse(`${period.end}T00:00:00Z`) - Date.parse(`${period.start}T00:00:00Z`)) / dayMs) + 1;
  const previous = { start: shiftDay(period.start, -length), end: shiftDay(period.start, -1) };
  const totals = (from: string, to: string) => {
    const rows = input.days.filter((row) => row.date >= from && row.date <= to);
    let clicks = 0, impressions = 0, weighted = 0, weight = 0;
    for (const row of rows) {
      clicks += row.clicks; impressions += row.impressions;
      if (row.position !== null && row.impressions > 0) { weighted += row.position * row.impressions; weight += row.impressions; }
    }
    return { days: new Set(rows.map((row) => row.date)).size, last: rows.reduce((max, row) => row.date > max ? row.date : max, ""), clicks, impressions, ctr: impressions ? clicks / impressions : null, position: weight ? weighted / weight : null };
  };
  const now = totals(period.start, period.end);
  if (!now.days) return [];
  const before = totals(previous.start, previous.end);
  const comparable = before.days === length && now.days === length;
  const pct = (a: number, b: number) => b > 0 ? ` (${a >= b ? "+" : "−"}${nf(Math.abs((a - b) / b) * 100)} %)` : "";
  const ctr = now.ctr === null ? "CTR —" : `CTR ${nf(now.ctr * 100, 1)} %${comparable && before.ctr !== null ? ` (${now.ctr >= before.ctr ? "+" : "−"}${nf(Math.abs(now.ctr - before.ctr) * 100, 1)} pt)` : ""}`;
  const position = now.position === null ? null : `position moyenne ${nf(now.position, 1)}${comparable && before.position !== null ? ` (${now.position <= before.position ? "gain" : "perte"} de ${nf(Math.abs(now.position - before.position), 1)} place${Math.abs(now.position - before.position) >= 2 ? "s" : ""})` : ""}`;
  const lines = [`Google Search Console (clics organiques depuis Google) : ${nf(now.clicks)} clics${comparable ? pct(now.clicks, before.clicks) : ""}, ${nf(now.impressions)} impressions${comparable ? pct(now.impressions, before.impressions) : ""}, ${[ctr, position].filter(Boolean).join(", ")}.`];
  if (now.days < length) lines.push(`Search Console : données disponibles sur ${now.days} jour${now.days > 1 ? "s" : ""} sur ${length} (jusqu’au ${frDate(now.last)}), Google publiant ses données avec quelques jours de retard ; comparaison non calculée.`);
  else if (!comparable) lines.push("Search Console : période précédente non synchronisée, comparaison non calculée.");
  return lines;
}

/**
 * Lecture d'account manager senior : à partir des seuls chiffres du rapport, ce qui mérite une action la
 * période suivante, du plus important au moins important. Chaque priorité cite le chiffre qui la justifie ;
 * sans donnée, aucune priorité n'est déduite. `client` : formulation partageable (sans élément interne).
 */
export type ReportPriority = { rank: number; internal: string; client: string | null };
export function reportPriorities(input: ReportInput, period: Period, derived: { uptime: number | null; avgResponse: number | null; overdue: number; pendingRecommendations: number; pendingActions: number; openIncidents: number; toValidate: number }): ReportPriority[] {
  const priorities: ReportPriority[] = [];
  if (derived.openIncidents) priorities.push({ rank: 0, internal: `Clore ${plural(derived.openIncidents, "incident ouvert", "incidents ouverts")} avant toute autre optimisation.`, client: null });
  if (derived.uptime !== null && derived.uptime < 99.5) priorities.push({ rank: 1, internal: `Disponibilité ${nf(derived.uptime, 1)} % (< 99,5 %) : identifier la cause des coupures (hébergement, déploiements) et mettre en place une alerte.`, client: "Fiabiliser la disponibilité du site." });
  if (derived.avgResponse !== null && derived.avgResponse > 1500) priorities.push({ rank: 2, internal: `Temps de réponse moyen ${nf(derived.avgResponse)} ms : mise en cache, images et hébergement à revoir (objectif < 800 ms).`, client: "Accélérer le chargement du site." });
  const sc = input.searchConsole;
  if (sc) {
    const length = Math.round((Date.parse(`${period.end}T00:00:00Z`) - Date.parse(`${period.start}T00:00:00Z`)) / dayMs) + 1;
    const sum = (from: string, to: string) => sc.days.filter((row) => row.date >= from && row.date <= to).reduce((acc, row) => ({ days: acc.days + 1, clicks: acc.clicks + row.clicks, impressions: acc.impressions + row.impressions, weighted: acc.weighted + (row.position ?? 0) * row.impressions, weight: acc.weight + (row.position === null ? 0 : row.impressions) }), { days: 0, clicks: 0, impressions: 0, weighted: 0, weight: 0 });
    const now = sum(period.start, period.end), before = sum(shiftDay(period.start, -length), shiftDay(period.start, -1));
    if (now.days === length && before.days === length && before.clicks >= 20) {
      const change = (now.clicks - before.clicks) / before.clicks;
      if (change <= -0.2) priorities.push({ rank: 1, internal: `Clics Google en baisse de ${nf(Math.abs(change) * 100)} % : identifier les pages et requêtes en recul (Search Console), vérifier indexation et mises à jour d’algorithme récentes.`, client: "Analyser et corriger la baisse de visibilité sur Google." });
      else if (change >= 0.2) priorities.push({ rank: 4, internal: `Clics Google en hausse de ${nf(change * 100)} % : consolider les pages qui progressent (contenu, liens internes).`, client: "Consolider la progression sur Google." });
    }
    const position = now.weight ? now.weighted / now.weight : null, ctr = now.impressions ? now.clicks / now.impressions : null;
    if (position !== null && ctr !== null && now.impressions >= 500 && position <= 10 && ctr < 0.02) priorities.push({ rank: 2, internal: `Bonne position moyenne (${nf(position, 1)}) mais CTR de ${nf(ctr * 100, 1)} % : réécrire titles et meta descriptions des pages les plus vues pour donner envie de cliquer.`, client: "Rendre les résultats Google plus attractifs (titres et descriptions)." });
    else if (position !== null && position > 10 && position <= 20 && now.impressions >= 500) priorities.push({ rank: 3, internal: `Position moyenne ${nf(position, 1)} (deuxième page) : enrichir les pages proches du top 10 et renforcer leurs liens internes.`, client: "Faire passer les pages proches en première page de Google." });
  }
  for (const metric of input.metrics) {
    const data = metric.data;
    if (metric.provider === "pagespeed" && typeof data.performance === "number" && data.performance < 50) priorities.push({ rank: 2, internal: `Performance mobile ${data.performance}/100 : traiter les images, scripts tiers et le rendu bloquant (Core Web Vitals).`, client: "Améliorer la vitesse du site sur mobile." });
    if (metric.provider === "google-ads" && typeof data.cost === "number" && data.cost > 0 && (data.conversions ?? 0) === 0) priorities.push({ rank: 1, internal: `Google Ads : ${nf(data.cost, 2)} € dépensés sans conversion enregistrée : vérifier le suivi puis les termes de recherche (diagnostic expert de l’Agent Google Ads).`, client: "Vérifier la mesure des demandes issues de Google Ads." });
  }
  if (derived.overdue) priorities.push({ rank: 2, internal: `${plural(derived.overdue, "tâche en retard", "tâches en retard")} : replanifier ou déléguer cette semaine.`, client: null });
  if (derived.pendingActions || derived.pendingRecommendations) priorities.push({ rank: 3, internal: `Décisions en attente : ${[derived.pendingRecommendations ? plural(derived.pendingRecommendations, "recommandation", "recommandations") : null, derived.pendingActions ? plural(derived.pendingActions, "action à valider", "actions à valider") : null].filter(Boolean).join(", ")} ; les traiter évite de laisser des gains de côté.`, client: null });
  if (derived.toValidate) priorities.push({ rank: 3, internal: `${plural(derived.toValidate, "publication attend", "publications attendent")} une validation : les traiter pour garder le rythme éditorial.`, client: null });
  return priorities.sort((a, b) => a.rank - b.rank).slice(0, 6);
}

export function periodLabel(kind: ReportKind, period: Period) {
  if (kind === "google_ads" || kind === "custom") return period.start === period.end ? `le ${frDate(period.start)} ${period.start.slice(0, 4)}` : `du ${frDate(period.start)} ${period.start.slice(0, 4)} au ${frDate(period.end)} ${period.end.slice(0, 4)}`;
  if (kind === "monthly") return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period.start}T00:00:00Z`));
  return `semaine du ${frDate(period.start)} au ${frDate(period.end)}`;
}

function nextDays(today: string, days: number) {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return fmt(date);
}

export function buildReport(kind: RecurringReportKind, input: ReportInput, today: string): { internal: ReportContent; client: ReportContent; title: string } {
  const p = input.period;
  const completed = input.tasks.filter((task) => inPeriod(task.completed_at, p) || (task.status === "Terminé" && inPeriod(task.created_at, p)));
  const open = input.tasks.filter((task) => task.status !== "Terminé");
  const overdue = open.filter((task) => task.due_date && task.due_date < today);
  const upcoming = open.filter((task) => task.due_date && task.due_date >= today && task.due_date <= nextDays(today, 14)).sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
  const published = input.publications.filter((item) => ["published", "approved"].includes(item.status) && inPeriod(item.target_date ?? item.updated_at, p));
  const toValidate = input.publications.filter((item) => item.status === "pending_review");
  const newRecommendations = input.recommendations.filter((item) => inPeriod(item.created_at, p));
  const pendingRecommendations = input.recommendations.filter((item) => item.status === "pending");
  const doneActions = input.actions.filter((item) => item.status === "executed" && inPeriod(item.executed_at, p));
  const pendingActions = input.actions.filter((item) => item.status === "pending_approval");
  const incidents = input.incidents.filter((item) => inPeriod(item.detected_at, p) || item.status !== "resolved");
  const openIncidents = input.incidents.filter((item) => item.status !== "resolved");
  const runs = input.runs.filter((item) => inPeriod(item.started_at, p));
  const checks = input.siteChecks.filter((item) => inPeriod(item.checked_at, p));
  const uptime = checks.length ? Math.round((checks.filter((item) => item.ok).length / checks.length) * 1000) / 10 : null;
  const responseTimes = checks.map((item) => item.response_ms).filter((value): value is number => value !== null);
  const avgResponse = responseTimes.length ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : null;

  const searchConsoleLines = input.searchConsole ? searchConsoleReportLines(input.searchConsole, p) : [];
  const metricLines = [...searchConsoleLines, ...input.metrics.flatMap((metric) => {
    const data = metric.data;
    // L'historique quotidien remplace l'ancien résumé de l'Agent SEO (période différente de celle du rapport).
    if (metric.provider === "search-console" && searchConsoleLines.length) return [];
    if (metric.provider === "search-console" && typeof data.clicks === "number") return [`Search Console : ${data.clicks} clics, ${data.impressions ?? "?"} impressions${typeof data.position === "number" ? `, position moyenne ${data.position.toFixed(1)}` : ""}.`];
    if (metric.provider === "google-ads" && typeof data.cost === "number") return [`Google Ads : ${data.cost.toFixed(2)} € dépensés, ${data.conversions ?? 0} conversions${typeof data.cpa === "number" ? `, ${data.cpa.toFixed(2)} € par conversion` : ""}.`];
    if (metric.provider === "pagespeed" && typeof data.performance === "number") return [`Performance mobile (PageSpeed) : ${data.performance}/100.`];
    if (metric.provider === "vercel" && metric.metric_key === "web_analytics") {
      const pageviews = typeof data.pageviews === "number" ? data.pageviews : null;
      const visitors = typeof data.visitors === "number" ? data.visitors : null;
      if (pageviews === null && visitors === null) return [];
      const rows = (value: unknown) => Array.isArray(value) ? value.flatMap((item) => item && typeof item === "object" && !Array.isArray(item) ? [item as Record<string, unknown>] : []) : [];
      const topPages = rows(data.topPages).filter((item) => typeof item.label === "string" && typeof item.pageviews === "number").slice(0, 3);
      const referrers = rows(data.topReferrers).filter((item) => typeof item.label === "string" && typeof item.visitors === "number").slice(0, 3);
      const events = rows(data.events).filter((item) => typeof item.label === "string" && typeof item.count === "number").slice(0, 5);
      const devices = rows(data.devices).filter((item) => typeof item.label === "string" && typeof item.visitors === "number").slice(0, 3);
      const result = [`Vercel Analytics : ${pageviews ?? "?"} pages vues, ${visitors ?? "?"} visiteurs.`];
      if (topPages.length) result.push(`Pages principales : ${topPages.map((item) => `${item.label} (${item.pageviews} vues)`).join(", ")}.`);
      if (referrers.length) result.push(`Acquisition : ${referrers.map((item) => `${item.label} (${item.visitors} visiteurs)`).join(", ")}.`);
      if (devices.length) result.push(`Appareils : ${devices.map((item) => `${item.label} (${item.visitors})`).join(", ")}.`);
      result.push(events.length ? `Interactions suivies : ${events.map((item) => `${item.label}: ${item.count}`).join(", ")}.` : "Interactions suivies : aucun événement personnalisé remonté sur la période.");
      return result;
    }
    return [];
  })];

  const priorities = reportPriorities(input, p, { uptime, avgResponse, overdue: overdue.length, pendingRecommendations: pendingRecommendations.length, pendingActions: pendingActions.length, openIncidents: openIncidents.length, toValidate: toValidate.length });
  const empty = !completed.length && !published.length && !newRecommendations.length && !doneActions.length && !incidents.length && !runs.length && !checks.length && !metricLines.length;
  const name = input.client?.name ?? "Tous les clients";
  const title = `${kind === "weekly" ? "Rapport hebdomadaire" : "Rapport mensuel"} — ${name} — ${periodLabel(kind, p)}`;

  const highlights = [
    completed.length ? `${plural(completed.length, "tâche terminée", "tâches terminées")}` : null,
    published.length ? `${plural(published.length, "publication diffusée ou validée", "publications diffusées ou validées")}` : null,
    doneActions.length ? `${plural(doneActions.length, "action réalisée", "actions réalisées")}` : null,
    uptime !== null ? `disponibilité du site ${uptime.toString().replace(".", ",")} %` : null,
  ].filter((line): line is string => Boolean(line));

  const summary = empty
    ? `Aucune activité enregistrée pour ${name} sur la ${periodLabel(kind, p)}.`
    : `${name} — ${periodLabel(kind, p)} : ${highlights.join(", ") || "activité de suivi"}.${openIncidents.length ? ` ${plural(openIncidents.length, "incident reste ouvert", "incidents restent ouverts")}.` : ""}`;

  const internalSections: ReportSection[] = [
    { title: "Projets", lines: input.projects.map((project) => `${project.name} — ${project.status}, ${project.progress} %`) },
    { title: "Travail réalisé", lines: completed.map((task) => `✓ ${task.title}`) },
    { title: "Échéances à venir (14 jours)", lines: upcoming.map((task) => `${task.due_date} — ${task.title}${task.priority === "Haute" ? " (prioritaire)" : ""}`) },
    { title: "En retard", lines: overdue.map((task) => `${task.due_date} — ${task.title}`) },
    { title: "Publications", lines: [...published.map((item) => `Diffusée/validée : ${item.subject}`), ...toValidate.map((item) => `À valider : ${item.subject}`)] },
    { title: "Recommandations", lines: [...newRecommendations.map((item) => `Nouvelle : ${item.title} (${item.severity})`), ...pendingRecommendations.filter((item) => !inPeriod(item.created_at, p)).map((item) => `En attente : ${item.title}`)] },
    { title: "Actions", lines: [...doneActions.map((item) => `Réalisée : ${item.label}`), ...pendingActions.map((item) => `À valider : ${item.label}`)] },
    { title: "Incidents", lines: incidents.map((item) => `${item.status === "resolved" ? "Résolu" : "Ouvert"} : ${item.title} (${item.severity})`) },
    { title: "Disponibilité et performances", lines: [uptime !== null ? `Disponibilité ${uptime} % sur ${checks.length} contrôles${avgResponse !== null ? `, temps de réponse moyen ${avgResponse} ms` : ""}.` : null, ...metricLines].filter((line): line is string => Boolean(line)) },
    { title: "Priorités recommandées", lines: priorities.map((item, index) => `${index + 1}. ${item.internal}`) },
    { title: "Analyses des agents", lines: Object.entries(runs.reduce<Record<string, { total: number; failed: number }>>((acc, run) => { const entry = acc[run.agent] ??= { total: 0, failed: 0 }; entry.total++; if (run.status === "failed") entry.failed++; return acc; }, {})).map(([agent, stat]) => `${agent} : ${plural(stat.total, "analyse", "analyses")}${stat.failed ? `, ${stat.failed} en échec` : ""}`) },
  ].filter((section) => section.lines.length);

  // Version client : réalisations et résultats, sans éléments internes (échecs, retards, analyses).
  const clientSections: ReportSection[] = [
    { title: "Réalisé", lines: [...completed.map((task) => task.title), ...doneActions.map((item) => item.label)] },
    { title: "Contenus publiés", lines: published.map((item) => item.subject) },
    { title: "Résultats", lines: [uptime !== null ? `Disponibilité du site : ${uptime.toString().replace(".", ",")} %` : null, ...metricLines].filter((line): line is string => Boolean(line)) },
    { title: "À venir", lines: upcoming.slice(0, 5).map((task) => task.title) },
    { title: "Nos priorités pour la suite", lines: [...new Set(priorities.flatMap((item) => item.client ? [item.client] : []))].slice(0, 3) },
  ].filter((section) => section.lines.length);

  return {
    title,
    internal: { summary, highlights, sections: internalSections, empty },
    client: { summary: empty ? `Pas d’activité notable sur la ${periodLabel(kind, p)}.` : summary, highlights, sections: clientSections, empty },
  };
}
