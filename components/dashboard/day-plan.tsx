import Link from "next/link";
import { Panel } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format-date";
import type { TaskRecord } from "@/lib/tasks/types";

function TaskList({ title, tasks, empty, tone = "neutral" }: { title: string; tasks: TaskRecord[]; empty: string; tone?: "neutral" | "amber" }) {
  return (
    <div className="min-w-0">
      <h3 className={`flex items-center justify-between text-xs font-medium tracking-[0.14em] uppercase ${tone === "amber" ? "text-amber-300" : "text-muted"}`}>
        <span>{title}</span><span aria-hidden="true">{tasks.length}</span>
      </h3>
      {tasks.length ? (
        <ul className="mt-3 space-y-2">
          {tasks.slice(0, 5).map((task) => (
            <li key={task.id}>
              <Link href={`/tasks/${task.id}/edit`} className="block rounded-lg border border-border px-3 py-2.5 transition-colors hover:border-accent/40">
                <span className="block truncate text-sm">{task.title}</span>
                <span className="mt-0.5 block truncate text-xs text-muted">
                  {task.client?.name ?? "Client"} · <time dateTime={task.due_date ?? undefined}>{formatDate(task.due_date)}</time>{task.priority === "Haute" && " · prioritaire"}
                </span>
              </Link>
            </li>
          ))}
          {tasks.length > 5 && <li className="px-1 text-xs text-muted">+ {tasks.length - 5} autres</li>}
        </ul>
      ) : <p className="mt-3 text-sm text-muted">{empty}</p>}
    </div>
  );
}

export function DayPlan({ overdue, today, week }: { overdue: TaskRecord[]; today: TaskRecord[]; week: TaskRecord[] }) {
  const nothing = !overdue.length && !today.length && !week.length;
  return (
    <Panel className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Aujourd’hui / cette semaine</h2>
        <Link href="/agenda" className="text-sm text-accent hover:underline">Ouvrir l’agenda</Link>
      </div>
      {nothing ? (
        <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">Aucune échéance dans les 7 prochains jours. Ajoutez une date à vos tâches pour les voir ici.</p>
      ) : (
        <div className={`mt-5 grid gap-5 ${overdue.length ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
          {overdue.length > 0 && <TaskList title="En retard" tasks={overdue} empty="" tone="amber" />}
          <TaskList title="Aujourd’hui" tasks={today} empty="Rien de prévu aujourd’hui." />
          <TaskList title="Cette semaine" tasks={week} empty="Rien de prévu cette semaine." />
        </div>
      )}
    </Panel>
  );
}
