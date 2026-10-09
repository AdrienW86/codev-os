// Scénarios de simulation : variations déterministes du monde de base.
import { addDays, at, buildBaseWorld } from "@/lib/simulation/fixtures";
import type { SimId, SimWorkItem, SimWorld } from "@/lib/simulation/types";

export type Scenario = {
  id: string; name: string; description: string;
  /** Page la plus parlante pour démarrer le parcours. */
  focus: string;
  apply: (world: SimWorld) => void;
};

const keepClients = (world: SimWorld, ids: string[]) => {
  const keep = new Set(ids);
  world.clients = world.clients.filter((client) => keep.has(client.id));
  world.projects = world.projects.filter((item) => keep.has(item.clientId));
  world.work = world.work.filter((item) => keep.has(item.clientId));
  world.publications = world.publications.filter((item) => keep.has(item.clientId));
  world.reports = world.reports.filter((item) => !item.clientId || keep.has(item.clientId));
  world.events = world.events.filter((item) => !item.clientId || keep.has(item.clientId));
  world.campaigns = world.campaigns.filter((item) => keep.has(item.clientId));
  world.sites = world.sites.filter((item) => keep.has(item.clientId));
  world.seo = world.seo.filter((item) => keep.has(item.clientId));
  world.activity = world.activity.filter((item) => !item.clientId || keep.has(item.clientId));
};

const closeAllWork = (world: SimWorld) => {
  world.work = world.work.map((item) => ({ ...item, status: item.kind === "task" ? "done" : item.kind === "recommendation" ? "accepted" : item.kind === "action" ? "executed" : "resolved" }));
};

const task = (world: SimWorld, id: string, title: string, clientId: SimId, due: number, priority: SimWorkItem["priority"] = "medium"): SimWorkItem => ({
  id: `sim-w-${id}`, kind: "task", title, summary: "", status: "todo", clientId, priority, due: addDays(world.today, due), createdAt: addDays(world.today, -5),
  history: [{ at: at(addDays(world.today, -5)), label: "Tâche créée" }],
});

const siteDown = (world: SimWorld) => {
  const site = world.sites.find((item) => item.clientId === "sim-garage");
  if (site) Object.assign(site, { status: "down", uptime: "97,40 %", lastCheck: at(world.today, "08:00") });
  world.work.push(
    { id: "sim-w-inc-site", kind: "incident", title: "Site garage-central.example indisponible", summary: "Erreur 502 depuis 07:52 sur toutes les pages. Dernier déploiement : hier à 18:40.", status: "open",
      clientId: "sim-garage", projectId: "sim-p-garage-site", agentId: "monitoring", priority: "high", createdAt: world.today,
      details: [{ label: "Détecté", value: "Aujourd’hui 07:52" }, { label: "Pages touchées", value: "100 %" }, { label: "Cause probable", value: "Variable d’environnement manquante après déploiement" }],
      history: [{ at: at(world.today, "07:52"), label: "Incident détecté par l’Agent Monitoring Technique" }] },
    { id: "sim-w-rec-site", kind: "recommendation", title: "Revenir au déploiement précédent", summary: "Le déploiement d’hier a introduit l’erreur ; revenir à la version précédente rétablit le site en 2 minutes.", status: "to-review",
      clientId: "sim-garage", projectId: "sim-p-garage-site", agentId: "monitoring", priority: "high", createdAt: world.today, sourceId: "sim-w-inc-site",
      details: [{ label: "Correction proposée", value: "PR fictive #128 : rétablir la variable manquante" }], history: [{ at: at(world.today, "07:58"), label: "Diagnostic terminé" }] },
  );
  world.activity.unshift({ id: "sim-a-site", agentId: "monitoring", clientId: "sim-garage", summary: "Site indisponible (502). Diagnostic et correction proposés.", at: at(world.today, "07:58"), status: "failed" });
};

const adsAnomaly = (world: SimWorld) => {
  const campaign = world.campaigns.find((item) => item.clientId === "sim-delmas");
  if (campaign) Object.assign(campaign, { spend: 1180, cpa: 236, conversions: 5, state: "anomaly", note: "Coût par conversion ×2,6 en 5 jours." });
  world.work.push({ id: "sim-w-inc-ads", kind: "incident", title: "Anomalie : coût par conversion ×2,6", summary: "Le CPA de la campagne « Droit du travail » est passé de 90 € à 236 € en 5 jours.", status: "open",
    clientId: "sim-delmas", projectId: "sim-p-delmas-ads", agentId: "google-ads", priority: "high", createdAt: world.today,
    details: [{ label: "Budget consommé", value: "118 %" }, { label: "Cause probable", value: "Requêtes « avocat gratuit » en forte hausse" }],
    history: [{ at: at(world.today, "07:02"), label: "Anomalie détectée par l’Agent Google Ads" }] });
  const rec = world.work.find((item) => item.id === "sim-w-rec-2");
  if (rec) rec.sourceId = "sim-w-inc-ads";
};

