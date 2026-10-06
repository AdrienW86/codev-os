import { requireAdmin } from "@/lib/require-admin";
import type { Metadata } from "next";
import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icon";
import { Badge, PageHeading, Panel } from "@/components/ui/primitives";
import { listClients } from "@/lib/clients/data";
import { listProjects } from "@/lib/projects/data";
import { listTasks } from "@/lib/tasks/data";
import { listAgents } from "@/lib/agents/data";
import { listRecommendations } from "@/lib/recommendations/data";
import { listActions } from "@/lib/actions/data";
import { listAgentRuns } from "@/lib/agent-runs/data";
import { formatDate } from "@/lib/format-date";
import { summarizeDashboard } from "@/lib/dashboard/summary";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  await requireAdmin();
  const [clients, projects, tasks, agents, recommendations, actions, runs] = await Promise.all([
    listClients(), listProjects(), listTasks(), listAgents(), listRecommendations(), listActions(), listAgentRuns({ limit: 5 }),
  ]);
  const summary = summarizeDashboard({ clients, projects, tasks, agents, recommendations, actions });
  const priorityTasks = summary.priorityTasks.slice(0, 5);
  const metrics: { label: string; value: number; caption: string; icon: IconName; href: string }[] = [
    { label: "Clients", value: summary.clients, icon: "clients", href: "/clients", caption: "Enregistrés" },
    { label: "Projets ouverts", value: summary.openProjects, icon: "projects", href: "/projects", caption: "Non terminés" },
    { label: "Tâches ouvertes", value: summary.openTasks, icon: "tasks", href: "/tasks", caption: "À suivre" },
    { label: "Agents actifs", value: summary.activeAgents, icon: "agents", href: "/agents", caption: "Activés et actifs" },
    { label: "Recommandations", value: summary.pendingRecommendations, icon: "recommendations", href: "/recommendations?status=pending", caption: "En attente" },
    { label: "Approbations", value: summary.pendingActions, icon: "tasks", href: "/actions?status=pending_approval", caption: "À valider" },
  ];

  return (
    <>
      <PageHeading
        eyebrow="Vue d’ensemble"
        title="Votre cockpit, en un regard."
        description="Données en direct des domaines connectés. Les runs affichés ici sont internes et déterministes."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map((metric) => (
          <Link key={metric.label} href={metric.href} className="group rounded-xl border border-border bg-surface p-5 transition-colors hover:border-accent/40">
            <div className="flex items-center justify-between gap-3 text-sm text-muted">
              <span>{metric.label}</span><Icon name={metric.icon} className="shrink-0 text-accent" />
            </div>
            <p className="mt-6 text-4xl font-semibold tracking-tight">{metric.value.toString().padStart(2, "0")}</p>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-muted">{metric.caption}</span>
              <Icon name="arrow" className="text-muted transition-colors group-hover:text-accent" />
            </div>
          </Link>
        ))}
      </div>

      <section className="mt-8" aria-labelledby="to-process">
        <h2 id="to-process" className="mb-4 text-lg font-semibold">À traiter</h2>
        <div className="grid items-start gap-5 xl:grid-cols-3">
          <Panel className="p-5"><h3 className="font-semibold">Tâches prioritaires</h3>{priorityTasks.length ? <ul className="mt-4 space-y-3">{priorityTasks.map((task) => <li key={task.id} className="border-t border-border pt-3"><Link href={`/tasks/${task.id}/edit`} className="text-sm font-medium hover:text-accent hover:underline">{task.title}</Link><p className="mt-1 text-xs text-muted">{task.client?.name ?? "Client indisponible"} · {task.status}</p></li>)}</ul> : <p className="mt-3 text-sm text-muted">Aucune tâche prioritaire ouverte.</p>}</Panel>
          <Panel className="p-5"><h3 className="font-semibold">Recommandations en attente</h3>{summary.pendingRecommendations ? <ul className="mt-4 space-y-3">{recommendations.filter((item) => item.status === "pending").slice(0, 5).map((item) => <li key={item.id} className="border-t border-border pt-3"><Link href={`/recommendations/${item.id}`} className="text-sm font-medium hover:text-accent hover:underline">{item.title}</Link><p className="mt-1 text-xs text-muted">{item.client?.name ?? "Client indisponible"}</p></li>)}</ul> : <p className="mt-3 text-sm text-muted">Aucune recommandation à traiter.</p>}</Panel>
          <Panel className="p-5"><h3 className="font-semibold">Actions à approuver</h3>{summary.pendingActions ? <ul className="mt-4 space-y-3">{actions.filter((item) => item.status === "pending_approval" && item.requires_approval).slice(0, 5).map((item) => <li key={item.id} className="border-t border-border pt-3"><p className="text-sm font-medium">{item.action_type}</p><p className="mt-1 text-xs text-muted">{item.client?.name ?? "Client indisponible"}</p></li>)}</ul> : <p className="mt-3 text-sm text-muted">Aucune approbation en attente.</p>}<Link href="/actions" className="mt-4 inline-block text-xs text-accent hover:underline">Ouvrir le centre d’actions</Link></Panel>
        </div>
      </section>

      <Panel className="mt-8 p-5"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Derniers runs internes</h2><Badge>{runs.length}</Badge></div>{runs.length ? <ul className="mt-4 divide-y divide-border">{runs.map((run) => <li key={run.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="text-sm font-medium">{run.agent?.name ?? "Agent indisponible"} · {run.client?.name ?? "Sans client"}</p><p className="mt-1 text-xs text-muted">{run.summary ?? "Run en cours"}</p></div><div className="flex items-center gap-3"><Badge>{run.status}</Badge><time className="text-xs text-muted" dateTime={run.started_at}>{formatDate(run.started_at)}</time></div></li>)}</ul> : <p className="mt-3 text-sm text-muted">Aucun run interne enregistré.</p>}</Panel>
    </>
  );
}
