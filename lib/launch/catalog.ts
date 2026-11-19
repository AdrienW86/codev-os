// Lancement manuel (pur) : chaque tâche d'agent peut être déclenchée tout de suite par l'administrateur, pour un client
// ou pour tous. Un lancement passe par le même code que le planificateur (mêmes gardes : agent actif, budget IA,
// Agent Contrôle, confirmations cruciales). Les tâches dont l'écran de lancement existe déjà renvoient vers lui.
import type { HarnessAgentId } from "@/lib/harness/charter";

export type LaunchScope = "client" | "global" | "client-or-global";
export type LaunchTask = {
  id: string;
  agent: HarnessAgentId;
  label: string;
  /** Ce que fait le lancement, en une phrase. */
  effect: string;
  scope: LaunchScope;
  /** Étape du planificateur ou type d'exécution couvert (cohérence avec la charte). */
  covers: { step?: string; runType?: string };
  /** Lancement payant (fournisseur facturé à l'appel) : confirmation explicite avant de lancer. */
  paid?: boolean;
  /** Écran existant où se fait le lancement (paramètres à choisir, aperçu) ; sinon lancement direct. */
  href?: (clientId: string | null) => string;
};

export const launchTasks: readonly LaunchTask[] = [
  { id: "harness-control", agent: "director", label: "Contrôle du chef de projet", effect: "Vérifie maintenant chaque client (semaine de publications, connexions, retards) et ouvre ou résout les alertes.", scope: "global", covers: { step: "harness_control" } },
  { id: "auto-decisions", agent: "report", label: "Décisions automatiques", effect: "Approuve les rapports internes à relire et archive les remplacés. Rien n’est envoyé.", scope: "global", covers: { step: "auto_decisions" } },
  { id: "report-generate", agent: "report", label: "Générer un rapport", effect: "Ouvre les rapports pour générer le rapport hebdomadaire ou mensuel d’un client.", scope: "client-or-global", covers: { runType: "report.generate" }, href: () => "/reports" },
  { id: "ads-report", agent: "report", label: "Rapport Google Ads", effect: "Ouvre les réglages du rapport Google Ads récurrent du client.", scope: "client", covers: { runType: "ads.report.prepare" }, href: () => "/advertising" },
  { id: "publication-preparation", agent: "publications", label: "Préparer les prochaines publications", effect: "Ouvre la préparation du client : l’agent rédige les prochaines publications, à valider ou validées automatiquement.", scope: "client", covers: { step: "publication_preparation" }, href: (id) => (id ? `/clients/${id}?tab=publications` : "/publications") },
  { id: "publication-photo", agent: "publication-photo", label: "Proposer les images manquantes", effect: "Génère une image pour les publications préparées sans photo. Chaque image attend votre validation.", scope: "global", covers: { step: "publication_photo" } },
  { id: "publication-stats", agent: "publication-check", label: "Relever les statistiques des publications", effect: "Relève maintenant les statistiques des publications diffusées.", scope: "global", covers: { step: "publication_stats" } },
  { id: "blog", agent: "blog", label: "Écrire un article de blog", effect: "Rédige un article maintenant, selon les réglages de l’Agent Blog du client.", scope: "client", covers: { step: "blog_agent" } },
  { id: "visual", agent: "visual", label: "Créer un visuel", effect: "Crée un visuel maintenant, selon les réglages de l’Agent Visuels du client.", scope: "client", covers: { step: "visual_agent" } },
  { id: "video", agent: "video", label: "Monter une vidéo", effect: "Monte une vidéo maintenant à partir des photos publiables du client.", scope: "client", covers: { step: "video_agent" } },
  { id: "media-library", agent: "media-library", label: "Synchroniser et classer la photothèque", effect: "Importe les nouvelles photos du Drive du client et les classe.", scope: "client", covers: { step: "media_intelligence" } },
  { id: "seo-analyze", agent: "seo", label: "Analyse SEO", effect: "Lance maintenant l’analyse SEO programmée du client.", scope: "client", covers: { runType: "seo.analyze" } },
  { id: "search-console", agent: "seo", label: "Synchroniser Search Console", effect: "Récupère les 28 derniers jours de Search Console du client.", scope: "client", covers: { step: "search_console" } },
  { id: "google-analytics", agent: "seo", label: "Synchroniser Google Analytics", effect: "Récupère les dernières statistiques GA4 du client.", scope: "client", covers: { step: "google_analytics" } },
  { id: "local-seo", agent: "seo", label: "Relever la fiche Google", effect: "Relève maintenant les statistiques et avis de la fiche Google du client.", scope: "client", covers: { step: "local_seo" } },
  { id: "local-competition", agent: "seo", label: "Relever la concurrence locale", effect: "Relève maintenant les concurrents locaux du client.", scope: "client", covers: { step: "local_competition" } },
  { id: "local-geogrid", agent: "seo", label: "Carte de positions Google Maps", effect: "Relève la grille 7 × 7 des positions Maps du client (appels DataForSEO facturés).", scope: "client", covers: { step: "local_geogrid" }, paid: true },
  { id: "monitoring", agent: "monitoring", label: "Vérifier les sites", effect: "Lance maintenant la vérification programmée des sites du client.", scope: "client", covers: { runType: "monitoring.check_sites" } },
  { id: "lighthouse", agent: "monitoring", label: "Audit Lighthouse", effect: "Audite maintenant le site du client (mobile et ordinateur), même en journée.", scope: "client", covers: { step: "lighthouse" } },
  { id: "site-health", agent: "monitoring", label: "Santé technique du site", effect: "Vérifie maintenant certificat, domaine, DNS, sitemap et indexation du site du client.", scope: "client", covers: { step: "site_health" } },
  { id: "ads-monitor", agent: "google-ads", label: "Analyse Google Ads", effect: "Lance maintenant l’analyse programmée des campagnes du client. Aucune modification sans votre accord.", scope: "client", covers: { runType: "ads.monitor" } },
  { id: "prospection", agent: "prospection", label: "Recherche de prescripteurs", effect: "Fait avancer les recherches de prescripteurs en cours ; une nouvelle zone se lance depuis Acquisition.", scope: "global", covers: { step: "acquisition_discovery" } },
  { id: "prospection-email", agent: "prospection-email", label: "Envoyer la prospection approuvée", effect: "Envoie maintenant les e-mails approuvés dus, dans les créneaux de bureau et au rythme du préchauffage ; rien hors créneau ni au-delà du quota.", scope: "global", covers: { step: "acquisition_send" } },
  { id: "newsletter", agent: "newsletter", label: "Préparer une newsletter", effect: "Ouvre les newsletters pour en générer une. L’envoi reste à votre validation.", scope: "client-or-global", covers: {}, href: () => "/emailing" },
  { id: "veille", agent: "veille", label: "Actualiser la veille", effect: "Récupère maintenant les dernières actualités tech, IA, SEO et Ads.", scope: "global", covers: { runType: "news.fetch" } },
];

export const launchTask = (id: unknown): LaunchTask | null => (typeof id === "string" ? launchTasks.find((t) => t.id === id) ?? null : null);

/** Étapes du planificateur volontairement absentes : la diffusion part à son créneau (« Publier maintenant » par publication). */
export const NOT_LAUNCHABLE_STEPS: readonly string[] = ["publication_auto_approval", "publication_delivery_prepare", "publication_delivery_send", "push", "whatsapp", "whatsapp_exports", "automations"];
