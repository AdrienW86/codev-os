"use client";
import { useEffect, useRef, useState } from "react";
type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
export function PwaStatus() {
  const [offline, setOffline] = useState(false); const [update, setUpdate] = useState<ServiceWorker | null>(null); const [installable, setInstallable] = useState(false); const install = useRef<InstallEvent | null>(null);
  useEffect(() => {
    let alive = true;
    const network = () => setOffline(!navigator.onLine);
    const prompt = (event: Event) => { event.preventDefault(); install.current = event as InstallEvent; setInstallable(true); };
    network(); window.addEventListener("online", network); window.addEventListener("offline", network); window.addEventListener("beforeinstallprompt", prompt);
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then((registration) => {
      if (!alive) return; if (registration.waiting) setUpdate(registration.waiting);
      registration.addEventListener("updatefound", () => { const worker = registration.installing; worker?.addEventListener("statechange", () => { if (alive && worker.state === "installed" && navigator.serviceWorker.controller) setUpdate(worker); }); });
    }).catch(() => {});
    return () => { alive = false; window.removeEventListener("online", network); window.removeEventListener("offline", network); window.removeEventListener("beforeinstallprompt", prompt); };
  }, []);
  return <div className="flex flex-wrap items-center gap-2 text-xs">{offline && <p role="status">Hors connexion — les données affichées peuvent être anciennes. Reconnectez-vous pour les actualiser.</p>}{update && <button type="button" className="min-h-11 rounded-lg border border-border px-3" onClick={() => { navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true }); update.postMessage("ACTIVATE_UPDATE"); }}>Mise à jour disponible · Recharger</button>}{installable && <button type="button" className="min-h-11 rounded-lg border border-border px-3" onClick={async () => { await install.current?.prompt(); setInstallable(false); }}>Installer CODE-V OS</button>}</div>;
}
