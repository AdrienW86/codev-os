"use client";

import Link from "next/link";
import { EntityCard, SectionHeader } from "@/components/ui/layout";
import { PageHeading } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/status-badge";
import { useSimWorld } from "@/components/simulation/simulation-provider";
import { agentCatalog, scopeLabels } from "@/lib/agents/catalog";
import { getService } from "@/lib/services/catalog";
import { agentStatusLabels, formatSimDateTime, isAgentWorking } from "@/lib/simulation/labels";

/** Registre simulé : état, portée, services, clients, capacités, automatisations. */
export function SimAgents() {
  const { world, open } = useSimWorld();
  return (
    <>
      <PageHeading eyebrow="Registre" title="Agents" description="Les agents CODE-V, les services qu’ils servent et ce qu’ils savent faire." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {agentCatalog.map((agent) => {
          const state = world.agents[agent.id];
          const working = isAgentWorking(state.status);
          const clients = world.clients.filter((client) => agent.includedForAllClients || agent.services.some((service) => client.services[service]));
          return (
            <EntityCard key={agent.id} icon="agents" title={agent.name} eyebrow={`${scopeLabels[agent.scope]} · ${agent.services.map((id) => getService(id)?.name).join(", ")}`}
              status={agentStatusLabels[state.status]} onOpen={() => open({ type: "agent", id: agent.id })} description={agent.role}
              footer={<p className="text-xs text-muted">{agent.includedForAllClients ? `Tous les clients (${clients.length})` : `${clients.length} client${clients.length > 1 ? "s" : ""}`} · {working ? `${agent.capabilities.length} capacités actives` : `${agent.capabilities.length} capacités prévues`}</p>}>
              {state.note && !working && <p className="mt-3 text-xs text-amber-200">{state.note}</p>}
            </EntityCard>
          );
        })}
      </div>

      <section aria-labelledby="sim-automations" className="mt-12">
        <SectionHeader id="sim-automations" title="Automatisations" count={world.automations.length} action={<Link href="/settings?tab=automations" className="text-sm text-accent hover:underline">Gérer</Link>} />
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface px-5">
          {world.automations.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => open({ type: "automation", id: item.id })} className="grid w-full gap-2 py-4 text-left sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <span className="min-w-0"><span className="block font-medium">{item.label}</span><span className="block text-xs text-muted">{item.schedule} · {item.target} · prochaine : {item.status === "paused" ? "en pause" : formatSimDateTime(item.nextRun)}</span></span>
                <StatusBadge label={item.status === "active" ? "Active" : item.status === "paused" ? "En pause" : "En erreur"} tone={item.status === "active" ? "green" : item.status === "error" ? "red" : "neutral"} />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
