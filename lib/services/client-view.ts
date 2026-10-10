// Vue « Services & agents » d’un client, calculée à partir des données existantes (lecture seule).
import { getService, serviceCatalog, matchServiceType, subscriptionStatusFromRecord, type ServiceDefinition, type ServiceId, type ServiceSubscriptionStatus } from "@/lib/services/catalog";
import { agentCatalog, clientAgentState, capabilityState, matchConfiguredAgents, type AgentBlueprint, type AgentDisplayState, type CapabilityState, type ConfiguredAgent } from "@/lib/agents/catalog";

export type ClientAgentView = {
  id: AgentBlueprint["id"];
  name: string;
  role: string;
  scope: AgentBlueprint["scope"];
  state: AgentDisplayState;
  includedForAllClients: boolean;
  configured: { id: string; name: string }[];
  capabilities: { label: string; state: CapabilityState }[];
};

export type ClientServiceView = {
  id: ServiceId;
  name: string;
  description: string;
  icon: ServiceDefinition["icon"];
  status: ServiceSubscriptionStatus;
  /** Libellés tels qu’enregistrés dans les services du client. */
  recordedAs: string[];
  agents: ClientAgentView[];
};

const rank: Record<ServiceSubscriptionStatus, number> = { active: 0, "to-configure": 1, included: 2, "not-subscribed": 3 };

export function buildClientServicesView(input: {
  services: readonly { service_type: string; status: string; service_key?: string | null; lifecycle?: string | null }[];
  agents: readonly ConfiguredAgent[];
  /** Agents configurés rattachés (rattachement actif) au client ou à l’un de ses projets. */
  assignedAgentIds: ReadonlySet<string>;
}) {
  const { byBlueprint } = matchConfiguredAgents(input.agents);
  const recorded = new Map<ServiceId, { status: ServiceSubscriptionStatus; labels: string[] }>();
  const otherServices: string[] = [];
  for (const row of input.services) {
    const service = (row.service_key ? getService(row.service_key) : null) ?? matchServiceType(row.service_type);
    if (!service) { otherServices.push(row.service_type); continue; }
    // Cycle de vie explicite (services activés depuis CODE-V OS), sinon statut libre historique.
    const status: ServiceSubscriptionStatus = row.lifecycle
      ? row.lifecycle === "active" ? "active" : row.lifecycle === "ended" ? "not-subscribed" : "to-configure"
      : subscriptionStatusFromRecord(row.status);
    const current = recorded.get(service.id);
    if (!current) recorded.set(service.id, { status, labels: [row.service_type] });
    else {
      current.labels.push(row.service_type);
      if (rank[status] < rank[current.status]) current.status = status;
    }
  }

  const agentView = (blueprint: AgentBlueprint): ClientAgentView => {
    const configured = byBlueprint.get(blueprint.id) ?? [];
    const state = clientAgentState(blueprint, configured, input.assignedAgentIds);
    return {
      id: blueprint.id, name: blueprint.name, role: blueprint.role, scope: blueprint.scope, state,
      includedForAllClients: Boolean(blueprint.includedForAllClients),
      configured: configured.map(({ id, name }) => ({ id, name })),
      capabilities: blueprint.capabilities.map((capability) => ({ label: capability.label, state: capabilityState(capability, state) })),
    };
  };

  const services: ClientServiceView[] = serviceCatalog.map((service) => {
    const record = recorded.get(service.id);
    const status: ServiceSubscriptionStatus = service.includedByDefault ? "included" : record?.status ?? "not-subscribed";
    return {
      id: service.id, name: service.name, description: service.description, icon: service.icon, status,
      recordedAs: record?.labels ?? [],
      agents: service.defaultAgents.map((id) => agentCatalog.find((blueprint) => blueprint.id === id)).filter((item): item is AgentBlueprint => Boolean(item)).map(agentView),
    };
  });
  services.sort((a, b) => rank[a.status] - rank[b.status]);
  return { services, otherServices };
}
