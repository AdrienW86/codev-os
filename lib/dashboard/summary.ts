import type { AgentRow, InternalActionRow, ProjectRow, RecommendationRow, TaskRow } from "@/lib/supabase/database.types";

export function summarizeDashboard(input: {
  clients: readonly unknown[];
  projects: readonly Pick<ProjectRow, "status">[];
  tasks: readonly (Pick<TaskRow, "id" | "title" | "status" | "priority"> & { client?: { name: string } | null })[];
  agents: readonly Pick<AgentRow, "status" | "enabled">[];
  recommendations: readonly Pick<RecommendationRow, "status">[];
  actions: readonly Pick<InternalActionRow, "status" | "requires_approval">[];
}) {
  return {
    clients: input.clients.length,
    openProjects: input.projects.filter((project) => project.status !== "Terminé").length,
    openTasks: input.tasks.filter((task) => task.status !== "Terminé").length,
    activeAgents: input.agents.filter((agent) => agent.status === "Actif" && agent.enabled).length,
    pendingRecommendations: input.recommendations.filter((recommendation) => recommendation.status === "pending").length,
    pendingActions: input.actions.filter((action) => action.status === "pending_approval" && action.requires_approval).length,
    priorityTasks: input.tasks.filter((task) => task.status !== "Terminé" && task.priority === "Haute"),
  };
}