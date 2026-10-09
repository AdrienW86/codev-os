// Registre frontend des agents CODE-V (actuels et futurs). Configuration statique : aucune table associée.
import { normalizeLabel, type ServiceId } from "@/lib/services/catalog";

export type AgentBlueprintId = "seo" | "google-ads" | "publications" | "monitoring" | "automation" | "report";
export type AgentPortee = "global" | "client" | "project";
/** État d’un agent tant qu’aucun agent configuré en base ne lui correspond. */
export type BlueprintReadiness = "to-connect" | "coming-soon";

export type Capability = {
  label: string;
  /** La fonctionnalité existe déjà dans CODE-V OS (elle reste soumise aux réglages et validations existants). */
  existsInApp?: boolean;
};

export type AgentBlueprint = {
  id: AgentBlueprintId;
  name: string;
  role: string;
  scope: AgentPortee;
  services: ServiceId[];
  readiness: BlueprintReadiness;
  /** Niveau d’autonomie envisagé, sur 3. */
  plannedAutonomy: 1 | 2 | 3;
  capabilities: Capability[];
  /** Agent global inclus pour tous les clients actifs. */
  includedForAllClients?: boolean;
  /** Reconnaît un agent déjà configuré en base. */
  matches: (agent: { name: string; publication_specialist?: boolean }) => boolean;
};

const nameHas = (pattern: RegExp) => (agent: { name: string }) => pattern.test(normalizeLabel(agent.name));

export const agentCatalog: readonly AgentBlueprint[] = [
  {
    id: "seo", name: "Agent SEO & Site", role: "Analyse le référencement et propose des améliorations du site.",
    scope: "project", services: ["seo"], readiness: "coming-soon", plannedAutonomy: 1,
    capabilities: [{ label: "Audit SEO" }, { label: "Search Console" }, { label: "Opportunités de mots-clés" }, { label: "Suivi des positions et des pages" }, { label: "Recommandations" }],
    matches: nameHas(/\bseo\b|referencement/),
  },
  {
    id: "google-ads", name: "Agent Google Ads", role: "Surveille les campagnes et propose des optimisations.",
    scope: "client", services: ["google-ads"], readiness: "to-connect", plannedAutonomy: 1,
    capabilities: [{ label: "Lecture des campagnes (lecture seule)", existsInApp: true }, { label: "Analyse coûts / conversions", existsInApp: true }, { label: "Détection d’anomalies" }, { label: "Propositions d’optimisation" }],
    matches: nameHas(/google ads|\bads\b|\bsea\b/),
  },
  {
    id: "publications", name: "Agent Publications", role: "Prépare les contenus des réseaux sociaux, soumis à validation.",
    scope: "project", services: ["social"], readiness: "to-connect", plannedAutonomy: 2,
    capabilities: [{ label: "Préparer les publications", existsInApp: true }, { label: "Sélectionner les médias", existsInApp: true }, { label: "Adapter Facebook / Instagram / Google", existsInApp: true }, { label: "Planifier", existsInApp: true }, { label: "Préparer la validation", existsInApp: true }],
    matches: (agent) => Boolean(agent.publication_specialist) || nameHas(/publication|reseaux sociaux|social/)(agent),
  },
  {
    id: "monitoring", name: "Agent Monitoring Technique", role: "Veille sur la disponibilité et la santé technique des sites.",
    scope: "project", services: ["maintenance", "website"], readiness: "coming-soon", plannedAutonomy: 1,
    capabilities: [{ label: "Disponibilité" }, { label: "PageSpeed / Lighthouse" }, { label: "Déploiements Vercel" }, { label: "Erreurs" }, { label: "Audit du code" }, { label: "Détection de régressions" }],
    matches: nameHas(/monitoring|maintenance|technique/),
  },
  {
    id: "automation", name: "Agent Automatisation", role: "Orchestre les workflows et intégrations du client.",
    scope: "client", services: ["automation"], readiness: "coming-soon", plannedAutonomy: 1,
    capabilities: [{ label: "Workflows" }, { label: "Connexions API" }, { label: "Automatisations" }, { label: "Supervision" }],
    matches: nameHas(/automatisation|automation|workflow/),
  },
  {
    id: "report", name: "Agent Rapport", role: "Account manager : rassemble toute l’activité du client en une synthèse.",
    scope: "global", services: ["reporting"], readiness: "coming-soon", plannedAutonomy: 1, includedForAllClients: true,
    capabilities: [{ label: "Synthèse d’activité" }, { label: "Rapport hebdomadaire" }, { label: "Rapport mensuel" }, { label: "Synthèse client" }],
    matches: nameHas(/rapport|report|account manager/),
  },
];

