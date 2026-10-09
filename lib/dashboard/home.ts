// Vues dérivées de la home : calculs purs et déterministes à partir des données existantes.

type TaskLike = { id: string; title: string; status: string; priority: string; due_date: string | null; client_id: string; client?: { name: string } | null };
type ClientLike = { id: string; name: string };
type ProjectLike = { client_id: string; status: string };
type RecommendationLike = { client_id: string; status: string };
type ActionLike = { client_id: string; status: string; requires_approval: boolean };

const isOpenTask = (task: { status: string }) => task.status !== "Terminé";

/** Date du jour (AAAA-MM-JJ) dans le fuseau de l’agence. */
export function todayInParis(now: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const byDueDateThenPriority = (a: TaskLike, b: TaskLike) =>
  (a.due_date ?? "").localeCompare(b.due_date ?? "") || Number(b.priority === "Haute") - Number(a.priority === "Haute") || a.title.localeCompare(b.title, "fr");

/** Planning léger : tâches ouvertes en retard, du jour et des 7 prochains jours. */
export function planTasks<T extends TaskLike>(tasks: readonly T[], today: string) {
  const weekEnd = addDays(today, 7);
  const dated = tasks.filter((task) => isOpenTask(task) && /^\d{4}-\d{2}-\d{2}/.test(task.due_date ?? ""));
  const day = (task: T) => (task.due_date as string).slice(0, 10);
  return {
    overdue: dated.filter((task) => day(task) < today).sort(byDueDateThenPriority),
    today: dated.filter((task) => day(task) === today).sort(byDueDateThenPriority),
    week: dated.filter((task) => day(task) > today && day(task) <= weekEnd).sort(byDueDateThenPriority),
    undatedPriority: tasks.filter((task) => isOpenTask(task) && !task.due_date && task.priority === "Haute"),
  };
}

export type ClientWatch = {
  id: string; name: string;
  openProjects: number; openTasks: number; priorityTasks: number;
  pendingRecommendations: number; pendingActions: number; score: number;
};

/** Clients à surveiller : score simple, sans IA, trié puis limité. */
export function watchClients(input: {
  clients: readonly ClientLike[]; projects: readonly ProjectLike[]; tasks: readonly TaskLike[];
  recommendations: readonly RecommendationLike[]; actions: readonly ActionLike[];
}, limit = 5): ClientWatch[] {
  const rows = new Map<string, ClientWatch>(input.clients.map((client) => [client.id, {
    id: client.id, name: client.name, openProjects: 0, openTasks: 0, priorityTasks: 0, pendingRecommendations: 0, pendingActions: 0, score: 0,
  }]));
  for (const project of input.projects) { const row = rows.get(project.client_id); if (row && project.status !== "Terminé") row.openProjects++; }
  for (const task of input.tasks) {
    const row = rows.get(task.client_id);
    if (!row || !isOpenTask(task)) continue;
    row.openTasks++;
    if (task.priority === "Haute") row.priorityTasks++;
  }
  for (const item of input.recommendations) { const row = rows.get(item.client_id); if (row && item.status === "pending") row.pendingRecommendations++; }
  for (const item of input.actions) { const row = rows.get(item.client_id); if (row && item.status === "pending_approval" && item.requires_approval) row.pendingActions++; }
  for (const row of rows.values()) {
    row.score = row.pendingActions * 3 + row.pendingRecommendations * 2 + row.priorityTasks * 2 + row.openTasks + row.openProjects;
  }
  return [...rows.values()]
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "fr"))
    .slice(0, limit);
}

/** Résumé lisible d’un client : « 2 projets actifs · 3 tâches · 1 recommandation ». */
export function describeClientWatch(row: ClientWatch) {
  const parts: string[] = [];
  const add = (count: number, singular: string, plural: string) => { if (count) parts.push(`${count} ${count > 1 ? plural : singular}`); };
  add(row.openProjects, "projet actif", "projets actifs");
  add(row.openTasks, "tâche", "tâches");
  add(row.pendingRecommendations, "recommandation", "recommandations");
  add(row.pendingActions, "action à valider", "actions à valider");
  return parts.join(" · ") || "Rien en attente";
}
