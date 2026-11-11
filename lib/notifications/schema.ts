import { z } from "zod";
export const categories = ["report_ready", "analysis_completed", "analysis_failed", "incident", "delivery_failed", "media_received", "media_missing", "publication_review", "blog_scheduled"] as const;
export const notificationLabels: Record<(typeof categories)[number], string> = { report_ready: "Rapport prêt à relire", analysis_completed: "Analyse terminée", analysis_failed: "Analyse en échec", incident: "Incident important", delivery_failed: "Échec ou incertitude d’envoi", media_received: "Nouveaux médias WhatsApp", media_missing: "Photo manquante pour une publication", publication_review: "Publication à valider", blog_scheduled: "Article de blog prévu demain" };
// Seules les alertes notifient (cloche, liste et push) : échecs et incidents. Les événements courants (publication à
// valider, photo manquante, médias reçus, article prévu, rapport prêt, analyse terminée) restent visibles dans leurs
// files de travail (/publications/review, photothèque, rapports) sans notification : ils arrivaient par dizaines chaque jour.
export const alertCategories = ["analysis_failed", "incident", "delivery_failed"] as const satisfies readonly (typeof categories)[number][];
export const isAlertCategory = (value: unknown): value is (typeof alertCategories)[number] => (alertCategories as readonly unknown[]).includes(value);
export const preferencesSchema = z.object({ categories: z.array(z.enum(alertCategories)).max(alertCategories.length), push_enabled: z.boolean(), push_categories: z.array(z.enum(alertCategories)).max(alertCategories.length) }).strict();
export const subscriptionSchema = z.object({ deviceId: z.uuid(), endpoint: z.url().max(2048).refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.port && ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}), keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{87,88}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/) }).strict() }).strict();
export function safeNotificationHref(href: string) { return /^\/(reports|advertising\/analyses|agents|publications|blog)\/[0-9a-f-]{36}$/.test(href) || /^\/clients\/[0-9a-f-]{36}\?tab=media$/.test(href) || href === "/work?kind=incident" || href === "/publications/review" || href === "/settings/whatsapp" ? href : "/notifications"; }
