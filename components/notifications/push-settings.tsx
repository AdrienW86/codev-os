"use client";
import { useRef, useState } from "react";
import { subscribePushAction, revokePushAction } from "@/app/(cockpit)/notifications/actions";
export function PushSettings({ publicKey, devices }: { publicKey: string | null; devices: { device_id: string; created_at: string }[] }) {
  const [notice, setNotice] = useState(""); const [pending, setPending] = useState(false); const busy = useRef(false);
  async function subscribe() {
    if (busy.current) return; busy.current = true; setPending(true);
    try {
      if (!publicKey || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) throw Error("Push indisponible. Sur iPhone, installez d’abord l’application depuis Safari sur l’écran d’accueil.");
      if (await Notification.requestPermission() !== "granted") throw Error("Autorisation refusée. Vous pouvez la modifier dans les réglages du navigateur.");
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      const ready = await navigator.serviceWorker.ready;
      const key = Uint8Array.from(atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")), (value) => value.charCodeAt(0));
      const existing = await ready.pushManager.getSubscription();
      const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      let deviceId = localStorage.getItem("codev-push-device"); if (!deviceId) { deviceId = crypto.randomUUID(); localStorage.setItem("codev-push-device", deviceId); }
      const result = await subscribePushAction({ deviceId, endpoint: subscription.endpoint, keys: subscription.toJSON().keys });
      if (!result.ok) { if (!existing) await subscription.unsubscribe(); throw Error(result.message); }
      setNotice("Cet appareil est abonné. Activez aussi les catégories push souhaitées dans les préférences.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Abonnement impossible."); }
    finally { busy.current = false; setPending(false); }
  }
  async function revoke(deviceId: string) {
    if (busy.current) return; busy.current = true; setPending(true);
    try {
      const result = await revokePushAction(deviceId); if (!result.ok) throw Error(result.message);
      if (localStorage.getItem("codev-push-device") === deviceId && "serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.getRegistration(); await (await registration?.pushManager.getSubscription())?.unsubscribe(); localStorage.removeItem("codev-push-device");
      }
      setNotice("Appareil révoqué sur le serveur.");
    } catch { setNotice("Révocation impossible : réessayez."); } finally { busy.current = false; setPending(false); }
  }
  return <div className="space-y-3"><button type="button" onClick={() => void subscribe()} disabled={pending || !publicKey} className="min-h-11 rounded-lg border border-border px-3 disabled:opacity-60">Autoriser les notifications sur cet appareil</button>{!publicKey && <p className="text-sm text-muted">Clés VAPID serveur non configurées. Les notifications internes restent disponibles.</p>}<ul className="space-y-2">{devices.map((device, index) => <li key={device.device_id} className="flex flex-wrap items-center gap-2 text-sm">Appareil {index + 1} · {new Date(device.created_at).toLocaleDateString("fr-FR")}<button disabled={pending} type="button" onClick={() => void revoke(device.device_id)} className="min-h-11 rounded-lg border border-border px-3">Révoquer</button></li>)}</ul><p role="status" className="text-sm text-muted">{notice}</p></div>;
}