export function getAgentBlueprint(id: string) {
  return agentCatalog.find((agent) => agent.id === id) ?? null;
}

export const scopeLabels: Record<AgentPortee, string> = { global: "Global", client: "Client", project: "Projet" };

// ---------------------------------------------------------------------------------------------
// État affiché : jamais « Actif » sans agent réellement configuré et activé en base.
// ---------------------------------------------------------------------------------------------

export type AgentDisplayState = "active" | "config-required" | "disabled" | "to-connect" | "coming-soon";

export const agentStateLabels: Record<AgentDisplayState, { label: string; tone: "neutral" | "green" | "amber"; symbol: string }> = {
  active: { label: "Actif", tone: "green", symbol: "●" },
  "config-required": { label: "Configuration requise", tone: "amber", symbol: "○" },
  disabled: { label: "Désactivé", tone: "neutral", symbol: "○" },
  "to-connect": { label: "À connecter", tone: "neutral", symbol: "○" },
  "coming-soon": { label: "À venir", tone: "neutral", symbol: "◌" },
};

export type ConfiguredAgent = { id: string; name: string; status: string; enabled: boolean; autonomy_level: number; scope_review_required: boolean; publication_specialist?: boolean };

const isRunnable = (agent: ConfiguredAgent) => agent.enabled && agent.status === "Actif";

/** État global d’un agent du registre, d’après les agents configurés qui lui correspondent. */
export function blueprintState(blueprint: AgentBlueprint, configured: readonly ConfiguredAgent[]): AgentDisplayState {
  if (!configured.length) return blueprint.readiness;
  if (configured.some((agent) => isRunnable(agent) && !agent.scope_review_required)) return "active";
  if (configured.some(isRunnable)) return "config-required";
  return "disabled";
}

/**
 * État d’un agent pour un client donné : actif seulement si un agent configuré
 * est activé ET rattaché (rattachement actif) à ce client.
 */
export function clientAgentState(blueprint: AgentBlueprint, configured: readonly ConfiguredAgent[], assignedEnabledIds: ReadonlySet<string>): AgentDisplayState {
  if (!configured.length) return blueprint.readiness;
  const runnable = configured.filter(isRunnable);
  if (!runnable.length) return "disabled";
  return runnable.some((agent) => assignedEnabledIds.has(agent.id) && !agent.scope_review_required) ? "active" : "config-required";
}

export type CapabilityState = "available" | "planned";

/** Une capacité n’est « disponible » que si elle existe dans l’app ET que l’agent est actif. */
export function capabilityState(capability: Capability, agentState: AgentDisplayState): CapabilityState {
  return capability.existsInApp && agentState === "active" ? "available" : "planned";
}

/** Répartit les agents configurés entre les entrées du registre ; les autres restent listés à part. */
export function matchConfiguredAgents<T extends ConfiguredAgent>(agents: readonly T[]) {
  const byBlueprint = new Map<AgentBlueprintId, T[]>(agentCatalog.map((blueprint) => [blueprint.id, []]));
  const unmatched: T[] = [];
  for (const agent of agents) {
    const blueprint = agentCatalog.find((item) => item.matches(agent));
    if (blueprint) byBlueprint.get(blueprint.id)!.push(agent);
    else unmatched.push(agent);
  }
  return { byBlueprint, unmatched };
}
