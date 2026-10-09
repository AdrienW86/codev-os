// Libellés métier des états simulés.
import type { StatusTone } from "@/components/ui/status-badge";
import type { SimAgentStatus, SimEventKind, SimPlatform, SimPublication, SimReport, SimWorkItem } from "@/lib/simulation/types";

type L = { label: string; tone: StatusTone; symbol?: string };

export const workKindLabels: Record<SimWorkItem["kind"], string> = { task: "Tâche", recommendation: "Recommandation", action: "Action", incident: "Incident" };

export const workStatusLabels: Record<SimWorkItem["status"], L> = {
  todo: { label: "À faire", tone: "neutral" }, "in-progress": { label: "En cours", tone: "blue" }, waiting: { label: "En attente", tone: "amber" }, done: { label: "Terminé", tone: "green" },
  "to-review": { label: "À examiner", tone: "amber" }, accepted: { label: "Acceptée", tone: "green" }, rejected: { label: "Écartée", tone: "neutral" },
  draft: { label: "Préparée", tone: "neutral" }, "to-approve": { label: "À valider", tone: "amber" }, approved: { label: "Validée", tone: "green" },
  refused: { label: "Refusée", tone: "neutral" }, executed: { label: "Réalisée", tone: "green" }, failed: { label: "Échec", tone: "red" },
  open: { label: "Ouvert", tone: "red" }, investigating: { label: "Diagnostic en cours", tone: "amber" }, resolved: { label: "Résolu", tone: "green" },
};

export const priorityLabels: Record<SimWorkItem["priority"], L> = { high: { label: "Priorité haute", tone: "amber" }, medium: { label: "Priorité moyenne", tone: "neutral" }, low: { label: "Priorité basse", tone: "neutral" } };

/** Sections de la page Travail. */
export function workSection(item: SimWorkItem): "todo" | "follow" | "review" | "waiting" | "done" {
  if (["to-review", "to-approve", "open"].includes(item.status)) return "review";
  if (["in-progress", "approved", "investigating", "failed"].includes(item.status)) return "follow";
  if (["waiting", "draft"].includes(item.status)) return "waiting";
  if (item.status === "todo") return "todo";
  return "done";
}

export const agentStatusLabels: Record<SimAgentStatus, L> = {
  active: { label: "Actif", tone: "green", symbol: "●" }, ready: { label: "Prêt", tone: "green", symbol: "●" },
  "to-connect": { label: "À connecter", tone: "neutral", symbol: "○" }, "config-required": { label: "Configuration requise", tone: "amber", symbol: "○" },
  "coming-soon": { label: "À venir", tone: "neutral", symbol: "◌" }, error: { label: "En erreur", tone: "red", symbol: "●" },
  disconnected: { label: "Déconnecté", tone: "red", symbol: "○" }, paused: { label: "En pause", tone: "neutral", symbol: "○" },
};

export const isAgentWorking = (status: SimAgentStatus) => status === "active" || status === "ready";

export const publicationStatusLabels: Record<SimPublication["status"], L> = {
  draft: { label: "Brouillon", tone: "neutral" }, "to-review": { label: "À valider", tone: "amber" }, approved: { label: "Validée", tone: "green" },
  scheduled: { label: "Planifiée", tone: "blue" }, published: { label: "Publiée", tone: "green" }, partial: { label: "Échec partiel", tone: "red" },
};

export const platformLabels: Record<SimPlatform, string> = { facebook: "Facebook", instagram: "Instagram", google_business_profile: "Google Business" };

export const reportStatusLabels: Record<SimReport["status"], L> = {
  "to-generate": { label: "À générer", tone: "neutral" }, generating: { label: "Génération…", tone: "blue" }, ready: { label: "Prêt à relire", tone: "amber" },
  approved: { label: "Approuvé", tone: "green" }, sent: { label: "Envoyé", tone: "green" },
};

export const reportKindLabels: Record<SimReport["kind"], string> = { weekly: "Rapport hebdomadaire", monthly: "Rapport mensuel", global: "Activité globale" };

export const eventKindLabels: Record<SimEventKind, string> = { task: "Tâche", meeting: "Rendez-vous", check: "Contrôle récurrent", "agent-run": "Analyse planifiée" };
export const recurrenceLabels = { none: "Une fois", daily: "Tous les jours", weekly: "Toutes les semaines", monthly: "Tous les mois" } as const;

export const connectionStatusLabels = {
  connected: { label: "Connecté", tone: "green" }, "to-connect": { label: "À connecter", tone: "neutral" },
  error: { label: "Erreur", tone: "red" }, "coming-soon": { label: "À venir", tone: "neutral" },
} as const satisfies Record<string, L>;

const timeFormatter = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const dayFormatter = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** « 12 oct., 08:00 » à partir de « AAAA-MM-JJTHH:MM ». */
export function formatSimDateTime(value: string) {
  const date = new Date(`${value.length === 10 ? `${value}T00:00` : value}:00.000Z`);
  return Number.isNaN(date.getTime()) ? "—" : value.length === 10 ? dayFormatter.format(date) : timeFormatter.format(date);
}
