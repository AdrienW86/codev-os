import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadTs } from "./helpers/load-ts.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";
const schema = loadTs("lib/notifications/schema.ts");
const deviceId = "11111111-1111-4111-8111-111111111111";
const resolution = loadTs("lib/notifications/resolution.ts");
test("Push destination survives login while external redirect paths are rejected", () => {
  const { cockpitReturnPath } = loadTs("lib/auth/return-path.ts");
  assert.equal(cockpitReturnPath(`/notifications?focus=${deviceId}`), `/notifications?focus=${deviceId}`);
  for (const value of ["https://evil.test", "//evil.test", "/\\evil.test", "/api/private"]) assert.equal(cockpitReturnPath(value), "/dashboard");
});
test("Push subscription rejects private endpoints and unvalidated keys", () => {
  const valid = { deviceId, endpoint: "https://fcm.googleapis.com/test", keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) } };
  assert.equal(schema.subscriptionSchema.safeParse(valid).success, true);
  for (const endpoint of ["http://127.0.0.1/private", "https://evil.test", "https://fcm.googleapis.com.evil.test", "https://user:password@fcm.googleapis.com/test"]) assert.equal(schema.subscriptionSchema.safeParse({ ...valid, endpoint }).success, false);
  assert.equal(schema.safeNotificationHref("https://evil.test"), "/notifications");
});
test("Admin denial precedes notification reads, preferences and subscription writes", async () => {
  const fake = createFakeSupabase({});
  const service = loadTs("lib/notifications/service.ts", { "@/lib/require-admin": { requireAdmin: async () => { throw Error("denied"); } }, "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client }, "./schema": schema, "./resolution": loadTs("lib/notifications/resolution.ts") });
  for (const action of [() => service.listNotifications(), () => service.notificationPreferences(), () => service.markNotificationRead(deviceId), () => service.subscribeDevice({}), () => service.revokeDevice(deviceId), () => service.dismissNotification(deviceId), () => service.dismissReadNotifications()]) await assert.rejects(action, /denied/);
  assert.equal(fake.calls.length, 0);
});
test("Expired push devices are removed; only a discreet payload reaches the fake transport", async () => {
  const fake = createFakeSupabase({ admin_push_subscriptions: [{ id: deviceId, device_id: deviceId, user_id: "test_admin", endpoint: "https://fcm.googleapis.com/fake", keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) } }], admin_notification_preferences: [{ user_id: "test_admin", push_enabled: true, push_categories: ["delivery_failed"] }], admin_notifications: [{ id: deviceId, category: "delivery_failed", event_key: "email:r:v1", clientName: "SECRET" }], admin_push_deliveries: [{ notification_id: deviceId, subscription_id: deviceId, state: "sending" }] }, { rpc: { codev_claim_push: () => [{ notification_id: deviceId, subscription_id: deviceId, created_at: new Date().toISOString() }] } });
  const push = loadTs("lib/notifications/push.ts", { "web-push": { default: {} }, "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client }, "./schema": schema, "./resolution": resolution });
  const env = { VAPID_PUBLIC_KEY: "fake", VAPID_PRIVATE_KEY: "fake", VAPID_SUBJECT: "mailto:admin@example.test", PUSH_SENDING_ENABLED: "true", AUTHORIZED_ADMIN_USER_ID: "test_admin" };
  let calls = 0;
  await push.flushPushNotifications({}, async () => { calls++; }); assert.equal(calls, 0);
  const result = await push.flushPushNotifications(env, async (_, payload) => { calls++; assert.equal(payload.includes("SECRET"), false); assert.match(payload, /\/notifications\?focus=/); throw { statusCode: 410 }; });
  assert.equal(calls, 1); assert.equal(result.failed, 1);
  assert.equal(fake.tables.admin_push_subscriptions.length, 0);
});
test("Service worker caches only public offline content and refuses external click destinations", async () => {
  const handlers = {}; const cached = []; const network = []; const opened = [];
  const cache = { put: async (url) => cached.push(url), match: async () => new Response("offline") };
  const request = class { constructor(value, options) { this.url = typeof value === "string" ? value : value.url; Object.assign(this, options); } };
  vm.runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), { Request: request, URL, self: { location: { origin: "https://os.example.test" }, addEventListener: (name, handler) => handlers[name] = handler, clients: { claim: async () => {}, matchAll: async () => [], openWindow: async (url) => opened.push(url) } }, caches: { open: async () => cache }, fetch: async (input) => { network.push(input); return new Response("private"); } });
  let work; handlers.install({ waitUntil: (promise) => work = promise }); await work; assert.deepEqual(cached, ["/offline.html"]);
  handlers.fetch({ request: { mode: "navigate", url: "https://os.example.test/clients/private" }, respondWith: (promise) => work = promise }); await work;
  assert.equal(cached.length, 1); assert.equal(network[1].cache, "no-store");
  handlers.notificationclick({ notification: { data: { url: "https://evil.test" }, close() {} }, waitUntil: (promise) => work = promise }); await work;
  assert.deepEqual(opened, ["https://os.example.test/notifications"]);
});

