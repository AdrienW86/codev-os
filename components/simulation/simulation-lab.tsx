"use client";

import Link from "next/link";
import { useState } from "react";
import { actionClass } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { useSimulation } from "@/components/simulation/simulation-provider";

type ScenarioSummary = { id: string; name: string; description: string; focus: string };

/** Scenario Lab : choisir un scénario, l’activer, puis parcourir l’application. */
export function SimulationLab({ scenarios }: { scenarios: ScenarioSummary[] }) {
  const { scenario, world, enable, disable, reset } = useSimulation();
  const [selected, setSelected] = useState(scenario?.id ?? scenarios[0].id);
  const chosen = scenarios.find((item) => item.id === selected) ?? scenarios[0];
  const firstClient = world?.clients[0]?.id;
  const shortcuts = [
    { label: "Accueil", href: "/dashboard" }, { label: "Client", href: firstClient ? `/clients/${firstClient}` : "/clients" },
    { label: "Travail", href: "/work" }, { label: "Agenda", href: "/agenda" }, { label: "Agents", href: "/agents" },
    { label: "Publications", href: "/publications" }, { label: "Rapports", href: "/reports" }, { label: "Paramètres", href: "/settings" },
  ];

  return (
    <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section aria-labelledby="scenario-title">
        <h2 id="scenario-title" className="mb-4 text-lg font-semibold">Scénario</h2>
        <fieldset>
          <legend className="sr-only">Choisir un scénario</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {scenarios.map((item) => (
              <label key={item.id} className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors ${selected === item.id ? "border-accent/60 bg-accent/5" : "border-border hover:border-accent/30"}`}>
                <input type="radio" name="scenario" value={item.id} checked={selected === item.id} onChange={() => setSelected(item.id)} className="mt-1 accent-[#b8f49b]" />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 font-medium">{item.name}{scenario?.id === item.id && <StatusBadge label="Actif" tone="blue" />}</span>
                  <span className="mt-1 block text-sm text-muted">{item.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="sticky bottom-3 z-10 mt-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-surface/95 p-3 backdrop-blur xl:hidden">
          <span className="min-w-0 truncate text-sm">{chosen.name}</span>
          <button type="button" onClick={() => enable(chosen.id, chosen.focus)} className={actionClass("primary")}>{scenario ? "Ouvrir" : "Activer"}</button>
        </div>
      </section>

      <aside className="space-y-4 xl:sticky xl:top-6">
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-xs text-muted">Sélection</p>
          <p className="mt-1 font-semibold">{chosen.name}</p>
          <p className="mt-1 text-sm text-muted">{chosen.description}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => enable(chosen.id, chosen.focus)} className={actionClass("primary")}>{scenario ? "Changer et ouvrir" : "Activer la simulation"}</button>
            {scenario && <button type="button" onClick={disable} className={actionClass("secondary")}>Quitter</button>}
          </div>
          {scenario && <button type="button" onClick={reset} className="mt-3 text-xs text-muted hover:text-foreground">Réinitialiser « {scenario.name} »</button>}
        </div>
        {scenario && (
          <nav aria-label="Accès rapide" className="rounded-xl border border-border bg-surface p-5">
            <p className="mb-3 text-sm font-medium">Accès rapide</p>
            <ul className="grid grid-cols-2 gap-2">{shortcuts.map((item) => <li key={item.label}><Link href={item.href} className={actionClass("secondary", "w-full")}>{item.label}</Link></li>)}</ul>
          </nav>
        )}
        <InlineNotice tone="info" title="Règles de la simulation">
          Données fictives dans ce navigateur uniquement (session). Rien n’est écrit en base, aucun appel externe, aucune publication, aucun e-mail. Un bandeau bleu signale chaque page simulée.
        </InlineNotice>
      </aside>
    </div>
  );
}
