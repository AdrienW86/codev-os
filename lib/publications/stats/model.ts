// Statistiques des publications diffusées (architecture des agents, lot 3). Règles pures, sans réseau ni import.
// Relevé en lecture seule chez chaque réseau, avec les autorisations déjà accordées ; un réseau qui ne fournit pas de
// statistiques est marqué « non disponible », jamais compté zéro.

/** Fenêtre de suivi après la diffusion, et délai minimal entre deux relevés d'une même diffusion. */
export const STATS_WINDOW_DAYS = 30;
export const STATS_REFRESH_HOURS = 20;
/** Au-delà de 14 jours, un relevé par semaine suffit (les interactions ne bougent presque plus). */
export const STATS_SLOW_AFTER_DAYS = 14;
export const STATS_SLOW_REFRESH_DAYS = 7;
export const MAX_STATS_PER_TICK = 15;

export type StatsMetrics = { reactions?: number; likes?: number; comments?: number; shares?: number };
export type StatsDelivery = { id: string; client_id: string; platform: string; remote_id: string | null; published_at: string | null; scheduled_for: string };
export type StatsRow = { delivery_id: string; status: string; fetched_at: string };

/** Plateformes dont l'API, avec les autorisations actuelles, donne des chiffres par post. */
export const STATS_SUPPORTED = new Set(["facebook", "instagram"]);
/** Raison affichée quand un réseau ne fournit rien (pas de chiffre inventé). */
export const STATS_UNSUPPORTED_REASON: Record<string, string> = {
  google_business_profile: "google_no_post_insights",
  tiktok: "tiktok_scope_video_list_missing",
  snapchat: "snapchat_no_stats_api",
};

const DAY = 86_400_000, HOUR = 3_600_000;
const time = (value: string | null | undefined) => (typeof value === "string" ? Date.parse(value) : NaN);

/** Diffusions à relever maintenant, les plus anciennes jamais relevées d'abord. */
export function dueForStats(deliveries: readonly StatsDelivery[], stats: readonly StatsRow[], now: Date, max = MAX_STATS_PER_TICK): StatsDelivery[] {
  const last = new Map(stats.map((row) => [row.delivery_id, row]));
  return deliveries.filter((delivery) => {
    if (!delivery.remote_id || delivery.remote_id.startsWith("simulated-")) return false;
    const published = time(delivery.published_at ?? delivery.scheduled_for);
    if (!Number.isFinite(published) || now.getTime() - published > STATS_WINDOW_DAYS * DAY || published > now.getTime()) return false;
    const previous = last.get(delivery.id);
    if (!previous) return true;
    if (previous.status === "unsupported") return false;
    const age = now.getTime() - time(previous.fetched_at);
    if (!Number.isFinite(age)) return true;
    const slow = now.getTime() - published > STATS_SLOW_AFTER_DAYS * DAY;
    return age >= (slow ? STATS_SLOW_REFRESH_DAYS * DAY : STATS_REFRESH_HOURS * HOUR);
  }).sort((a, b) => Number(last.has(a.id)) - Number(last.has(b.id)) || time(a.published_at ?? a.scheduled_for) - time(b.published_at ?? b.scheduled_for)).slice(0, max);
}

const count = (value: unknown): number | undefined => (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 1e9 ? value : undefined);
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const summary = (value: unknown) => count(record(record(value).summary).total_count);
const clean = (metrics: StatsMetrics): StatsMetrics => Object.fromEntries(Object.entries(metrics).filter(([, v]) => v !== undefined)) as StatsMetrics;

/** Post Facebook : GET /{post}?fields=reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares */
export function readFacebookStats(body: unknown): StatsMetrics | null {
  const b = record(body);
  const metrics = clean({ reactions: summary(b.reactions), comments: summary(b.comments), shares: count(record(b.shares).count) ?? (b.reactions !== undefined ? 0 : undefined) });
  return Object.keys(metrics).length ? metrics : null;
}
/** Média Instagram : GET /{media}?fields=like_count,comments_count (like_count absent si le compte masque les « j'aime »). */
export function readInstagramStats(body: unknown): StatsMetrics | null {
  const b = record(body);
  const metrics = clean({ likes: count(b.like_count), comments: count(b.comments_count) });
  return Object.keys(metrics).length ? metrics : null;
}
export const FACEBOOK_STATS_FIELDS = "reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares";
export const INSTAGRAM_STATS_FIELDS = "like_count,comments_count";

/** Lecture sûre d'une ligne relue en base. */
export function readStoredMetrics(value: unknown): StatsMetrics {
  const v = record(value);
  return clean({ reactions: count(v.reactions), likes: count(v.likes), comments: count(v.comments), shares: count(v.shares) });
}
/** Interactions d'un post : réactions ou « j'aime » + commentaires + partages. */
export const interactions = (metrics: StatsMetrics) => (metrics.reactions ?? metrics.likes ?? 0) + (metrics.comments ?? 0) + (metrics.shares ?? 0);
