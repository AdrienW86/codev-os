import { requireAdmin } from "@/lib/require-admin";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { SectionHeader } from "@/components/ui/layout";
import { EmptyState } from "@/components/ui/states";
import { MutationForm } from "@/components/ui/mutation-form";
import { ModuleUnavailable } from "@/components/ui/module-unavailable";
import { DayPlan } from "@/components/dashboard/day-plan";
import { AgendaForm } from "@/components/agenda/agenda-form";
import { planTasks, todayInParis } from "@/lib/dashboard/home";
import { listTasks } from "@/lib/tasks/data";
import { listClients } from "@/lib/clients/data";
import { listAgendaItems } from "@/lib/agenda/service";
import { listAutomations } from "@/lib/automations/service";
import { addDays, automationRuns, expandOccurrences, localDay, mondayOf, upcomingOccurrences } from "@/lib/agenda/occurrences";
import { zonedToUtc } from "@/lib/scheduler/recurrence";
import { safeRead } from "@/lib/core/safe-read";
import { getActiveScenario } from "@/lib/simulation/server";
import { SimAgenda } from "@/components/simulation/views/sim-agenda";
import { cancelAgendaItemAction, completeAgendaItemAction, createAgendaItemAction } from "./actions";

export const metadata: Metadata = { title: "Agenda" };

const dayFormatter = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const timeFormatter = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
const kindLabels: Record<string, string> = { event: "Événement", meeting: "Rendez-vous", work_block: "Créneau", check: "Contrôle", automation: "Automatisation", task: "Échéance" };
const kindStyles: Record<string, string> = { event: "border-l-sky-300", meeting: "border-l-accent", work_block: "border-l-violet-300", check: "border-l-amber-300", automation: "border-l-white/40", task: "border-l-amber-300" };

type Entry = { key: string; kind: string; time: string | null; title: string; detail?: string; href?: string };

