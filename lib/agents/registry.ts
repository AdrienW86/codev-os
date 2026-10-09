// Registre des agents CODE-V OS : source unique de vérité pour ce que chaque agent SAIT faire.
// Ce qu'il a le DROIT de faire (permissions) et ce que son AUTONOMIE l'autorise à exécuter
// sont décidés par lib/permissions/engine.ts à partir de ces définitions.
//
// Ajouter un agent, une capacité ou un type d'exécution = ajouter une entrée ici (et un handler
// dans lib/runs/handlers.ts si le type d'exécution est nouveau). Aucun branchement ailleurs.

import type { ServiceId } from "@/lib/services/catalog";

export type AgentType = "report" | "seo" | "google-ads" | "publications" | "monitoring" | "automation" | "veille";
export type AgentScope = "global" | "client" | "project";
export type ProviderId =
  | "internal" | "openai" | "anthropic" | "search-console" | "pagespeed" | "http" | "vercel" | "github"
  | "google-ads" | "meta" | "google-business-profile" | "google-drive" | "email" | "rss";

/** read : lire / analyser. prepare : créer une recommandation, un brouillon ou une action à valider. execute : effet réel. */
export type Permission = "read" | "prepare" | "execute";

export type CapabilityId =
  | "aggregate_activity" | "generate_report" | "send_report"
  | "analyze_search_console" | "audit_pagespeed" | "detect_seo_opportunities" | "propose_site_change" | "modify_site"
  | "read_campaigns" | "detect_ads_anomalies" | "propose_ads_optimization" | "modify_campaign"
  | "prepare_publication" | "select_media" | "schedule_publication" | "publish"
  | "check_http" | "read_deployments" | "read_repository" | "propose_fix" | "apply_fix"
  | "run_workflow"
  | "fetch_news" | "build_digest";

export type CapabilityDefinition = {
  id: CapabilityId;
  label: string;
  permission: Permission;
  /** Fournisseurs nécessaires ; « internal » = aucune dépendance externe. */
  providers: ProviderId[];
  /** Effet hors de CODE-V OS (site, Ads, réseau social, e-mail) : jamais automatique en V1. */
  externalEffect?: boolean;
};

export const capabilities: Record<CapabilityId, CapabilityDefinition> = {
  aggregate_activity: { id: "aggregate_activity", label: "Synthèse de l’activité", permission: "read", providers: ["internal"] },
  generate_report: { id: "generate_report", label: "Rapports hebdomadaires et mensuels", permission: "prepare", providers: ["internal"] },
  send_report: { id: "send_report", label: "Envoi du rapport au client", permission: "execute", providers: ["email"], externalEffect: true },
  analyze_search_console: { id: "analyze_search_console", label: "Analyse Search Console", permission: "read", providers: ["search-console"] },
  audit_pagespeed: { id: "audit_pagespeed", label: "PageSpeed / Lighthouse", permission: "read", providers: ["pagespeed"] },
  detect_seo_opportunities: { id: "detect_seo_opportunities", label: "Pages et requêtes à fort potentiel", permission: "prepare", providers: ["search-console"] },
  propose_site_change: { id: "propose_site_change", label: "Proposition de modification du site", permission: "prepare", providers: ["internal"] },
  modify_site: { id: "modify_site", label: "Modification du site", permission: "execute", providers: ["github"], externalEffect: true },
  read_campaigns: { id: "read_campaigns", label: "Lecture des campagnes (lecture seule)", permission: "read", providers: ["google-ads"] },
  detect_ads_anomalies: { id: "detect_ads_anomalies", label: "Détection d’anomalies", permission: "read", providers: ["google-ads"] },
  propose_ads_optimization: { id: "propose_ads_optimization", label: "Propositions d’optimisation", permission: "prepare", providers: ["internal"] },
  modify_campaign: { id: "modify_campaign", label: "Modification des campagnes", permission: "execute", providers: ["google-ads"], externalEffect: true },
  prepare_publication: { id: "prepare_publication", label: "Préparer les publications", permission: "prepare", providers: ["openai"] },
  select_media: { id: "select_media", label: "Sélectionner les médias", permission: "read", providers: ["google-drive"] },
  schedule_publication: { id: "schedule_publication", label: "Planifier", permission: "prepare", providers: ["internal"] },
  publish: { id: "publish", label: "Publier (après validation)", permission: "execute", providers: ["meta", "google-business-profile"], externalEffect: true },
  check_http: { id: "check_http", label: "Disponibilité et temps de réponse", permission: "read", providers: ["http"] },
  read_deployments: { id: "read_deployments", label: "Déploiements et builds Vercel", permission: "read", providers: ["vercel"] },
  read_repository: { id: "read_repository", label: "Derniers changements du code", permission: "read", providers: ["github"] },
  propose_fix: { id: "propose_fix", label: "Correction proposée", permission: "prepare", providers: ["internal"] },
  apply_fix: { id: "apply_fix", label: "Application d’une correction", permission: "execute", providers: ["github"], externalEffect: true },
  run_workflow: { id: "run_workflow", label: "Exécution de workflows", permission: "execute", providers: ["internal"], externalEffect: true },
  fetch_news: { id: "fetch_news", label: "Collecte des flux publics", permission: "read", providers: ["rss"] },
  build_digest: { id: "build_digest", label: "Digest quotidien et hebdomadaire", permission: "prepare", providers: ["internal"] },
};

