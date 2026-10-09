// Vue « Travail » : agrège tâches, recommandations et actions sans nouveau modèle de données.
import { actionStatusLabel, actionTypeLabel, recommendationStatusLabel, severityLabel, taskStatusLabel, type Label } from "@/lib/presentation/labels";

export const workSections = [
  { id: "todo", label: "À faire" },
  { id: "follow", label: "En cours / à suivre" },
  { id: "review", label: "À valider" },
  { id: "waiting", label: "En attente" },
  { id: "done", label: "Terminé" },
] as const;
export type WorkSectionId = (typeof workSections)[number]["id"];
export type WorkKind = "task" | "recommendation" | "action";

export type WorkItem = {
  key: string; id: string; kind: WorkKind; kindLabel: string; section: WorkSectionId;
  /** Résumé métier affiché dans le panneau de détail. */
  summary: string | null;
  agent: { id: string; name: string } | null;
  /** Élément d’origine (recommandation d’une action). */
  source: { href: string; title: string } | null;
  /** Page détail existante, sinon `null`. */
  fullHref: string | null;
  priorityKey: "high" | "medium" | "low" | null;
  title: string; href: string; status: Label;
  client: { id: string; name: string | null };
  project: { id: string; name: string } | null;
  priority: Label | null; dueDate: string | null; updatedAt: string;
};

type Ref = { id: string; name: string } | null;
type TaskInput = { id: string; client_id: string; project_id: string | null; title: string; status: string; priority: string; due_date: string | null; updated_at: string; client?: { name: string } | null; project?: { name: string } | null };
type RecommendationInput = { id: string; client_id: string; project_id: string | null; title: string; status: string; severity: string; updated_at: string; reason?: string | null; client?: Ref; project?: Ref; agent?: Ref };
type ActionInput = { id: string; client_id: string; project_id: string | null; action_type: string; status: string; requires_approval: boolean; updated_at: string; client?: Ref; project?: Ref; agent?: Ref; recommendation?: { id: string; title: string } | null };

const taskPriorityKey = (priority: string) => priority === "Haute" ? "high" : priority === "Basse" ? "low" : "medium";
const severityKey = (severity: string) => severity === "high" || severity === "critical" ? "high" : severity === "medium" ? "medium" : "low";

function taskSection(status: string): WorkSectionId {
  if (status === "Terminé") return "done";
  if (status === "En cours") return "follow";
  if (status === "En attente") return "waiting";
  return "todo";
}

function recommendationSection(status: string): WorkSectionId {
  return status === "pending" ? "review" : "done";
}

function actionSection(status: string, requiresApproval: boolean): WorkSectionId {
  if (status === "pending_approval") return requiresApproval ? "review" : "waiting";
  if (status === "approved" || status === "executing" || status === "failed") return "follow";
  if (status === "draft") return "waiting";
  return "done";
}

const project = (id: string | null, name: string | undefined | null) => (id && name ? { id, name } : null);

export function buildWorkItems(input: { tasks: readonly TaskInput[]; recommendations: readonly RecommendationInput[]; actions: readonly ActionInput[] }): WorkItem[] {
  const items: WorkItem[] = [
    ...input.tasks.map((task): WorkItem => ({
      key: `task:${task.id}`, id: task.id, kind: "task", summary: null, agent: null, source: null, fullHref: `/tasks/${task.id}/edit`, priorityKey: taskPriorityKey(task.priority), kindLabel: "Tâche", section: taskSection(task.status),
      title: task.title, href: `/tasks/${task.id}/edit`, status: taskStatusLabel(task.status),
      client: { id: task.client_id, name: task.client?.name ?? null }, project: project(task.project_id, task.project?.name),
      priority: { label: `Priorité ${task.priority.toLowerCase()}`, tone: task.priority === "Haute" ? "amber" : "neutral" },
      dueDate: task.due_date, updatedAt: task.updated_at,
    })),
    ...input.recommendations.map((item): WorkItem => ({
      key: `recommendation:${item.id}`, id: item.id, kind: "recommendation", summary: item.reason ?? null, agent: item.agent ?? null, source: null, fullHref: `/recommendations/${item.id}`, priorityKey: severityKey(item.severity), kindLabel: "Recommandation", section: recommendationSection(item.status),
      title: item.title, href: `/recommendations/${item.id}`, status: recommendationStatusLabel(item.status),
      client: { id: item.client_id, name: item.client?.name ?? null }, project: project(item.project_id, item.project?.name),
      priority: severityLabel(item.severity), dueDate: null, updatedAt: item.updated_at,
    })),
    ...input.actions.map((item): WorkItem => ({
      key: `action:${item.id}`, id: item.id, kind: "action", summary: item.requires_approval ? "Action proposée par un agent : elle ne s’exécute qu’après votre validation." : null, agent: item.agent ?? null,
      source: item.recommendation ? { href: `/recommendations/${item.recommendation.id}`, title: item.recommendation.title } : null, fullHref: null, priorityKey: null, kindLabel: "Action", section: actionSection(item.status, item.requires_approval),
      title: item.recommendation?.title ? `${actionTypeLabel(item.action_type)} · ${item.recommendation.title}` : actionTypeLabel(item.action_type),
      href: `/actions?status=${encodeURIComponent(item.status)}`, status: actionStatusLabel(item.status),
      client: { id: item.client_id, name: item.client?.name ?? null }, project: project(item.project_id, item.project?.name),
      priority: null, dueDate: null, updatedAt: item.updated_at,
    })),
  ];
  return items.sort((a, b) =>
    Number(b.priority?.tone === "amber") - Number(a.priority?.tone === "amber")
    || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")
    || b.updatedAt.localeCompare(a.updatedAt));
}

export function groupWorkItems(items: readonly WorkItem[]) {
  const groups = Object.fromEntries(workSections.map(({ id }) => [id, [] as WorkItem[]])) as Record<WorkSectionId, WorkItem[]>;
  for (const item of items) groups[item.section].push(item);
  // Le travail terminé est affiché du plus récent au plus ancien.
  groups.done.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return groups;
}

export function isWorkSectionId(value: unknown): value is WorkSectionId {
  return typeof value === "string" && workSections.some(({ id }) => id === value);
}
