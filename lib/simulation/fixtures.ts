// Monde de démonstration de base. Clients, chiffres et contenus entièrement fictifs.
import type { SimWorld } from "@/lib/simulation/types";

export function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Horodatage local lisible (AAAA-MM-JJTHH:MM). */
export const at = (day: string, time = "09:00") => `${day}T${time}`;

const periodFormatter = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });
/** « Semaine du 2 octobre ». */
export const weekOf = (day: string) => `Semaine du ${periodFormatter.format(new Date(`${day}T00:00:00Z`))}`;

export function buildBaseWorld(today: string): SimWorld {
  const d = (offset: number) => addDays(today, offset);
  const untilMonday = ((8 - new Date(`${today}T00:00:00Z`).getUTCDay()) % 7) || 7;
  return {
    today,
    clients: [
      { id: "sim-renov", name: "Rénov Habitat", activity: "Rénovation énergétique", zone: "Perpignan", website: "renov-habitat.example", createdAt: d(-400),
        services: { website: "active", seo: "active", "google-ads": "active", social: "active", maintenance: "active" } },
      { id: "sim-toitures", name: "Toitures Catalanes", activity: "Couverture", zone: "Céret", website: "toitures-catalanes.example", createdAt: d(-220),
        services: { seo: "active" } },
      { id: "sim-boulangerie", name: "Boulangerie du Port", activity: "Boulangerie", zone: "Collioure", website: "boulangerie-port.example", createdAt: d(-150),
        services: { social: "active" } },
      { id: "sim-delmas", name: "Cabinet Delmas", activity: "Avocats", zone: "Montpellier", website: "cabinet-delmas.example", createdAt: d(-300),
        services: { seo: "active", "google-ads": "active" } },
      { id: "sim-garage", name: "Garage Central", activity: "Automobile", zone: "Narbonne", website: "garage-central.example", createdAt: d(-90),
        services: { website: "active", maintenance: "active" } },
    ],
    projects: [
      { id: "sim-p-renov-seo", clientId: "sim-renov", name: "SEO local 2026", serviceId: "seo", status: "active" },
      { id: "sim-p-renov-ads", clientId: "sim-renov", name: "Campagnes pompes à chaleur", serviceId: "google-ads", status: "active" },
      { id: "sim-p-renov-social", clientId: "sim-renov", name: "Réseaux sociaux", serviceId: "social", status: "active" },
      { id: "sim-p-renov-site", clientId: "sim-renov", name: "Maintenance du site", serviceId: "maintenance", status: "active" },
      { id: "sim-p-toitures-seo", clientId: "sim-toitures", name: "Visibilité locale", serviceId: "seo", status: "active" },
      { id: "sim-p-boulangerie-social", clientId: "sim-boulangerie", name: "Instagram & Facebook", serviceId: "social", status: "active" },
      { id: "sim-p-delmas-ads", clientId: "sim-delmas", name: "Google Ads droit du travail", serviceId: "google-ads", status: "active" },
      { id: "sim-p-delmas-seo", clientId: "sim-delmas", name: "Contenus juridiques", serviceId: "seo", status: "active" },
      { id: "sim-p-garage-site", clientId: "sim-garage", name: "Site et monitoring", serviceId: "maintenance", status: "active" },
    ],
    agents: {
      seo: { status: "to-connect", note: "Search Console à connecter." },
      "google-ads": { status: "active" },
      publications: { status: "active" },
      monitoring: { status: "active" },
      automation: { status: "coming-soon" },
      report: { status: "active" },
    },
    work: [
      { id: "sim-w-task-1", kind: "task", title: "Valider les visuels de novembre", summary: "Le client attend une proposition de 4 visuels pour ses publications.", status: "todo",
        clientId: "sim-renov", projectId: "sim-p-renov-social", priority: "high", due: d(0), createdAt: d(-3), history: [{ at: at(d(-3)), label: "Tâche créée" }] },
      { id: "sim-w-task-2", kind: "task", title: "Mettre à jour la page Tarifs", summary: "Nouveaux tarifs transmis par le client.", status: "in-progress",
        clientId: "sim-toitures", projectId: "sim-p-toitures-seo", priority: "medium", due: d(2), createdAt: d(-5), history: [{ at: at(d(-5)), label: "Tâche créée" }] },
      { id: "sim-w-task-3", kind: "task", title: "Appeler le client pour le bilan trimestriel", summary: "Préparer les chiffres SEO et Ads avant l’appel.", status: "todo",
        clientId: "sim-delmas", priority: "medium", due: d(4), createdAt: d(-2), history: [{ at: at(d(-2)), label: "Tâche créée" }] },
      { id: "sim-w-task-4", kind: "task", title: "Récupérer les accès Google Business", summary: "En attente d’une réponse du client.", status: "waiting",
        clientId: "sim-boulangerie", projectId: "sim-p-boulangerie-social", priority: "low", createdAt: d(-8), history: [{ at: at(d(-8)), label: "Tâche créée" }] },
      { id: "sim-w-rec-1", kind: "recommendation", title: "Ajouter une page « Aides 2026 »", summary: "Recherches en hausse sur « aides pompe à chaleur 2026 » : une page dédiée capterait ce trafic.", status: "to-review",
        clientId: "sim-renov", projectId: "sim-p-renov-seo", agentId: "seo", priority: "medium", createdAt: d(-1),
        details: [{ label: "Requêtes", value: "+38 % en 30 jours" }, { label: "Effort estimé", value: "1 page, 2 h" }], history: [{ at: at(d(-1), "07:12"), label: "Proposée par l’Agent SEO & Site" }] },
      { id: "sim-w-rec-2", kind: "recommendation", title: "Baisser l’enchère sur « avocat gratuit »", summary: "Mot-clé coûteux sans conversion depuis 3 semaines.", status: "to-review",
        clientId: "sim-delmas", projectId: "sim-p-delmas-ads", agentId: "google-ads", priority: "high", createdAt: d(0),
        details: [{ label: "Coût 21 j", value: "412 €" }, { label: "Conversions", value: "0" }], history: [{ at: at(d(0), "07:02"), label: "Proposée par l’Agent Google Ads" }] },
      { id: "sim-w-act-1", kind: "action", title: "Mettre en pause le mot-clé « devis gratuit »", summary: "Action préparée à partir d’une recommandation acceptée.", status: "to-approve",
        clientId: "sim-renov", projectId: "sim-p-renov-ads", agentId: "google-ads", priority: "high", createdAt: d(-1),
        details: [{ label: "Effet attendu", value: "−120 €/mois" }, { label: "Réversible", value: "Oui" }], history: [{ at: at(d(-1), "16:40"), label: "Action préparée" }, { at: at(d(-1), "16:41"), label: "Validation demandée" }] },
    ],
    publications: [
      { id: "sim-pub-1", clientId: "sim-renov", projectId: "sim-p-renov-social", subject: "Avant / après : salle de bain", text: "Une salle de bain entièrement rénovée en 8 jours à Perpignan 🛁 Isolation, douche à l’italienne et éclairage LED.",
        date: d(1), time: "18:00", status: "to-review", channels: [{ platform: "facebook", status: "pending" }, { platform: "instagram", status: "pending" }], history: [{ at: at(d(-1)), label: "Préparée par l’Agent Publications" }] },
      { id: "sim-pub-2", clientId: "sim-boulangerie", projectId: "sim-p-boulangerie-social", subject: "Nouvelle fougasse d’automne", text: "Châtaigne, figue et noix : la fougasse d’automne arrive ce week-end 🍂",
        date: d(2), time: "08:30", status: "scheduled", channels: [{ platform: "instagram", status: "pending" }, { platform: "google_business_profile", status: "pending" }], history: [{ at: at(d(-2)), label: "Validée" }, { at: at(d(-2), "09:10"), label: "Planifiée" }] },
      { id: "sim-pub-3", clientId: "sim-renov", projectId: "sim-p-renov-social", subject: "Conseil : bien choisir sa PAC", text: "Air-eau ou air-air ? Nos 3 critères pour choisir votre pompe à chaleur.",
        date: d(-2), time: "12:00", status: "published", channels: [{ platform: "facebook", status: "published" }, { platform: "google_business_profile", status: "published" }], history: [{ at: at(d(-2), "12:00"), label: "Publiée" }] },
      { id: "sim-pub-4", clientId: "sim-boulangerie", projectId: "sim-p-boulangerie-social", subject: "Horaires de la Toussaint", text: "Ouverts tous les jours pendant les vacances, de 6 h 30 à 19 h.",
        date: d(5), time: "07:00", status: "draft", channels: [{ platform: "facebook", status: "pending" }, { platform: "google_business_profile", status: "pending" }], history: [{ at: at(d(0)), label: "Brouillon créé" }] },
    ],
    reports: [
      { id: "sim-rep-renov-w", clientId: "sim-renov", kind: "weekly", period: weekOf(d(-7)), status: "ready", recipient: "contact@renov-habitat.example",
        summary: "Semaine solide : +12 % de clics SEO, 2 publications diffusées, 1 optimisation Ads proposée.",
        sections: [
          { title: "SEO", lines: ["Clics : 1 240 (+12 %)", "Position moyenne : 8,4 (−0,6)"] },
          { title: "Google Ads", lines: ["Dépenses : 640 € / 800 €", "Conversions : 21 · CPA 30 €"] },
          { title: "Publications", lines: ["2 publiées · 1 à valider"] },
          { title: "Travail", lines: ["3 tâches terminées · 1 recommandation en cours"] },
        ], history: [{ at: at(d(0), "06:30"), label: "Rapport généré" }] },
      { id: "sim-rep-delmas-m", clientId: "sim-delmas", kind: "monthly", period: "Mois précédent", status: "to-generate", recipient: "associes@cabinet-delmas.example",
        summary: "", sections: [], history: [] },
      { id: "sim-rep-toitures-w", clientId: "sim-toitures", kind: "weekly", period: weekOf(d(-14)), status: "sent", recipient: "contact@toitures-catalanes.example",
        summary: "Visibilité locale en progression, 3 nouveaux avis Google.", sections: [{ title: "SEO", lines: ["Clics : 380 (+6 %)"] }],
        history: [{ at: at(d(-7), "06:30"), label: "Rapport généré" }, { at: at(d(-7), "10:00"), label: "Approuvé" }, { at: at(d(-7), "10:02"), label: "Envoyé" }] },
      { id: "sim-rep-global", kind: "global", period: "Mois en cours", status: "to-generate", recipient: "Équipe CODE-V", summary: "", sections: [], history: [] },
    ],
    events: [
      { id: "sim-e-1", kind: "meeting", title: "Point mensuel Rénov Habitat", date: d(1), time: "10:00", clientId: "sim-renov", recurrence: "monthly" },
      { id: "sim-e-2", kind: "task", title: "Valider les visuels de novembre", date: d(0), time: "14:00", clientId: "sim-renov", projectId: "sim-p-renov-social", recurrence: "none" },
      { id: "sim-e-3", kind: "agent-run", title: "Analyse des campagnes", date: d(0), time: "07:00", agentId: "google-ads", recurrence: "daily" },
    ],
    automations: [
      { id: "sim-auto-monitoring", label: "Contrôle technique des sites", schedule: "Tous les lundis à 08:00", agentId: "monitoring", target: "Clients Maintenance (2)",
        nextRun: at(d(untilMonday), "08:00"), lastRun: at(d(untilMonday - 7), "08:00"), status: "active",
        history: [{ at: at(d(-7), "08:00"), status: "success", summary: "2 sites contrôlés, aucun incident" }, { at: at(d(-14), "08:00"), status: "success", summary: "2 sites contrôlés, 1 alerte performance" }] },
      { id: "sim-auto-ads", label: "Veille des campagnes", schedule: "Tous les jours à 07:00", agentId: "google-ads", target: "Clients Google Ads (2)",
        nextRun: at(d(1), "07:00"), lastRun: at(d(0), "07:00"), status: "active", history: [{ at: at(d(0), "07:00"), status: "success", summary: "1 recommandation proposée" }] },
      { id: "sim-auto-report", label: "Rapports hebdomadaires", schedule: "Tous les lundis à 06:30", agentId: "report", target: "Tous les clients",
        nextRun: at(d(untilMonday), "06:30"), lastRun: at(d(untilMonday - 7), "06:30"), status: "active", history: [{ at: at(d(0), "06:30"), status: "success", summary: "1 rapport prêt à relire" }] },
    ],
    campaigns: [
      { id: "sim-c-renov", clientId: "sim-renov", name: "Pompes à chaleur — Recherche", spend: 640, budget: 800, conversions: 21, cpa: 30, state: "stable", note: "Performances dans l’objectif." },
      { id: "sim-c-delmas", clientId: "sim-delmas", name: "Droit du travail — Recherche", spend: 910, budget: 1000, conversions: 9, cpa: 101, state: "stable", note: "CPA légèrement au-dessus de l’objectif (90 €)." },
    ],
    sites: [
      { clientId: "sim-renov", url: "renov-habitat.example", status: "up", uptime: "99,98 %", performance: 91, lastCheck: at(d(0), "08:00") },
      { clientId: "sim-garage", url: "garage-central.example", status: "up", uptime: "99,91 %", performance: 84, lastCheck: at(d(0), "08:00") },
    ],
    seo: [
      { clientId: "sim-renov", clicks: 1240, clicksChange: 12, position: 8.4, positionChange: -0.6 },
      { clientId: "sim-toitures", clicks: 380, clicksChange: 6, position: 11.2, positionChange: -0.3 },
      { clientId: "sim-delmas", clicks: 610, clicksChange: -2, position: 9.8, positionChange: 0.4 },
    ],
    activity: [
      { id: "sim-a-1", agentId: "google-ads", clientId: "sim-delmas", summary: "Analyse des campagnes : 1 recommandation proposée.", at: at(d(0), "07:02"), status: "success" },
      { id: "sim-a-2", agentId: "report", clientId: "sim-renov", summary: "Rapport hebdomadaire prêt à relire.", at: at(d(0), "06:30"), status: "success" },
      { id: "sim-a-3", agentId: "publications", clientId: "sim-renov", summary: "Publication préparée : « Avant / après : salle de bain ».", at: at(d(-1), "17:20"), status: "success" },
    ],
    connections: [
      { id: "google-ads", name: "Google Ads", description: "Lecture des campagnes et des conversions.", status: "connected" },
      { id: "meta", name: "Meta (Facebook & Instagram)", description: "Publication sur les pages des clients.", status: "connected" },
      { id: "gbp", name: "Google Business Profile", description: "Publications et avis Google.", status: "connected" },
      { id: "search-console", name: "Search Console", description: "Clics, positions et pages indexées.", status: "to-connect" },
      { id: "vercel", name: "Vercel", description: "Déploiements et erreurs des sites.", status: "to-connect" },
      { id: "email", name: "Envoi d’e-mails", description: "Envoi des rapports aux clients.", status: "coming-soon" },
    ],
    news: [
      { id: "n1", category: "IA", source: "Simulation", date: d(-1), title: "Les assistants vocaux arrivent dans les outils métiers", summary: "Ce que cela change pour le pilotage quotidien d’une agence." },
      { id: "n2", category: "SEO", source: "Simulation", date: d(-2), title: "Recherche locale : les avis pèsent davantage", summary: "Répondre aux avis devient un levier de visibilité." },
      { id: "n3", category: "Ads", source: "Simulation", date: d(-3), title: "Google Ads simplifie les campagnes locales", summary: "Moins de réglages, plus d’automatisation à surveiller." },
    ],
  };
}
