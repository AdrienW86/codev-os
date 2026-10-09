import { requireAdmin } from "@/lib/require-admin";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading } from "@/components/ui/primitives";
import { TaskCard } from "@/components/work/work-cards";
import { listTasks } from "@/lib/tasks/data";
import { listAgents } from "@/lib/agents/data";

export const metadata: Metadata = { title: "Tâches" };

export default async function TasksPage() {
  await requireAdmin();
  const [tasks, agents] = await Promise.all([listTasks(), listAgents()]);
  return (
    <>
      <PageHeading eyebrow="Organisation" title="Tâches" description="Le travail à suivre pour les projets CODE-V." action={<div className="flex flex-wrap items-center gap-4"><span className="text-xs text-muted">{tasks.length} tâches · {tasks.filter((task) => task.status !== "Terminé").length} ouvertes</span><Link href="/tasks/new" className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-background">+ Nouvelle tâche</Link></div>} />
      <h2 className="sr-only">Toutes les tâches</h2>
      {tasks.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{tasks.map((task) => <TaskCard key={task.id} task={task} agents={agents} />)}</div> : <p className="border-t border-border py-8 text-sm text-muted">Aucune tâche enregistrée. Créez une tâche pour organiser le travail.</p>}
    </>
  );
}
