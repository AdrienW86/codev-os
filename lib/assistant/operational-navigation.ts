/**
 * Navigation explicite du directeur opérationnel.
 * Aucun chemin ni paramètre arbitraire n'est accepté depuis une sortie de modèle.
 * Les demandes d'analyse et d'exécution restent traitées par l'orchestrateur existant.
 */
export const operationalDestinations = {
  dashboard: { href: "/dashboard", label: "l'accueil" },
  clients: { href: "/clients", label: "les clients" },
  analytics: { href: "/analytics", label: "les données et performances" },
  advertising: { href: "/advertising", label: "les campagnes publicitaires" },
  agenda: { href: "/agenda", label: "l'agenda" },
  work: { href: "/work", label: "le travail" },
  publications: { href: "/publications", label: "les publications" },
  acquisition: { href: "/acquisition", label: "l'acquisition" },
  reports: { href: "/reports", label: "les rapports" },
  agents: { href: "/agents", label: "les agents" },
  settings: { href: "/settings", label: "les paramètres" },
} as const;

export type OperationalDestination = keyof typeof operationalDestinations;

const targets: { destination: OperationalDestination; expressions: RegExp[] }[] = [
  { destination: "dashboard", expressions: [/^(?:accueil|tableau de bord|dashboard)$/] },
  { destination: "clients", expressions: [/^(?:clients?|liste des clients?)$/] },
  { destination: "analytics", expressions: [/^(?:statistiques|statistiques generales|donnees et performances|performances|analytics)$/] },
  { destination: "advertising", expressions: [/^(?:campagnes?(?: publicitaires?| google ads)?|google ads|publicite(?:s)?)$/] },
  { destination: "agenda", expressions: [/^(?:agenda|calendrier)$/] },
  { destination: "work", expressions: [/^(?:travail|taches?|mes taches|actions a valider)$/] },
  { destination: "publications", expressions: [/^(?:publications?|posts?|reseaux sociaux)$/] },
  { destination: "acquisition", expressions: [/^(?:acquisition|prospection)$/] },
  { destination: "reports", expressions: [/^(?:rapports?|comptes rendus)$/] },
  { destination: "agents", expressions: [/^(?:agents?|mes agents)$/] },
  { destination: "settings", expressions: [/^(?:parametres|reglages|configuration)$/] },
];

export function resolveExplicitNavigation(message: string) {
  const normalized = message
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[’']/g, " ").replace(/-/g, " ").replace(/[.!?]+$/g, "").replace(/\s+/g, " ").trim();
  // Le verbe explicite et une cible exacte empêchent de détourner les demandes métier.
  const match = /^(?:ouvre|ouvrir|affiche|afficher|montre|montrer|va sur|vas sur|navigue vers|emmene moi sur|amene moi sur)\s+(?:(?:moi|nous)\s+)?(?:la page\s+|l ecran\s+|le module\s+|la rubrique\s+|l onglet\s+)?(?:des?\s+|les?\s+|l\s+)?(.+)$/.exec(normalized);
  if (!match) return null;
  const target = match[1];
  const found = targets.find(({ expressions }) => expressions.some((expression) => expression.test(target)));
  return found ? { destination: found.destination, ...operationalDestinations[found.destination] } : null;
}

/**
 * Navigation vers une fiche client, uniquement lorsque la commande est explicitement
 * une demande de navigation. Le serveur résout ensuite le client existant.
 */
export function resolveClientNavigation(message: string): string | null {
  const normalized = message.trim().replace(/[.!?]+$/g, "").replace(/\s+/g, " ");
  const match = /^(?:ouvre|ouvrir|affiche|afficher|montre|montrer|va sur|vas sur)\s+(?:(?:moi)\s+)?(?:(?:la\s+)?fiche\s+(?:du\s+client\s+|de\s+|d['’])|(?:le\s+)?dossier\s+(?:du\s+client\s+|de\s+|d['’])|(?:le\s+)?client\s+)(.+)$/i.exec(normalized);
  const name = match?.[1]?.trim();
  return name && name.length <= 120 && !/[\/\\<>]/.test(name) ? name : null;
}

/** Explicitly scoped campaign commands, not generic analysis requests. */
export function resolveCampaignCommand(message: string): { campaign: string; client: string; analyze: boolean } | null {
  const normalized = message.trim().replace(/[.!?]+$/g, "").replace(/\s+/g, " ");
  const match = /^(ouvre|affiche|montre|analyse|analyser|verifie|vérifie)\s+(?:moi\s+)?(?:la\s+)?campagne\s+(.+?)\s+(?:de|du client|pour)\s+(.+)$/i.exec(normalized);
  if (!match) return null;
  const campaign = match[2].trim(), client = match[3].trim();
  if (!campaign || !client || campaign.length > 120 || client.length > 120 || /[<>\\/]/.test(campaign + client)) return null;
  return { campaign, client, analyze: /^(analyse|analyser|verifie|vérifie)$/i.test(match[1]) };
}

/** Read-only coordinated executive briefing; no external writes. */
export function isDirectorBriefing(message: string): boolean {
  const cleaned = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/-/g, " ").replace(/[.!?]+$/g, "").trim();
  return /^(?:fais|prepare|donne|affiche|montre)(?: moi)? (?:un |le |mon )?(?:bilan global|briefing operationnel|point sur les priorites)$/.test(cleaned);
}


/** Mission Ads + SEO explicitement demandée pour un client nommé. */
export function resolveAdsSeoMission(message: string): string | null {
  const clean = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[.!?]+$/g, "").replace(/\s+/g, " ").trim();
  const match = /^(?:analyse|analyser|verifie|fais (?:un |le )?bilan (?:des? )?)\s+(?:les? )?(?:campagnes? (?:google ads|ads)|google ads|publicite)\s+et\s+(?:le |du |la )?(?:referencement|seo)\s+(?:de|du client|pour)\s+(.+?)(?:,?\s+(?:identifie les opportunites|propose les optimisations|affiche moi les recommandations).*)?$/.exec(clean);
  const name = match?.[1]?.trim();
  return name && name.length <= 120 && !/[\/\\<>]/.test(name) ? name : null;
}


/** The client's top three recorded Ads/SEO recommendations, explicitly requested. */
export function resolveTopPrioritiesCommand(message: string): string | null {
  const normalized = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[’']/g, " ").replace(/[.!?]+$/g, "").replace(/\s+/g, " ").trim();
  const match = /^(?:directeur,?\s+)?(?:quelles?\s+sont\s+)?(?:les\s+)?(?:trois|3)\s+(?:actions|priorites|recommandations)\s+(?:les\s+plus\s+importantes?\s+)?(?:pour\s+(?:developper\s+l\s+activite\s+de\s+|le\s+client\s+)?|de\s+)(.+)$/.exec(normalized);
  const client = match?.[1]?.trim();
  return client && client.length <= 120 && !/[\/\\<>]/.test(client) ? client : null;
}
