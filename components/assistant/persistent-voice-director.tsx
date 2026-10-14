"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { AssistantCommandBox } from "@/components/dashboard/assistant-command-box";
import { Icon } from "@/components/ui/icon";

/**
 * One persistent assistant instance in the authenticated layout.
 * Visual collapse only: voice session and conversation do not unmount on route change.
 */
export function PersistentVoiceDirector() {
  const pathname = usePathname();
  const [panel, setPanel] = useState({ pathname, expanded: false });
  // Derive visibility from the current route without a synchronous effect update.
  const expanded = panel.pathname === pathname && panel.expanded;

  return (
    <aside aria-label="Directeur opérationnel IA" className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 w-[min(28rem,calc(100vw-2rem))]">
      <div id="persistent-voice-panel" className={expanded
        ? "mb-3 max-h-[min(70dvh,42rem)] overflow-y-auto rounded-2xl border border-border bg-surface shadow-2xl"
        : "hidden"}>
        <AssistantCommandBox suggestions={[]} />
      </div>
      <div className="flex justify-end">
        <button type="button"
          aria-expanded={expanded} aria-controls="persistent-voice-panel"
          aria-label={expanded ? "Réduire le directeur IA" : "Ouvrir le directeur IA"}
          onClick={() => setPanel({ pathname, expanded: !expanded })}
          className="inline-flex min-h-12 items-center gap-2.5 rounded-full border border-accent/35 bg-surface px-4 py-3 text-sm font-medium text-foreground shadow-xl backdrop-blur transition-colors hover:border-accent/65 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          <Icon name="mic" width={18} height={18} className="text-accent" />
          <span>{expanded ? "Réduire" : "Directeur IA"}</span>
        </button>
      </div>
      <p className="sr-only" aria-live="polite">Écran actuel : {pathname}</p>
    </aside>
  );
}
