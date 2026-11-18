// Agent Rapport : audience (Google Analytics 4), qualité du site (Lighthouse), contenus diffusés par réseau, blog,
// newsletters et lectures croisées. Fonctions PURES et sans import (chargées telles quelles par les tests).
// Règles : un chiffre vient d'une ligne enregistrée et porte sa période ; une lecture croisée MET EN REGARD deux
// mesures, elle n'affirme jamais de cause ; une donnée absente est dite, jamais remplacée par zéro.

export type Period = { start: string; end: string };
type Traffic = { sessions: number; engagedSessions: number; keyEvents: number; users?: number | null };
type Segment = { key: string; sessions: number; engagedSessions: number; keyEvents: number };
type Landing = Segment & { channel: string };

/** Instantané GA4 réduit à ce que le rapport lit (forme de lib/integrations/google-analytics/model.ts). */
export type ReportAnalytics = {
  period: Period; previousPeriod: Period | null;
  totals: Traffic | null; previousTotals: Traffic | null;
  channels: Segment[]; previousChannels: Segment[]; landingPages: Landing[]; keyEvents: { name: string; count: number }[];
  thresholded: boolean;
};
export type ReportLighthouse = { strategy: string; url: string; analyzed_at: string; scores: unknown; field: unknown };
export type ReportPostStats = { reactions?: number; likes?: number; comments?: number; shares?: number };
/** stats : dernier relevé chez le réseau (lot 3) ; statsStatus « unsupported » = le réseau ne fournit rien, jamais zéro. */
export type ReportDelivery = { platform: string; published_at: string; subject: string | null; stats?: ReportPostStats | null; statsStatus?: string | null };
export type ReportArticle = { title: string; slug: string; published_at: string; target_query: string | null };
export type ReportNewsletter = { subject: string; sent_at: string; sent_count: number };
export type ReportAds = { cost: number; conversions: number | null; clicks: number | null };

/** Contrôle de santé technique (lot 5) : état des contrôles et constats, tels qu'archivés. */
export type ReportSiteHealth = { checked_at: string; score: number; checks: unknown; findings: unknown };
/** Fiche Google Business Profile (lot 6) : dernier relevé, tel qu'archivé. */
export type ReportLocal = { location_title: string | null; period_start: string; period_end: string; metrics: unknown; previous_metrics: unknown; keywords: unknown; reviews: unknown };
/** Positions Google (lot 7) : requêtes du dernier instantané Search Console, avec la période précédente. */
export type ReportRankingQuery = { query: string; position: number; impressions: number; clicks: number; previousPosition: number | null; previousImpressions: number | null };
export type ReportRanking = { period: Period; queries: ReportRankingQuery[] };
/** Concurrence locale (lot 7) : dernier relevé par source, tel qu'archivé (metric_snapshots local-competition). */
export type ReportCompetition = { source: string; keyword: string; checkedAt: string; depth: number; rank: number | null; client: { rating: number | null; reviews: number | null } | null;
  competitors: { name: string; rating: number | null; reviews: number | null }[]; medianRating: number | null; medianReviews: number | null };
/** Carte de positions Google Maps (lot 7, DataForSEO) : dernière grille de chaque recherche suivie. */
export type ReportGeogrid = { keyword: string; checkedAt: string; size: number; spacingKm: number; cells: (number | null)[]; failed: number[]; found: number; top3: number; average: number | null };
export type ReportExtras = {
  ranking?: ReportRanking | null;
  geogrid?: ReportGeogrid[] | null;
  competition?: ReportCompetition[] | null;
  siteHealth?: ReportSiteHealth | null;
  local?: ReportLocal[] | null;
  analytics: ReportAnalytics | null;
  lighthouse: ReportLighthouse[];
  deliveries: ReportDelivery[];
  articles: ReportArticle[];
  newsletters: ReportNewsletter[];
};

export const emptyExtras = (): ReportExtras => ({ ranking: null, geogrid: null, competition: null, siteHealth: null, local: null, analytics: null, lighthouse: [], deliveries: [], articles: [], newsletters: [] });

const num = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const rec = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const nf = (value: number, digits = 0) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value).replace(/ | /g, " ");
const plural = (n: number, one: string, many: string) => `${nf(n)} ${n > 1 ? many : one}`;
const frDay = (value: string) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
const clean = (value: string, max = 120) => value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const change = (now: number, before: number) => before > 0 ? ` (${now >= before ? "+" : "−"}${nf(Math.abs((now - before) / before) * 100)} %)` : "";
const validDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

export const platformLabels: Record<string, string> = {
  facebook: "Facebook", instagram: "Instagram", google_business_profile: "Google Business Profile", tiktok: "TikTok", snapchat: "Snapchat",
};
const platform = (value: string) => platformLabels[value] ?? clean(value, 40);

