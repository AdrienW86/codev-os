import { requireAdmin } from "@/lib/require-admin";
import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { todayInParis } from "@/lib/dashboard/home";

export const metadata: Metadata = { title: "Agenda" };

const dayFormatter = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", timeZone: "UTC" });

/** Lundi → dimanche de la semaine courante (aucune donnée métier pour ce lot). */
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
  const week = currentWeek(todayInParis());
  return (
    <>
      <PageHeading
        eyebrow="Planification"
        title="Agenda"
        description="Organisez vos tâches, échéances et créneaux de travail."
        action={<button type="button" disabled aria-describedby="agenda-soon" className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-background opacity-50"><Icon name="plus" width={16} height={16} />Ajouter</button>}
      />
      <Panel className="overflow-hidden">
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
            </li>
          ))}
        </ol>
      </Panel>
      <div id="agenda-soon" className="mt-8 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent"><Icon name="calendar" /></span>
        <p className="mt-4 font-medium">L’agenda CODE-V sera bientôt disponible.</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">En attendant, les échéances de vos tâches sont visibles sur l’accueil et dans la page Travail.</p>
        <Link href="/work" className="mt-5 inline-flex items-center gap-1.5 text-sm text-accent hover:underline">Voir le travail<Icon name="arrow" width={16} height={16} /></Link>
      </div>
    </>
  );
}
