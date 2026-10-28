import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { auditedMutation, plainColumns } from "@/lib/core/audited-mutation";
import type { CreateTaskResult, TaskRecord } from "./types";
import { validateTaskForm } from "./validation";
import {readAllRows} from '@/lib/supabase/pagination';

const taskColumns = "id,client_id,project_id,completed_at,title,status,priority,due_date,assignee_type,assignee_id,created_at,updated_at,client:clients(name),project:projects!tasks_project_id_fkey(name)";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function storageFailure(operation: "list" | "detail" | "create" | "update" | "delete"): never {
  console.error(`[tasks] Échec du stockage (${operation}).`);
  throw new Error("Le stockage tâches est indisponible. Réessayez plus tard.");
}

export async function listTasks(): Promise<TaskRecord[]> {
  await requireAdmin();
  try {
    const db=getSupabaseServerClient();
    return await readAllRows<TaskRecord>(()=>db.from("tasks").select(taskColumns).order("due_date", { ascending: true }).order("created_at", { ascending: false }).order("id"));
  } catch { storageFailure("list"); }
}

export async function listTasksByClient(clientId: string): Promise<TaskRecord[]> {
  await requireAdmin();
  if(!uuid.test(clientId))return [];
  try {
    const db=getSupabaseServerClient();
    return await readAllRows<TaskRecord>(()=>db.from("tasks").select(taskColumns).eq("client_id", clientId).order("due_date", { ascending: true }).order("created_at", { ascending: false }).order("id"));
  } catch { storageFailure("list"); }
}

export async function listTasksByProject(projectId: string): Promise<TaskRecord[]> {
  await requireAdmin();
  if(!uuid.test(projectId))return [];
  try {
    const db=getSupabaseServerClient();
    return await readAllRows<TaskRecord>(()=>db.from("tasks").select(taskColumns).eq("project_id", projectId).order("due_date", { ascending: true }).order("created_at", { ascending: false }).order("id"));
  } catch { storageFailure("list"); }
}

export async function createTask(formData: FormData): Promise<CreateTaskResult> {
  const { userId } = await requireAdmin();
  const validation = validateTaskForm(formData);
  if (!validation.ok) return { ok: false, state: validation.state };

  try {
    const supabase = getSupabaseServerClient();
    const { data: client, error: clientError } = await supabase.from("clients").select("id").eq("id", validation.data.client_id).maybeSingle();
    if (clientError) throw new Error();
    if (!client) return { ok: false, state: { errors: { client_id: "Ce client n’existe pas." }, values: validation.values } };

    if (validation.data.project_id) {
      const { data: project, error: projectError } = await supabase.from("projects").select("id").eq("id", validation.data.project_id).eq("client_id", validation.data.client_id).maybeSingle();
      if (projectError) throw new Error();
      if (!project) return { ok: false, state: { errors: { project_id: "Ce projet n’appartient pas au client sélectionné." }, values: validation.values } };
    }

    // Création et journal dans la même transaction (audit P1-03).
    const data = await auditedMutation<{ id: string }>({ table: "tasks", operation: "insert", values: validation.data, columns: ["id"], auditColumns: plainColumns(taskColumns),
      audit: { action: "task.created", resource_type: "task", actor_type: "admin", actor_id: userId } });
    if (!data) throw new Error();
    return { ok: true, id: data.id };
  } catch { storageFailure("create"); }
}

async function clientExists(clientId: string) {
  const { data, error } = await getSupabaseServerClient().from("clients").select("id").eq("id", clientId).maybeSingle();
  if (error) throw new Error();
  return Boolean(data);
}

async function projectBelongsToClient(projectId: string, clientId: string) {
  const { data, error } = await getSupabaseServerClient().from("projects").select("id").eq("id", projectId).eq("client_id", clientId).maybeSingle();
  if (error) throw new Error();
  return Boolean(data);
}

export async function getTaskById(id: string): Promise<TaskRecord | null> {
  await requireAdmin();
  if (!uuid.test(id)) return null;
  try {
    const { data, error } = await getSupabaseServerClient().from("tasks").select(taskColumns).eq("id", id).maybeSingle();
    if (error) throw new Error();
    return data;
  } catch { storageFailure("detail"); }
}

export async function updateTask(formData: FormData): Promise<CreateTaskResult> {
  const { userId } = await requireAdmin();
  const validation = validateTaskForm(formData, true);
  if (!validation.ok) return { ok: false, state: validation.state };
  const id = validation.values.id;
  if (!id || !uuid.test(id)) return { ok: false, state: { errors: { id: "Tâche indisponible." } } };

  try {
    if (!await clientExists(validation.data.client_id)) return { ok: false, state: { errors: { client_id: "Ce client n’existe pas." }, values: validation.values } };
    if (validation.data.project_id && !await projectBelongsToClient(validation.data.project_id, validation.data.client_id)) {
      return { ok: false, state: { errors: { project_id: "Ce projet n’appartient pas au client sélectionné." }, values: validation.values } };
    }
    if (validation.data.assignee_type === "agent") {
      const assigneeId = validation.data.assignee_id;
      if (!assigneeId) return { ok: false, state: { errors: { assignee_id: "L’agent associé est indisponible." }, values: validation.values } };
      const { data: agent, error: agentError } = await getSupabaseServerClient().from("agents").select("id").eq("id", assigneeId).maybeSingle();
      if (agentError) throw new Error();
      if (!agent) return { ok: false, state: { errors: { assignee_id: "L’agent associé est indisponible." }, values: validation.values } };
    }

    const after = await auditedMutation({ table: "tasks", operation: "update", id, values: validation.data, columns: ["id"], auditColumns: plainColumns(taskColumns),
      audit: { action: "task.updated", resource_type: "task", resource_id: id, actor_type: "admin", actor_id: userId } });
    if (!after) return { ok: false, state: { errors: { id: "Tâche indisponible." }, values: validation.values } };
    return { ok: true, id };
  } catch {
    console.error("[tasks] Échec du stockage (update).");
    return { ok: false, state: { message: "Impossible de confirmer la modification. Actualisez la liste avant de réessayer." } };
  }
}

export async function deleteTask(id: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const { userId } = await requireAdmin();
  if (!uuid.test(id)) return { ok: false, message: "Impossible de supprimer cette tâche. Actualisez la liste et réessayez." };
  try {
    const deleted = await auditedMutation({ table: "tasks", operation: "delete", id, columns: ["id"], auditColumns: plainColumns(taskColumns),
      audit: { action: "task.deleted", resource_type: "task", resource_id: id, actor_type: "admin", actor_id: userId } });
    if (!deleted) return { ok: false, message: "Impossible de supprimer cette tâche. Actualisez la liste et réessayez." };
    return { ok: true };
  } catch {
    console.error("[tasks] Échec du stockage (delete).");
    return { ok: false, message: "Impossible de confirmer la suppression. Rechargez la liste avant de réessayer." };
  }
}
