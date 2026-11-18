// Référencement local (architecture des agents, lot 6) : statistiques et avis de la fiche Google Business Profile.
// Règles PURES, sans import. Lecture seule ; l'agent ne répond jamais lui-même à un avis (il prépare une
// recommandation). Une donnée non fournie par Google est dite absente, jamais remplacée par zéro.

export const GBP_DAILY_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", "BUSINESS_IMPRESSIONS_MOBILE_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "CALL_CLICKS", "WEBSITE_CLICKS", "BUSINESS_DIRECTION_REQUESTS", "BUSINESS_CONVERSATIONS", "BUSINESS_BOOKINGS",
] as const;
export type GbpMetricKey = (typeof GBP_DAILY_METRICS)[number];
export type LocalMetrics = { impressionsMaps: number | null; impressionsSearch: number | null; calls: number | null; websiteClicks: number | null; directions: number | null; conversations: number | null; bookings: number | null };
export type LocalKeyword = { keyword: string; impressions: number | null; threshold: number | null };
export type LocalReview = { rating: number | null; at: string; replied: boolean; author: string | null; excerpt: string | null };
export type LocalReviews = { total: number | null; average: number | null; recent: LocalReview[] };
export type LocalSnapshot = { period: { start: string; end: string }; metrics: LocalMetrics | null; previous: LocalMetrics | null; keywords: LocalKeyword[] | null; reviews: LocalReviews | null };

/** Collecte hebdomadaire par fiche ; nouvel essai 24 h après un échec. */
export const LOCAL_INTERVAL_DAYS = 7;
export const LOCAL_RETRY_HOURS = 24;
/** Google publie les statistiques avec quelques jours de retard. */
export const LOCAL_DELAY_DAYS = 3;
export const LOCATION_RE = /^accounts\/[0-9A-Za-z_-]{1,100}\/locations\/([0-9A-Za-z_-]{1,100})$/;

const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export function localPeriods(now: Date): { current: { start: string; end: string }; previous: { start: string; end: string } } {
  const end = now.getTime() - LOCAL_DELAY_DAYS * DAY;
  return { current: { start: isoDay(end - 27 * DAY), end: isoDay(end) }, previous: { start: isoDay(end - 55 * DAY), end: isoDay(end - 28 * DAY) } };
}

export function localDue(input: { lastAt: string | null; lastFailureAt: string | null }, now: Date) {
  const last = input.lastAt ? Date.parse(input.lastAt) : NaN, failure = input.lastFailureAt ? Date.parse(input.lastFailureAt) : NaN;
  if (Number.isFinite(failure) && now.getTime() - failure < LOCAL_RETRY_HOURS * 3_600_000 && (!Number.isFinite(last) || failure > last)) return false;
  return !Number.isFinite(last) || now.getTime() - last >= LOCAL_INTERVAL_DAYS * DAY;
}