/** Types d'exécution planifiables (jobs). Chacun appartient à un agent et exige une capacité. */
export type RunType = "report.generate" | "monitoring.check_sites" | "seo.analyze" | "ads.monitor" | "news.fetch";

export type RunTypeDefinition = {
  id: RunType;
  label: string;
  agent: AgentType;
  capability: CapabilityId;
  /** Portée attendue de l'automatisation. */
  scope: "global" | "client";
  /** Description affichée ; la charge utile acceptée est validée par lib/automations/definitions.ts (runConfigSchemas). */
  description: string;
};

export const runTypes: Record<RunType, RunTypeDefinition> = {
  "report.generate": { id: "report.generate", label: "Générer les rapports", agent: "report", capability: "generate_report", scope: "global", description: "Rapport hebdomadaire ou mensuel d’un client, ou de tous les clients actifs." },
  "monitoring.check_sites": { id: "monitoring.check_sites", label: "Contrôle technique des sites", agent: "monitoring", capability: "check_http", scope: "global", description: "Disponibilité, code HTTP et temps de réponse des sites des clients Maintenance / Site web." },
  "seo.analyze": { id: "seo.analyze", label: "Analyse SEO", agent: "seo", capability: "analyze_search_console", scope: "client", description: "Search Console et PageSpeed : pertes, gains, pages à améliorer." },
  "ads.monitor": { id: "ads.monitor", label: "Veille des campagnes Google Ads", agent: "google-ads", capability: "detect_ads_anomalies", scope: "client", description: "Lecture seule : coûts, conversions, anomalies." },
  "news.fetch": { id: "news.fetch", label: "Veille tech & IA", agent: "veille", capability: "fetch_news", scope: "global", description: "Collecte, déduplication et classement des flux publics." },
};

export type AgentDefinition = {
  type: AgentType;
  name: string;
  description: string;
  scopes: AgentScope[];
  services: ServiceId[];
  capabilities: CapabilityId[];
  /** Outils de l'assistant (lib/assistant/tools.ts) qui sollicitent cet agent. */
  tools: string[];
  runTypes: RunType[];
  defaultAutonomy: 0 | 1;
  /** Agent attaché d'office à tous les clients actifs. */
  attachToAllClients?: boolean;
  /** Agent sans client (veille). */
  global?: boolean;
};

