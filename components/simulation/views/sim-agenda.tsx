"use client";

import { useState } from "react";
import { Action } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { RelationLink } from "@/components/ui/layout";
import { PageHeading } from "@/components/ui/primitives";
import { InlineNotice } from "@/components/ui/states";
import { ButtonTabs } from "@/components/ui/tabs";
import { useSimWorld } from "@/components/simulation/simulation-provider";
import { clientName, newSimId } from "@/components/simulation/entity-drawer";
import { agentCatalog, getAgentBlueprint, type AgentBlueprintId } from "@/lib/agents/catalog";
import { addDays } from "@/lib/simulation/fixtures";
import { eventKindLabels, recurrenceLabels } from "@/lib/simulation/labels";
import type { SimEvent, SimEventKind, SimId, SimWorld } from "@/lib/simulation/types";

const dayFormatter = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", timeZone: "UTC" });
const longFormatter = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
const mondayOf = (day: string) => addDays(day, -((weekday(day) + 6) % 7));
const inputClass = "mt-1.5 block min-h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground";

type Entry = { key: string; time: string; title: string; kind: SimEventKind | "due" | "automation"; event?: SimEvent; workId?: string; automationId?: string };

const kindTone: Record<Entry["kind"], string> = {
  task: "border-l-accent", meeting: "border-l-sky-400", check: "border-l-amber-300", "agent-run": "border-l-violet-400", due: "border-l-amber-300", automation: "border-l-violet-400",
};

function occursOn(event: SimEvent, day: string) {
  if (day < event.date) return false;
  if (event.recurrence === "none") return day === event.date;
  if (event.recurrence === "daily") return true;
  if (event.recurrence === "weekly") return weekday(day) === weekday(event.date);
  return day.slice(8) === event.date.slice(8);
}

function entriesFor(world: SimWorld, day: string): Entry[] {
  const entries: Entry[] = [
    ...world.events.filter((event) => occursOn(event, day)).map((event) => ({ key: `${event.id}-${day}`, time: event.time, title: event.title, kind: event.kind, event })),
    ...world.work.filter((item) => item.kind === "task" && item.due === day && item.status !== "done" && !world.events.some((event) => event.title === item.title && event.date === day))
      .map((item) => ({ key: `due-${item.id}`, time: "Journée", title: `Échéance : ${item.title}`, kind: "due" as const, workId: item.id })),
    ...world.automations.filter((item) => item.status !== "paused" && item.nextRun.slice(0, 10) === day)
      .map((item) => ({ key: `auto-${item.id}`, time: item.nextRun.slice(11, 16), title: item.label, kind: "automation" as const, automationId: item.id })),
  ];
  return entries.sort((a, b) => (a.time === "Journée" ? "" : a.time).localeCompare(b.time === "Journée" ? "" : b.time));
}

