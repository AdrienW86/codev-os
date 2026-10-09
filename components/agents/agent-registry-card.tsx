import Link from "next/link";
import { AgentStateBadge, CapabilityList } from "@/components/agents/capability-list";
import { Icon } from "@/components/ui/icon";
import { Panel } from "@/components/ui/primitives";
import { Action } from "@/components/ui/button";
import { TrySimulationButton } from "@/components/simulation/simulation-banner";
import { capabilityState, scopeLabels, type AgentBlueprint, type AgentDisplayState } from "@/lib/agents/catalog";

/** Scénario le plus parlant pour découvrir chaque agent. */
const simulationScenarios: Record<AgentBlueprint["id"], string> = {
  seo: "seo-progress", "google-ads": "ads-anomaly", publications: "publications-review", monitoring: "site-down", automation: "all-services", report: "report-ready",
};

function Autonomy({ level, planned }: { level: number; planned: boolean }) {
  const value = Math.max(0, Math.min(3, level));
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className="flex gap-1">
        {[1, 2, 3].map((step) => <span key={step} className={`h-1.5 w-4 rounded-full ${step <= value ? (planned ? "bg-white/30" : "bg-accent") : "bg-white/10"}`} />)}
      </span>
      <span className="text-xs text-muted">{value} / 3{planned && " · prévue"}</span>
    </span>
  );
}

/** Fiche de registre : un agent CODE-V, son état réel et ce qu’il fera. */
export function AgentRegistryCard({ blueprint, state, serviceNames, clients, clientsLabel, configured }: {
  blueprint: AgentBlueprint;
  state: AgentDisplayState;
  serviceNames: string[];
  clients: { id: string; name: string }[];
  /** Remplace la liste des clients (ex. agent global). */
  clientsLabel?: string;
  configured: { id: string; name: string; autonomy_level: number }[];
}) {
  const autonomy = configured.length ? Math.max(...configured.map((agent) => agent.autonomy_level)) : blueprint.plannedAutonomy;
  return (
    <Panel className="flex flex-col p-6">
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 text-accent"><Icon name="agents" /></span>
        <AgentStateBadge state={state} />
      </div>
      <h3 className="mt-4 text-lg font-semibold">{blueprint.name}</h3>
      <p className="mt-1 text-sm leading-6 text-muted">{blueprint.role}</p>

      <dl className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm">
        <dt className="text-muted">Portée</dt><dd>{scopeLabels[blueprint.scope]}{blueprint.includedForAllClients && " · Inclus par défaut"}</dd>
        <dt className="text-muted">Service</dt><dd>{serviceNames.join(", ")}</dd>
        <dt className="text-muted">Clients</dt>
        <dd className="min-w-0">
          {clientsLabel ?? (clients.length
            ? <>{clients.slice(0, 4).map((client, index) => <span key={client.id}>{index > 0 && ", "}<Link href={`/clients/${client.id}`} className="text-accent hover:underline">{client.name}</Link></span>)}{clients.length > 4 && ` +${clients.length - 4}`}</>
            : <span className="text-muted">Aucun</span>)}
        </dd>
        <dt className="text-muted">Autonomie</dt><dd><Autonomy level={autonomy} planned={!configured.length} /></dd>
      </dl>

      <h4 className="mt-5 text-xs font-medium tracking-[0.14em] text-muted uppercase">Capacités</h4>
      <CapabilityList className="mt-3" capabilities={blueprint.capabilities.map((capability) => ({ label: capability.label, state: capabilityState(capability, state) }))} />

      <div className="mt-auto pt-5">
        {configured.length ? (
          <ul className="space-y-2 border-t border-border pt-4">
            {configured.map((agent) => (
              <li key={agent.id}>
                <Link href={`/agents/${agent.id}`} aria-label={`Ouvrir la configuration de ${agent.name}`} className="inline-flex min-h-10 items-center gap-1.5 text-sm text-accent hover:underline">
                  Configuration : {agent.name}<Icon name="arrow" width={16} height={16} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="border-t border-border pt-4">
            <p className="text-xs text-muted">Aucun agent configuré pour l’instant.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <TrySimulationButton scenarioId={simulationScenarios[blueprint.id]} href="/agents">Voir en simulation</TrySimulationButton>
              <Action href="/agents/new">Créer</Action>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
