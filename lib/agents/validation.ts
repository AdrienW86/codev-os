import type { AgentInsert } from "@/lib/supabase/database.types";
import type { AgentField, AgentFormState } from "./types";

export const agentStatuses = ["Actif", "En pause"] as const;

const formFields: (AgentField | "id")[] = ["id", "name", "description", "status", "enabled", "instructions", "model", "schedule", "autonomy_level", "max_monthly_budget_eur", "agent_scope"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readFields(formData: FormData) {
  const values: Partial<Record<AgentField | "id", string>> = {};
  const errors: Partial<Record<AgentField | "id", string>> = {};
  for (const field of formFields) {
    const entries = formData.getAll(field);
    if (field === "enabled" && entries.length === 0) {
      values.enabled = "false";
      continue;
    }
    if (entries.length > 1 || entries.some((entry) => typeof entry !== "string")) {
      errors[field] = "Valeur invalide.";
      continue;
    }
    values[field] = typeof entries[0] === "string" ? entries[0].trim() : "";
  }
  return { values, errors };
}

export function validateAgentForm(formData: FormData, updating = false):
  | { ok: true; data: AgentInsert; id: string | null; values: Partial<Record<AgentField | "id", string>> }
  | { ok: false; state: AgentFormState } {
  const { values, errors } = readFields(formData);
  const id = values.id ?? "";
  const name = values.name ?? "";
  const description = values.description ?? "";
  const status = values.status ?? "";
  const enabled = values.enabled ?? "";
  const instructions = values.instructions ?? "";
  const model = values.model ?? "";
  const schedule = values.schedule ?? "";
  const autonomy = values.autonomy_level ?? "";
  const budget = values.max_monthly_budget_eur ?? "";
  const scope = values.agent_scope;
  if (scope && scope!=="client" && scope!=="project") errors.agent_scope="Sélectionnez une portée valide.";
  if (updating && scope) errors.agent_scope="Modifiez la portée dans le réglage dédié et audité.";

  if (updating && !uuid.test(id)) errors.id = "Agent indisponible.";
  if (!name) errors.name = "Le nom est obligatoire.";
  else if (name.length > 120 || name.includes("\0")) errors.name = "Maximum 120 caractères.";
  if (!agentStatuses.includes(status as (typeof agentStatuses)[number])) errors.status = "Sélectionnez un statut valide.";
  if (enabled !== "true" && enabled !== "false") errors.enabled = "Sélectionnez un état valide.";
  if (!instructions) errors.instructions = "Les instructions sont obligatoires.";
  else if (instructions.length > 10000 || instructions.includes("\0")) errors.instructions = "Maximum 10 000 caractères.";
  if (description.length > 2000 || description.includes("\0")) errors.description = "Maximum 2 000 caractères.";
  if (model.length > 120 || model.includes("\0")) errors.model = "Maximum 120 caractères.";
  if (schedule.length > 200 || schedule.includes("\0")) errors.schedule = "Maximum 200 caractères.";
  if (!/^[0-3]$/.test(autonomy)) errors.autonomy_level = "Le niveau doit être un entier entre 0 et 3.";
  if (budget && (!/^(?:\d+)(?:\.\d{1,2})?$/.test(budget) || !Number.isFinite(Number(budget)) || Number(budget) < 0 || Number(budget) > 1000000)) {
    errors.max_monthly_budget_eur = "Renseignez un budget positif valide (1 000 000 € maximum).";
  }

  if (Object.keys(errors).length) return { ok: false, state: { errors, values } };
  return {
    ok: true,
    id: updating ? id : null,
    values,
    data: {
      ...(!updating ? { agent_scope: (scope || "client") as "client" | "project", scope_review_required: !scope } : {}),
      name,
      description: description || null,
      status,
      enabled: enabled === "true",
      instructions,
      model: model || null,
      schedule: schedule || null,
      autonomy_level: Number(autonomy),
      max_monthly_budget_eur: budget ? Number(budget) : null,
    },
  };
}

export function isAgentUuid(value: string) {
  return uuid.test(value);
}

export function validateAssignmentIds(agentId: string, clientId: string) {
  return isAgentUuid(agentId) && isAgentUuid(clientId);
}