/** Lecture tolérante d'un instantané GA4 stocké : forme invalide → null, jamais complété. */
export function readReportAnalytics(data: unknown): ReportAnalytics | null {
  const value = rec(data);
  const period = rec(value.period);
  if (value.version !== 1 || !validDay(period.start) || !validDay(period.end)) return null;
  const traffic = (raw: unknown): Traffic | null => {
    const t = rec(raw);
    return num(t.sessions) && num(t.engagedSessions) && num(t.keyEvents) ? { sessions: t.sessions, engagedSessions: t.engagedSessions, keyEvents: t.keyEvents, users: num(t.users) ? t.users : null } : null;
  };
  const segments = (raw: unknown): Segment[] => Array.isArray(raw) ? raw.flatMap((item) => {
    const s = rec(item);
    return typeof s.key === "string" && num(s.sessions) && num(s.engagedSessions) && num(s.keyEvents) ? [{ key: s.key, sessions: s.sessions, engagedSessions: s.engagedSessions, keyEvents: s.keyEvents }] : [];
  }) : [];
  const previous = rec(value.previousPeriod);
  const sections = rec(value.sections);
  const read = (key: string) => rec(sections[key]).ok === true;
  return {
    period: { start: period.start, end: period.end },
    previousPeriod: validDay(previous.start) && validDay(previous.end) ? { start: previous.start, end: previous.end } : null,
    totals: read("totals") ? traffic(value.totals) : null,
    previousTotals: read("previousTotals") ? traffic(value.previousTotals) : null,
    channels: read("channels") ? segments(value.channels) : [],
    previousChannels: read("previousChannels") ? segments(value.previousChannels) : [],
    landingPages: read("landingPages") && Array.isArray(value.landingPages) ? value.landingPages.flatMap((item) => {
      const s = rec(item);
      return typeof s.key === "string" && typeof s.channel === "string" && num(s.sessions) && num(s.engagedSessions) && num(s.keyEvents) ? [{ key: s.key, channel: s.channel, sessions: s.sessions, engagedSessions: s.engagedSessions, keyEvents: s.keyEvents }] : [];
    }) : [],
    keyEvents: read("keyEvents") && Array.isArray(value.keyEvents) ? value.keyEvents.flatMap((item) => { const k = rec(item); return typeof k.name === "string" && num(k.count) ? [{ name: k.name, count: k.count }] : []; }) : [],
    thresholded: value.thresholded === true,
  };
}

const channelNames: Record<string, string> = {
  "Organic Search": "recherche naturelle", "Paid Search": "Google Ads", Direct: "accès direct", "Organic Social": "réseaux sociaux", "Paid Social": "réseaux sociaux payants",
  Referral: "sites référents", Email: "e-mail", "Organic Maps": "Google Maps", Unassigned: "non attribué",
};
const channel = (key: string) => channelNames[key] ?? clean(key, 40);
const SOCIAL = new Set(["Organic Social", "Paid Social"]);

/** Audience GA4 : fenêtre glissante de 30 jours (celle de la synchronisation), comparée aux 30 jours précédents. */
export function analyticsLines(analytics: ReportAnalytics | null): string[] {
  if (!analytics?.totals) return [];
  const t = analytics.totals, p = analytics.previousTotals;
  const span = `30 jours du ${frDay(analytics.period.start)} au ${frDay(analytics.period.end)}`;
  const engagement = t.sessions > 0 ? `, taux d’engagement ${nf(t.engagedSessions / t.sessions * 100)} %` : "";
  const lines = [`Google Analytics 4 (${span}) : ${plural(t.sessions, "session", "sessions")}${p ? change(t.sessions, p.sessions) : ""}${engagement}, ${plural(t.keyEvents, "conversion (événement clé)", "conversions (événements clés)")}${p ? change(t.keyEvents, p.keyEvents) : ""}.`];
  const top = [...analytics.channels].sort((a, b) => b.sessions - a.sessions).slice(0, 4);
  if (top.length && t.sessions > 0) lines.push(`Origine des visites : ${top.map((row) => `${channel(row.key)} ${nf(row.sessions / t.sessions * 100)} %`).join(", ")}.`);
  const events = [...analytics.keyEvents].sort((a, b) => b.count - a.count).slice(0, 4);
  if (events.length) lines.push(`Conversions suivies : ${events.map((row) => `${clean(row.name, 40)} ${nf(row.count)}`).join(", ")}.`);
  else lines.push("Aucun événement clé (conversion) déclenché dans Google Analytics sur la fenêtre : vérifier que les appels et formulaires sont bien suivis.");
  if (analytics.thresholded) lines.push("Google Analytics a masqué certains petits volumes (seuils de confidentialité) : les répartitions sont approchées.");
  return lines;
}

