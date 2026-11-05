"use client";

import { createContext, useContext } from "react";
import type { Scenario } from "@/lib/simulation/scenarios";
import type { SimEntityRef, SimWorld } from "@/lib/simulation/types";

// Contexte seul (aucune donnée fictive) : importé partout sans alourdir les pages hors simulation.
export type SimulationContextValue = {
  scenario: Pick<Scenario, "id" | "name" | "description" | "focus"> | null;
  world: SimWorld | null;
  /** Modifie le monde simulé (copie, puis mutation). */
  update: (mutate: (world: SimWorld) => void) => void;
  reset: () => void;
  enable: (scenarioId: string, href?: string) => void;
  disable: () => void;
  open: (ref: SimEntityRef) => void;
};

export const SimulationContext = createContext<SimulationContextValue | null>(null);

export function useSimulation() {
  const context = useContext(SimulationContext);
  if (!context) throw new Error("SimulationProvider manquant.");
  return context;
}

/** Monde simulé actif (les vues simulées ne sont rendues qu’en simulation). */
export function useSimWorld() {
  const context = useSimulation();
  if (!context.world) throw new Error("Simulation inactive.");
  return { ...context, world: context.world };
}
