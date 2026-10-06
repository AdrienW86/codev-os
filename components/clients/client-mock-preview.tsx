import "server-only";
import { Badge, Panel } from "@/components/ui/primitives";
import { ProjectCard, TaskCard } from "@/components/work/work-cards";
import { demoConnections, connectionNames } from "@/lib/client-demo-data";
import type { AgentRecord } from "@/lib/agents/types";
import type { ProjectRecord } from "@/lib/projects/types";
import type { TaskRecord } from "@/lib/tasks/types";

export function ClientMockPreview({ projects, tasks, agents }: { projects: ProjectRecord[]; tasks: TaskRecord[]; agents: AgentRecord[] }) {
  return (
    <>
      <section className="mt-8 grid gap-8 border-t border-border pt-8" aria-label="Projets et tâches du client">
        <section aria-labelledby="client-projects">
          <h2 id="client-projects" className="mb-4 text-lg font-semibold">Projets <span className="text-sm font-normal text-muted">({projects.length})</span></h2>
          {projects.length ? <div className="grid gap-5 md:grid-cols-2">{projects.map((project) => <ProjectCard key={project.id} project={project} />)}</div> : <p className="text-sm text-muted">Aucun projet pour ce client.</p>}
        </section>
        <section aria-labelledby="client-tasks">
          <h2 id="client-tasks" className="mb-4 text-lg font-semibold">Tâches <span className="text-sm font-normal text-muted">({tasks.length})</span></h2>
          {tasks.length ? <div className="grid gap-5 md:grid-cols-2">{tasks.map((task) => <TaskCard key={task.id} task={task} agents={agents} />)}</div> : <p className="text-sm text-muted">Aucune tâche pour ce client.</p>}
        </section>
      </section>
      <section className="mt-8 border-t border-border pt-8" aria-label="Aperçu de démonstration indépendant">
      <Badge tone="amber">Sections de démonstration</Badge>
      <p className="mt-3 mb-6 text-sm leading-6 text-muted">Les sections ci-dessous illustrent des données fictives indépendantes du client affiché.</p>
      <div className="mt-8">
        <Panel className="p-6">
          <h2 className="font-semibold">Connexions disponibles <span className="text-xs font-normal text-amber-300">· Démo</span></h2>
          <p className="mt-2 text-xs leading-5 text-muted">Statuts d’exemple uniquement. Aucun service n’est réellement connecté.</p>
          <ul className="mt-5 divide-y divide-border">
            {connectionNames.filter((name) => name !== "Google Ads").map((name) => {
              const status = demoConnections[name];
              return <li key={name} className="flex flex-wrap items-center justify-between gap-2 py-3"><span className="text-sm">{name}</span><Badge tone={status === "Connected" ? "green" : status === "Attention" ? "amber" : "neutral"}>{status}</Badge></li>;
            })}
          </ul>
        </Panel>
      </div>

      <Panel className="mt-8 p-6">
        <h2 className="font-semibold">Historique client</h2>
        <p className="mt-3 text-sm leading-6 text-muted">La vue d’historique client n’est pas encore connectée. Les mutations CRUD sont consignées dans les journaux d’audit, sans fil chronologique dédié ici.</p>
      </Panel>

      </section>
    </>
  );
}