export type LighthouseScores = { performance: number | null; accessibility: number | null; bestPractices: number | null; seo: number | null };
const score = (value: unknown) => {
  if (!num(value)) return null;
  const scaled = value > 0 && value <= 1 && !Number.isInteger(value) ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(scaled)));
};
export function readLighthouseScores(value: unknown): LighthouseScores {
  const raw = rec(value);
  return { performance: score(raw.performance), accessibility: score(raw.accessibility), bestPractices: score(raw.bestPractices ?? raw["best-practices"]), seo: score(raw.seo) };
}

/** Dernier audit de chaque appareil dans la période ou juste avant (lignes triées par le service, plus récentes d'abord). */
export function latestAudits(audits: readonly ReportLighthouse[]) {
  const seen = new Map<string, ReportLighthouse>();
  for (const audit of audits) if (!seen.has(audit.strategy) || Date.parse(audit.analyzed_at) > Date.parse(seen.get(audit.strategy)!.analyzed_at)) seen.set(audit.strategy, audit);
  return ["mobile", "desktop"].flatMap((strategy) => seen.has(strategy) ? [seen.get(strategy)!] : []);
}

export function lighthouseLines(audits: readonly ReportLighthouse[]): string[] {
  return latestAudits(audits).flatMap((audit) => {
    const s = readLighthouseScores(audit.scores);
    const parts = [["performance", s.performance], ["accessibilité", s.accessibility], ["bonnes pratiques", s.bestPractices], ["SEO", s.seo]].filter((item): item is [string, number] => item[1] !== null);
    if (!parts.length) return [];
    const lines = [`Lighthouse ${audit.strategy === "desktop" ? "ordinateur" : "mobile"} (audit du ${frDay(audit.analyzed_at)}) : ${parts.map(([label, value]) => `${label} ${value}/100`).join(", ")}.`];
    const field = rec(audit.field);
    if (audit.strategy !== "desktop" && field.scope !== "unavailable" && (num(field.lcpMs) || num(field.inpMs) || num(field.cls))) {
      lines.push(`Expérience réelle des visiteurs (Core Web Vitals, Chrome) : ${[num(field.lcpMs) ? `LCP ${nf(field.lcpMs / 1000, 1)} s` : null, num(field.inpMs) ? `INP ${nf(field.inpMs)} ms` : null, num(field.cls) ? `CLS ${nf(field.cls, 2)}` : null].filter(Boolean).join(", ")}.`);
    }
    return lines;
  });
}

