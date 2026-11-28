import "server-only";
import webpush from "web-push";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { MONTHLY_REVIEW_PREFIX, isNotifiable, subscriptionSchema } from "./schema";
import { deliveryIdOf } from "./resolution";
type Env = Record<string, string | undefined>;
export function pushConfiguration(env: Env = process.env) {
  const configured = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
  return { enabled: configured && env.PUSH_SENDING_ENABLED === "true", publicKey: configured ? env.VAPID_PUBLIC_KEY! : null };
}
/** Called by the existing authenticated scheduler only. No automatic retries after ambiguous network failures. */
export async function flushPushNotifications(env: Env = process.env, transport = webpush.sendNotification) {
  if (!pushConfiguration(env).enabled) return { accepted: 0, failed: 0, disabled: true };
  const db = getSupabaseServerClient(); const token = crypto.randomUUID();
  const { data, error } = await db.rpc("codev_claim_push", { p_token: token, p_limit: 10 });
  if (error) throw new Error("Push reservation unavailable");
  let accepted = 0, failed = 0;
  for (const delivery of data ?? []) {
    const { data: device, error: deviceError } = await db.from("admin_push_subscriptions").select("user_id,device_id,endpoint,keys").eq("id", delivery.subscription_id).maybeSingle();
    let state = "failed";
    if (device && !deviceError) {
      const { data: preferences, error: prefsError } = await db.from("admin_notification_preferences").select("push_enabled,push_categories").eq("user_id", device.user_id).maybeSingle();
      const { data: notification, error: eventError } = await db.from("admin_notifications").select("category,event_key").eq("id", delivery.notification_id).maybeSingle();
      // Check current opt-out and ownership again after reservation. Only publication failures and the monthly batch notice
      // are ever pushed, and a repeated failure (same network, same cause) is pushed once per window.
      if (!prefsError && !eventError && notification && isNotifiable(notification) && !(await repeatedFailure(db, notification.event_key, delivery.notification_id)) && preferences?.push_enabled && preferences.push_categories.includes(notification?.category ?? "") && device.user_id === env.AUTHORIZED_ADMIN_USER_ID && Date.now() - Date.parse(delivery.created_at) < 3600000) {
        const subscription = subscriptionSchema.safeParse({ deviceId: device.device_id, endpoint: device.endpoint, keys: device.keys });
        if (subscription.success) {
          try {
            await transport({ endpoint: subscription.data.endpoint, keys: subscription.data.keys }, JSON.stringify({ title: "CODE-V OS", body: pushBody(notification), url: `/notifications?focus=${delivery.notification_id}` }), { TTL: 3600, timeout: 5000, urgency: "normal", vapidDetails: { subject: env.VAPID_SUBJECT!, publicKey: env.VAPID_PUBLIC_KEY!, privateKey: env.VAPID_PRIVATE_KEY! } });
            state = "accepted"; accepted++;
          } catch (error) {
            const code = (error as { statusCode?: number }).statusCode;
            if (code === 404 || code === 410) { state = "expired"; await db.from("admin_push_subscriptions").delete().eq("id", delivery.subscription_id).eq("user_id", device.user_id); }
            failed++;
          }
        } else failed++;
      } else state = "skipped";
    } else failed++;
    const { error: finishError } = await db.from("admin_push_deliveries").update({ state, updated_at: new Date().toISOString() }).eq("notification_id", delivery.notification_id).eq("subscription_id", delivery.subscription_id).eq("token", token).eq("state", "sending");
    if (finishError) throw new Error("Push state unavailable");
  }
  return { accepted, failed, disabled: false };
}

// Causes qui viennent d'une autorisation ou d'un réglage externe en attente (Snapchat, TikTok non audité…) : elles se
// répètent à chaque créneau tant que rien ne change ailleurs, une seule notification par mois suffit.
const PENDING_SETUP = /^(permission_missing|app_not_audited|auth|token|not_connected|account)/i;
export const REPEAT_WINDOW_MS = 24 * 3600000, SETUP_REPEAT_WINDOW_MS = 30 * 24 * 3600000;
type Db = ReturnType<typeof getSupabaseServerClient>;
type DeliveryRow = { id: string; platform: string | null; status: string | null; last_error_code: string | null; blocked_reason: string | null };
export const failureGroup = (d: DeliveryRow) => `${d.platform ?? "?"}:${d.status ?? "?"}:${d.last_error_code ?? d.blocked_reason ?? "?"}`;
export const failureWindow = (d: DeliveryRow) => PENDING_SETUP.test(d.last_error_code ?? d.blocked_reason ?? "") ? SETUP_REPEAT_WINDOW_MS : REPEAT_WINDOW_MS;
/**
 * Une diffusion en échec pour la même raison sur le même réseau qu'une alerte déjà poussée dans la fenêtre (24 h, ou
 * 30 jours pour une autorisation externe en attente) n'est pas repoussée : elle reste dans la liste, sans push.
 * En cas de lecture impossible, on pousse (mieux vaut une alerte de trop qu'un échec silencieux).
 */
async function repeatedFailure(db: Db, eventKey: string | null | undefined, notificationId: string) {
  const deliveryId = deliveryIdOf(eventKey);
  if (!deliveryId) return false;
  const current = await db.from("publication_deliveries").select("id,platform,status,last_error_code,blocked_reason").eq("id", deliveryId).maybeSingle();
  if (current.error || !current.data) return false;
  const since = new Date(Date.now() - failureWindow(current.data as DeliveryRow)).toISOString();
  const pushed = await db.from("admin_push_deliveries").select("notification_id").eq("state", "accepted").gte("created_at", since).neq("notification_id", notificationId).limit(500);
  if (pushed.error || !pushed.data?.length) return false;
  const events = await db.from("admin_notifications").select("event_key").in("id", [...new Set(pushed.data.map((row) => row.notification_id))]);
  const ids = [...new Set((events.data ?? []).map((row) => deliveryIdOf(row.event_key)).filter((id): id is string => Boolean(id) && id !== deliveryId))];
  if (events.error || !ids.length) return false;
  const others = await db.from("publication_deliveries").select("id,platform,status,last_error_code,blocked_reason").in("id", ids);
  if (others.error) return false;
  const group = failureGroup(current.data as DeliveryRow);
  return (others.data as DeliveryRow[] ?? []).some((row) => failureGroup(row) === group);
}
/** Texte discret (aucun contenu client) : l'avis mensuel ou une publication en échec. */
export function pushBody(notification: { event_key?: string | null }) {
  if (notification.event_key?.startsWith("negative-review:")) return "Nouvel avis Google négatif : une réponse est prête à relire.";
  return notification.event_key?.startsWith(MONTHLY_REVIEW_PREFIX) ? "Les publications du mois sont prêtes : validez-les par lot." : "Une publication ou un envoi a échoué.";
}
