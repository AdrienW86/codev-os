"use client";

import { useActionState } from "react";
import { createTaskAction } from "@/app/(cockpit)/tasks/new/actions";
import { updateTaskAction } from "@/app/(cockpit)/tasks/[id]/actions";
import type { Client } from "@/lib/clients/types";
import type { ProjectRecord } from "@/lib/projects/types";
import { assigneeTypes, taskPriorities, taskStatuses } from "@/lib/tasks/validation";
import type { TaskField, TaskFormState, TaskRecord } from "@/lib/tasks/types";

type TaskProjectOption = Pick<ProjectRecord, "id" | "name" | "client_id" | "client">;

export function TaskForm({ clients, projects, task }: { clients: Client[]; projects: TaskProjectOption[]; task?: TaskRecord }) {
  const selectedAction = task ? updateTaskAction : createTaskAction;
  const [state, action, pending] = useActionState<TaskFormState, FormData>(selectedAction, {});
  const inputClass = "mt-2 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm disabled:opacity-60";
  const error = (field: TaskField) => state.errors?.[field] && <p id={`${field}-error`} className="mt-2 text-xs text-amber-300">{state.errors[field]}</p>;
  const assigneeType = state.values?.assignee_type ?? task?.assignee_type ?? "admin";

  return (
    <form action={action} className="space-y-6">
      {task && <input type="hidden" name="id" value={task.id} />}
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="client_id" className="text-sm font-medium">Client *</label>
          <select id="client_id" name="client_id" required defaultValue={state.values?.client_id ?? task?.client_id ?? ""} disabled={pending} aria-invalid={Boolean(state.errors?.client_id)} aria-describedby={state.errors?.client_id ? "client_id-error" : undefined} className={inputClass}>
            <option value="" disabled>Sélectionner un client</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
          {error("client_id")}
        </div>
        <div>
          <label htmlFor="project_id" className="text-sm font-medium">Projet</label>
          <select id="project_id" name="project_id" defaultValue={state.values?.project_id ?? task?.project_id ?? ""} disabled={pending} aria-invalid={Boolean(state.errors?.project_id)} aria-describedby={state.errors?.project_id ? "project_id-error" : undefined} className={inputClass}>
            <option value="">Aucun projet associé</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {project.client?.name ?? "Client"}</option>)}
          </select>
          {error("project_id")}
        </div>
        <div>
          <label htmlFor="title" className="text-sm font-medium">Titre *</label>
          <input id="title" name="title" required maxLength={300} defaultValue={state.values?.title ?? task?.title} disabled={pending} aria-invalid={Boolean(state.errors?.title)} aria-describedby={state.errors?.title ? "title-error" : undefined} className={inputClass} />
          {error("title")}
        </div>
        <div>
          <label htmlFor="status" className="text-sm font-medium">Statut *</label>
          <select id="status" name="status" required defaultValue={state.values?.status ?? task?.status ?? "À faire"} disabled={pending} aria-invalid={Boolean(state.errors?.status)} aria-describedby={state.errors?.status ? "status-error" : undefined} className={inputClass}>
            {taskStatuses.map((status) => <option key={status}>{status}</option>)}
          </select>
          {error("status")}
        </div>
        <div>
          <label htmlFor="priority" className="text-sm font-medium">Priorité *</label>
          <select id="priority" name="priority" required defaultValue={state.values?.priority ?? task?.priority ?? "Moyenne"} disabled={pending} aria-invalid={Boolean(state.errors?.priority)} aria-describedby={state.errors?.priority ? "priority-error" : undefined} className={inputClass}>
            {taskPriorities.map((priority) => <option key={priority}>{priority}</option>)}
          </select>
          {error("priority")}
        </div>
        <div>
          <label htmlFor="due_date" className="text-sm font-medium">Échéance</label>
          <input id="due_date" name="due_date" type="date" defaultValue={state.values?.due_date ?? task?.due_date ?? ""} disabled={pending} aria-invalid={Boolean(state.errors?.due_date)} aria-describedby={state.errors?.due_date ? "due_date-error" : undefined} className={inputClass} />
          {error("due_date")}
        </div>
        <div>
          <label htmlFor="assignee_type" className="text-sm font-medium">Assignation *</label>
          <select id="assignee_type" name="assignee_type" required defaultValue={assigneeType} disabled={pending} aria-invalid={Boolean(state.errors?.assignee_type)} aria-describedby={state.errors?.assignee_type ? "assignee_type-error" : undefined} className={inputClass}>
            {assigneeTypes.map((type) => <option key={type} value={type}>{type === "admin" ? "Adrien" : "Non assignée"}</option>)}
            {task?.assignee_type === "agent" && <option value="agent">Agent assigné (inchangé)</option>}
          </select>
          {task?.assignee_type === "agent" && task.assignee_id && assigneeType === "agent" && <input type="hidden" name="assignee_id" value={task.assignee_id} />}
          {error("assignee_type")}
        </div>
      </div>
      {state.message && <p role="alert" className="text-sm text-amber-300">{state.message}</p>}
      <button type="submit" disabled={pending || clients.length === 0} className="rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-background disabled:cursor-wait disabled:opacity-60">{pending ? "Enregistrement…" : task ? "Enregistrer les modifications" : "Créer la tâche"}</button>
    </form>
  );
}