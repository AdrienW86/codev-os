import { requireAdmin } from "@/lib/require-admin";
import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { DayPlan } from "@/components/dashboard/day-plan";
import { planTasks, todayInParis } from "@/lib/dashboard/home";
import { listTasks } from "@/lib/tasks/data";
import { getActiveScenario } from "@/lib/simulation/server";
import { SimAgenda } from "@/components/simulation/views/sim-agenda";
import { TrySimulationButton } from "@/components/simulation/simulation-banner";
import { InlineNotice } from "@/components/ui/states";
import { SimulatedFeatureButton } from "@/components/simulation/simulated-feature";

export const metadata: Metadata = { title: "Agenda" };

const dayFormatter = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", timeZone: "UTC" });

/** Lundi → dimanche de la semaine courante. */
function currentWeek(today: string) {
  const date = new Date(`${today}T00:00:00.000Z`);
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setUTCDate(monday.getUTCDate() + index);
    const iso = day.toISOString().slice(0, 10);
    return { iso, label: dayFormatter.format(day), isToday: iso === today };
  });
}

export default async function AgendaPage() {
  await requireAdmin();
  if (await getActiveScenario()) return <SimAgenda />;
  const today = todayInParis();
  const week = currentWeek(today);
  const tasks = await listTasks();
  const plan = planTasks(tasks, today);
  return (
    <>
      <PageHeading
        eyebrow="Planification"
        title="Agenda"
        description="Organisez vos tâches, échéances et créneaux de travail."
        action={<SimulatedFeatureButton href="/agenda" title="Ajouter à l’agenda"
          description={<><p>Bientôt, vous pourrez ajouter ici une tâche, un rendez-vous, un contrôle récurrent ou une analyse d’agent planifiée, avec client, projet et récurrence.</p><p>En attendant, les échéances viennent des tâches : créez une tâche datée depuis Travail.</p></>}>
          <Icon name="plus" width={16} height={16} />Ajouter</SimulatedFeatureButton>}
      />
      <DayPlan overdue={plan.overdue} today={plan.today} week={plan.week} />
      <Panel className="mt-6 overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 className="font-semibold">Cette semaine</h2>
          <span className="rounded-md bg-white/5 px-2 py-1 text-xs text-muted">Vue semaine</span>
        </div>
        <ol className="grid grid-cols-1 divide-y divide-border sm:grid-cols-7 sm:divide-x sm:divide-y-0">
          {week.map((day) => (
            <li key={day.iso} className="min-h-16 p-3 sm:min-h-48">
              <time dateTime={day.iso} className={`inline-flex rounded-md px-2 py-1 text-xs first-letter:uppercase ${day.isToday ? "bg-accent/15 font-medium text-accent" : "text-muted"}`}>
                {day.label}{day.isToday && <span className="sr-only"> (aujourd’hui)</span>}
              </time>
              <ul className="mt-2 space-y-1.5">
                {tasks.filter((task) => task.status !== "Terminé" && task.due_date?.slice(0, 10) === day.iso).map((task) => (
                  <li key={task.id}><Link href={`/tasks/${task.id}/edit`} className="block rounded-md border-l-2 border-l-amber-300 bg-white/[0.03] px-2 py-1.5 text-xs hover:bg-white/[0.07]"><span className="block text-muted">Échéance</span><span className="block break-words">{task.title}</span></Link></li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </Panel>
      <div className="mt-6"><InlineNotice title="Rendez-vous, contrôles récurrents et analyses planifiées arrivent bientôt." action={<TrySimulationButton href="/agenda">Voir l’agenda complet en simulation</TrySimulationButton>}>Les échéances affichées viennent de vos tâches réelles.</InlineNotice></div>
    </>
  );
}
