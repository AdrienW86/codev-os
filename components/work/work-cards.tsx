import Link from "next/link";
import { Badge, Panel } from "@/components/ui/primitives";
import { ConfirmDeleteForm } from "@/components/ui/confirm-delete-form";
import { deleteProjectAction } from "@/app/(cockpit)/projects/[id]/actions";
import { deleteTaskAction } from "@/app/(cockpit)/tasks/[id]/actions";
import type { ProjectRecord } from "@/lib/projects/types";
import type { TaskRecord } from "@/lib/tasks/types";
import { getTaskAssigneeLabel } from "@/lib/tasks/assignee-label";
import { formatDate } from "@/lib/format-date";

function PriorityBadge({ priority }: { priority: string }) {
  return <Badge tone={priority === "Haute" ? "amber" : "neutral"}>Priorité {priority.toLowerCase()}</Badge>;
}

function ClientLink({ clientId, clientName }: { clientId: string; clientName: string | null }) {
  return <Link href={`/clients/${clientId}`} className="text-xs text-accent hover:underline">{clientName ?? "Client indisponible"}</Link>;
}

export function ProjectCard({ project }: { project: ProjectRecord }) {
  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ClientLink clientId={project.client_id} clientName={project.client?.name ?? null} />
        <Badge tone={project.status === "Terminé" ? "green" : project.status === "En attente client" || project.status === "À valider" ? "amber" : "neutral"}>{project.status}</Badge>
      </div>
      <h3 className="mt-4 text-lg font-semibold"><Link href={`/projects/${project.id}`} className="hover:text-accent hover:underline">{project.name}</Link></h3>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">{project.type ?? "Type non défini"}</span>
        <PriorityBadge priority={project.priority} />
      </div>
      <div className="mt-5">
        <div className="mb-2 flex justify-between text-xs"><span className="text-muted">Progression</span><span>{project.progress} %</span></div>
        <div role="progressbar" aria-label={`Progression de ${project.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={project.progress} className="h-1.5 overflow-hidden rounded-full bg-white/5">
          <div className="h-full rounded-full bg-accent" style={{ width: `${project.progress}%` }} />
        </div>
      </div>
      <dl className="mt-5 space-y-3 border-t border-border pt-4 text-xs">
        <div className="flex justify-between gap-3"><dt className="text-muted">Responsable</dt><dd>{project.responsible ?? "Non défini"}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted">Création</dt><dd><time dateTime={project.created_at}>{formatDate(project.created_at)}</time></dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted">Échéance</dt><dd><time dateTime={project.due_date ?? undefined}>{formatDate(project.due_date)}</time></dd></div>
      </dl>
      <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <Link href={`/projects/${project.id}/edit`} className="rounded-lg border border-border px-4 py-2 text-sm font-medium">Modifier</Link>
        <ConfirmDeleteForm action={deleteProjectAction} fields={{ id: project.id }} confirmationMessage="Supprimer ce projet ? Supabase appliquera les clés étrangères existantes aux tâches liées." />
      </div>
    </Panel>
  );
}

export function TaskCard({ task, agents = [] }: { task: TaskRecord; agents?: Array<{ id: string; name: string }> }) {
  const assignment = getTaskAssigneeLabel(task.assignee_type, task.assignee_id, agents);
  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ClientLink clientId={task.client_id} clientName={task.client?.name ?? null} />
        <Badge tone={task.status === "Terminé" ? "green" : task.status === "En attente" ? "amber" : "neutral"}>{task.status}</Badge>
      </div>
      <h3 className="mt-4 text-base font-semibold">{task.title}</h3>
      <p className="mt-2 text-xs text-muted">Projet : {task.project?.name ?? "Sans projet"}</p>
      <div className="mt-4"><PriorityBadge priority={task.priority} /></div>
      <dl className="mt-5 space-y-3 border-t border-border pt-4 text-xs">
        <div className="flex justify-between gap-3"><dt className="text-muted">Assignation</dt><dd>{assignment}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted">Échéance</dt><dd><time dateTime={task.due_date ?? undefined}>{formatDate(task.due_date)}</time></dd></div>
      </dl>
      <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <Link href={`/tasks/${task.id}/edit`} className="rounded-lg border border-border px-4 py-2 text-sm font-medium">Modifier</Link>
        <ConfirmDeleteForm action={deleteTaskAction} fields={{ id: task.id }} confirmationMessage="Supprimer définitivement cette tâche ?" />
      </div>
    </Panel>
  );
}