export default async function AgendaPage({ searchParams }: PageProps<"/agenda">) {
  await requireAdmin();
  if (await getActiveScenario()) return <SimAgenda />;
  const { week: rawWeek } = await searchParams;
  const today = todayInParis();
  const monday = mondayOf(typeof rawWeek === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawWeek) ? rawWeek : today);
  const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  const [y1, m1, d1] = monday.split("-").map(Number);
  const [y2, m2, d2] = addDays(monday, 7).split("-").map(Number);
  const from = zonedToUtc(y1, m1, d1, 0, 0, "Europe/Paris");
  const to = zonedToUtc(y2, m2, d2, 0, 0, "Europe/Paris");

  const [tasks, clients, items, automations] = await Promise.all([
    listTasks(), safeRead("clients", () => listClients(), []),
    safeRead("agenda", () => listAgendaItems(to), []), safeRead("automations", () => listAutomations(), []),
  ]);
  const plan = planTasks(tasks, today);
  const occurrences = expandOccurrences(items.data, from, to);
  const runs = automationRuns(automations.data, from, to);

  const byDay = new Map<string, Entry[]>(days.map((day) => [day, []]));
  for (const occurrence of occurrences) byDay.get(localDay(occurrence.startsAt))?.push({ key: `a:${occurrence.item.id}:${occurrence.startsAt.toISOString()}`, kind: occurrence.item.kind, time: timeFormatter.format(occurrence.startsAt), title: occurrence.item.title, detail: occurrence.item.client?.name, href: occurrence.item.client ? `/clients/${occurrence.item.client.id}` : undefined });
  for (const run of runs) byDay.get(localDay(run.at))?.push({ key: `r:${run.automation.id}:${run.at.toISOString()}`, kind: "automation", time: timeFormatter.format(run.at), title: run.automation.name, href: "/settings?tab=automations" });
  for (const task of tasks) {
    if (task.status === "Terminé" || !task.due_date) continue;
    byDay.get(task.due_date.slice(0, 10))?.push({ key: `t:${task.id}`, kind: "task", time: (task as { due_time?: string | null }).due_time?.slice(0, 5) ?? null, title: task.title, detail: task.client?.name, href: `/tasks/${task.id}/edit` });
  }
  for (const entries of byDay.values()) entries.sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99"));
  const upcoming = upcomingOccurrences(items.data);

  return (
    <>
      <PageHeading eyebrow="Planification" title="Agenda" description="Rendez-vous, créneaux de travail, contrôles, échéances des tâches et exécutions planifiées des agents." />
      {(items.unavailable || automations.unavailable) && <div className="mb-6"><ModuleUnavailable module="Agenda" /></div>}
      <DayPlan overdue={plan.overdue} today={plan.today} week={plan.week} />

      <Panel className="mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 className="font-semibold">Semaine du {dayFormatter.format(new Date(`${monday}T00:00:00Z`))}</h2>
          <nav aria-label="Navigation par semaine" className="flex gap-2 text-sm">
            <Link href={`/agenda?week=${addDays(monday, -7)}`} className="inline-flex min-h-10 items-center rounded-lg border border-border px-3 hover:border-accent/50">← Précédente</Link>
            <Link href="/agenda" className="inline-flex min-h-10 items-center rounded-lg border border-border px-3 hover:border-accent/50">Aujourd’hui</Link>
            <Link href={`/agenda?week=${addDays(monday, 7)}`} className="inline-flex min-h-10 items-center rounded-lg border border-border px-3 hover:border-accent/50">Suivante →</Link>
          </nav>
        </div>
        <ol className="grid grid-cols-1 divide-y divide-border sm:grid-cols-7 sm:divide-x sm:divide-y-0">
          {days.map((day) => {
            const entries = byDay.get(day) ?? [];
            return (
              <li key={day} className="min-h-16 min-w-0 p-3 sm:min-h-48">
                <time dateTime={day} className={`inline-flex rounded-md px-2 py-1 text-xs first-letter:uppercase ${day === today ? "bg-accent/15 font-medium text-accent" : "text-muted"}`}>
                  {dayFormatter.format(new Date(`${day}T00:00:00Z`))}{day === today && <span className="sr-only"> (aujourd’hui)</span>}
                </time>
                <ul className="mt-2 space-y-1.5">
                  {entries.map((entry) => {
                    const body = <><span className="block text-muted">{entry.time ? `${entry.time} · ` : ""}{kindLabels[entry.kind]}</span><span className="block break-words">{entry.title}</span>{entry.detail && <span className="block text-muted">{entry.detail}</span>}</>;
                    const className = `block rounded-md border-l-2 ${kindStyles[entry.kind] ?? "border-l-border"} bg-white/[0.03] px-2 py-1.5 text-xs`;
                    return <li key={entry.key}>{entry.href ? <Link href={entry.href} className={`${className} hover:bg-white/[0.07]`}>{body}</Link> : <span className={className}>{body}</span>}</li>;
                  })}
                </ul>
              </li>
            );
          })}
        </ol>
      </Panel>

      <div className="mt-8 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel className="p-6">
          <h2 className="mb-4 font-semibold">Ajouter à l’agenda</h2>
          <AgendaForm action={createAgendaItemAction} defaultDate={today} clients={clients.data.map((client) => ({ value: client.id, label: client.name }))} />
          <p className="mt-4 text-xs text-muted">Pour une tâche datée, utilisez <Link href="/tasks/new" className="text-accent hover:underline">Nouvelle tâche</Link> ; pour une analyse récurrente d’agent, <Link href="/settings?tab=automations" className="text-accent hover:underline">une automatisation</Link>.</p>
        </Panel>
        <section>
          <SectionHeader title="Prochains éléments" />
          {upcoming.length ? (
            <ul className="divide-y divide-border rounded-xl border border-border bg-surface px-4">
              {upcoming.map(({ item, startsAt }) => (
                <li key={item.id} className="py-3">
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-muted">{dayFormatter.format(new Date(`${localDay(startsAt)}T00:00:00Z`))} · {timeFormatter.format(startsAt)} · {kindLabels[item.kind]}{item.recurrence !== "none" ? " · récurrent" : ""}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.recurrence === "none" && <MutationForm action={completeAgendaItemAction} fields={{ id: item.id }} label="Fait" variant="ghost" disableOnSuccess />}
                    <MutationForm action={cancelAgendaItemAction} fields={{ id: item.id }} label={item.recurrence === "none" ? "Annuler" : "Arrêter la série"} variant="ghost" confirm="Annuler cet élément ? Il reste dans l’historique." disableOnSuccess />
                  </div>
                </li>
              ))}
            </ul>
          ) : <EmptyState compact icon="calendar" title="Rien de planifié sur 14 jours." />}
        </section>
      </div>
    </>
  );
}