const inPeriod = (value: string, period: Period) => value.slice(0, 10) >= period.start && value.slice(0, 10) <= period.end;
const byPlatform = (rows: readonly ReportDelivery[]) => {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.platform, (counts.get(row.platform) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

/** Relevé stocké (publication_delivery_stats.metrics) → compteurs sûrs ; illisible → null. */
export function readPostStats(value: unknown): ReportPostStats | null {
  const v = rec(value);
  const ok = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0 && x < 1e9;
  const out: ReportPostStats = {};
  for (const key of ["reactions", "likes", "comments", "shares"] as const) if (ok(v[key])) out[key] = v[key] as number;
  return Object.keys(out).length ? out : null;
}
const postInteractions = (stats: ReportPostStats) => (stats.reactions ?? stats.likes ?? 0) + (stats.comments ?? 0) + (stats.shares ?? 0);

/** Publications réellement diffusées dans la période, par réseau, leurs interactions relevées, puis le détail daté. */
export function deliveryLines(deliveries: readonly ReportDelivery[], period: Period, detailed: boolean): string[] {
  const rows = deliveries.filter((row) => inPeriod(row.published_at, period)).sort((a, b) => a.published_at.localeCompare(b.published_at));
  if (!rows.length) return [];
  const lines = [`${plural(rows.length, "publication diffusée", "publications diffusées")} : ${byPlatform(rows).map(([key, n]) => `${platform(key)} ${n}`).join(", ")}.`];
  lines.push(...engagementLines(rows));
  if (detailed) for (const row of rows.slice(0, 40)) lines.push(`${frDay(row.published_at)} · ${platform(row.platform)} · ${row.subject ? clean(row.subject, 100) : "sans sujet"}${row.stats ? ` · ${plural(postInteractions(row.stats), "interaction", "interactions")}` : ""}`);
  if (detailed && rows.length > 40) lines.push(`… et ${rows.length - 40} autres.`);
  return lines;
}

/** Interactions relevées par réseau (réactions ou « j'aime », commentaires, partages) et réseaux sans statistiques. */
export function engagementLines(rows: readonly ReportDelivery[]): string[] {
  const lines: string[] = [];
  const measured = rows.filter((row) => row.stats);
  const networks = [...new Set(measured.map((row) => row.platform))].sort();
  for (const key of networks) {
    const own = measured.filter((row) => row.platform === key);
    const sum = (field: keyof ReportPostStats) => own.some((row) => num(row.stats?.[field])) ? own.reduce((total, row) => total + (row.stats?.[field] ?? 0), 0) : null;
    const parts = [["réactions", sum("reactions")], ["j’aime", sum("likes")], ["commentaires", sum("comments")], ["partages", sum("shares")]].filter((part): part is [string, number] => part[1] !== null);
    const total = own.reduce((acc, row) => acc + postInteractions(row.stats!), 0);
    const best = [...own].sort((a, b) => postInteractions(b.stats!) - postInteractions(a.stats!))[0];
    lines.push(`${platform(key)} : ${plural(total, "interaction relevée", "interactions relevées")} sur ${plural(own.length, "post", "posts")} (${parts.map(([label, n]) => `${label} ${nf(n)}`).join(", ")}), soit ${nf(Math.round(total / own.length * 10) / 10, Number.isInteger(Math.round(total / own.length * 10) / 10) ? 0 : 1)} par post${best && postInteractions(best.stats!) > 0 ? ` ; le plus suivi : ${best.subject ? `« ${clean(best.subject, 70)} »` : "un post sans sujet"} (${nf(postInteractions(best.stats!))})` : ""}.`);
  }
  const unsupported = [...new Set(rows.filter((row) => !row.stats && row.statsStatus === "unsupported").map((row) => platform(row.platform)))].sort();
  if (unsupported.length) lines.push(`Statistiques non fournies par ${unsupported.join(", ")} avec les accès actuels : aucun chiffre n’est affiché pour ces réseaux.`);
  const pending = rows.filter((row) => !row.stats && row.statsStatus !== "unsupported" && row.platform !== "google_business_profile" && row.platform !== "tiktok" && row.platform !== "snapchat").length;
  if (measured.length && pending) lines.push(`${plural(pending, "post sans relevé", "posts sans relevé")} pour le moment.`);
  return lines;
}

export function articleLines(articles: readonly ReportArticle[], period: Period): string[] {
  return articles.filter((row) => inPeriod(row.published_at, period)).map((row) => `Article publié le ${frDay(row.published_at)} : « ${clean(row.title, 110)} »${row.target_query ? `, requête visée « ${clean(row.target_query, 60)} »` : ""}.`);
}

export function newsletterLines(newsletters: readonly ReportNewsletter[], period: Period): string[] {
  return newsletters.filter((row) => inPeriod(row.sent_at, period)).map((row) => `Newsletter envoyée le ${frDay(row.sent_at)} : « ${clean(row.subject, 110)} » (${plural(row.sent_count, "destinataire", "destinataires")}).`);
}

const pathOf = (value: string) => {
  const path = value.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0].replace(/\/+$/, "");
  return path || "/";
};

/**
 * Lectures croisées : deux mesures enregistrées mises en regard, chacune avec sa période. Jamais de causalité :
 * chaque ligne le rappelle. Sans les deux mesures, aucune ligne.
 */
export function crossReadings(input: { period: Period; extras: ReportExtras; ads: ReportAds | null; searchClicks: number | null }): string[] {
  const { period, extras, ads } = input;
  const lines: string[] = [];
  const ga = extras.analytics;
  const posted = extras.deliveries.filter((row) => inPeriod(row.published_at, period));
  const social = ga ? ga.channels.filter((row) => SOCIAL.has(row.key)).reduce((sum, row) => sum + row.sessions, 0) : null;
  const socialBefore = ga && ga.previousChannels.length ? ga.previousChannels.filter((row) => SOCIAL.has(row.key)).reduce((sum, row) => sum + row.sessions, 0) : null;
  const socialPosts = posted.filter((row) => row.platform !== "google_business_profile");
  if (ga && socialPosts.length && social !== null) {
    lines.push(`Réseaux sociaux : ${plural(socialPosts.length, "post diffusé", "posts diffusés")} sur la période, à mettre en regard de ${plural(social, "visite", "visites")} du site venues des réseaux sociaux sur les 30 jours au ${frDay(ga.period.end)}${socialBefore !== null ? change(social, socialBefore) : ""}. Les deux mesures sont rapprochées, aucun lien de cause n’est établi.`);
  }
  const gbp = posted.filter((row) => row.platform === "google_business_profile");
  const maps = ga ? ga.channels.find((row) => row.key === "Organic Maps") : null;
  const local = (extras.local ?? [])[0];
  const actions = local ? ["calls", "websiteClicks", "directions"].map((key) => metric(local.metrics, key)) : [];
  if (gbp.length && local && actions.some((v) => v !== null)) lines.push(`Google Business Profile : ${plural(gbp.length, "post", "posts")} sur la période, à mettre en regard de ${nf(actions[0] ?? 0)} appels, ${nf(actions[1] ?? 0)} clics vers le site et ${nf(actions[2] ?? 0)} demandes d’itinéraire depuis la fiche du ${frDay(local.period_start)} au ${frDay(local.period_end)}. Rapprochement sans lien de cause établi.`);
  else if (gbp.length && maps) lines.push(`Google Business Profile : ${plural(gbp.length, "post", "posts")} sur la période, ${plural(maps.sessions, "visite", "visites")} venues de Google Maps sur les 30 jours au ${frDay(ga!.period.end)}. Rapprochement sans lien de cause établi ; les appels et itinéraires de la fiche ne sont pas encore récupérés.`);
  const articles = extras.articles.filter((row) => inPeriod(row.published_at, period) || row.published_at.slice(0, 10) <= period.end);
  if (ga && ga.landingPages.length && articles.length) {
    const sessions = (slug: string) => ga.landingPages.filter((row) => pathOf(row.key).endsWith(`/${slug}`)).reduce((acc, row) => ({ sessions: acc.sessions + row.sessions, organic: acc.organic + (row.channel === "Organic Search" ? row.sessions : 0), keyEvents: acc.keyEvents + row.keyEvents }), { sessions: 0, organic: 0, keyEvents: 0 });
    for (const article of articles.slice(0, 5)) {
      const s = sessions(article.slug);
      lines.push(`Article « ${clean(article.title, 80)} » : ${s.sessions ? `${plural(s.sessions, "visite", "visites")} en page d’entrée dont ${nf(s.organic)} depuis Google${s.keyEvents ? `, ${plural(s.keyEvents, "conversion", "conversions")}` : ""}` : "aucune visite en page d’entrée relevée"} sur les 30 jours au ${frDay(ga.period.end)}${article.target_query ? ` (requête visée « ${clean(article.target_query, 60)} »)` : ""}.`);
    }
  }
  if (ads && ga) {
    const paid = ga.channels.find((row) => row.key === "Paid Search");
    const organic = ga.channels.find((row) => row.key === "Organic Search");
    if (paid && organic) lines.push(`Payant et naturel : Google Ads ${nf(ads.cost, 2)} € pour ${ads.conversions === null ? "un nombre de conversions non relevé" : plural(ads.conversions, "conversion", "conversions")} ; dans Google Analytics (30 jours au ${frDay(ga.period.end)}), ${plural(paid.sessions, "visite", "visites")} et ${plural(paid.keyEvents, "conversion", "conversions")} via Google Ads contre ${plural(organic.sessions, "visite", "visites")} et ${plural(organic.keyEvents, "conversion", "conversions")} via la recherche naturelle. Périodes et méthodes de mesure différentes : à comparer avec prudence.`);
  }
  if (input.searchClicks !== null && ga) {
    const organic = ga.channels.find((row) => row.key === "Organic Search");
    if (organic && organic.sessions > 0) lines.push(`Recherche naturelle : ${plural(input.searchClicks, "clic", "clics")} Google sur la période (Search Console) ; ${plural(organic.keyEvents, "conversion", "conversions")} issues de la recherche naturelle sur les 30 jours au ${frDay(ga.period.end)} (Google Analytics), soit ${nf(organic.keyEvents / organic.sessions * 100, 1)} % des visites concernées.`);
  }
  const mobile = latestAudits(extras.lighthouse).find((audit) => audit.strategy === "mobile");
  const perf = mobile ? readLighthouseScores(mobile.scores).performance : null;
  if (ga?.totals && ga.totals.sessions > 0 && perf !== null && perf < 50) {
    lines.push(`Vitesse et engagement : performance mobile ${perf}/100 (Lighthouse du ${frDay(mobile!.analyzed_at)}) et taux d’engagement de ${nf(ga.totals.engagedSessions / ga.totals.sessions * 100)} % (Google Analytics). Un site lent peut décourager une partie des visiteurs mobiles ; l’effet réel n’est pas mesuré ici.`);
  }
  return lines;
}

/** Priorités tirées des nouvelles sources (même format que reportPriorities). */
const metric = (value: unknown, key: string) => { const v = rec(value)[key]; return num(v) ? v : null; };
/** Fiche Google : vues, appels, clics vers le site, itinéraires (28 jours, évolution), avis et recherches principales. */
export function localLines(locals: readonly ReportLocal[] | null | undefined): string[] {
  const lines: string[] = [];
  for (const local of (locals ?? []).slice(0, 3)) {
    const name = local.location_title ? ` « ${clean(local.location_title, 60)} »` : "";
    const span = `du ${frDay(local.period_start)} au ${frDay(local.period_end)}`;
    const m = local.metrics, p = local.previous_metrics;
    const parts = ([["vues sur Google Maps", "impressionsMaps"], ["vues dans la recherche Google", "impressionsSearch"], ["appels", "calls"], ["clics vers le site", "websiteClicks"], ["demandes d’itinéraire", "directions"]] as const)
      .flatMap(([label, key]) => { const now = metric(m, key); if (now === null) return []; const before = metric(p, key); return [`${nf(now)} ${label}${before !== null ? change(now, before) : ""}`]; });
    if (parts.length) lines.push(`Fiche Google${name} ${span} : ${parts.join(", ")}.`);
    const reviews = rec(local.reviews);
    const recent = Array.isArray(reviews.recent) ? reviews.recent.map(rec) : [];
    const unanswered = recent.filter((r) => r.replied === false && typeof r.at === "string" && r.at.slice(0, 10) >= local.period_start).length;
    if (num(reviews.total) || num(reviews.average)) lines.push(`Avis Google${name} : ${num(reviews.average) ? `note moyenne ${nf(reviews.average, 1)}/5` : "note moyenne non communiquée"}${num(reviews.total) ? ` sur ${plural(reviews.total, "avis", "avis")}` : ""}${recent.length ? `, ${plural(recent.filter((r) => typeof r.at === "string" && r.at.slice(0, 10) >= local.period_start).length, "nouvel avis", "nouveaux avis")} sur la période` : ""}${unanswered ? `, ${plural(unanswered, "sans réponse", "sans réponse")}` : ""}.`);
    const keywords = Array.isArray(local.keywords) ? local.keywords.map(rec).filter((k) => typeof k.keyword === "string").slice(0, 5) : [];
    if (keywords.length) lines.push(`Recherches qui ont affiché la fiche (mois précédent) : ${keywords.map((k) => `« ${clean(String(k.keyword), 40)} » (${num(k.impressions) ? nf(k.impressions) : num(k.threshold) ? `moins de ${nf(k.threshold)}` : "volume masqué"})`).join(", ")}.`);
  }
  return lines;
}

/** Instantané Search Console (forme de lib/integrations/search-console/model.ts) → requêtes et positions. */
export function readReportRanking(data: unknown): ReportRanking | null {
  const d = rec(data), period = rec(d.period);
  if (!validDay(period.start) || !validDay(period.end) || !Array.isArray(d.queries)) return null;
  const queries = d.queries.map(rec).flatMap((row): ReportRankingQuery[] => {
    const prev = rec(row.previous);
    if (typeof row.key !== "string" || !row.key.trim() || !num(row.position) || row.position <= 0 || !num(row.impressions)) return [];
    return [{ query: clean(row.key, 80), position: row.position, impressions: row.impressions, clicks: num(row.clicks) ? row.clicks : 0,
      previousPosition: num(prev.position) && prev.position > 0 ? prev.position : null, previousImpressions: num(prev.impressions) ? prev.impressions : null }];
  }).slice(0, 500);
  return { period: { start: period.start, end: period.end }, queries };
}

const place = (value: number) => { const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value); return nf(rounded, Number.isInteger(rounded) ? 0 : 1); };
/** Positions Google : requêtes en top 3 / top 10 / deuxième page, progressions et reculs nets (≥ 3 places, ≥ 20 impressions). */
export function rankingLines(ranking: ReportRanking | null | undefined): string[] {
  if (!ranking || !ranking.queries.length) return [];
  const q = ranking.queries;
  const top3 = q.filter((r) => r.position <= 3.5).length, top10 = q.filter((r) => r.position <= 10.5).length, page2 = q.filter((r) => r.position > 10.5 && r.position <= 20.5).length;
  const comparable = q.filter((r) => r.previousPosition !== null);
  const top10Before = comparable.length ? q.filter((r) => r.previousPosition !== null && r.previousPosition <= 10.5).length : null;
  const lines = [`Positions Google (Search Console, du ${frDay(ranking.period.start)} au ${frDay(ranking.period.end)}) : ${plural(top3, "requête", "requêtes")} en top 3, ${nf(top10)} en première page${top10Before !== null ? ` (période précédente : ${nf(top10Before)})` : ""}, ${nf(page2)} en deuxième page.`];
  const moves = comparable.filter((r) => r.impressions >= 20).map((r) => ({ ...r, gain: r.previousPosition! - r.position }));
  const up = moves.filter((r) => r.gain >= 3).sort((a, b) => b.gain - a.gain).slice(0, 3);
  const down = moves.filter((r) => r.gain <= -3).sort((a, b) => a.gain - b.gain).slice(0, 3);
  if (up.length) lines.push(`Progressions : ${up.map((r) => `« ${r.query} » ${place(r.previousPosition!)} → ${place(r.position)}`).join(", ")}.`);
  if (down.length) lines.push(`Reculs : ${down.map((r) => `« ${r.query} » ${place(r.previousPosition!)} → ${place(r.position)}`).join(", ")}.`);
  const near = q.filter((r) => r.position > 10.5 && r.position <= 20.5 && r.impressions >= 50).sort((a, b) => b.impressions - a.impressions).slice(0, 3);
  if (near.length) lines.push(`Aux portes de la première page : ${near.map((r) => `« ${r.query} » (position ${place(r.position)}, ${plural(r.impressions, "impression", "impressions")})`).join(", ")}.`);
  return lines;
}

