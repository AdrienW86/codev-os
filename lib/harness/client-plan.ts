// Chef de projet (harness) : pour un client, quel agent est attendu, lequel travaille, et ce qui attend l'administrateur.
// Fonction pure, uniquement à partir de faits lus en base : aucune estimation, aucun chiffre inventé.
import { harnessCharters, type HarnessAgentId } from "./charter";

export type ClientFacts = {
  clientId: string;
  website: string | null;
  services: readonly { key: string; lifecycle: string }[];
  /** Agents du registre activés (enabled + Actif) et rattachés à ce client, par type. */
  assignedTypes: ReadonlySet<string>;
  /** Types d'agents du registre actifs globalement. */
  activeTypes: ReadonlySet<string>;
  automations: readonly { run_type: string; client_id: string | null; status: string }[];
  publication: { configured: boolean; autoApprove: boolean; pendingReview: number; scheduledNext7Days: number; failedDeliveries: number } | null;
  blog: { enabled: boolean } | null;
  visual: { enabled: boolean } | null;
  video: { enabled: boolean } | null;
  mediaLibrary: { classification: boolean } | null;
};

export type SeatState = "working" | "needs_setup" | "not_subscribed" | "off" | "on_demand";
export type ClientSeat = { agent: HarnessAgentId; name: string; state: SeatState; detail: string; href: string };
export type ClientPlan = { seats: ClientSeat[]; todo: { label: string; href: string }[] };

const active = (facts: ClientFacts, key: string) => facts.services.some((s) => s.key === key && s.lifecycle === "active");
const planned = (facts: ClientFacts, runType: string, clientScoped: boolean) =>
  facts.automations.some((a) => a.run_type === runType && a.status === "active" && (!clientScoped || a.client_id === facts.clientId));

export function buildClientPlan(facts: ClientFacts): ClientPlan {
  const base = `/clients/${facts.clientId}`;
  const seats: ClientSeat[] = [];
  const todo: ClientPlan["todo"] = [];
  const name = (id: HarnessAgentId) => harnessCharters.find((c) => c.id === id)?.name ?? id;
  const seat = (agent: HarnessAgentId, state: SeatState, detail: string, href: string) => seats.push({ agent, name: name(agent), state, detail, href });

  // Pilotage
  seat("report", facts.activeTypes.has("report") && planned(facts, "report.generate", false) ? "working" : "needs_setup",
    planned(facts, "report.generate", false) ? "Rapports planifiés pour tous les clients actifs." : "Aucun rapport planifié.", "/agents#supervision");

  // Contenu
  const social = active(facts, "social");
  const pub = facts.publication;
  if (!social) seat("publications", "not_subscribed", "Service Réseaux sociaux non souscrit.", `${base}?tab=information`);
  else if (!pub?.configured) { seat("publications", "needs_setup", "Publications non configurées pour ce client.", `${base}?tab=publications`); todo.push({ label: "Configurer les publications", href: `${base}?tab=publications` }); }
  else {
    seat("publications", "working", `${pub.scheduledNext7Days} diffusion(s) programmée(s) sur 7 jours ; ${pub.pendingReview} à valider${pub.autoApprove ? " (validation automatique active)" : ""}.`, `${base}?tab=publications`);
    if (pub.pendingReview && !pub.autoApprove) todo.push({ label: `Valider ${pub.pendingReview} publication(s)`, href: "/publications/review" });
    if (pub.failedDeliveries) todo.push({ label: `Vérifier ${pub.failedDeliveries} diffusion(s) en échec ou bloquée(s)`, href: "/publications/supervision" });
  }
  for (const [agent, row, tab] of [["blog", facts.blog, "media"], ["visual", facts.visual, "media"], ["video", facts.video, "media"]] as const) {
    if (!social) { seat(agent, "not_subscribed", "Service Réseaux sociaux non souscrit.", `${base}?tab=information`); continue; }
    seat(agent, row?.enabled ? "working" : "off", row?.enabled ? "Activé pour ce client." : "Non activé pour ce client.", `${base}?tab=${tab}`);
  }
  seat("media-library", facts.mediaLibrary?.classification ? "working" : "off", facts.mediaLibrary?.classification ? "Classement automatique des photos actif." : "Classement automatique non activé.", `${base}?tab=media`);

  // Site et SEO
  if (!active(facts, "seo")) seat("seo", "not_subscribed", "Service SEO non souscrit.", `${base}?tab=information`);
  else if (!facts.assignedTypes.has("seo")) { seat("seo", "needs_setup", "Agent SEO en pause ou non rattaché.", "/agents"); todo.push({ label: "Activer l’Agent SEO", href: "/agents" }); }
  else if (!planned(facts, "seo.analyze", true)) { seat("seo", "needs_setup", "Aucune analyse SEO planifiée.", "/agents#supervision"); todo.push({ label: "Planifier les analyses SEO", href: "/agents#supervision" }); }
  else seat("seo", "working", "Analyses SEO planifiées.", `${base}?tab=health`);

  const site = active(facts, "website") || active(facts, "maintenance");
  if (!site) seat("monitoring", "not_subscribed", "Services Site web / Maintenance non souscrits.", `${base}?tab=information`);
  else if (!facts.website) { seat("monitoring", "needs_setup", "Adresse du site absente de la fiche client.", `${base}?tab=information`); todo.push({ label: "Renseigner l’adresse du site", href: `${base}?tab=information` }); }
  else if (!facts.activeTypes.has("monitoring") || !planned(facts, "monitoring.check_sites", false)) { seat("monitoring", "needs_setup", "Contrôle des sites non planifié.", "/agents#supervision"); todo.push({ label: "Planifier le contrôle des sites", href: "/agents#supervision" }); }
  else seat("monitoring", "working", "Site contrôlé chaque jour.", `${base}?tab=health`);

  // Publicité
  if (!active(facts, "google-ads")) seat("google-ads", "not_subscribed", "Service Google Ads non souscrit.", `${base}?tab=information`);
  else if (!facts.assignedTypes.has("google-ads")) { seat("google-ads", "needs_setup", "Agent Google Ads non rattaché à ce client.", `${base}?tab=agents`); todo.push({ label: "Rattacher l’Agent Google Ads", href: `${base}?tab=agents` }); }
  else seat("google-ads", "working", "Analyse des campagnes disponible.", `${base}?tab=ads`);

  // Prospection et veille : à la demande / global.
  seat("prospection", "on_demand", "Balayage de zone lancé à la demande.", `/acquisition?client=${facts.clientId}`);
  seat("veille", facts.activeTypes.has("veille") ? "working" : "off", "Veille commune à tous les clients.", "/news");

  return { seats, todo };
}

export const seatLabels: Record<SeatState, { label: string; tone: "green" | "amber" | "neutral" | "blue" }> = {
  working: { label: "Au travail", tone: "green" },
  needs_setup: { label: "À régler", tone: "amber" },
  not_subscribed: { label: "Non souscrit", tone: "neutral" },
  off: { label: "Désactivé", tone: "neutral" },
  on_demand: { label: "À la demande", tone: "blue" },
};
