"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { AssistantCommandBox } from "@/components/dashboard/assistant-command-box";

/**
 * Instance unique : hors des pages de l'App Router, elle ne se démonte pas lors d'une
 * navigation interne. Le micro et le contexte des demandes restent dans le même hook.
 * Le panneau peut être masqué visuellement sans détruire la session.
 */
export function PersistentVoiceDirector() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const onDashboard = pathname === "/dashboard";
  const visible = expanded || onDashboard;
  return (
    <aside aria-label="Directeur opérationnel IA" className={visible
      ? "fixed inset-x-3 bottom-3 z-40 max-h-[min(78dvh,46rem)] overflow-y-auto rounded-2xl border border-border bg-background shadow-2xl sm:inset-x-auto sm:right-5 sm:w-[min(34rem,calc(100vw-2.5rem))]"
      : "fixed bottom-3 right-3 z-40 sm:bottom-5 sm:right-5"}>
      <div className={visible ? "flex items-center justify-between gap-3 border-b border-border px-4 py-2" : ""}>
        {visible && <p className="text-sm font-semibold">Directeur opérationnel IA</p>}
        <button type="button" aria-expanded={visible} aria-label={visible ? "Réduire le directeur IA" : "Ouvrir le directeur IA"}
          onClick={() => setExpanded((value) => onDashboard ? !value || !visible : !value)}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-accent/40 bg-surface px-4 py-2 text-sm font-medium text-foreground shadow-lg">
          <span aria-hidden="true">✦</span> {visible ? "Réduire" : "Parler à CODE-V"}
        </button>
      </div>
      <div hidden={!visible} aria-hidden={!visible} className="p-2">
        <AssistantCommandBox />
      </div>
    </aside>
  );
}