const competitionSource = (source: string) => source === "dataforseo-maps" ? "position Google Maps, relevé DataForSEO" : "rang indicatif Google Places, différent du classement Maps propre à chaque internaute";
/** Concurrence locale : place du client sur « métier ville », note et avis face aux 5 premiers concurrents. */
export function competitionLines(rows: readonly ReportCompetition[] | null | undefined): string[] {
  const lines: string[] = [];
  for (const row of (rows ?? []).slice(0, 2)) {
    const where = `« ${clean(row.keyword, 80)} » (${competitionSource(row.source)}, relevé du ${frDay(row.checkedAt)})`;
    lines.push(row.rank !== null ? `Recherche locale ${where} : ${row.rank === 1 ? "1re" : `${row.rank}e`} place.` : `Recherche locale ${where} : fiche absente des ${row.depth} premiers résultats.`);
    const own = row.client;
    const ownPart = own && (own.rating !== null || own.reviews !== null) ? `la fiche : ${own.rating !== null ? `${nf(own.rating, 1)}/5` : "note non communiquée"}${own.reviews !== null ? ` sur ${plural(own.reviews, "avis", "avis")}` : ""}` : null;
    const medPart = row.medianRating !== null || row.medianReviews !== null ? `médiane des 5 premiers concurrents : ${row.medianRating !== null ? `${nf(row.medianRating, 1)}/5` : "note non communiquée"}${row.medianReviews !== null ? ` sur ${plural(row.medianReviews, "avis", "avis")}` : ""}` : null;
    if (ownPart || medPart) lines.push(`Avis face à la concurrence : ${[ownPart, medPart].filter(Boolean).join(" ; ")}.`);
    // Noms des concurrents : relevé DataForSEO seulement (le contenu Google Places ne se conserve pas au-delà de 30 jours,
    // or un rapport est archivé).
    if (row.source === "dataforseo-maps" && row.competitors.length) lines.push(`Concurrents en tête : ${row.competitors.slice(0, 3).map((c) => `${clean(c.name, 50)}${c.rating !== null ? ` (${nf(c.rating, 1)}/5${c.reviews !== null ? `, ${nf(c.reviews)} avis` : ""})` : ""}`).join(", ")}.`);
  }
  return lines;
}

