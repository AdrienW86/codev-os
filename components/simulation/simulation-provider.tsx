"use client";

import dynamic from "next/dynamic";
import { useMemo, type ReactNode } from "react";
import { simulationCookieValue } from "@/lib/simulation/cookie";
import { SimulationContext, type SimulationContextValue } from "@/components/simulation/simulation-context";

export { useSimulation, useSimWorld } from "@/components/simulation/simulation-context";

// Le monde fictif, ses scénarios et le tiroir ne sont téléchargés que lorsqu'une simulation est active :
// hors simulation (cas courant), aucune page ne charge ce code.
const ActiveSimulationProvider = dynamic(() => import("@/components/simulation/active-simulation-provider"));

const noop = () => {};

export function SimulationProvider({ scenarioId, children }: { scenarioId: string | null; children: ReactNode }) {
  const inactive = useMemo<SimulationContextValue>(() => ({
    scenario: null, world: null, update: noop, reset: noop, open: noop,
    // Changement de mode : rechargement complet, pour que layout et pages lisent le même scénario.
    enable: (id, href) => { document.cookie = simulationCookieValue(id); window.location.assign(href ?? window.location.href); },
    disable: () => { document.cookie = simulationCookieValue(null); window.location.assign(window.location.href); },
  }), []);
  if (scenarioId) return <ActiveSimulationProvider scenarioId={scenarioId}>{children}</ActiveSimulationProvider>;
  return <SimulationContext.Provider value={inactive}>{children}</SimulationContext.Provider>;
}
