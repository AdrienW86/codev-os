import { requireAdmin } from "@/lib/require-admin";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, PageHeading } from "@/components/ui/primitives";
import { listTasks } from "@/lib/tasks/data";
import { listRecommendations } from "@/lib/recommendations/data";
import { listActions } from "@/lib/actions/data";
import { buildWorkItems, groupWorkItems, isWorkSectionId, workSections, type WorkItem, type WorkSectionId } from "@/lib/work/items";
import { formatDate } from "@/lib/format-date";

export const metadata: Metadata = { title: "Travail" };

const DONE_LIMIT = 15;

function WorkRow({ item }: { item: WorkItem }) {
  return (
    <li className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="text-xs text-muted">
          <span className="font-medium text-foreground/80">{item.kindLabel}</span>
          {" · "}<Link href={`/clients/${item.client.id}`} className="text-accent hover:underline">{item.client.name ?? "Client"}</Link>
          {item.project && <>{" · "}<Link href={`/projects/${item.project.id}`} className="hover:text-foreground hover:underline">{item.project.name}</Link></>}
        </p>
        <h3 className="mt-1.5 text-sm font-medium sm:text-base">
          <Link href={item.href} className="hover:text-accent hover:underline">{item.title}</Link>
        </h3>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <Badge tone={item.status.tone}>{item.status.label}</Badge>
        {item.priority && <Badge tone={item.priority.tone}>{item.priority.label}</Badge>}
        {item.dueDate && <span className="text-xs text-muted">Échéance <time dateTime={item.dueDate}>{formatDate(item.dueDate)}</time></span>}
      </div>
    </li>
  );
}

export default async function WorkPage({ searchParams }: PageProps<"/work">) {
  await requireAdmin();
  const params = await searchParams;
  const view: WorkSectionId | null = isWorkSectionId(params.view) ? params.view : null;
  const [tasks, recommendations, actions] = await Promise.all([listTasks(), listRecommendations(), listActions()]);
  const groups = groupWorkItems(buildWorkItems({ tasks, recommendations, actions }));
  const visible = workSections.filter((section) => !view || section.id === view);
  const filterClass = (active: boolean) => `inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors ${active ? "border-accent/50 bg-accent/10 text-accent" : "border-border text-muted hover:text-foreground"}`;

  return (
    <>
      <PageHeading
        eyebrow="Organisation"
        title="Travail"
        description="Tâches, recommandations des agents et actions à valider, réunies au même endroit."
        action={<Link href="/tasks/new" className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-background">+ Nouvelle tâche</Link>}
      />
      <nav aria-label="Filtrer le travail" className="mb-8">
        <ul className="flex flex-wrap gap-2">
          <li><Link href="/work" aria-current={!view ? "page" : undefined} className={filterClass(!view)}>Tout</Link></li>
          {workSections.map((section) => (
            <li key={section.id}>
              <Link href={`/work?view=${section.id}`} aria-current={view === section.id ? "page" : undefined} className={filterClass(view === section.id)}>
                {section.label}<span className="text-xs opacity-70">{groups[section.id].length}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="space-y-10">
        {visible.map((section) => {
          const items = groups[section.id];
          const shown = section.id === "done" && !view ? items.slice(0, DONE_LIMIT) : items;
          return (
            <section key={section.id} aria-labelledby={`work-${section.id}`}>
              <h2 id={`work-${section.id}`} className="flex items-center gap-3 border-b border-border pb-3 text-lg font-semibold">
                {section.label}<span className="text-sm font-normal text-muted">{items.length}</span>
              </h2>
              {shown.length ? (
                <ul className="divide-y divide-border">{shown.map((item) => <WorkRow key={item.key} item={item} />)}</ul>
              ) : <p className="py-6 text-sm text-muted">Rien dans cette catégorie pour le moment.</p>}
              {shown.length < items.length && <Link href={`/work?view=${section.id}`} className="mt-2 inline-block text-sm text-accent hover:underline">Voir les {items.length} éléments</Link>}
            </section>
          );
        })}
      </div>

      <p className="mt-12 border-t border-border pt-5 text-xs text-muted">
        Vues détaillées : <Link href="/tasks" className="text-accent hover:underline">tâches</Link> · <Link href="/recommendations" className="text-accent hover:underline">recommandations</Link> · <Link href="/actions" className="text-accent hover:underline">actions</Link> · <Link href="/projects" className="text-accent hover:underline">projets</Link>
      </p>
    </>
  );
}
