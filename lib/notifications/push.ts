import "server-only";
import webpush from "web-push";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { subscriptionSchema } from "./schema";
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
      const { data: notification, error: eventError } = await db.from("admin_notifications").select("category").eq("id", delivery.notification_id).maybeSingle();
      // Check current opt-out and ownership again after reservation.
      if (!prefsError && !eventError && preferences?.push_enabled && preferences.push_categories.includes(notification?.category ?? "") && device.user_id === env.AUTHORIZED_ADMIN_USER_ID && Date.now() - Date.parse(delivery.created_at) < 3600000) {
        const subscription = subscriptionSchema.safeParse({ deviceId: device.device_id, endpoint: device.endpoint, keys: device.keys });
        if (subscription.success) {
          try {
            await transport({ endpoint: subscription.data.endpoint, keys: subscription.data.keys }, JSON.stringify({ title: "CODE-V OS", body: "Une nouvelle notification est disponible.", url: `/notifications?focus=${delivery.notification_id}` }), { TTL: 3600, timeout: 5000, urgency: "normal", vapidDetails: { subject: env.VAPID_SUBJECT!, publicKey: env.VAPID_PUBLIC_KEY!, privateKey: env.VAPID_PRIVATE_KEY! } });
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
