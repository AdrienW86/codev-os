"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { AssistantCommandBox } from "@/components/dashboard/assistant-command-box";

/**
 * Mounted once in the authenticated cockpit layout.
 * Keep the voice hook alive across client-side route transitions.
 */
export function PersistentVoiceDirector() {
  const [expanded, setExpanded] = useState(false);
  const pathname = usePathname();
  return (
    <aside aria-label="Directeur opérationnel vocal" className="fixed bottom-4 right-4 z-40 w-[min(29rem,calc(100vw-2rem))]">
      <div className="flex justify-end gap-2 pb-2">
        <button type="button" aria-expanded={expanded} aria-controls="persistent-voice-panel"
          onClick={() => setExpanded((value) => !value)}
          className="min-h-12 rounded-full border border-accent/40 bg-surface px-5 text-sm font-semibold text-foreground shadow-lg">
          {expanded ? "Réduire l’assistant" : "Parler au directeur IA"}
        </button>
      </div>
      <div id="persistent-voice-panel" className={expanded ? "max-h-[min(75dvh,44rem)] overflow-y-auto rounded-2xl shadow-2xl" : "hidden"}>
        <AssistantCommandBox />
        <p className="sr-only" aria-live="polite">Écran actuel : {pathname}</p>
      </div>
    </aside>
  );
}
