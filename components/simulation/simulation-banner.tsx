"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useSimulation } from "@/components/simulation/simulation-provider";

/** Pages qui affichent le monde simulé lorsque la simulation est active. */
export const simulatedPaths = ["/dashboard", "/clients", "/work", "/agenda", "/reports", "/publications", "/agents", "/settings"];

export function isSimulatedPath(pathname: string) {
  if (pathname.startsWith("/clients/")) return /^\/clients\/sim-[^/]+$/.test(pathname); // fiche client simulée
  return simulatedPaths.includes(pathname) || pathname === "/settings/simulation";
}

/** Bandeau toujours visible en simulation : aucune confusion avec les données réelles. */
export function SimulationBanner() {
  const { scenario, reset, disable } = useSimulation();
  const pathname = usePathname();
  if (!scenario) return null;
  const real = !isSimulatedPath(pathname);
  return (
    <div role="region" aria-label="Mode simulation" className="border-b border-sky-400/25 bg-sky-400/10 px-5 py-2.5 text-sm text-sky-100 sm:px-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="inline-flex items-center gap-2 font-medium"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-sky-300" />Simulation · {scenario.name}</span>
        <span className="text-xs text-sky-200/80">{real ? "Cette page n’est pas simulée : elle affiche les données réelles." : "Données fictives, rien n’est enregistré."}</span>
        <span className="ml-auto flex flex-wrap gap-1">
          <Link href="/settings/simulation" className="inline-flex min-h-9 items-center rounded-md px-2.5 text-xs hover:bg-white/10">Changer de scénario</Link>
          <button type="button" onClick={reset} className="min-h-9 rounded-md px-2.5 text-xs hover:bg-white/10">Réinitialiser</button>
          <button type="button" onClick={disable} className="min-h-9 rounded-md border border-sky-300/30 px-2.5 text-xs hover:bg-white/10">Quitter la simulation</button>
        </span>
      </div>
    </div>
  );
}

/** CTA pour une fonctionnalité sans backend : ouvre le parcours en simulation. */
export function TrySimulationButton({ scenarioId = "normal", href, children = "Essayer en simulation", className }: { scenarioId?: string; href: string; children?: ReactNode; className?: string }) {
  const { enable } = useSimulation();
  return <button type="button" onClick={() => enable(scenarioId, href)} className={className ?? "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-sky-400/40 px-4 text-sm font-medium text-sky-200 hover:bg-sky-400/10"}>{children}</button>;
}
