import { z } from "zod";
export const categories = ["report_ready", "analysis_completed", "analysis_failed", "incident", "delivery_failed", "media_received", "media_missing", "publication_review", "blog_scheduled", "negative_review"] as const;
export const notificationLabels: Record<(typeof categories)[number], string> = { report_ready: "Rapport prêt à relire", analysis_completed: "Analyse terminée", analysis_failed: "Analyse en échec", incident: "Incident important", delivery_failed: "Publication ou envoi en échec", media_received: "Nouveaux médias WhatsApp", media_missing: "Photo manquante pour une publication", publication_review: "Publications du mois à valider", blog_scheduled: "Article de blog prévu demain", negative_review: "Avis Google négatif à traiter" };
// Règle de l'utilisateur (2026-11-20) : on ne notifie (cloche, liste, push) que deux choses.
// 1. Une publication (ou un envoi à un client) en échec, ou un créneau qui n'a pas pu être préparé.
// 2. L'avis mensuel « publications du mois à valider par lot » (clé monthly-review:<AAAA-MM>).
// 3. (2026-11-28, Agent Avis Google validé par l'administrateur) Un avis Google de 3 étoiles ou moins, tout de suite.
// Tout le reste (publication à valider au fil de l'eau, photo manquante, médias reçus, article prévu, rapport prêt,
// analyse terminée ou en échec, incidents) reste visible dans l'application, sans notification.
export const alertCategories = ["delivery_failed", "publication_review", "negative_review"] as const satisfies readonly (typeof categories)[number][];
export const isAlertCategory = (value: unknown): value is (typeof alertCategories)[number] => (alertCategories as readonly unknown[]).includes(value);
export const MONTHLY_REVIEW_PREFIX = "monthly-review:";
/** Une ligne admin_notifications mérite-t-elle une notification ? « À valider » : seulement l'avis mensuel. */
export function isNotifiable(row: { category?: string | null; event_key?: string | null }) {
  if (row.category === "delivery_failed" || row.category === "negative_review") return true;
  return row.category === "publication_review" && typeof row.event_key === "string" && row.event_key.startsWith(MONTHLY_REVIEW_PREFIX);
}
export const preferencesSchema = z.object({ categories: z.array(z.enum(alertCategories)).max(alertCategories.length), push_enabled: z.boolean(), push_categories: z.array(z.enum(alertCategories)).max(alertCategories.length) }).strict();
export const subscriptionSchema = z.object({ deviceId: z.uuid(), endpoint: z.url().max(2048).refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.port && ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}), keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{87,88}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/) }).strict() }).strict();
export function safeNotificationHref(href: string) { return /^\/(reports|advertising\/analyses|agents|publications|blog)\/[0-9a-f-]{36}$/.test(href) || /^\/clients\/[0-9a-f-]{36}\?tab=media$/.test(href) || href === "/work?kind=incident" || href === "/publications/review" || href === "/settings/whatsapp" || /^\/avis\?client=[0-9a-f-]{36}$/.test(href) ? href : "/notifications"; }
