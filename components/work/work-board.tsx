"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionControls } from "@/components/actions/action-controls";
import { IncidentControls } from "@/components/work/incident-controls";
import { Action } from "@/components/ui/button";
import { DetailDrawer } from "@/components/ui/dialog";
import { RelationLink } from "@/components/ui/layout";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/format-date";
import type { InternalActionRecord } from "@/lib/actions/types";
import type { WorkItem, WorkSectionId } from "@/lib/work/items";

/** Sections de la page Travail : chaque ligne ouvre un panneau de détail sans quitter la page. */
export function WorkBoard({ sections, actions }: {
  sections: { id: WorkSectionId; label: string; items: WorkItem[]; total: number; moreHref?: string }[];
  /** Actions réelles, pour les contrôles de validation existants. */
  actions: Record<string, InternalActionRecord>;
}) {
  const [selected, setSelected] = useState<WorkItem | null>(null);
  const action = selected?.kind === "action" ? actions[selected.id] : undefined;

  return (
    <>
      <div className="space-y-10">
        {sections.map((section) => (
          <section key={section.id} aria-labelledby={`work-${section.id}`}>
            <h2 id={`work-${section.id}`} className="flex items-center gap-3 border-b border-border pb-3 text-lg font-semibold">{section.label}<span className="text-sm font-normal text-muted">{section.total}</span></h2>
            {section.items.length ? (
              <ul className="divide-y divide-border">
                {section.items.map((item) => (
                  <li key={item.key}>
                    <button type="button" onClick={() => setSelected(item)} className="grid w-full gap-2 py-4 text-left sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <span className="min-w-0">
                        <span className="block text-xs text-muted"><span className="font-medium text-foreground/80">{item.kindLabel}</span> · {item.client.name ?? "Client"}{item.project && ` · ${item.project.name}`}</span>
                        <span className="mt-1 block text-sm font-medium hover:text-accent sm:text-base">{item.title}</span>
                      </span>
                      <span className="flex flex-wrap items-center gap-2 sm:justify-end">
                        <StatusBadge label={item.status.label} tone={item.status.tone} />
                        {item.priority && item.priority.tone === "amber" && <StatusBadge label={item.priority.label} tone="amber" />}
                        {item.dueDate && <span className="text-xs text-muted">Échéance {formatDate(item.dueDate)}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="py-6 text-sm text-muted">Rien dans cette catégorie pour le moment.</p>}
            {section.moreHref && <Link href={section.moreHref} className="mt-2 inline-flex min-h-10 items-center text-sm text-accent hover:underline">Voir les {section.total} éléments</Link>}
          </section>
        ))}
      </div>

      <DetailDrawer open={selected !== null} onClose={() => setSelected(null)} title={selected?.title ?? ""} description={selected?.kindLabel}
        footer={selected && <>
          <Action onClick={() => setSelected(null)}>Fermer</Action>
          {selected.fullHref && <Action href={selected.fullHref} variant="primary">{selected.kind === "task" ? "Modifier la tâche" : "Ouvrir la fiche complète"}</Action>}
          {selected.kind === "action" && <Action href={selected.href} variant="primary">Ouvrir le centre d’actions</Action>}
        </>}>
        {selected && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge label={selected.status.label} tone={selected.status.tone} />
              {selected.priority && <StatusBadge label={selected.priority.label} tone={selected.priority.tone} />}
              {selected.dueDate && <span className="text-xs text-muted">Échéance {formatDate(selected.dueDate)}</span>}
            </div>
            {selected.summary && <p className="text-sm leading-6 whitespace-pre-wrap">{selected.summary}</p>}
            <div>
              <h3 className="mb-2 text-xs font-medium tracking-[0.14em] text-muted uppercase">Liens</h3>
              <div className="flex flex-wrap gap-2">
                <RelationLink kind="Client" label={selected.client.name ?? "Client"} href={`/clients/${selected.client.id}`} icon="clients" />
                {selected.project && <RelationLink kind="Projet" label={selected.project.name} href={`/projects/${selected.project.id}`} icon="projects" />}
                {selected.agent && <RelationLink kind="Agent" label={selected.agent.name} href={`/agents/${selected.agent.id}`} icon="agents" />}
                {selected.source && <RelationLink kind="Recommandation d’origine" label={selected.source.title} href={selected.source.href} icon="recommendations" />}
              </div>
            </div>
            {action && (
              <div>
                <h3 className="mb-2 text-xs font-medium tracking-[0.14em] text-muted uppercase">Décision</h3>
                <ActionControls action={action} />
              </div>
            )}
            {selected.kind === "incident" && (
              <div>
                <h3 className="mb-2 text-xs font-medium tracking-[0.14em] text-muted uppercase">Suivi</h3>
                <IncidentControls id={selected.id} section={selected.section} />
              </div>
            )}
            {selected.kind === "recommendation" && selected.section === "review" && <p className="text-sm text-muted">Acceptez, écartez ou transformez cette recommandation en action depuis sa fiche complète.</p>}
          </div>
        )}
      </DetailDrawer>
    </>
  );
}
