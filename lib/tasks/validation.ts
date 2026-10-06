import type { TaskInsert } from "@/lib/supabase/database.types";
import type { TaskField, TaskFormState } from "./types";

export const taskStatuses = ["À faire", "En cours", "En attente", "Terminé"] as const;
export const taskPriorities = ["Haute", "Moyenne", "Basse"] as const;
export const assigneeTypes = ["admin", "none"] as const;

const fieldNames: TaskField[] = ["id", "assignee_id", "client_id", "project_id", "title", "status", "priority", "due_date", "assignee_type"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readFields(formData: FormData) {
  const values: Partial<Record<TaskField, string>> = {};
  const errors: Partial<Record<TaskField, string>> = {};
  for (const field of fieldNames) {
    const entries = formData.getAll(field);
    if (entries.length > 1 || entries.some((entry) => typeof entry !== "string")) {
      errors[field] = "Valeur invalide.";
      continue;
    }
    values[field] = typeof entries[0] === "string" ? entries[0].trim() : "";
  }
  return { values, errors };
}

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateTaskForm(formData: FormData, updating = false):
  | { ok: true; data: TaskInsert; values: Partial<Record<TaskField, string>> }
  | { ok: false; state: TaskFormState } {
  const { values, errors } = readFields(formData);
  const id = values.id ?? "";
  const assigneeId = values.assignee_id ?? "";
  const clientId = values.client_id ?? "";
  const projectId = values.project_id ?? "";
  const title = values.title ?? "";
  const status = values.status ?? "";
  const priority = values.priority ?? "";
  const dueDate = values.due_date ?? "";
  const assigneeType = values.assignee_type ?? "";

  if (updating && !uuid.test(id)) errors.id = "Tâche indisponible.";
  if (!uuid.test(clientId)) errors.client_id = "Sélectionnez un client valide.";
  if (projectId && !uuid.test(projectId)) errors.project_id = "Sélectionnez un projet valide.";
  if (!title) errors.title = "Le titre est obligatoire.";
  else if (title.length > 300 || title.includes("\0")) errors.title = "Titre invalide (300 caractères maximum).";
  if (!taskStatuses.includes(status as (typeof taskStatuses)[number])) errors.status = "Sélectionnez un statut valide.";
  if (!taskPriorities.includes(priority as (typeof taskPriorities)[number])) errors.priority = "Sélectionnez une priorité valide.";
  if (dueDate && !isDate(dueDate)) errors.due_date = "Renseignez une date valide.";
  const allowedAssigneeTypes: readonly string[] = updating ? [...assigneeTypes, "agent"] : assigneeTypes;
  if (!allowedAssigneeTypes.includes(assigneeType)) errors.assignee_type = "Sélectionnez une assignation valide.";
  if (assigneeType === "agent" && (!updating || !uuid.test(assigneeId))) errors.assignee_id = "L’agent associé est invalide.";

  if (Object.keys(errors).length) return { ok: false, state: { errors, values } };
  return {
    ok: true,
    values,
    data: {
      client_id: clientId,
      project_id: projectId || null,
      title,
      status,
      priority,
      due_date: dueDate || null,
      assignee_type: assigneeType as "admin" | "agent" | "none",
      assignee_id: assigneeType === "agent" ? assigneeId : null,
    },
  };
}