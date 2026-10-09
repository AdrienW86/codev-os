import type { ProjectInsert } from "@/lib/supabase/database.types";
import type { ProjectField, ProjectFormState } from "./types";

export const projectTypes = ["Site web", "SEO", "Google Ads", "Local Services", "Réseaux sociaux", "Google Business Profile", "Automatisation", "Maintenance", "Refonte", "Campagne locale", "Autre"] as const;
export const projectStatuses = ["À démarrer", "En cours", "En attente client", "À valider", "Terminé"] as const;
export const priorities = ["Haute", "Moyenne", "Basse"] as const;

const fieldNames: ProjectField[] = ["client_id", "name", "type", "status", "priority", "due_date", "progress", "responsible"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readFields(formData: FormData) {
  const values: Partial<Record<ProjectField, string>> = {};
  const errors: Partial<Record<ProjectField, string>> = {};
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

export function validateProjectForm(formData: FormData):
  | { ok: true; data: ProjectInsert; values: Partial<Record<ProjectField, string>> }
  | { ok: false; state: ProjectFormState } {
  const { values, errors } = readFields(formData);
  const clientId = values.client_id ?? "";
  const name = values.name ?? "";
  const type = values.type ?? "";
  const status = values.status ?? "";
  const priority = values.priority ?? "";
  const dueDate = values.due_date ?? "";
  const progressValue = values.progress ?? "";
  const responsible = values.responsible ?? "";

  if (!uuid.test(clientId)) errors.client_id = "Sélectionnez un client valide.";
  if (!name) errors.name = "Le nom est obligatoire.";
  else if (name.length > 200 || name.includes("\0")) errors.name = "Nom invalide (200 caractères maximum).";
  if (type && !projectTypes.includes(type as (typeof projectTypes)[number])) errors.type = "Sélectionnez un type valide.";
  if (!projectStatuses.includes(status as (typeof projectStatuses)[number])) errors.status = "Sélectionnez un statut valide.";
  if (!priorities.includes(priority as (typeof priorities)[number])) errors.priority = "Sélectionnez une priorité valide.";
  if (dueDate && !isDate(dueDate)) errors.due_date = "Renseignez une date valide.";
  if (!/^(0|[1-9]\d*)$/.test(progressValue) || Number(progressValue) > 100) errors.progress = "La progression doit être un entier entre 0 et 100.";
  if (responsible.length > 200 || responsible.includes("\0")) errors.responsible = "Maximum 200 caractères.";

  if (Object.keys(errors).length) return { ok: false, state: { errors, values } };
  return {
    ok: true,
    values,
    data: {
      client_id: clientId,
      name,
      type: type || null,
      status,
      priority,
      due_date: dueDate || null,
      progress: Number(progressValue),
      responsible: responsible || null,
    },
  };
}
