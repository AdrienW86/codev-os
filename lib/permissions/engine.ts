// Moteur de permissions : décide si un agent peut utiliser une capacité, et comment.
//  1. SAIT-IL le faire ?        → capacité déclarée dans le registre de l'agent.
//  2. A-T-IL LE DROIT ?         → agent activé, fournisseurs configurés, pas de simulation pour un effet réel.
//  3. SON AUTONOMIE le permet ? → lecture / préparation automatiques ; exécution toujours soumise
//                                 à validation en V1 (autonomie plafonnée à 1).
import { agentDefinitions, capabilities, type AgentType, type CapabilityId, type ProviderId } from "@/lib/agents/registry";

export const V1_MAX_AUTONOMY = 1;

export type AgentState = { type: AgentType; enabled: boolean; status: string; autonomy: number };

export type DenyReason = "unknown_capability" | "not_capable" | "agent_disabled" | "simulation" | "provider_not_configured";

export type Decision =
  | { outcome: "allow"; mode: "automatic"; capability: CapabilityId }
  | { outcome: "allow"; mode: "approval_required"; capability: CapabilityId }
  | { outcome: "deny"; reason: DenyReason; message: string; missingProviders?: ProviderId[] };

export function effectiveAutonomy(autonomy: number) {
  return Math.max(0, Math.min(V1_MAX_AUTONOMY, Math.trunc(Number.isFinite(autonomy) ? autonomy : 0)));
}

export function authorize(input: {
  agent: AgentState;
  capability: string;
  /** Simulation UX active : aucune écriture réelle, lecture seule. */
  simulation?: boolean;
  /** Indique si un fournisseur est configuré (variables serveur / connexion). */
  isProviderConfigured?: (provider: ProviderId) => boolean;
}): Decision {
  const capability = Object.hasOwn(capabilities, input.capability) ? capabilities[input.capability as CapabilityId] : null;
  if (!capability) return { outcome: "deny", reason: "unknown_capability", message: "Capacité inconnue." };
  const definition = agentDefinitions[input.agent.type];
  if (!definition || !definition.capabilities.includes(capability.id)) {
    return { outcome: "deny", reason: "not_capable", message: `${definition?.name ?? "Cet agent"} ne dispose pas de la capacité « ${capability.label} ».` };
  }
  if (!input.agent.enabled || input.agent.status !== "Actif") {
    return { outcome: "deny", reason: "agent_disabled", message: `${definition.name} est en pause ou désactivé.` };
  }
  if (input.simulation && capability.permission !== "read") {
    return { outcome: "deny", reason: "simulation", message: "Simulation active : aucune écriture réelle." };
  }
  const missing = capability.providers.filter((provider) => provider !== "internal" && input.isProviderConfigured && !input.isProviderConfigured(provider));
  if (missing.length) {
    return { outcome: "deny", reason: "provider_not_configured", message: `Connexion requise : ${missing.join(", ")}.`, missingProviders: missing };
  }
  if (capability.permission !== "execute") return { outcome: "allow", mode: "automatic", capability: capability.id };
  // Exécution : effet externe toujours validé par un humain ; sinon autonomie ≥ 2 requise (hors V1).
  if (capability.externalEffect || effectiveAutonomy(input.agent.autonomy) < 2) return { outcome: "allow", mode: "approval_required", capability: capability.id };
  return { outcome: "allow", mode: "automatic", capability: capability.id };
}