/** Carte de positions : part des points en top 3 et où la fiche apparaît, position moyenne là où elle apparaît. */
export function geogridLines(grids: readonly ReportGeogrid[] | null | undefined): string[] {
  return (grids ?? []).slice(0, 3).flatMap((grid) => {
    const measured = grid.cells.length - grid.failed.length;
    if (!measured) return [];
    const dec = (v: number) => { const r = Math.round(v * 10) / 10; return nf(r, Number.isInteger(r) ? 0 : 1); };
    const span = dec((grid.size - 1) * grid.spacingKm);
    return [`Carte Google Maps « ${clean(grid.keyword, 60)} » (${grid.size} × ${grid.size} points sur ${span} km autour de la fiche, relevé du ${frDay(grid.checkedAt)}) : top 3 sur ${nf(grid.top3)} point${grid.top3 > 1 ? "s" : ""} sur ${nf(measured)}, présente sur ${nf(grid.found)}${grid.average !== null ? `, position moyenne ${dec(grid.average)} là où elle apparaît` : ""}.`];
  });
}

type HealthCheckLine = { key: string; label: string; state: string; detail: string };
type HealthFindingLine = { code: string; severity: string; title: string; detail: string };
const healthChecks = (value: unknown): HealthCheckLine[] => Array.isArray(value) ? value.filter((row): row is HealthCheckLine => rec(row).label !== undefined && typeof rec(row).state === "string" && typeof rec(row).detail === "string").slice(0, 12) : [];
const healthFindings = (value: unknown): HealthFindingLine[] => Array.isArray(value) ? value.filter((row): row is HealthFindingLine => typeof rec(row).title === "string" && typeof rec(row).severity === "string").slice(0, 20) : [];