const rec = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const intOf = (value: unknown): number | null => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};
const dayOf = (date: unknown) => { const d = rec(date); const y = intOf(d.year), m = intOf(d.month), day = intOf(d.day); return y && m && day ? `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null; };

/**
 * Réponse de fetchMultiDailyMetricsTimeSeries → totaux par indicateur sur la période. Un indicateur absent de la
 * réponse reste null (Google omet les jours à zéro dans datedValues, mais renvoie la série de l'indicateur).
 */
export function readDailyMetrics(body: unknown, period: { start: string; end: string }): LocalMetrics | null {
  const groups = rec(body).multiDailyMetricTimeSeries;
  if (!Array.isArray(groups)) return null;
  const totals = new Map<string, number>();
  for (const group of groups) for (const series of Array.isArray(rec(group).dailyMetricTimeSeries) ? rec(group).dailyMetricTimeSeries as unknown[] : []) {
    const metric = rec(series).dailyMetric;
    if (typeof metric !== "string") continue;
    const values = rec(rec(series).timeSeries).datedValues;
    let sum = totals.get(metric) ?? 0;
    for (const point of Array.isArray(values) ? values : []) {
      const day = dayOf(rec(point).date);
      if (!day || day < period.start || day > period.end) continue;
      sum += intOf(rec(point).value) ?? 0;
    }
    totals.set(metric, sum);
  }
  if (!totals.size) return null;
  const get = (key: GbpMetricKey) => (totals.has(key) ? totals.get(key)! : null);
  const add = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));
  return {
    impressionsMaps: add(get("BUSINESS_IMPRESSIONS_DESKTOP_MAPS"), get("BUSINESS_IMPRESSIONS_MOBILE_MAPS")),
    impressionsSearch: add(get("BUSINESS_IMPRESSIONS_DESKTOP_SEARCH"), get("BUSINESS_IMPRESSIONS_MOBILE_SEARCH")),
    calls: get("CALL_CLICKS"), websiteClicks: get("WEBSITE_CLICKS"), directions: get("BUSINESS_DIRECTION_REQUESTS"),
    conversations: get("BUSINESS_CONVERSATIONS"), bookings: get("BUSINESS_BOOKINGS"),
  };
}

/** Recherches qui ont affiché la fiche (mois) : Google masque les volumes faibles (« moins de N »). */
export function readKeywords(body: unknown): LocalKeyword[] | null {
  const rows = rec(body).searchKeywordsCounts;
  if (rows === undefined) return [];
  if (!Array.isArray(rows)) return null;
  return rows.flatMap((row): LocalKeyword[] => {
    const keyword = rec(row).searchKeyword;
    if (typeof keyword !== "string" || !keyword.trim()) return [];
    const value = rec(rec(row).insightsValue);
    return [{ keyword: keyword.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 80), impressions: intOf(value.value), threshold: intOf(value.threshold) }];
  }).sort((a, b) => (b.impressions ?? b.threshold ?? 0) - (a.impressions ?? a.threshold ?? 0)).slice(0, 20);
}

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
/** Avis (My Business API v4) : note moyenne, total, 20 derniers avis avec leur état de réponse. */
export function readReviews(body: unknown): LocalReviews | null {
  const b = rec(body);
  if (b.reviews !== undefined && !Array.isArray(b.reviews)) return null;
  const average = typeof b.averageRating === "number" && b.averageRating >= 0 && b.averageRating <= 5 ? Math.round(b.averageRating * 10) / 10 : null;
  const recent = (Array.isArray(b.reviews) ? b.reviews : []).flatMap((row): LocalReview[] => {
    const r = rec(row);
    const at = typeof r.createTime === "string" && Number.isFinite(Date.parse(r.createTime)) ? new Date(Date.parse(r.createTime)).toISOString() : null;
    if (!at) return [];
    const comment = typeof r.comment === "string" ? r.comment.replace(/\(Translated by Google\)[\s\S]*$/, "").replace(/[\u0000-\u001f]/g, " ").trim() : "";
    const author = typeof rec(r.reviewer).displayName === "string" ? String(rec(r.reviewer).displayName).trim().split(/\s+/)[0].slice(0, 30) : null;
    return [{ rating: STARS[String(r.starRating)] ?? null, at, replied: Boolean(rec(r.reviewReply).comment), author, excerpt: comment ? comment.slice(0, 160) : null }];
  }).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
  return { total: intOf(b.totalReviewCount), average, recent };
}

export type LocalFinding = { code: string; severity: "high" | "medium" | "low"; title: string; detail: string; fix: string };
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Constats du référencement local : avis sans réponse, avis négatifs récents, baisse des actions sur la fiche. */
export function evaluateLocal(snapshot: LocalSnapshot, now: Date): LocalFinding[] {
  const findings: LocalFinding[] = [];
  const reviews = snapshot.reviews;
  if (reviews) {
    const unanswered = reviews.recent.filter((review) => !review.replied && now.getTime() - Date.parse(review.at) <= 30 * DAY);
    const negative = unanswered.filter((review) => review.rating !== null && review.rating <= 3);
    if (negative.length) findings.push({ code: "negative_review_unanswered", severity: "high", title: "Avis négatif sans réponse", detail: `${plural(negative.length, "avis de 3 étoiles ou moins", "avis de 3 étoiles ou moins")} sans réponse depuis moins de 30 jours.`, fix: "Répondre poliment et factuellement sous 48 h (proposer un échange hors ligne) ; aucune réponse n’est publiée sans validation." });
    else if (unanswered.length >= 2) findings.push({ code: "reviews_unanswered", severity: "medium", title: "Avis récents sans réponse", detail: `${plural(unanswered.length, "avis", "avis")} des 30 derniers jours sans réponse.`, fix: "Remercier chaque client en citant la prestation : les réponses comptent pour le classement local." });
    const last = reviews.recent[0];
    if (reviews.total !== null && (!last || now.getTime() - Date.parse(last.at) > 90 * DAY)) findings.push({ code: "reviews_stale", severity: "low", title: "Aucun nouvel avis depuis 3 mois", detail: last ? `Dernier avis le ${last.at.slice(0, 10)}.` : "Aucun avis sur la fiche.", fix: "Demander un avis après chaque chantier terminé (lien direct vers la fiche, carte ou SMS)." });
  }
  const m = snapshot.metrics, p = snapshot.previous;
  if (m && p) {
    const actions = (x: LocalMetrics) => (x.calls ?? 0) + (x.websiteClicks ?? 0) + (x.directions ?? 0);
    const before = actions(p), current = actions(m);
    if (before >= 20 && current <= before * 0.7) findings.push({ code: "actions_drop", severity: "medium", title: "Moins d’actions sur la fiche Google", detail: `Appels, clics vers le site et itinéraires : ${current} sur 28 jours contre ${before} les 28 jours précédents (−${Math.round((1 - current / before) * 100)} %).`, fix: "Vérifier la fiche (horaires, catégorie, photos récentes, posts réguliers) et les avis récents." });
  }
  return findings;
}
export const LOCAL_CODES = ["negative_review_unanswered", "reviews_unanswered", "reviews_stale", "actions_drop"] as const;
export const localFingerprint = (clientId: string, code: string) => `local-seo:${clientId}:${code}`;