export const scenarios: readonly Scenario[] = [
  { id: "normal", name: "Journée type", description: "Activité habituelle : quelques validations et tâches.", focus: "/dashboard", apply: () => {} },
  { id: "calm", name: "Journée calme", description: "Peu de choses à faire, rien d’urgent.", focus: "/dashboard",
    apply: (world) => { closeAllWork(world); world.work.push(task(world, "calm-1", "Relire le contenu de la newsletter", "sim-renov", 3, "low")); world.publications.forEach((item) => { if (item.status === "to-review" || item.status === "draft") item.status = "scheduled"; }); } },
  { id: "busy", name: "Journée chargée", description: "Retards, validations, publications et incidents en même temps.", focus: "/dashboard",
    apply: (world) => {
      world.work.push(task(world, "busy-1", "Corriger les balises title", "sim-toitures", -2, "high"), task(world, "busy-2", "Envoyer le devis refonte", "sim-garage", -1, "high"), task(world, "busy-3", "Brief photos chantier", "sim-renov", 0, "high"));
      world.publications.forEach((item) => { if (item.status === "draft") item.status = "to-review"; });
      siteDown(world); adsAnomaly(world);
    } },
  { id: "new-client", name: "Nouveau client", description: "Un client vient d’être créé, sans service.", focus: "/clients/sim-atelier",
    apply: (world) => { world.clients.unshift({ id: "sim-atelier", name: "Atelier Bois & Co", activity: "Menuiserie", zone: "Perpignan", website: "atelier-bois.example", createdAt: world.today, services: {}, isNew: true }); } },
  { id: "seo-only", name: "Client SEO uniquement", description: "Un seul client, abonné au SEO.", focus: "/clients/sim-toitures", apply: (world) => keepClients(world, ["sim-toitures"]) },
  { id: "ads-seo", name: "Client Ads + SEO", description: "Un cabinet abonné à Google Ads et au SEO.", focus: "/clients/sim-delmas", apply: (world) => keepClients(world, ["sim-delmas"]) },
  { id: "social", name: "Client réseaux sociaux", description: "Une boulangerie suivie sur les réseaux.", focus: "/clients/sim-boulangerie", apply: (world) => keepClients(world, ["sim-boulangerie"]) },
  { id: "all-services", name: "Tous services actifs", description: "Un client abonné aux 7 services, tous les agents prêts.", focus: "/clients/sim-renov",
    apply: (world) => {
      const renov = world.clients.find((item) => item.id === "sim-renov");
      if (renov) renov.services = { ...renov.services, automation: "active" };
      for (const id of Object.keys(world.agents) as (keyof SimWorld["agents"])[]) world.agents[id] = { status: "active" };
      world.connections.forEach((item) => { if (item.status === "to-connect") item.status = "connected"; });
    } },
  { id: "to-configure", name: "Service à configurer", description: "Services souscrits mais pas encore configurés.", focus: "/clients/sim-renov",
    apply: (world) => { const renov = world.clients.find((item) => item.id === "sim-renov"); if (renov) renov.services = { ...renov.services, seo: "to-configure", "google-ads": "to-configure" }; world.agents.seo = { status: "to-connect", note: "Search Console à connecter." }; } },
  { id: "agent-disconnected", name: "Agent déconnecté", description: "La connexion Google Ads a expiré.", focus: "/agents",
    apply: (world) => { world.agents["google-ads"] = { status: "disconnected", note: "Accès Google Ads expiré : reconnexion nécessaire." }; const connection = world.connections.find((item) => item.id === "google-ads"); if (connection) connection.status = "error"; } },
  { id: "agent-error", name: "Agent en erreur", description: "L’Agent Publications a échoué lors de sa dernière exécution.", focus: "/agents",
    apply: (world) => {
      world.agents.publications = { status: "error", note: "Dernière exécution échouée : quota de génération atteint." };
      world.activity.unshift({ id: "sim-a-err", agentId: "publications", clientId: "sim-boulangerie", summary: "Préparation des publications échouée (quota atteint).", at: at(world.today, "06:00"), status: "failed" });
    } },
  { id: "actions-pending", name: "Actions à valider", description: "Plusieurs actions attendent une décision.", focus: "/work?view=review",
    apply: (world) => {
      world.work.push(
        { id: "sim-w-act-2", kind: "action", title: "Ajouter 12 mots-clés négatifs", summary: "Exclut les recherches « gratuit » et « stage ».", status: "to-approve", clientId: "sim-delmas", projectId: "sim-p-delmas-ads", agentId: "google-ads", priority: "medium", createdAt: world.today, sourceId: "sim-w-rec-2", history: [{ at: at(world.today, "07:10"), label: "Action préparée" }] },
        { id: "sim-w-act-3", kind: "action", title: "Publier la page « Aides 2026 »", summary: "Page rédigée, relue par l’Agent SEO & Site.", status: "to-approve", clientId: "sim-renov", projectId: "sim-p-renov-seo", agentId: "seo", priority: "medium", createdAt: world.today, sourceId: "sim-w-rec-1", history: [{ at: at(world.today, "08:30"), label: "Action préparée" }] },
      );
    } },
  { id: "publications-review", name: "Publications à valider", description: "Plusieurs publications attendent une relecture.", focus: "/publications",
    apply: (world) => { world.publications.forEach((item) => { if (item.status !== "published") item.status = "to-review"; }); } },
  { id: "publication-partial", name: "Publication partiellement échouée", description: "Publiée sur Facebook, échec sur Instagram.", focus: "/publications",
    apply: (world) => { const pub = world.publications.find((item) => item.id === "sim-pub-3"); if (pub) { pub.status = "partial"; pub.channels = [{ platform: "facebook", status: "published" }, { platform: "instagram", status: "failed", error: "Image refusée : format 4:5 attendu." }]; pub.history.push({ at: at(pub.date, "12:01"), label: "Échec sur Instagram" }); } } },
  { id: "report-ready", name: "Rapport prêt", description: "Des rapports attendent votre relecture.", focus: "/reports",
    apply: (world) => { world.reports.forEach((item) => { if (item.status === "to-generate") Object.assign(item, { status: "ready", summary: "Mois stable : objectifs atteints sur le SEO, CPA Ads à surveiller.", sections: [{ title: "Synthèse", lines: ["Clics SEO : +4 %", "Conversions Ads : 31"] }], history: [{ at: at(world.today, "06:30"), label: "Rapport généré" }] }); }); } },
  { id: "report-pending", name: "Rapport en attente", description: "Aucun rapport n’est encore généré.", focus: "/reports",
    apply: (world) => { world.reports.forEach((item) => { if (item.status !== "sent") Object.assign(item, { status: "to-generate", summary: "", sections: [], history: [] }); }); } },
  { id: "tasks-overdue", name: "Tâches en retard", description: "Plusieurs échéances sont dépassées.", focus: "/work?view=todo",
    apply: (world) => { world.work.push(task(world, "late-1", "Livrer les maquettes", "sim-garage", -4, "high"), task(world, "late-2", "Relancer le client pour les photos", "sim-renov", -2, "medium"), task(world, "late-3", "Mettre à jour les horaires Google", "sim-boulangerie", -1, "high")); } },
  { id: "site-down", name: "Site indisponible", description: "Le site d’un client ne répond plus.", focus: "/work?view=review", apply: siteDown },
  { id: "ads-anomaly", name: "Campagne Ads en anomalie", description: "Le coût par conversion explose.", focus: "/clients/sim-delmas", apply: adsAnomaly },
  { id: "seo-progress", name: "SEO en progression", description: "Belle progression des clics et des positions.", focus: "/clients/sim-toitures",
    apply: (world) => { const seo = world.seo.find((item) => item.clientId === "sim-toitures"); if (seo) Object.assign(seo, { clicks: 620, clicksChange: 63, position: 6.1, positionChange: -5.1 }); world.agents.seo = { status: "active" }; const sc = world.connections.find((item) => item.id === "search-console"); if (sc) sc.status = "connected"; } },
  { id: "nothing", name: "Aucun élément à traiter", description: "Tout est à jour.", focus: "/dashboard",
    apply: (world) => { closeAllWork(world); world.publications.forEach((item) => { if (item.status !== "published") item.status = "scheduled"; }); world.reports.forEach((item) => { item.status = "sent"; }); } },
];

export const defaultScenarioId = "normal";

export function getScenario(id: string | null | undefined) {
  return scenarios.find((scenario) => scenario.id === id) ?? null;
}

export function buildScenarioWorld(id: string, today: string): SimWorld {
  const world = buildBaseWorld(today);
  getScenario(id)?.apply(world);
  return world;
}
