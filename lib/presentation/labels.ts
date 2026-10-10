// Libellés métier pour l’interface : aucun statut brut de la base n’est affiché tel quel.

export type Tone = "neutral" | "green" | "amber";
export type Label = { label: string; tone: Tone };

const recommendationStatusLabels: Record<string, Label> = {
  pending: { label: "À examiner", tone: "amber" },
  accepted: { label: "Acceptée", tone: "green" },
  rejected: { label: "Écartée", tone: "neutral" },
  archived: { label: "Archivée", tone: "neutral" },
};

const actionStatusLabels: Record<string, Label> = {
  draft: { label: "Brouillon", tone: "neutral" },
  pending_approval: { label: "À valider", tone: "amber" },
  approved: { label: "Validée", tone: "green" },
  executing: { label: "En cours", tone: "neutral" },
  executed: { label: "Réalisée", tone: "green" },
  failed: { label: "Échec · à vérifier", tone: "amber" },
  cancelled: { label: "Annulée", tone: "neutral" },
  rejected: { label: "Refusée", tone: "neutral" },
  uncertain: { label: "Résultat incertain · à vérifier", tone: "amber" },
};

const runStatusLabels: Record<string, Label> = {
  running: { label: "En cours", tone: "neutral" },
  completed: { label: "Terminé", tone: "green" },
  failed: { label: "Échec", tone: "amber" },
};

const publicationStatusLabels: Record<string, Label> = {
  draft: { label: "À préparer", tone: "neutral" },
  pending_review: { label: "À valider", tone: "amber" },
  approved: { label: "Validée", tone: "green" },
  rejected: { label: "Refusée", tone: "neutral" },
};

const severityLabels: Record<string, Label> = {
  info: { label: "Information", tone: "neutral" },
  low: { label: "Importance faible", tone: "neutral" },
  medium: { label: "Importance moyenne", tone: "neutral" },
  high: { label: "Importance haute", tone: "amber" },
  critical: { label: "Critique", tone: "amber" },
};

const actionTypeLabels: Record<string, string> = {
  "internal.test": "Vérification interne",
  "seo.site_change": "Amélioration SEO du site",
  "ads.optimization": "Optimisation Google Ads",
  "monitoring.fix": "Correctif technique",
  "report.send": "Envoi de rapport",
};

const unknown: Label = { label: "Statut inconnu", tone: "neutral" };

export function recommendationStatusLabel(status: string): Label { return recommendationStatusLabels[status] ?? unknown; }
export function actionStatusLabel(status: string): Label { return actionStatusLabels[status] ?? unknown; }
export function runStatusLabel(status: string): Label { return runStatusLabels[status] ?? unknown; }
export function publicationStatusLabel(status: string): Label { return publicationStatusLabels[status] ?? unknown; }
export function severityLabel(severity: string): Label { return severityLabels[severity] ?? { label: "Importance non définie", tone: "neutral" }; }

// Les statuts des tâches sont déjà rédigés en français dans la base.
export function taskStatusLabel(status: string): Label {
  if (status === "Terminé") return { label: "Terminée", tone: "green" };
  if (status === "En attente") return { label: "En attente", tone: "amber" };
  return { label: status || "Statut inconnu", tone: "neutral" };
}

export function actionTypeLabel(type: string) {
  return actionTypeLabels[type] ?? "Action proposée par un agent";
}

/** « 3 tâches prioritaires », « 1 action à valider »… */
export function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count > 1 ? plural : singular}`;
}