export const agentDefinitions: Record<AgentType, AgentDefinition> = {
  report: {
    type: "report", name: "Agent Rapport", description: "Account manager : rassemble toute l’activité du client en rapports hebdomadaires et mensuels.",
    scopes: ["client"], services: ["reporting"], capabilities: ["aggregate_activity", "generate_report", "send_report"],
    tools: ["list_reports", "generate_report"], runTypes: ["report.generate"], defaultAutonomy: 0, attachToAllClients: true,
  },
  seo: {
    type: "seo", name: "Agent SEO & Site", description: "Analyse Search Console et PageSpeed, détecte pertes et opportunités, propose des améliorations.",
    scopes: ["client", "project"], services: ["seo"], capabilities: ["analyze_search_console", "audit_pagespeed", "detect_seo_opportunities", "propose_site_change", "modify_site"],
    tools: ["run_check"], runTypes: ["seo.analyze"], defaultAutonomy: 1,
  },
  "google-ads": {
    type: "google-ads", name: "Agent Google Ads", description: "Surveille les campagnes en lecture seule et propose des optimisations.",
    scopes: ["client"], services: ["google-ads"], capabilities: ["read_campaigns", "detect_ads_anomalies", "propose_ads_optimization", "modify_campaign"],
    tools: ["run_check"], runTypes: ["ads.monitor"], defaultAutonomy: 1,
  },
  publications: {
    type: "publications", name: "Agent Publications", description: "Prépare les contenus des réseaux sociaux ; rien n’est publié sans validation.",
    scopes: ["project"], services: ["social"], capabilities: ["prepare_publication", "select_media", "schedule_publication", "publish"],
    tools: [], runTypes: [], defaultAutonomy: 1,
  },
  monitoring: {
    type: "monitoring", name: "Agent Monitoring Technique", description: "Disponibilité, performances, déploiements et régressions des sites.",
    scopes: ["client", "project"], services: ["maintenance", "website"], capabilities: ["check_http", "audit_pagespeed", "read_deployments", "read_repository", "propose_fix", "apply_fix"],
    tools: ["run_check"], runTypes: ["monitoring.check_sites"], defaultAutonomy: 1,
  },
  automation: {
    type: "automation", name: "Agent Automatisation", description: "Workflows et intégrations sur mesure.",
    scopes: ["client"], services: ["automation"], capabilities: ["run_workflow"], tools: [], runTypes: [], defaultAutonomy: 1,
  },
  veille: {
    type: "veille", name: "Agent Veille", description: "Veille tech, IA, SEO et Ads à partir de flux publics fiables.",
    scopes: ["global"], services: [], capabilities: ["fetch_news", "build_digest"], tools: ["list_news"], runTypes: ["news.fetch"], defaultAutonomy: 0, global: true,
  },
};

export const agentTypes = Object.keys(agentDefinitions) as AgentType[];

export function isAgentType(value: unknown): value is AgentType {
  return typeof value === "string" && Object.hasOwn(agentDefinitions, value);
}

export function isRunType(value: unknown): value is RunType {
  return typeof value === "string" && Object.hasOwn(runTypes, value);
}

/** Agents à rattacher quand un service est activé (sans logique codée ailleurs). */
export function agentTypesForService(serviceId: ServiceId): AgentType[] {
  return agentTypes.filter((type) => agentDefinitions[type].services.includes(serviceId) && !agentDefinitions[type].attachToAllClients);
}

/** Agents attachés à tous les clients (Agent Rapport). */
export function globalClientAgentTypes(): AgentType[] {
  return agentTypes.filter((type) => agentDefinitions[type].attachToAllClients);
}

export function capabilitiesOf(type: AgentType): CapabilityDefinition[] {
  return agentDefinitions[type].capabilities.map((id) => capabilities[id]);
}

/** Fournisseurs requis par un agent (pour l’état du système et les messages « à configurer »). */
export function providersOf(type: AgentType): ProviderId[] {
  return [...new Set(capabilitiesOf(type).flatMap((capability) => capability.providers))].filter((provider) => provider !== "internal");
}
