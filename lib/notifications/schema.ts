import { z } from "zod";
export const categories = ["report_ready", "analysis_completed", "analysis_failed", "incident", "delivery_failed"] as const;
export const notificationLabels: Record<(typeof categories)[number], string> = { report_ready: "Rapport prêt à relire", analysis_completed: "Analyse terminée", analysis_failed: "Analyse en échec", incident: "Incident important", delivery_failed: "Échec ou incertitude d’envoi" };
export const preferencesSchema = z.object({ categories: z.array(z.enum(categories)).max(5), push_enabled: z.boolean(), push_categories: z.array(z.enum(categories)).max(5) }).strict();
export const subscriptionSchema = z.object({ deviceId: z.uuid(), endpoint: z.url().max(2048).refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.port && ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}), keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{87,88}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/) }).strict() }).strict();
export function safeNotificationHref(href: string) { return /^\/(reports|advertising\/analyses|agents)\/[0-9a-f-]{36}$/.test(href) || href === "/work?kind=incident" ? href : "/notifications"; }
