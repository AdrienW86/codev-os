"use client";

import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { todayInParis } from "@/lib/dashboard/home";
import { simulationCookieValue } from "@/lib/simulation/cookie";
import { buildScenarioWorld, getScenario, type Scenario } from "@/lib/simulation/scenarios";
import type { SimEntityRef, SimWorld } from "@/lib/simulation/types";
import { SimEntityDrawer } from "@/components/simulation/entity-drawer";

// ---------------------------------------------------------------------------------------------
// Store : un monde par scénario, gardé en sessionStorage. Jamais envoyé au serveur.
// ---------------------------------------------------------------------------------------------

const storageKey = (id: string, today: string) => `codev-simulation:${id}:${today}`;
const cache = new Map<string, SimWorld>();
const serverCache = new Map<string, SimWorld>();
const listeners = new Set<() => void>();

function readWorld(id: string, today: string): SimWorld {
  const key = storageKey(id, today);
  const cached = cache.get(key);
  if (cached) return cached;
  let world: SimWorld | null = null;
  try { const raw = sessionStorage.getItem(key); if (raw) world = JSON.parse(raw) as SimWorld; } catch { world = null; }
  world ??= buildScenarioWorld(id, today);
  cache.set(key, world);
  return world;
}

function writeWorld(id: string, today: string, world: SimWorld | null) {
  const key = storageKey(id, today);
  if (world) { cache.set(key, world); try { sessionStorage.setItem(key, JSON.stringify(world)); } catch { /* mémoire seule */ } }
  else { cache.delete(key); try { sessionStorage.removeItem(key); } catch { /* rien à nettoyer */ } }
  listeners.forEach((listener) => listener());
}

function serverWorld(id: string, today: string) {
  const key = storageKey(id, today);
  if (!serverCache.has(key)) serverCache.set(key, buildScenarioWorld(id, today));
  return serverCache.get(key)!;
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

// ---------------------------------------------------------------------------------------------

type SimulationContextValue = {
  scenario: Pick<Scenario, "id" | "name" | "description" | "focus"> | null;
  world: SimWorld | null;
  /** Modifie le monde simulé (copie, puis mutation). */
  update: (mutate: (world: SimWorld) => void) => void;
  reset: () => void;
  enable: (scenarioId: string, href?: string) => void;
  disable: () => void;
  open: (ref: SimEntityRef) => void;
};

const SimulationContext = createContext<SimulationContextValue | null>(null);

export function SimulationProvider({ scenarioId, children }: { scenarioId: string | null; children: ReactNode }) {
  const scenario = getScenario(scenarioId);
  const today = todayInParis();
  const world = useSyncExternalStore(
    subscribe,
    () => (scenario ? readWorld(scenario.id, today) : null),
    () => (scenario ? serverWorld(scenario.id, today) : null),
  );
  const [stack, setStack] = useState<SimEntityRef[]>([]);

  const update = useCallback((mutate: (world: SimWorld) => void) => {
    if (!scenario) return;
    const next = structuredClone(readWorld(scenario.id, today));
    mutate(next);
    writeWorld(scenario.id, today, next);
  }, [scenario, today]);

  const value = useMemo<SimulationContextValue>(() => ({
    scenario: scenario ? { id: scenario.id, name: scenario.name, description: scenario.description, focus: scenario.focus } : null,
    world,
    update,
    reset: () => { if (scenario) writeWorld(scenario.id, today, null); },
    // Changement de mode : rechargement complet, pour que layout et pages lisent le même scénario.
    enable: (id, href) => {
      document.cookie = simulationCookieValue(id);
      setStack([]);
      window.location.assign(href ?? window.location.href);
    },
    disable: () => { document.cookie = simulationCookieValue(null); setStack([]); window.location.assign(window.location.pathname.startsWith("/clients/sim-") ? "/clients" : window.location.href); },
    open: (ref) => setStack((current) => [...current, ref]),
  }), [scenario, world, update, today]);

  return (
    <SimulationContext.Provider value={value}>
      {children}
      {world && <SimEntityDrawer stack={stack} onBack={() => setStack((current) => current.slice(0, -1))} onClose={() => setStack([])} />}
    </SimulationContext.Provider>
  );
}

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
