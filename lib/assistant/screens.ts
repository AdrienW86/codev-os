// Écrans que le Directeur peut afficher au premier plan (pur). Catalogue fermé : le modèle choisit un identifiant, le
// serveur résout le client et construit l'adresse. Jamais d'adresse, de paramètre libre ni de HTML venant du modèle.

export type ScreenClient = "none" | "optional" | "required";
type Screen = { label: string; client: ScreenClient; href: (clientId: string | null) => string };

const withClient = (base: string, param = "client") => (id: string | null) => (id ? `${base}${base.includes("?") ? "&" : "?"}${param}=${id}` : base);
const fiche = (tab: string) => (id: string | null) => `/clients/${id}?tab=${tab}`;

export const screens = {
  dashboard: { label: "l’accueil", client: "none", href: () => "/dashboard" },
  decisions: { label: "les décisions à prendre", client: "none", href: () => "/validation" },
  launch: { label: "le lancement des actions", client: "optional", href: withClient("/lancer") },
  work: { label: "le travail", client: "none", href: () => "/work" },
  incidents: { label: "les incidents ouverts", client: "none", href: () => "/work?kind=incident" },
  agenda: { label: "l’agenda", client: "none", href: () => "/agenda" },
  clients: { label: "la liste des clients", client: "none", href: () => "/clients" },
  client_overview: { label: "la fiche du client", client: "required", href: fiche("overview") },
  client_publications: { label: "les publications du client", client: "required", href: fiche("publications") },
  client_media: { label: "la photothèque du client", client: "required", href: fiche("media") },
  client_agents: { label: "les agents du client (plan, mémoire, budget IA)", client: "required", href: fiche("agents") },
  client_health: { label: "la santé du client", client: "required", href: fiche("health") },
  client_ads: { label: "l’onglet Ads du client", client: "required", href: fiche("ads") },
  client_information: { label: "les informations du client", client: "required", href: fiche("information") },
  client_activity: { label: "l’activité du client", client: "required", href: fiche("activity") },
  publications: { label: "les publications", client: "none", href: () => "/publications" },
  publications_review: { label: "les publications à valider", client: "none", href: () => "/publications/review" },
  publications_supervision: { label: "la supervision des publications", client: "none", href: () => "/publications/supervision" },
  publications_calendar: { label: "le calendrier des publications diffusées", client: "none", href: () => "/publications/published" },
  generated_images: { label: "les images générées à valider", client: "none", href: () => "/publications/images" },
  studio: { label: "le studio vidéo", client: "none", href: () => "/studio" },
  newsletters: { label: "les newsletters", client: "none", href: () => "/emailing" },
  analytics: { label: "les données et performances", client: "optional", href: withClient("/analytics") },
  competitor_watch: { label: "la veille concurrence du client", client: "required", href: withClient("/analytics?source=competition") },
  site_audits: { label: "les audits de sites", client: "none", href: () => "/performance" },
  advertising: { label: "les campagnes publicitaires", client: "optional", href: withClient("/advertising") },
  reports: { label: "les rapports", client: "none", href: () => "/reports" },
  reports_to_review: { label: "les rapports à relire", client: "none", href: () => "/reports?status=ready_for_review" },
  recommendations: { label: "les recommandations des agents", client: "optional", href: withClient("/recommendations", "clientId") },
  agents: { label: "les agents et leur état", client: "none", href: () => "/agents" },
  acquisition: { label: "la prospection", client: "none", href: () => "/acquisition" },
  finance: { label: "les prestations et la finance", client: "none", href: () => "/finance" },
  news: { label: "la veille", client: "none", href: () => "/news" },
  settings: { label: "les paramètres", client: "none", href: () => "/settings" },
} as const satisfies Record<string, Screen>;

export type ScreenId = keyof typeof screens;
export const screenIds = Object.keys(screens) as [ScreenId, ...ScreenId[]];

/** Adresse de l'écran, ou null si le client est requis et absent. clientId déjà revalidé (UUID d'un client existant). */
export function screenHref(id: ScreenId, clientId: string | null): string | null {
  const screen: Screen = screens[id];
  if (screen.client === "required" && !clientId) return null;
  return screen.href(screen.client === "none" ? null : clientId);
}