/** Agenda simulé : vues jour / semaine, ajout commun (tâche, rendez-vous, contrôle, analyse planifiée). */
export function SimAgenda() {
  const { world, update, open } = useSimWorld();
  const [view, setView] = useState<"today" | "week">("week");
  const [weekStart, setWeekStart] = useState(mondayOf(world.today));
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<SimEvent | null>(null);
  const [form, setForm] = useState({ kind: "meeting" as SimEventKind, title: "", date: world.today, time: "10:00", clientId: "", projectId: "", agentId: "", recurrence: "none" as SimEvent["recurrence"] });
  const days = view === "today" ? [world.today] : Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

  function create() {
    const id = newSimId("event");
    update((draft) => {
      draft.events.push({ id, kind: form.kind, title: form.title.trim(), date: form.date, time: form.time, clientId: (form.clientId || undefined) as SimId | undefined, projectId: (form.projectId || undefined) as SimId | undefined, agentId: (form.agentId || undefined) as AgentBlueprintId | undefined, recurrence: form.recurrence });
      if (form.kind === "task" && form.clientId) draft.work.push({ id: newSimId("task"), kind: "task", title: form.title.trim(), summary: "Créée depuis l’agenda.", status: "todo", clientId: form.clientId as SimId, projectId: (form.projectId || undefined) as SimId | undefined, priority: "medium", due: form.date, createdAt: draft.today, history: [{ at: `${draft.today}T09:00`, label: "Tâche créée depuis l’agenda (simulation)" }] });
    });
    setWeekStart(mondayOf(form.date)); setCreating(false); setForm({ ...form, title: "" });
  }

  function openEntry(entry: Entry) {
    if (entry.event) setSelected(entry.event);
    else if (entry.workId) open({ type: "work", id: entry.workId });
    else if (entry.automationId) open({ type: "automation", id: entry.automationId });
  }

  return (
    <>
      <PageHeading eyebrow="Planification" title="Agenda" description="Organisez vos tâches, échéances et créneaux de travail." action={<Action variant="primary" onClick={() => setCreating(true)}><Icon name="plus" width={16} height={16} />Ajouter</Action>} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ButtonTabs label="Vue de l’agenda" current={view} onChange={(id) => setView(id as "today" | "week")} items={[{ id: "today", label: "Aujourd’hui" }, { id: "week", label: "Semaine" }]} />
        {view === "week" && (
          <div className="mb-6 flex items-center gap-1">
            <button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Semaine précédente" className="flex h-10 w-10 items-center justify-center rounded-lg border border-border hover:border-accent/50">‹</button>
            <button type="button" onClick={() => setWeekStart(mondayOf(world.today))} className="min-h-10 rounded-lg border border-border px-3 text-sm hover:border-accent/50">Cette semaine</button>
            <button type="button" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Semaine suivante" className="flex h-10 w-10 items-center justify-center rounded-lg border border-border hover:border-accent/50">›</button>
          </div>
        )}
      </div>

      <ol className={`grid grid-cols-1 overflow-hidden rounded-xl border border-border bg-surface ${view === "week" ? "divide-y divide-border lg:grid-cols-7 lg:divide-x lg:divide-y-0" : ""}`}>
        {days.map((day) => {
          const entries = entriesFor(world, day);
          const isToday = day === world.today;
          return (
            <li key={day} className={`min-w-0 p-3 ${view === "week" ? "lg:min-h-64" : "min-h-64"}`}>
              <h2 className={`inline-flex rounded-md px-2 py-1 text-xs first-letter:uppercase ${isToday ? "bg-accent/15 font-medium text-accent" : "text-muted"}`}>
                <time dateTime={day}>{view === "today" ? longFormatter.format(new Date(`${day}T00:00:00Z`)) : dayFormatter.format(new Date(`${day}T00:00:00Z`))}</time>{isToday && <span className="sr-only"> (aujourd’hui)</span>}
              </h2>
              {entries.length ? (
                <ul className="mt-2 space-y-1.5">
                  {entries.map((entry) => (
                    <li key={entry.key}>
                      <button type="button" onClick={() => openEntry(entry)} className={`w-full rounded-md border-l-2 bg-white/[0.03] px-2 py-1.5 text-left text-xs hover:bg-white/[0.07] ${kindTone[entry.kind]}`}>
                        <span className="block text-muted">{entry.time}</span><span className="block break-words">{entry.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : view === "today" && <p className="mt-3 text-sm text-muted">Rien de prévu aujourd’hui.</p>}
            </li>
          );
        })}
      </ol>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span><span aria-hidden="true" className="text-accent">▍</span>Tâche</span><span><span aria-hidden="true" className="text-sky-400">▍</span>Rendez-vous</span>
        <span><span aria-hidden="true" className="text-amber-300">▍</span>Contrôle / échéance</span><span><span aria-hidden="true" className="text-violet-400">▍</span>Analyse d’agent planifiée</span>
      </p>

      <Dialog open={creating} onClose={() => setCreating(false)} title="Ajouter à l’agenda" description="Simulation : rien n’est enregistré en base."
        footer={<><Action onClick={() => setCreating(false)}>Annuler</Action><Action variant="primary" type="submit" form="sim-new-event" disabled={!form.title.trim()}>Ajouter</Action></>}>
        <form id="sim-new-event" className="grid grid-cols-2 gap-4" onSubmit={(event) => { event.preventDefault(); if (form.title.trim()) create(); }}>
          <label className="col-span-2 text-xs text-muted">Type<select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as SimEventKind, recurrence: event.target.value === "check" ? "weekly" : form.recurrence })} className={inputClass}>{Object.entries(eventKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="col-span-2 text-xs text-muted">Titre<input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className={inputClass} placeholder="Ex. Point mensuel" /></label>
          <label className="text-xs text-muted">Date<input type="date" required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} className={inputClass} /></label>
          <label className="text-xs text-muted">Heure<input type="time" required value={form.time} onChange={(event) => setForm({ ...form, time: event.target.value })} className={inputClass} /></label>
          <label className="text-xs text-muted">Client<select value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value, projectId: "" })} className={inputClass}><option value="">Aucun</option>{world.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
          <label className="text-xs text-muted">Projet<select value={form.projectId} disabled={!form.clientId} onChange={(event) => setForm({ ...form, projectId: event.target.value })} className={inputClass}><option value="">Aucun</option>{world.projects.filter((project) => project.clientId === form.clientId).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label className="text-xs text-muted">Agent{form.kind === "agent-run" ? "" : " (facultatif)"}<select required={form.kind === "agent-run"} value={form.agentId} onChange={(event) => setForm({ ...form, agentId: event.target.value })} className={inputClass}><option value="">Aucun</option>{agentCatalog.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
          <label className="text-xs text-muted">Récurrence<select value={form.recurrence} onChange={(event) => setForm({ ...form, recurrence: event.target.value as SimEvent["recurrence"] })} className={inputClass}>{Object.entries(recurrenceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {form.kind === "task" && <div className="col-span-2"><InlineNotice tone="info">{form.clientId ? "La tâche apparaîtra aussi dans Travail." : "Choisissez un client pour que la tâche apparaisse aussi dans Travail."}</InlineNotice></div>}
        </form>
      </Dialog>

      <Dialog open={selected !== null} onClose={() => setSelected(null)} title={selected?.title ?? ""} description={selected ? `${eventKindLabels[selected.kind]} · ${recurrenceLabels[selected.recurrence]}` : undefined}
        footer={selected && <><Action variant="danger" onClick={() => { const id = selected.id; update((draft) => { draft.events = draft.events.filter((event) => event.id !== id); }); setSelected(null); }}>Retirer de l’agenda</Action><Action variant="primary" onClick={() => setSelected(null)}>Fermer</Action></>}>
        {selected && (
          <div className="space-y-4">
            <p className="text-sm">{longFormatter.format(new Date(`${selected.date}T00:00:00Z`))} à {selected.time}</p>
            <div className="flex flex-wrap gap-2">
              {selected.clientId && <RelationLink kind="Client" label={clientName(world, selected.clientId)} href={`/clients/${selected.clientId}`} icon="clients" />}
              {selected.projectId && <RelationLink kind="Projet" label={world.projects.find((project) => project.id === selected.projectId)?.name ?? "Projet"} onClick={() => { const id = selected.projectId!; setSelected(null); open({ type: "project", id }); }} />}
              {selected.agentId && <RelationLink kind="Agent" label={getAgentBlueprint(selected.agentId)?.name ?? "Agent"} onClick={() => { const id = selected.agentId!; setSelected(null); open({ type: "agent", id }); }} />}
            </div>
            {selected.kind === "agent-run" && <InlineNotice tone="info">Analyse planifiée simulée : aucune exécution réelle.</InlineNotice>}
          </div>
        )}
      </Dialog>
    </>
  );
}
