"use client";

import { useActionState } from "react";
import { createProjectAction } from "@/app/(cockpit)/projects/new/actions";
import { updateProjectAction } from "@/app/(cockpit)/projects/[id]/actions";
import type { Client } from "@/lib/clients/types";
import { priorities, projectStatuses, projectTypes } from "@/lib/projects/validation";
import type { ProjectField, ProjectFormState, ProjectRecord } from "@/lib/projects/types";

export function ProjectForm({ clients, project }: { clients: Client[]; project?: ProjectRecord }) {
  const selectedAction = project ? updateProjectAction : createProjectAction;
  const [state, action, pending] = useActionState<ProjectFormState, FormData>(selectedAction, {});
  const inputClass = "mt-2 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm disabled:opacity-60";
  const error = (field: ProjectField) => state.errors?.[field] && <p id={`${field}-error`} className="mt-2 text-xs text-amber-300">{state.errors[field]}</p>;

  return (
    <form action={action} className="space-y-6">
      {project && <input type="hidden" name="id" value={project.id} />}
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="client_id" className="text-sm font-medium">Client *</label>
          <select id="client_id" name="client_id" required defaultValue={state.values?.client_id ?? project?.client_id ?? ""} disabled={pending} aria-invalid={Boolean(state.errors?.client_id)} aria-describedby={state.errors?.client_id ? "client_id-error" : undefined} className={inputClass}>
            <option value="" disabled>Sélectionner un client</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
          {error("client_id")}
        </div>
        <div>
          <label htmlFor="name" className="text-sm font-medium">Nom du projet *</label>
          <input id="name" name="name" required maxLength={200} defaultValue={state.values?.name ?? project?.name} disabled={pending} aria-invalid={Boolean(state.errors?.name)} aria-describedby={state.errors?.name ? "name-error" : undefined} className={inputClass} />
          {error("name")}
        </div>
        <div>
          <label htmlFor="type" className="text-sm font-medium">Type</label>
          <select id="type" name="type" defaultValue={state.values?.type ?? project?.type ?? ""} disabled={pending} aria-invalid={Boolean(state.errors?.type)} aria-describedby={state.errors?.type ? "type-error" : undefined} className={inputClass}>
            <option value="">Non défini</option>
            {projectTypes.map((type) => <option key={type}>{type}</option>)}
          </select>
          {error("type")}
        </div>
        <div>
          <label htmlFor="status" className="text-sm font-medium">Statut *</label>
          <select id="status" name="status" required defaultValue={state.values?.status ?? project?.status ?? "À démarrer"} disabled={pending} aria-invalid={Boolean(state.errors?.status)} aria-describedby={state.errors?.status ? "status-error" : undefined} className={inputClass}>
            {projectStatuses.map((status) => <option key={status}>{status}</option>)}
          </select>
          {error("status")}
        </div>
        <div>
          <label htmlFor="priority" className="text-sm font-medium">Priorité *</label>
          <select id="priority" name="priority" required defaultValue={state.values?.priority ?? project?.priority ?? "Moyenne"} disabled={pending} aria-invalid={Boolean(state.errors?.priority)} aria-describedby={state.errors?.priority ? "priority-error" : undefined} className={inputClass}>
            {priorities.map((priority) => <option key={priority}>{priority}</option>)}
          </select>
          {error("priority")}
        </div>
        <div>
          <label htmlFor="due_date" className="text-sm font-medium">Échéance</label>
          <input id="due_date" name="due_date" type="date" defaultValue={state.values?.due_date ?? project?.due_date ?? ""} disabled={pending} aria-invalid={Boolean(state.errors?.due_date)} aria-describedby={state.errors?.due_date ? "due_date-error" : undefined} className={inputClass} />
          {error("due_date")}
        </div>
        <div>
          <label htmlFor="progress" className="text-sm font-medium">Progression (%) *</label>
          <input id="progress" name="progress" type="number" min={0} max={100} step={1} required defaultValue={state.values?.progress ?? String(project?.progress ?? 0)} disabled={pending} aria-invalid={Boolean(state.errors?.progress)} aria-describedby={state.errors?.progress ? "progress-error" : undefined} className={inputClass} />
          {error("progress")}
        </div>
        <div>
          <label htmlFor="responsible" className="text-sm font-medium">Responsable</label>
          <input id="responsible" name="responsible" maxLength={200} defaultValue={state.values?.responsible ?? project?.responsible ?? ""} disabled={pending} aria-invalid={Boolean(state.errors?.responsible)} aria-describedby={state.errors?.responsible ? "responsible-error" : undefined} className={inputClass} />
          {error("responsible")}
        </div>
      </div>
      {state.message && <p role="alert" className="text-sm text-amber-300">{state.message}</p>}
      <button type="submit" disabled={pending || clients.length === 0} className="rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-background disabled:cursor-wait disabled:opacity-60">{pending ? "Enregistrement…" : project ? "Enregistrer les modifications" : "Créer le projet"}</button>
    </form>
  );
}