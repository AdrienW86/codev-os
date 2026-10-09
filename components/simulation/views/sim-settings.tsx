"use client";

import { useState } from "react";
import { Action } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { InlineNotice } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { useSimWorld } from "@/components/simulation/simulation-provider";
import { getAgentBlueprint } from "@/lib/agents/catalog";
import { connectionStatusLabels, formatSimDateTime } from "@/lib/simulation/labels";
import type { SimConnection } from "@/lib/simulation/types";

/** Connexions simulées : état, description, parcours de connexion fictif. */
export function SimConnections() {
  const { world, update } = useSimWorld();
  const [connecting, setConnecting] = useState<SimConnection | null>(null);
  const [step, setStep] = useState<"intro" | "consent" | "done">("intro");

  function finish() {
    const id = connecting?.id;
    update((draft) => { const target = draft.connections.find((item) => item.id === id); if (target) target.status = "connected"; if (id === "search-console") draft.agents.seo = { status: "ready" }; });
    setStep("done");
  }

  return (
    <>
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface px-5">
        {world.connections.map((connection) => (
          <li key={connection.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="min-w-0"><p className="font-medium">{connection.name}</p><p className="text-sm text-muted">{connection.description}</p></div>
            <div className="flex items-center gap-3">
              <StatusBadge {...connectionStatusLabels[connection.status]} />
              {connection.status === "coming-soon" ? <span className="text-xs text-muted">Prochaine version</span>
                : <Action onClick={() => { setConnecting(connection); setStep("intro"); }}>{connection.status === "connected" ? "Gérer" : connection.status === "error" ? "Reconnecter" : "Connecter"}</Action>}
            </div>
          </li>
        ))}
      </ul>
      <Dialog open={connecting !== null} onClose={() => setConnecting(null)} title={connecting?.name ?? ""} description="Parcours de connexion simulé : aucune autorisation réelle n’est demandée.">
        {connecting && step === "intro" && (
          <div className="space-y-4">
            <p className="text-sm">{connecting.description}</p>
            {connecting.status === "connected" ? <InlineNotice tone="green">Connexion active (simulation).</InlineNotice> : <InlineNotice tone="info">Vous serez redirigé vers le fournisseur pour autoriser CODE-V OS en lecture.</InlineNotice>}
            <div className="flex flex-wrap gap-2">
              {connecting.status === "connected"
                ? <Action variant="danger" onClick={() => { const id = connecting.id; update((draft) => { const target = draft.connections.find((item) => item.id === id); if (target) target.status = "to-connect"; }); setConnecting(null); }}>Déconnecter (simulation)</Action>
                : <Action variant="primary" onClick={() => setStep("consent")}>Continuer</Action>}
              <Action onClick={() => setConnecting(null)}>Annuler</Action>
            </div>
          </div>
        )}
        {connecting && step === "consent" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-background/60 p-4 text-sm">
              <p className="font-medium">{connecting.name} (écran fournisseur simulé)</p>
              <p className="mt-2 text-muted">CODE-V OS souhaite accéder en lecture à vos données {connecting.name}.</p>
            </div>
            <div className="flex flex-wrap gap-2"><Action variant="primary" onClick={finish}>Autoriser (simulation)</Action><Action onClick={() => setStep("intro")}>Retour</Action></div>
          </div>
        )}
        {connecting && step === "done" && (
          <div className="space-y-4">
            <InlineNotice tone="green" title="Connecté (simulation)">{connecting.id === "search-console" ? "L’Agent SEO & Site est maintenant prêt." : "Les agents concernés peuvent utiliser cette connexion."}</InlineNotice>
            <Action variant="primary" onClick={() => setConnecting(null)}>Terminer</Action>
          </div>
        )}
      </Dialog>
    </>
  );
}

/** Automatisations simulées (CAS H) : prochaine / dernière exécution, état, pause, historique. */
export function SimAutomations() {
  const { world, update, open } = useSimWorld();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <div className="mb-4 flex justify-end"><Action variant="primary" onClick={() => setCreating(true)}>+ Nouvelle automatisation</Action></div>
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface px-5">
        {world.automations.map((item) => (
          <li key={item.id} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <button type="button" onClick={() => open({ type: "automation", id: item.id })} className="min-w-0 text-left">
              <span className="block font-medium hover:text-accent">{item.label}</span>
              <span className="block text-xs text-muted">{item.schedule} · {getAgentBlueprint(item.agentId)?.name} · {item.target}</span>
              <span className="block text-xs text-muted">Prochaine : {item.status === "paused" ? "en pause" : formatSimDateTime(item.nextRun)} · Dernière : {item.lastRun ? formatSimDateTime(item.lastRun) : "jamais"}</span>
            </button>
            <div className="flex items-center gap-2">
              <StatusBadge label={item.status === "active" ? "Active" : item.status === "paused" ? "En pause" : "En erreur"} tone={item.status === "active" ? "green" : item.status === "error" ? "red" : "neutral"} />
              <Action onClick={() => update((draft) => { const target = draft.automations.find((other) => other.id === item.id); if (target) target.status = target.status === "paused" ? "active" : "paused"; })}>{item.status === "paused" ? "Reprendre" : "Pause"}</Action>
            </div>
          </li>
        ))}
      </ul>
      <Dialog open={creating} onClose={() => setCreating(false)} title="Nouvelle automatisation" description="Simulation">
        <div className="space-y-4">
          <p className="text-sm">Exemple prêt à l’emploi : <strong>« Tous les lundis à 08:00 » → Agent Monitoring Technique → clients Maintenance</strong>.</p>
          <Action variant="primary" onClick={() => {
            update((draft) => { draft.automations.push({ id: `sim-auto-${Date.now().toString(36)}`, label: "Contrôle hebdomadaire (copie)", schedule: "Tous les lundis à 08:00", agentId: "monitoring", target: "Clients Maintenance", nextRun: draft.automations[0]?.nextRun ?? `${draft.today}T08:00`, status: "active", history: [] }); });
            setCreating(false);
          }}>Créer cette automatisation (simulation)</Action>
          <InlineNotice tone="info">Aucune tâche planifiée réelle (cron) n’est créée.</InlineNotice>
        </div>
      </Dialog>
    </>
  );
}
