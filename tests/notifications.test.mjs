import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadTs } from "./helpers/load-ts.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";
const schema = loadTs("lib/notifications/schema.ts");
const deviceId = "11111111-1111-4111-8111-111111111111";
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
  const service = loadTs("lib/notifications/service.ts", { "@/lib/require-admin": { requireAdmin: async () => { throw Error("denied"); } }, "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client }, "./schema": schema });
  for (const action of [() => service.listNotifications(), () => service.notificationPreferences(), () => service.markNotificationRead(deviceId), () => service.subscribeDevice({}), () => service.revokeDevice(deviceId)]) await assert.rejects(action, /denied/);
  assert.equal(fake.calls.length, 0);
});
test("Expired push devices are removed; only a discreet payload reaches the fake transport", async () => {
  const fake = createFakeSupabase({ admin_push_subscriptions: [{ id: deviceId, device_id: deviceId, user_id: "test_admin", endpoint: "https://fcm.googleapis.com/fake", keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) } }], admin_notification_preferences: [{ user_id: "test_admin", push_enabled: true, push_categories: ["incident"] }], admin_notifications: [{ id: deviceId, category: "incident", clientName: "SECRET" }], admin_push_deliveries: [{ notification_id: deviceId, subscription_id: deviceId, state: "sending" }] }, { rpc: { codev_claim_push: () => [{ notification_id: deviceId, subscription_id: deviceId, created_at: new Date().toISOString() }] } });
  const push = loadTs("lib/notifications/push.ts", { "web-push": { default: {} }, "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client }, "./schema": schema });
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
