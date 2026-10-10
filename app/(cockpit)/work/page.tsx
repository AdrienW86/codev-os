import { requireAdmin } from "@/lib/require-admin";
import type { Metadata } from "next";
import Link from "next/link";
import { Action } from "@/components/ui/button";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeading } from "@/components/ui/primitives";
import { WorkBoard } from "@/components/work/work-board";
import { SimWork } from "@/components/simulation/views/sim-work";
import { listTasks } from "@/lib/tasks/data";
import { listRecommendations } from "@/lib/recommendations/data";
import { listActions } from "@/lib/actions/data";
import { listIncidents } from "@/lib/incidents/data";
import { safeRead } from "@/lib/core/safe-read";
import { buildWorkItems, groupWorkItems, isWorkSectionId, workSections, type WorkSectionId } from "@/lib/work/items";
import { getActiveScenario } from "@/lib/simulation/server";

export const metadata: Metadata = { title: "Travail" };

const DONE_LIMIT = 15;
const kinds = [{ value: "task", label: "Tâches" }, { value: "recommendation", label: "Recommandations" }, { value: "action", label: "Actions" }, { value: "incident", label: "Incidents" }];
const priorities = [{ value: "high", label: "Haute" }, { value: "medium", label: "Moyenne" }, { value: "low", label: "Basse" }];
const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");

export default async function WorkPage({ searchParams }: PageProps<"/work">) {
  await requireAdmin();
  const params = await searchParams;
  if (await getActiveScenario()) return <SimWork initialView={one(params.view) || undefined} initialClient={one(params.client) || undefined} />;
  const view: WorkSectionId | null = isWorkSectionId(params.view) ? params.view : null;
  const filters = { client: one(params.client), project: one(params.project), kind: one(params.kind), priority: one(params.priority) };
  const [tasks, recommendations, actions, incidents] = await Promise.all([listTasks(), listRecommendations(), listActions(), safeRead("incidents", () => listIncidents(), [])]);
  const all = buildWorkItems({ tasks, recommendations, actions, incidents: incidents.data });
  const items = all.filter((item) => (!filters.client || item.client.id === filters.client) && (!filters.project || item.project?.id === filters.project)
    && (!filters.kind || item.kind === filters.kind) && (!filters.priority || item.priorityKey === filters.priority));
  const groups = groupWorkItems(items);

  // Options de filtre tirées des données réelles uniquement.
  const clients = [...new Map(all.map((item) => [item.client.id, item.client.name ?? "Client"])).entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "fr"));
  const projects = [...new Map(all.filter((item) => item.project && (!filters.client || item.client.id === filters.client)).map((item) => [item.project!.id, item.project!.name])).entries()].map(([value, label]) => ({ value, label }));
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
  const sections = workSections.filter((section) => !view || section.id === view).map((section) => {
    const list = groups[section.id];
    const capped = section.id === "done" && !view && list.length > DONE_LIMIT;
    query.set("view", section.id);
    return { id: section.id, label: section.label, items: capped ? list.slice(0, DONE_LIMIT) : list, total: list.length, moreHref: capped ? `/work?${query.toString()}` : undefined };
  });

  return (
    <>
      <PageHeading eyebrow="Organisation" title="Travail" description="Tâches, incidents, recommandations des agents et actions à valider, réunis au même endroit." action={<Action href="/tasks/new" variant="primary">+ Nouvelle tâche</Action>} />
      <FilterBar resetHref="/work" fields={[
        { name: "client", label: "Client", value: filters.client, options: clients },
        { name: "project", label: "Projet", value: filters.project, options: projects },
        { name: "kind", label: "Type", value: filters.kind, options: kinds },
        { name: "view", label: "Statut", value: view ?? "", options: workSections.map((section) => ({ value: section.id, label: `${section.label} (${groups[section.id].length})` })) },
        { name: "priority", label: "Priorité", value: filters.priority, options: priorities },
      ]} />
      <WorkBoard sections={sections} actions={Object.fromEntries(actions.map((action) => [action.id, action]))} />
      <p className="mt-12 border-t border-border pt-5 text-xs text-muted">
        Vues détaillées : <Link href="/tasks" className="text-accent hover:underline">tâches</Link> · <Link href="/recommendations" className="text-accent hover:underline">recommandations</Link> · <Link href="/actions" className="text-accent hover:underline">actions</Link> · <Link href="/projects" className="text-accent hover:underline">projets</Link>
      </p>
    </>
  );
}