/** Santé technique du site : score, contrôles et constats datés. Un contrôle non vérifié est dit comme tel. */
export function siteHealthLines(health: ReportSiteHealth | null | undefined): string[] {
  if (!health || !num(health.score)) return [];
  const checks = healthChecks(health.checks), findings = healthFindings(health.findings);
  const lines = [`Santé technique du site (contrôle du ${frDay(health.checked_at)}) : ${health.score}/100${findings.length ? `, ${plural(findings.length, "point à corriger", "points à corriger")}` : ", aucun point à corriger"}.`];
  for (const check of checks) lines.push(`${clean(check.label, 40)} : ${check.state === "unverified" ? "non vérifié" : check.state === "issue" ? "à corriger" : "conforme"} (${clean(check.detail, 140)})`);
  return lines;
}

export function extrasPriorities(extras: ReportExtras): { rank: number; internal: string; client: string | null }[] {
  const out: { rank: number; internal: string; client: string | null }[] = [];
  const ga = extras.analytics;
  if (ga?.totals && ga.previousTotals && ga.previousTotals.sessions >= 100) {
    const delta = (ga.totals.sessions - ga.previousTotals.sessions) / ga.previousTotals.sessions;
    if (delta <= -0.2) out.push({ rank: 1, internal: `Visites du site en baisse de ${nf(Math.abs(delta) * 100)} % sur 30 jours (Google Analytics) : identifier le canal en recul avant d’agir.`, client: "Comprendre et corriger la baisse de fréquentation du site." });
  }
  if (ga?.totals && ga.totals.sessions >= 100 && ga.totals.keyEvents === 0) out.push({ rank: 1, internal: "Aucune conversion enregistrée dans Google Analytics malgré du trafic : configurer le suivi des appels et des formulaires.", client: "Mesurer les demandes de contact reçues par le site." });
  const mobile = latestAudits(extras.lighthouse).find((audit) => audit.strategy === "mobile");
  const scores = mobile ? readLighthouseScores(mobile.scores) : null;
  if (scores?.performance !== null && scores?.performance !== undefined && scores.performance < 50) out.push({ rank: 2, internal: `Lighthouse mobile : performance ${scores.performance}/100 : images, scripts tiers et rendu bloquant à traiter.`, client: "Améliorer la vitesse du site sur mobile." });
  for (const local of extras.local ?? []) {
    const recent = Array.isArray(rec(local.reviews).recent) ? (rec(local.reviews).recent as unknown[]).map(rec) : [];
    if (recent.some((r) => r.replied === false && num(r.rating) && r.rating <= 3)) { out.push({ rank: 1, internal: "Avis Google négatif sans réponse : préparer une réponse factuelle à valider.", client: "Répondre aux avis Google récents." }); break; }
  }
  for (const finding of healthFindings(extras.siteHealth?.findings).filter((row) => row.severity === "critical" || row.severity === "high").slice(0, 2))
    out.push({ rank: finding.severity === "critical" ? 0 : 2, internal: `Santé technique : ${clean(finding.title, 90)}. ${clean(finding.detail, 160)}`, client: `Corriger : ${clean(finding.title, 90).toLowerCase()}.` });
  const primary = (extras.competition ?? [])[0];
  if (primary && primary.rank === null) out.push({ rank: 2, internal: `Fiche absente des ${primary.depth} premiers résultats locaux pour « ${clean(primary.keyword, 60)} » : catégorie, zone desservie et avis à travailler.`, client: "Faire apparaître la fiche Google dans les recherches locales du métier." });
  else if (primary?.client?.reviews !== null && primary?.client?.reviews !== undefined && primary.medianReviews !== null && primary.medianReviews >= 10 && primary.client.reviews < primary.medianReviews * 0.5)
    out.push({ rank: 3, internal: `${plural(primary.client.reviews, "avis", "avis")} contre ${nf(primary.medianReviews)} en médiane chez les concurrents locaux : mettre en place une demande d’avis après chaque chantier.`, client: "Obtenir plus d’avis Google que les concurrents." });
  if (scores?.seo !== null && scores?.seo !== undefined && scores.seo < 80) out.push({ rank: 2, internal: `Lighthouse mobile : SEO ${scores.seo}/100 : balises, liens et indexabilité à corriger.`, client: "Corriger les points techniques de référencement du site." });
  return out;
}
