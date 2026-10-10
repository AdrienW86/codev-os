/* Only a public offline document is cached. Never cache authenticated pages, APIs, RSC or client data. */
const CACHE = "codev-public-offline-v1";
self.addEventListener("install", (event) => event.waitUntil((async () => { const response = await fetch(new Request("/offline.html", { credentials: "omit", cache: "reload" })); if (!response.ok || response.redirected) throw new Error("Public offline page unavailable"); await (await caches.open(CACHE)).put("/offline.html", response); })()));
self.addEventListener("activate", (event) => event.waitUntil((async () => { for (const key of await caches.keys()) if (key.startsWith("codev-public-offline-") && key !== CACHE) await caches.delete(key); await self.clients.claim(); })()));
self.addEventListener("message", (event) => { if (event.data === "ACTIVATE_UPDATE") self.skipWaiting(); });
self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate" && new URL(event.request.url).origin === self.location.origin) {
    event.respondWith(fetch(new Request(event.request, { cache: "no-store" })).catch(async () => (await caches.open(CACHE)).match("/offline.html")));
  }
});
self.addEventListener("push", (event) => event.waitUntil((async () => {
  let url = "/notifications";
  try { const value = event.data.json(); if (/^\/notifications\?focus=[0-9a-f-]{36}$/.test(value.url)) url = value.url; } catch { /* generic message */ }
  await self.registration.showNotification("CODE-V OS", { body: "Une nouvelle notification est disponible.", icon: "/pwa/icon-192.png", badge: "/pwa/icon-192.png", tag: "codev-notifications", data: { url } });
})()));
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.url;
  const url = new URL(typeof path === "string" && /^\/notifications(?:\?focus=[0-9a-f-]{36})?$/.test(path) ? path : "/notifications", self.location.origin).href;
  event.waitUntil((async () => { const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true }); const existing = windows.find((client) => new URL(client.url).origin === self.location.origin); if (existing) { await existing.navigate(url); await existing.focus(); } else await self.clients.openWindow(url); })());
});
