import { requireAdmin } from "@/lib/require-admin";
import type { Metadata } from "next";
import Link from "next/link";
import { AgentCard } from "@/components/agents/agent-card";
import { AgentRegistryCard } from "@/components/agents/agent-registry-card";
import { CapabilityLegend } from "@/components/agents/capability-list";
import { PageHeading } from "@/components/ui/primitives";
import { listAgents, listClientsForAgent } from "@/lib/agents/data";
import { listAgentProjectAssignments } from "@/lib/agents/project-assignments";
import { listClients } from "@/lib/clients/data";
import { agentCatalog, agentStateLabels, blueprintState, matchConfiguredAgents } from "@/lib/agents/catalog";
import { getService } from "@/lib/services/catalog";
import { getActiveScenario } from "@/lib/simulation/server";
import { SimAgents } from "@/components/simulation/views/sim-agents";

export const metadata: Metadata = { title: "Agents" };

export default async function AgentsPage() {
  await requireAdmin();
  if (await getActiveScenario()) return <SimAgents />;
  const [agents, clients] = await Promise.all([listAgents(), listClients()]);
  const { byBlueprint, unmatched } = matchConfiguredAgents(agents);
  const clientNames = new Map(clients.map((client) => [client.id, client.name]));

  // Clients rattachés (rattachement actif) aux agents configurés reconnus dans le registre.
  const matchedIds = [...byBlueprint.values()].flat().map((agent) => agent.id);
  const linkedClients = new Map(await Promise.all(matchedIds.map(async (agentId) => {
    const [clientLinks, projectLinks] = await Promise.all([listClientsForAgent(agentId), listAgentProjectAssignments({ agentId }).catch(() => [])]);
    return [agentId, new Set([...clientLinks, ...projectLinks].filter((link) => link.enabled).map((link) => link.client_id))] as const;
  })));

  const legend = (["active", "to-connect", "coming-soon"] as const).map((state) => agentStateLabels[state]);

  return (
    <>
      <PageHeading
        eyebrow="Registre"
        title="Agents"
        description="Les agents CODE-V, les services qu’ils servent et ce qu’ils savent faire aujourd’hui."
        action={<Link href="/agents/new" className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-background">+ Nouvel agent</Link>}
      />
      <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted" aria-label="Légende">
        {legend.map((item) => <span key={item.label}><span aria-hidden="true" className={item.tone === "green" ? "text-accent" : ""}>{item.symbol}</span> {item.label}</span>)}
        <CapabilityLegend />
      </div>

      <h2 className="sr-only">Agents du registre</h2>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {agentCatalog.map((blueprint) => {
          const configured = byBlueprint.get(blueprint.id) ?? [];
          const clientIds = new Set(configured.flatMap((agent) => [...(linkedClients.get(agent.id) ?? [])]));
          return (
            <AgentRegistryCard
              key={blueprint.id}
              blueprint={blueprint}
              state={blueprintState(blueprint, configured)}
              serviceNames={blueprint.services.map((id) => getService(id)?.name ?? id)}
              clients={[...clientIds].map((id) => ({ id, name: clientNames.get(id) ?? "Client" })).sort((a, b) => a.name.localeCompare(b.name, "fr"))}
              clientsLabel={blueprint.includedForAllClients ? `Tous les clients (${clients.length})` : undefined}
              configured={configured.map(({ id, name, autonomy_level }) => ({ id, name, autonomy_level }))}
            />
          );
        })}
      </div>

      {unmatched.length > 0 && (
        <section aria-labelledby="other-agents" className="mt-12">
          <h2 id="other-agents" className="text-lg font-semibold">Autres agents configurés</h2>
          <p className="mt-1 mb-5 text-sm text-muted">Agents enregistrés qui ne correspondent pas encore à une entrée du registre.</p>
          <div className="grid gap-5 md:grid-cols-2">{unmatched.map((agent) => <AgentCard key={agent.id} agent={agent} />)}</div>
        </section>
      )}
    </>
  );
}
