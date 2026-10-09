"use client";

import { useState } from "react";
import { Action } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PageHeading } from "@/components/ui/primitives";
import { InlineNotice } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { useSimWorld } from "@/components/simulation/simulation-provider";
import { clientName, newSimId } from "@/components/simulation/entity-drawer";
import { formatSimDateTime, priorityLabels, workKindLabels, workSection, workStatusLabels } from "@/lib/simulation/labels";
import type { SimId, SimWorkItem } from "@/lib/simulation/types";

const sections = [
  { id: "review", label: "À valider" }, { id: "todo", label: "À faire" }, { id: "follow", label: "En cours / à suivre" },
  { id: "waiting", label: "En attente" }, { id: "done", label: "Terminé" },
] as const;

const selectClass = "mt-1.5 block min-h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground";

/** Centre opérationnel simulé : tâches, recommandations, actions et incidents, ouverts en panneau. */
export function SimWork({ initialView, initialClient }: { initialView?: string; initialClient?: string }) {
  const { world, open, update } = useSimWorld();
  const [filters, setFilters] = useState({ view: initialView ?? "", client: initialClient ?? "", project: "", kind: "", priority: "" });
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ title: "", clientId: world.clients[0]?.id ?? "", due: world.today, priority: "medium" as SimWorkItem["priority"] });

  const items = world.work
    .filter((item) => (!filters.client || item.clientId === filters.client) && (!filters.project || item.projectId === filters.project)
      && (!filters.kind || item.kind === filters.kind) && (!filters.priority || item.priority === filters.priority))
    .sort((a, b) => Number(b.priority === "high") - Number(a.priority === "high") || (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  const grouped = Object.fromEntries(sections.map((section) => [section.id, items.filter((item) => workSection(item) === section.id)]));
  const visible = sections.filter((section) => !filters.view || section.id === filters.view);
  const projects = world.projects.filter((project) => !filters.client || project.clientId === filters.client);
  const set = (key: keyof typeof filters) => (event: { target: { value: string } }) => setFilters({ ...filters, [key]: event.target.value, ...(key === "client" ? { project: "" } : {}) });

  function createTask() {
    const id = newSimId("task");
    update((world) => { world.work.push({ id, kind: "task", title: draft.title.trim(), summary: "", status: "todo", clientId: draft.clientId as SimId, priority: draft.priority, due: draft.due, createdAt: world.today, history: [{ at: `${world.today}T09:00`, label: "Tâche créée (simulation)" }] }); });
    setCreating(false); setDraft({ ...draft, title: "" }); open({ type: "work", id });
  }

  return (
    <>
      <PageHeading eyebrow="Organisation" title="Travail" description="Tâches, recommandations, actions à valider et incidents, réunis au même endroit." action={<Action variant="primary" onClick={() => setCreating(true)}>+ Nouvelle tâche</Action>} />

      <div role="group" aria-label="Filtres" className="mb-6 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
        <label className="min-w-0 text-xs text-muted sm:w-44">Client<select value={filters.client} onChange={set("client")} className={selectClass}><option value="">Tous</option>{world.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
        <label className="min-w-0 text-xs text-muted sm:w-44">Projet<select value={filters.project} onChange={set("project")} className={selectClass}><option value="">Tous</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <label className="min-w-0 text-xs text-muted sm:w-40">Type<select value={filters.kind} onChange={set("kind")} className={selectClass}><option value="">Tous</option>{Object.entries(workKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="min-w-0 text-xs text-muted sm:w-40">Priorité<select value={filters.priority} onChange={set("priority")} className={selectClass}><option value="">Toutes</option>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label.label}</option>)}</select></label>
        <label className="col-span-2 min-w-0 text-xs text-muted sm:col-span-1 sm:w-44">Statut<select value={filters.view} onChange={set("view")} className={selectClass}><option value="">Tous</option>{sections.map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}</select></label>
      </div>

      <div className="space-y-10">
        {visible.map((section) => {
          const list = grouped[section.id];
          if (!list.length && !filters.view) return null;
          return (
            <section key={section.id} aria-labelledby={`sim-work-${section.id}`}>
              <h2 id={`sim-work-${section.id}`} className="flex items-center gap-3 border-b border-border pb-3 text-lg font-semibold">{section.label}<span className="text-sm font-normal text-muted">{list.length}</span></h2>
              {list.length ? (
                <ul className="divide-y divide-border">
                  {list.map((item) => (
                    <li key={item.id}>
                      <button type="button" onClick={() => open({ type: "work", id: item.id })} className="grid w-full gap-2 py-4 text-left sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                        <span className="min-w-0">
                          <span className="block text-xs text-muted">{workKindLabels[item.kind]} · {clientName(world, item.clientId)}{item.projectId && ` · ${world.projects.find((project) => project.id === item.projectId)?.name ?? ""}`}</span>
                          <span className="mt-1 block text-sm font-medium hover:text-accent sm:text-base">{item.title}</span>
                        </span>
                        <span className="flex flex-wrap items-center gap-2 sm:justify-end">
                          <StatusBadge {...workStatusLabels[item.status]} />
                          {item.priority === "high" && <StatusBadge {...priorityLabels.high} />}
                          {item.due && <span className={`text-xs ${item.due < world.today && item.status !== "done" ? "text-amber-300" : "text-muted"}`}>Échéance {formatSimDateTime(item.due)}</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="py-6 text-sm text-muted">Rien dans cette catégorie.</p>}
            </section>
          );
        })}
        {!items.length && <p className="text-sm text-muted">Aucun élément pour ces filtres.</p>}
      </div>

      <Dialog open={creating} onClose={() => setCreating(false)} title="Nouvelle tâche" description="Simulation : la tâche n’est pas enregistrée en base."
        footer={<><Action onClick={() => setCreating(false)}>Annuler</Action><Action variant="primary" type="submit" form="sim-new-task" disabled={!draft.title.trim()}>Créer</Action></>}>
        <form id="sim-new-task" className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (draft.title.trim()) createTask(); }}>
          <label className="block text-xs text-muted">Titre<input required autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className={selectClass} /></label>
          <label className="block text-xs text-muted">Client<select value={draft.clientId} onChange={(event) => setDraft({ ...draft, clientId: event.target.value })} className={selectClass}>{world.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-muted">Échéance<input type="date" value={draft.due} onChange={(event) => setDraft({ ...draft, due: event.target.value })} className={selectClass} /></label>
            <label className="block text-xs text-muted">Priorité<select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as SimWorkItem["priority"] })} className={selectClass}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label.label}</option>)}</select></label>
          </div>
          <InlineNotice tone="info">Pour planifier un créneau ou une récurrence, utilisez l’Agenda.</InlineNotice>
        </form>
      </Dialog>
    </>
  );
}
