import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { categories, preferencesSchema, subscriptionSchema } from "./schema";
const db = () => getSupabaseServerClient();
const defaults = { categories: [...categories], push_enabled: false, push_categories: categories.filter((value) => value !== "analysis_completed") };
export async function notificationPreferences() {
  const { userId } = await requireAdmin();
  const { data, error } = await db().from("admin_notification_preferences").select("categories,push_enabled,push_categories").eq("user_id", userId).maybeSingle();
  if (error) throw new Error("Préférences indisponibles : vérifiez la migration notifications.");
  return data ? preferencesSchema.parse(data) : defaults;
}
export async function listNotifications() {
  const { userId } = await requireAdmin(); const prefs = await notificationPreferences();
  const events = await db().from("admin_notifications").select("id,category,href,created_at").in("category", prefs.categories).order("created_at", { ascending: false }).limit(100);
  const reads = await db().from("admin_notification_reads").select("notification_id").eq("user_id", userId).in("notification_id", (events.data ?? []).map((row) => row.id));
  if (events.error || reads.error) throw new Error("Notifications indisponibles.");
  const seen = new Set(reads.data?.map((row) => row.notification_id));
  return (events.data ?? []).map((row) => ({ ...row, read: seen.has(row.id) }));
}
export async function unreadNotificationCount() {
  const { userId } = await requireAdmin();
  const { data, error } = await db().rpc("codev_unread_notifications", { p_user_id: userId });
  if (error) throw new Error("Compteur indisponible."); return data;
}
export async function markNotificationRead(id: unknown) {
  const { userId } = await requireAdmin();
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) throw new Error("Notification invalide.");
  const { error } = await db().from("admin_notification_reads").upsert({ notification_id: id, user_id: userId }, { onConflict: "notification_id,user_id", ignoreDuplicates: true });
  if (error) throw new Error("Lecture non enregistrée.");
}
export async function saveNotificationPreferences(input: unknown) {
  const { userId } = await requireAdmin(); const value = preferencesSchema.parse(input);
  const { error } = await db().from("admin_notification_preferences").upsert({ user_id: userId, ...value });
  if (error) throw new Error("Préférences non enregistrées.");
}
export async function subscribeDevice(input: unknown) {
  const { userId } = await requireAdmin(); const value = subscriptionSchema.parse(input);
  const { error } = await db().rpc("codev_subscribe_push", { p_user_id: userId, p_device_id: value.deviceId, p_endpoint: value.endpoint, p_keys: value.keys });
  if (error) throw new Error("Abonnement non enregistré (dix appareils maximum).");
}
export async function revokeDevice(deviceId: unknown) {
  const { userId } = await requireAdmin();
  if (typeof deviceId !== "string" || !/^[0-9a-f-]{36}$/.test(deviceId)) throw new Error("Appareil invalide.");
  const { error } = await db().from("admin_push_subscriptions").delete().eq("user_id", userId).eq("device_id", deviceId);
  if (error) throw new Error("Révocation non enregistrée.");
}
export async function listPushDevices() {
  const { userId } = await requireAdmin();
  const { data, error } = await db().from("admin_push_subscriptions").select("device_id,created_at").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) throw new Error("Appareils indisponibles."); return data ?? [];
}
