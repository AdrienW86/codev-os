"use client";

import { useActionState } from "react";
import { createAgentAction } from "@/app/(cockpit)/agents/new/actions";
import { updateAgentAction } from "@/app/(cockpit)/agents/[id]/actions";
import { agentStatuses } from "@/lib/agents/validation";
import type { AgentRecord, AgentField, AgentFormState } from "@/lib/agents/types";

export function AgentForm({ agent }: { agent?: AgentRecord }) {
  const selectedAction = agent ? updateAgentAction : createAgentAction;
  const [state, action, pending] = useActionState<AgentFormState, FormData>(selectedAction, {});
  const inputClass = "mt-2 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm disabled:opacity-60";
  const error = (field: AgentField) => state.errors?.[field] && <p id={`${field}-error`} className="mt-2 text-xs text-amber-300">{state.errors[field]}</p>;

  return (
    <form action={action} className="space-y-6">
      {agent && <input type="hidden" name="id" value={agent.id} />}
      <div className="grid gap-5 sm:grid-cols-2">
        {!agent && <div className="sm:col-span-2"><label htmlFor="agent_scope" className="text-sm font-medium">Portée métier *</label><select id="agent_scope" name="agent_scope" required defaultValue={state.values?.agent_scope ?? ""} disabled={pending} className={inputClass}><option value="" disabled>Choisir la portée</option><option value="client">Client entier / Account Manager</option><option value="project">Projet précis / Agent spécialisé</option></select>{error("agent_scope")}</div>}
        <div>
          <label htmlFor="name" className="text-sm font-medium">Nom *</label>
          <input id="name" name="name" required maxLength={120} defaultValue={state.values?.name ?? agent?.name} disabled={pending} aria-invalid={Boolean(state.errors?.name)} aria-describedby={state.errors?.name ? "name-error" : undefined} className={inputClass} />
          {error("name")}
        </div>
        <div>
          <label htmlFor="status" className="text-sm font-medium">Statut *</label>
          <select id="status" name="status" required defaultValue={state.values?.status ?? agent?.status ?? "Actif"} disabled={pending} aria-invalid={Boolean(state.errors?.status)} aria-describedby={state.errors?.status ? "status-error" : undefined} className={inputClass}>
            {agentStatuses.map((status) => <option key={status}>{status}</option>)}
          </select>
          {error("status")}
        </div>
        <div>
          <label htmlFor="description" className="text-sm font-medium">Description</label>
          <textarea id="description" name="description" rows={3} maxLength={2000} defaultValue={state.values?.description ?? agent?.description ?? ""} disabled={pending} aria-invalid={Boolean(state.errors?.description)} aria-describedby={state.errors?.description ? "description-error" : undefined} className={inputClass} />
          {error("description")}
        </div>
        <div>
          <label htmlFor="instructions" className="text-sm font-medium">Instructions globales *</label>
          <textarea id="instructions" name="instructions" rows={6} required maxLength={10000} defaultValue={state.values?.instructions ?? agent?.instructions ?? ""} disabled={pending} aria-invalid={Boolean(state.errors?.instructions)} aria-describedby={state.errors?.instructions ? "instructions-error" : undefined} className={inputClass} />
          {error("instructions")}
        </div>
        <div>
          <label htmlFor="model" className="text-sm font-medium">Modèle</label>
          <input id="model" name="model" maxLength={120} defaultValue={state.values?.model ?? agent?.model ?? ""} disabled={pending} aria-invalid={Boolean(state.errors?.model)} aria-describedby={state.errors?.model ? "model-error" : undefined} className={inputClass} />
          {error("model")}
        </div>
        <div>
          <label htmlFor="schedule" className="text-sm font-medium">Planning</label>
          <input id="schedule" name="schedule" maxLength={200} defaultValue={state.values?.schedule ?? agent?.schedule ?? ""} disabled={pending} aria-invalid={Boolean(state.errors?.schedule)} aria-describedby={state.errors?.schedule ? "schedule-error" : undefined} className={inputClass} />
          {error("schedule")}
        </div>
        <div>
          <label htmlFor="autonomy_level" className="text-sm font-medium">Niveau d’autonomie *</label>
          <select id="autonomy_level" name="autonomy_level" required defaultValue={state.values?.autonomy_level ?? String(agent?.autonomy_level ?? 0)} disabled={pending} aria-invalid={Boolean(state.errors?.autonomy_level)} aria-describedby={state.errors?.autonomy_level ? "autonomy_level-error" : undefined} className={inputClass}>
            {[0, 1, 2, 3].map((level) => <option key={level} value={level}>{level} / 3</option>)}
          </select>
          {error("autonomy_level")}
        </div>
        <div>
          <label htmlFor="max_monthly_budget_eur" className="text-sm font-medium">Budget mensuel maximum (€)</label>
          <input id="max_monthly_budget_eur" name="max_monthly_budget_eur" type="number" min={0} max={1000000} step="0.01" defaultValue={state.values?.max_monthly_budget_eur ?? agent?.max_monthly_budget_eur ?? ""} disabled={pending} aria-invalid={Boolean(state.errors?.max_monthly_budget_eur)} aria-describedby={state.errors?.max_monthly_budget_eur ? "max_monthly_budget_eur-error" : undefined} className={inputClass} />
          {error("max_monthly_budget_eur")}
        </div>
        <label className="flex items-center gap-3 text-sm font-medium sm:col-span-2">
          <input type="checkbox" name="enabled" value="true" defaultChecked={(state.values?.enabled ?? String(agent?.enabled ?? true)) === "true"} disabled={pending} aria-invalid={Boolean(state.errors?.enabled)} aria-describedby={state.errors?.enabled ? "enabled-error" : undefined} className="h-4 w-4 accent-[var(--color-accent)]" />
          Agent activé
        </label>
        {error("enabled")}
      </div>
      {state.errors?.id && <p role="alert" className="text-sm text-amber-300">{state.errors.id}</p>}
      {state.message && <p role="alert" className="text-sm text-amber-300">{state.message}</p>}
      <button type="submit" disabled={pending} className="rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-background disabled:cursor-wait disabled:opacity-60">{pending ? "Enregistrement…" : agent ? "Enregistrer les modifications" : "Créer l’agent"}</button>
    </form>
  );
}
