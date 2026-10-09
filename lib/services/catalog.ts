// Catalogue frontend des services CODE-V. Configuration statique : aucune table associée.
import type { IconName } from "@/components/ui/icon";

export type ServiceId = "website" | "seo" | "google-ads" | "social" | "maintenance" | "automation" | "reporting";

export type ServiceDefinition = {
  id: ServiceId;
  name: string;
  description: string;
  icon: IconName;
  category: "Acquisition" | "Présence en ligne" | "Technique" | "Pilotage";
  defaultAgents: string[];
  /** Inclus pour tous les clients, sans souscription. */
  includedByDefault?: boolean;
  /** Mots-clés pour reconnaître un service déjà enregistré (texte libre de `client_services.service_type`). */
  keywords: string[];
};

export const serviceCatalog: readonly ServiceDefinition[] = [
  { id: "website", name: "Site web", category: "Présence en ligne", icon: "content", defaultAgents: ["monitoring"],
    description: "Création et évolution du site du client.", keywords: ["site", "web", "vitrine", "landing"] },
  { id: "seo", name: "SEO & visibilité locale", category: "Acquisition", icon: "seo", defaultAgents: ["seo"],
    description: "Référencement naturel, Search Console et fiche Google.", keywords: ["seo", "referencement", "visibilite", "search console", "local"] },
  { id: "google-ads", name: "Google Ads", category: "Acquisition", icon: "ads", defaultAgents: ["google-ads"],
    description: "Pilotage des campagnes payantes Google.", keywords: ["google ads", "ads", "sea", "campagne", "adwords"] },
  { id: "social", name: "Réseaux sociaux & publications", category: "Présence en ligne", icon: "publications", defaultAgents: ["publications"],
    description: "Préparation et planification des contenus Facebook, Instagram et Google.", keywords: ["reseaux", "social", "publication", "facebook", "instagram", "contenu"] },
  { id: "maintenance", name: "Maintenance & monitoring", category: "Technique", icon: "settings", defaultAgents: ["monitoring"],
    description: "Disponibilité, performances et suivi technique du site.", keywords: ["maintenance", "monitoring", "hebergement", "technique", "support"] },
  { id: "automation", name: "Automatisation & IA", category: "Technique", icon: "agents", defaultAgents: ["automation"],
    description: "Workflows, intégrations et automatisations sur mesure.", keywords: ["automatisation", "automation", "ia", "workflow", "integration"] },
  { id: "reporting", name: "Rapports & pilotage", category: "Pilotage", icon: "reports", defaultAgents: ["report"], includedByDefault: true,
    description: "Synthèse de l’activité du client, incluse pour tous.", keywords: ["rapport", "reporting", "pilotage"] },
];

export function getService(id: string) {
  return serviceCatalog.find((service) => service.id === id) ?? null;
}

/** Minuscules sans accents, pour comparer des libellés saisis librement. */
export function normalizeLabel(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function matchesKeyword(text: string, keyword: string) {
  // Les mots-clés courts (« ads », « ia », « web »…) doivent correspondre à un mot entier.
  return keyword.length <= 4 ? new RegExp(`(^|[^a-z0-9])${keyword}([^a-z0-9]|$)`).test(text) : text.includes(keyword);
}

/** Retrouve le service du catalogue correspondant à un libellé libre, ou `null`. */
export function matchServiceType(serviceType: string): ServiceDefinition | null {
  const text = normalizeLabel(serviceType);
  if (!text) return null;
  // Ordre de priorité : « Google Ads » avant « site », etc.
  const ordered = ["google-ads", "seo", "social", "maintenance", "automation", "reporting", "website"];
  for (const id of ordered) {
    const service = getService(id);
    if (service?.keywords.some((keyword) => matchesKeyword(text, keyword))) return service;
  }
  return null;
}

export type ServiceSubscriptionStatus = "active" | "to-configure" | "included" | "not-subscribed";

export const serviceStatusLabels: Record<ServiceSubscriptionStatus, { label: string; tone: "neutral" | "green" | "amber" }> = {
  active: { label: "Actif", tone: "green" },
  "to-configure": { label: "À configurer", tone: "amber" },
  included: { label: "Inclus", tone: "green" },
  "not-subscribed": { label: "Non souscrit", tone: "neutral" },
};

/** Statut d’un service enregistré (texte libre) traduit en statut catalogue. */
export function subscriptionStatusFromRecord(status: string): ServiceSubscriptionStatus {
  const text = normalizeLabel(status);
  if (/(resili|termine|arrete|inactif|annule|stoppe)/.test(text)) return "not-subscribed";
  if (/(actif|active|en cours|souscrit|signe)/.test(text)) return "active";
  return "to-configure";
}