test("Read notifications can be removed from the list; unread ones never are", () => {
  const service = readFileSync("lib/notifications/service.ts", "utf8"), page = readFileSync("app/(cockpit)/notifications/page.tsx", "utf8");
  const sql = readFileSync("supabase/migrations/20261113000000_notifications_dismiss.sql", "utf8");
  assert.match(sql, /add column if not exists dismissed_at timestamptz/);
  // Retrait = mise à jour de la ligne de lecture : sans lecture préalable, rien n'est retiré.
  assert.match(service, /from\("admin_notification_reads"\)\.update\(\{ dismissed_at:/);
  assert.doesNotMatch(service, /from\("admin_notifications"\)\.delete/);
  assert.match(service, /filter\(\(row\) => !dismissed\.has\(row\.id\)\)/);
  assert.match(page, /row\.read \? <MutationForm action=\{dismissNotificationAction\}/);
  assert.match(page, /Supprimer les notifications lues/);
});

const env = { VAPID_PUBLIC_KEY: "fake", VAPID_PRIVATE_KEY: "fake", VAPID_SUBJECT: "mailto:admin@example.test", PUSH_SENDING_ENABLED: "true", AUTHORIZED_ADMIN_USER_ID: "test_admin" };
const sub = (id) => ({ id, device_id: id, user_id: "test_admin", endpoint: "https://fcm.googleapis.com/fake", keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) } });
const N = (n) => `aaaaaaaa-0000-4000-8000-00000000000${n}`, D = (n) => `dddddddd-0000-4000-8000-00000000000${n}`;

