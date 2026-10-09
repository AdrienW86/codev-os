"use client";

import { useSyncExternalStore } from "react";
import { formatDate } from "@/lib/format-date";
import type { NewsItem } from "@/lib/news/types";

const DISMISS_KEY = "codev:tech-news-dismissed";
const listeners = new Set<() => void>();
let hiddenInMemory = false;

function readDismissed() {
  try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
}

function dismiss() {
  try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* stockage indisponible : masqué jusqu’au rechargement */ }
  hiddenInMemory = true;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Actualités tech & IA (3 maximum). Prêt à être alimenté par un futur Agent Veille ;
 * `demo` signale des exemples statiques. Masquable pour la session en cours.
 */
export function TechNews({ items, demo = false }: { items: readonly NewsItem[]; demo?: boolean }) {
  const hidden = useSyncExternalStore(subscribe, () => hiddenInMemory || readDismissed(), () => false);
  if (hidden || !items.length) return null;
  return (
    <section aria-labelledby="tech-news-title" className="border-t border-border pt-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="tech-news-title" className="flex flex-wrap items-center gap-2 font-semibold">
          Actualités tech & IA
          {demo && <span className="rounded-md bg-white/5 px-2 py-0.5 text-xs font-normal text-muted">Exemples · veille bientôt disponible</span>}
        </h2>
        <button type="button" onClick={dismiss} className="min-h-10 shrink-0 rounded-lg px-3 text-xs text-muted hover:bg-white/5 hover:text-foreground">Masquer</button>
      </div>
      <ul className="grid gap-4 md:grid-cols-3">
        {items.slice(0, 3).map((item) => (
          <li key={item.id} className="min-w-0">
            <p className="text-xs text-muted"><span className="text-accent">{item.category}</span> · {item.source} · <time dateTime={item.date}>{formatDate(item.date)}</time></p>
            <h3 className="mt-1.5 text-sm font-medium">{item.url ? <a href={item.url} className="hover:text-accent hover:underline" target="_blank" rel="noreferrer">{item.title}</a> : item.title}</h3>
            <p className="mt-1 text-sm text-muted">{item.summary}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
