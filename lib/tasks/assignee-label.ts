import type { AgentRow } from "@/lib/supabase/database.types";

export function getTaskAssigneeLabel(assigneeType: string, assigneeId: string | null, agents: readonly Pick<AgentRow, "id" | "name">[]) {
  if (assigneeType === "admin") return "Adrien";
  if (assigneeType === "none") return "Non assignée";
  return agents.find((agent) => agent.id === assigneeId)?.name ?? "Agent introuvable";
}