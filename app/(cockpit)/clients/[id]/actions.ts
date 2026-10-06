"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/require-admin";
import { assignAgentToClient, removeAgentFromClient, updateAgentClientAssignment } from "@/lib/agents/data";
import type { AgentAssignmentFormState } from "@/lib/agents/types";
import { deleteClient, updateClientRecord } from "@/lib/clients/data";
import type { ClientFormState } from "@/lib/clients/types";
import type { DeleteFormState } from "@/lib/action-state";
import { createClientService, deleteClientService, updateClientService } from "@/lib/client-services/data";
import type { ClientServiceFormState } from "@/lib/client-services/types";

function singleField(formData: FormData, name: string) {
  const entries = formData.getAll(name);
  return entries.length === 1 && typeof entries[0] === "string" ? entries[0] : null;
}

function revalidateAssignments(clientId: string, agentId: string) {
  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/agents/${agentId}`);
  revalidatePath("/agents");
  revalidatePath("/tasks");
}

export async function assignAgentAction(_previousState: AgentAssignmentFormState, formData: FormData): Promise<AgentAssignmentFormState> {
  await requireAdmin();
  const clientId = singleField(formData, "client_id");
  const agentId = singleField(formData, "agent_id");
  const instructions = singleField(formData, "client_instructions");
  if (!clientId || !agentId || instructions === null || instructions.length > 3000) return { message: "Impossible d’assigner cet agent. Vérifiez les informations et réessayez." };
  const result = await assignAgentToClient(agentId, clientId, instructions);
  if (!result.ok) return { message: result.message };
  revalidateAssignments(clientId, agentId);
  return { message: "Agent assigné au client." };
}

export async function updateAgentClientAssignmentAction(_previousState: AgentAssignmentFormState, formData: FormData): Promise<AgentAssignmentFormState> {
  await requireAdmin();
  const clientId = singleField(formData, "client_id");
  const agentId = singleField(formData, "agent_id");
  const instructions = singleField(formData, "client_instructions");
  const enabledEntries = formData.getAll("enabled");
  if (!clientId || !agentId || instructions === null || instructions.length > 3000 || enabledEntries.length > 1) {
    return { message: "Impossible de mettre à jour cette assignation. Vérifiez les informations et réessayez." };
  }
  const enabledValue = enabledEntries[0];
  const enabled = enabledEntries.length === 0 ? false : enabledValue === "true" ? true : enabledValue === "false" ? false : null;
  if (enabled === null) return { message: "Impossible de mettre à jour cette assignation. Vérifiez les informations et réessayez." };
  const result = await updateAgentClientAssignment(agentId, clientId, enabled, instructions);
  if (!result.ok) return { message: result.message };
  revalidateAssignments(clientId, agentId);
  return { message: "Assignation mise à jour." };
}

export async function removeAgentFromClientAction(_previousState: AgentAssignmentFormState, formData: FormData): Promise<AgentAssignmentFormState> {
  await requireAdmin();
  const clientId = singleField(formData, "client_id");
  const agentId = singleField(formData, "agent_id");
  if (!clientId || !agentId) return { message: "Impossible de retirer cette assignation. Réessayez." };
  const result = await removeAgentFromClient(agentId, clientId);
  if (!result.ok) return { message: result.message };
  revalidateAssignments(clientId, agentId);
  return { message: "Assignation retirée." };
}

export async function updateClientAction(_previousState: ClientFormState, formData: FormData): Promise<ClientFormState> {
  await requireAdmin();
  const result = await updateClientRecord(formData);
  if (!result.ok) return result.state;
  revalidatePath("/clients");
  revalidatePath(`/clients/${result.client.id}`);
  revalidatePath("/projects");
  revalidatePath("/tasks");
  redirect(`/clients/${result.client.id}`);
}

export async function deleteClientAction(_previousState: DeleteFormState, formData: FormData): Promise<DeleteFormState> {
  await requireAdmin();
  const id = singleField(formData, "id");
  if (!id) return { message: "Impossible de supprimer ce client. Actualisez la liste et réessayez." };
  const result = await deleteClient(id);
  if (!result.ok) return { message: result.message };
  revalidatePath("/clients");
  revalidatePath("/projects");
  revalidatePath("/tasks");
  redirect("/clients");
}

export async function createClientServiceAction(_previousState: ClientServiceFormState, formData: FormData): Promise<ClientServiceFormState> {
  await requireAdmin();
  const result = await createClientService(formData);
  if (!result.ok) return result.state;
  revalidatePath(`/clients/${result.service.client_id}`);
  return { message: "Service ajouté." };
}

export async function updateClientServiceAction(_previousState: ClientServiceFormState, formData: FormData): Promise<ClientServiceFormState> {
  await requireAdmin();
  const result = await updateClientService(formData);
  if (!result.ok) return result.state;
  revalidatePath(`/clients/${result.service.client_id}`);
  return { message: "Service mis à jour." };
}

export async function deleteClientServiceAction(_previousState: DeleteFormState, formData: FormData): Promise<DeleteFormState> {
  await requireAdmin();
  const id = singleField(formData, "id");
  const clientId = singleField(formData, "client_id");
  if (!id || !clientId) return { message: "Impossible de retirer ce service. Rechargez la fiche." };
  const result = await deleteClientService(id, clientId);
  if (!result.ok) return { message: result.message };
  revalidatePath(`/clients/${clientId}`);
  return { message: "Service retiré." };
}