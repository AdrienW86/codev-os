"use client";

import { useSyncExternalStore } from "react";

// Confirmation persistante : quand l'élément concerné disparaît après l'action (archivé, annulé,
// créé depuis un modèle…), son formulaire est démonté avec son message. Cette zone, montée dans
// la mise en page, garde la confirmation visible quelques secondes.
type Flash = { id: number; text: string; ok: boolean };
let current: Flash | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export function flash(text: string, ok = true) {
  const id = Date.now() + Math.random();
  current = { id, text, ok };
  notify();
  setTimeout(() => { if (current?.id === id) { current = null; notify(); } }, 6000);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function FlashRegion() {
  const value = useSyncExternalStore(subscribe, () => current, () => null);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex justify-center sm:inset-x-auto sm:right-6">
      {value && (
        <p data-flash className={`pointer-events-auto max-w-md rounded-xl border px-4 py-3 text-sm shadow-lg ${value.ok ? "border-accent/40 bg-surface text-accent" : "border-amber-300/40 bg-surface text-amber-200"}`}>{value.text}</p>
      )}
    </div>
  );
}