test("Only publication failures, the monthly batch notice and negative Google reviews notify (bell, list, badge)", async () => {
  assert.deepEqual([...schema.alertCategories], ["delivery_failed", "publication_review", "negative_review"]);
  assert.equal(schema.isNotifiable({ category: "negative_review", event_key: "negative-review:abc" }), true);
  for (const row of [{ category: "publication_review", event_key: "publication-review:day:2026-11-20" }, { category: "media_missing", event_key: "media-missing:x:2026-11-20" }, { category: "incident", event_key: "incident:x" }, { category: "analysis_failed", event_key: "analysis:x:failed" }, { category: "analysis_completed", event_key: "analysis:x:completed" }, { category: "report_ready", event_key: "report:x" }, { category: "blog_scheduled", event_key: "blog-scheduled:x" }, { category: "media_received", event_key: "x" }])
    assert.equal(schema.isNotifiable(row), false, row.event_key);
  assert.equal(schema.isNotifiable({ category: "delivery_failed", event_key: `publication-delivery:${D(1)}:failed` }), true);
  assert.equal(schema.isNotifiable({ category: "publication_review", event_key: "monthly-review:2026-12" }), true);
  // Préférences enregistrées avant : les catégories qui ne notifient plus sont ignorées à la lecture.
  const fake = createFakeSupabase({ admin_notification_preferences: [{ user_id: "test_admin", categories: ["publication_review", "incident", "delivery_failed"], push_enabled: true, push_categories: ["report_ready", "delivery_failed"] }],
    admin_notifications: [
      { id: N(1), category: "publication_review", event_key: "publication-review:day:2026-11-20", href: "/publications/review", created_at: "2026-11-20T08:00:00Z" },
      { id: N(2), category: "publication_review", event_key: "monthly-review:2026-12", href: "/publications/review", created_at: "2026-11-20T07:30:00Z" },
      { id: N(3), category: "incident", event_key: "incident:x", href: "/work?kind=incident", created_at: "2026-11-20T07:00:00Z" },
      { id: N(4), category: "delivery_failed", event_key: "email:r:v1", href: "/notifications", created_at: "2026-11-20T06:00:00Z" }], admin_notification_reads: [] });
  const service = loadTs("lib/notifications/service.ts", { "@/lib/require-admin": { requireAdmin: async () => ({ userId: "test_admin" }) }, "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client }, "./schema": schema, "./resolution": resolution });
  assert.deepEqual(JSON.parse(JSON.stringify(await service.notificationPreferences())), { categories: ["publication_review", "delivery_failed"], push_enabled: true, push_categories: ["delivery_failed"] });
  assert.deepEqual((await service.listNotifications()).map((row) => row.id), [N(2), N(4)]);
  assert.equal(await service.unreadNotificationCount(), 2);
});

test("Push: routine events never pushed; a repeated failure (same network, same cause) is pushed once per window", async () => {
  const tables = () => ({ admin_push_subscriptions: [sub(deviceId)], admin_notification_preferences: [{ user_id: "test_admin", push_enabled: true, push_categories: ["publication_review", "delivery_failed"] }],
    admin_notifications: [
      { id: N(1), category: "publication_review", event_key: "publication-review:day:2026-11-20" },
      { id: N(2), category: "delivery_failed", event_key: `publication-delivery:${D(2)}:blocked` },
      { id: N(3), category: "delivery_failed", event_key: `publication-delivery:${D(3)}:failed` },
      { id: N(4), category: "delivery_failed", event_key: `publication-delivery:${D(4)}:failed` }],
    publication_deliveries: [
      { id: D(1), platform: "snapchat", status: "blocked", last_error_code: null, blocked_reason: "permission_missing" },
      { id: D(2), platform: "snapchat", status: "blocked", last_error_code: null, blocked_reason: "permission_missing" },
      { id: D(3), platform: "instagram", status: "failed", last_error_code: "invalid_media", blocked_reason: null },
      { id: D(4), platform: "facebook", status: "failed", last_error_code: "invalid_media", blocked_reason: null }],
    admin_push_deliveries: [
      // Snapchat bloqué déjà poussé il y a 10 jours (fenêtre d'un mois pour une autorisation en attente).
      { notification_id: N(9), subscription_id: deviceId, state: "accepted", created_at: new Date(Date.now() - 10 * 86400000).toISOString() },
      // Instagram invalid_media déjà poussé il y a 2 jours (fenêtre de 24 h : on repousse).
      { notification_id: N(8), subscription_id: deviceId, state: "accepted", created_at: new Date(Date.now() - 2 * 86400000).toISOString() },
      ...[1, 2, 3, 4].map((n) => ({ notification_id: N(n), subscription_id: deviceId, state: "sending", created_at: new Date().toISOString() }))] });
  const t = tables();
  t.admin_notifications.push({ id: N(9), category: "delivery_failed", event_key: `publication-delivery:${D(1)}:blocked` }, { id: N(8), category: "delivery_failed", event_key: `publication-delivery:${D(5)}:failed` });
  t.publication_deliveries.push({ id: D(5), platform: "instagram", status: "failed", last_error_code: "invalid_media", blocked_reason: null });
  const fake = createFakeSupabase(t, { rpc: { codev_claim_push: () => [1, 2, 3, 4].map((n) => ({ notification_id: N(n), subscription_id: deviceId, created_at: new Date().toISOString() })) } });
  const push = loadTs("lib/notifications/push.ts", { "web-push": { default: {} }, "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client }, "./schema": schema, "./resolution": resolution });
  const sent = [];
  const result = await push.flushPushNotifications(env, async (_, payload) => { sent.push(JSON.parse(payload).url.split("focus=")[1]); });
  // Seuls les échecs Instagram (dernier push de cette cause il y a 2 jours) et Facebook (cause jamais poussée) partent.
  assert.deepEqual(sent, [N(3), N(4)]);
  assert.equal(result.accepted, 2);
});
