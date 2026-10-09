"use client";

import { useState } from "react";
import { Action } from "@/components/ui/button";
import { ConfirmationDialog, Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { SectionHeader } from "@/components/ui/layout";
import { InlineNotice } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { useSimWorld } from "@/components/simulation/simulation-provider";
import { newSimId } from "@/components/simulation/entity-drawer";
import { getAgentBlueprint } from "@/lib/agents/catalog";
import { serviceCatalog, type ServiceDefinition, type ServiceId } from "@/lib/services/catalog";
import { agentStatusLabels, isAgentWorking } from "@/lib/simulation/labels";
import type { SimClient } from "@/lib/simulation/types";

type Step = { mode: "catalog" } | { mode: "detail"; serviceId: ServiceId; fromCatalog?: boolean } | { mode: "added"; serviceId: ServiceId };

/** Services & agents d’un client simulé : ajout, configuration et désactivation (CAS A, B). */
export function SimServices({ client }: { client: SimClient }) {
  const { world, update, open } = useSimWorld();
  const [step, setStep] = useState<Step | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<ServiceId | null>(null);

  const statusOf = (service: ServiceDefinition) => service.includedByDefault ? "included" : client.services[service.id] ?? "not-subscribed";
  const shown = serviceCatalog.filter((service) => statusOf(service) !== "not-subscribed");
  const available = serviceCatalog.filter((service) => statusOf(service) === "not-subscribed");
  const service = step && step.mode !== "catalog" ? serviceCatalog.find((item) => item.id === step.serviceId) ?? null : null;

  const statusBadge = (status: string) => status === "included" ? <StatusBadge label="Inclus" tone="green" />
    : status === "active" ? <StatusBadge label="Actif" tone="green" />
    : status === "to-configure" ? <StatusBadge label="À configurer" tone="amber" /> : <StatusBadge label="Non souscrit" />;

  function addService(serviceId: ServiceId) {
    const definition = serviceCatalog.find((item) => item.id === serviceId);
    update((draft) => {
      const target = draft.clients.find((item) => item.id === client.id);
      if (!target || !definition) return;
      const ready = definition.defaultAgents.every((agentId) => isAgentWorking(draft.agents[agentId as keyof typeof draft.agents].status));
      target.services[serviceId] = ready ? "active" : "to-configure";
      target.isNew = false;
    });
    setStep({ mode: "added", serviceId });
  }

  function createProject(serviceId: ServiceId, name: string) {
    const id = newSimId("project");
    update((draft) => { draft.projects.push({ id, clientId: client.id, name, serviceId, status: "setup" }); });
    return id;
  }

  const agentsOf = (definition: ServiceDefinition) => definition.defaultAgents.map((id) => getAgentBlueprint(id)).filter((agent) => agent !== null);

  return (
    <section aria-labelledby="sim-services" className="mt-8">
      <SectionHeader id="sim-services" title="Services & agents" description="Chaque service souscrit active ses agents."
        action={<Action onClick={() => setStep({ mode: "catalog" })}><Icon name="plus" width={16} height={16} />Ajouter un service</Action>} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((definition) => (
          <article key={definition.id} className="flex min-w-0 flex-col rounded-xl border border-border bg-surface p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-accent"><Icon name={definition.icon} width={18} height={18} /></span>
                <h3 className="font-semibold">{definition.name}</h3>
              </div>
              {statusBadge(statusOf(definition))}
            </div>
            <ul className="mt-4 space-y-2">
              {agentsOf(definition).map((agent) => (
                <li key={agent.id}>
                  <button type="button" onClick={() => open({ type: "agent", id: agent.id })} className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-left text-sm hover:bg-white/[0.06]">
                    <span className="flex min-w-0 items-center gap-2"><Icon name="agents" width={16} height={16} className="shrink-0 text-muted" /><span className="truncate">{agent.name}</span></span>
                    <StatusBadge {...agentStatusLabels[world.agents[agent.id].status]} />
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-muted">{definition.description}</p>
            <button type="button" onClick={() => setStep({ mode: "detail", serviceId: definition.id })} className="mt-auto inline-flex min-h-10 items-center gap-1.5 self-start pt-4 text-sm text-accent hover:underline">
              Détails<span className="sr-only"> du service {definition.name}</span><Icon name="arrow" width={16} height={16} />
            </button>
          </article>
        ))}
      </div>

      <Dialog
        open={step !== null}
        onClose={() => setStep(null)}
        onBack={step?.mode === "detail" && step.fromCatalog ? () => setStep({ mode: "catalog" }) : undefined}
        title={step?.mode === "catalog" ? "Ajouter un service" : step?.mode === "added" ? "Service ajouté" : service?.name ?? ""}
        description={step?.mode === "catalog" ? `Pour ${client.name} · simulation` : undefined}
      >
        {step?.mode === "catalog" && (available.length ? (
          <ul className="space-y-2">
            {available.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => setStep({ mode: "detail", serviceId: item.id, fromCatalog: true })} className="flex w-full items-center gap-3 rounded-xl border border-border p-4 text-left hover:border-accent/40">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-accent"><Icon name={item.icon} width={18} height={18} /></span>
                  <span className="min-w-0 flex-1"><span className="block font-medium">{item.name}</span><span className="mt-0.5 block text-sm text-muted">{item.description}</span></span>
                  <Icon name="arrow" width={16} height={16} className="shrink-0 text-muted" />
                </button>
              </li>
            ))}
          </ul>
        ) : <InlineNotice>Tous les services du catalogue sont déjà actifs pour ce client.</InlineNotice>)}

        {step?.mode === "detail" && service && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">{statusBadge(statusOf(service))}<p className="text-sm text-muted">{service.description}</p></div>
            {agentsOf(service).map((agent) => {
              const status = world.agents[agent.id].status;
              const working = isAgentWorking(status);
              return (
                <div key={agent.id} className="rounded-xl border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{agent.name}</h3><StatusBadge {...agentStatusLabels[status]} /></div>
                  <p className="mt-1 text-sm text-muted">{agent.role}</p>
                  <ul className="mt-3 space-y-1.5 text-sm">{agent.capabilities.map((capability) => <li key={capability.label} className={`flex gap-2 ${working ? "" : "text-muted"}`}><span aria-hidden="true" className={`w-4 text-center ${working ? "text-accent" : ""}`}>{working ? "✓" : "○"}</span>{capability.label}</li>)}</ul>
                  <button type="button" onClick={() => { setStep(null); open({ type: "agent", id: agent.id }); }} className="mt-3 inline-flex min-h-10 items-center text-sm text-accent hover:underline">{working ? "Voir l’agent" : "Configurer l’agent"}</button>
                </div>
              );
            })}
            {statusOf(service) === "not-subscribed" ? (
              <Action variant="primary" onClick={() => addService(service.id)}>Ajouter ce service (simulation)</Action>
            ) : statusOf(service) === "included" ? (
              <InlineNotice>Inclus pour tous les clients : l’Agent Rapport rassemble toute l’activité du client.</InlineNotice>
            ) : (
              <div className="space-y-3">
                <InlineNotice title="Désactiver ce service">Les agents liés ne seront plus actifs pour les prochaines exécutions. L’historique (publications, recommandations, tâches) reste conservé.</InlineNotice>
                <Action variant="danger" onClick={() => setConfirmRemove(service.id)}>Désactiver (simulation)</Action>
              </div>
            )}
          </div>
        )}

        {step?.mode === "added" && service && (() => {
          const project = world.projects.find((item) => item.clientId === client.id && item.serviceId === service.id);
          const pendingAgents = agentsOf(service).filter((agent) => !isAgentWorking(world.agents[agent.id].status));
          return (
            <div className="space-y-4">
              <InlineNotice tone="green" title={`${service.name} ajouté à ${client.name}`}>Ses agents apparaissent sur la fiche client.</InlineNotice>
              {project ? (
                <InlineNotice title="Projet créé" action={<Action onClick={() => { setStep(null); open({ type: "project", id: project.id }); }}>Ouvrir le projet</Action>}>{project.name}</InlineNotice>
              ) : (
                <InlineNotice title="Projet proposé" action={<Action variant="primary" onClick={() => createProject(service.id, `${service.name} — ${client.name}`)}>Créer le projet (simulation)</Action>}>
                  {service.name} — {client.name}
                </InlineNotice>
              )}
              {pendingAgents.length > 0 && (
                <InlineNotice tone="amber" title="Configuration à effectuer" action={pendingAgents.map((agent) => <Action key={agent.id} onClick={() => { setStep(null); open({ type: "agent", id: agent.id }); }}>Configurer {agent.name}</Action>)}>
                  {pendingAgents.map((agent) => agent.name).join(", ")} : {agentStatusLabels[world.agents[pendingAgents[0].id].status].label.toLowerCase()}.
                </InlineNotice>
              )}
              <Action variant="primary" onClick={() => setStep(null)}>Revenir au client</Action>
            </div>
          );
        })()}
      </Dialog>

      <ConfirmationDialog
        open={confirmRemove !== null}
        title="Désactiver ce service ?"
        message="Simulation : le service passe en « Non souscrit », ses agents s’arrêtent pour ce client. L’historique reste visible."
        confirmLabel="Désactiver"
        tone="danger"
        onCancel={() => setConfirmRemove(null)}
        onConfirm={() => {
          const id = confirmRemove;
          update((draft) => { const target = draft.clients.find((item) => item.id === client.id); if (target && id) delete target.services[id]; });
          setConfirmRemove(null); setStep(null);
        }}
      />
    </section>
  );
}

