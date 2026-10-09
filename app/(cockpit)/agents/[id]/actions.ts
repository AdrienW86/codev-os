"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/require-admin";
import { deleteAgent, updateAgent } from "@/lib/agents/data";
import type { AgentFormState } from "@/lib/agents/types";
import { createInternalTestRun } from "@/lib/agent-runs/data";
import type { AgentTestRunState } from "@/lib/agents/types";

export async function updateAgentAction(_previousState: AgentFormState, formData: FormData): Promise<AgentFormState> {
  await requireAdmin();
  const result = await updateAgent(formData);
  if (!result.ok) return result.state;
  revalidatePath("/agents");
  revalidatePath(`/agents/${result.id}`);
  revalidatePath("/clients", "layout");
  revalidatePath("/tasks");
  redirect(`/agents/${result.id}?updated=1`);
}

export async function deleteAgentAction(_previousState: AgentFormState, formData: FormData): Promise<AgentFormState> {
  await requireAdmin();
  const result = await deleteAgent(formData);
  if (!result.ok) return result.state;
  revalidatePath("/agents", "layout");
  revalidatePath("/clients", "layout");
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  revalidatePath("/recommendations", "layout");
  redirect("/agents");
}

export async function createAgentTestRunAction(_previousState: AgentTestRunState, formData: FormData): Promise<AgentTestRunState> {
  await requireAdmin();
  const agentEntries = formData.getAll("agent_id");
  const clientEntries = formData.getAll("client_id");
  const agentId = agentEntries.length === 1 && typeof agentEntries[0] === "string" ? agentEntries[0] : "";
  const clientId = clientEntries.length === 1 && typeof clientEntries[0] === "string" ? clientEntries[0] : "";
  if (!agentId || !clientId) return { message: "Impossible de créer le run de test. Vérifiez l’assignation." };
  const result = await createInternalTestRun(agentId, clientId);
  if (!result.ok) return { message: result.message };
  revalidatePath(`/agents/${agentId}`);
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/recommendations");
  revalidatePath(`/recommendations/${result.recommendationId}`);
  revalidatePath("/dashboard");
  return { message: "Run de test interne terminé ; une recommandation déterministe a été créée.", recommendationId: result.recommendationId };
}
