"use client";

import { useState } from "react";
import { Action } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { EmptyState, InlineNotice } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { useSimWorld } from "@/components/simulation/simulation-provider";
import { clientName, newSimId } from "@/components/simulation/entity-drawer";
import { agentStatusLabels, formatSimDateTime, isAgentWorking, platformLabels, publicationStatusLabels } from "@/lib/simulation/labels";
import type { SimId, SimPlatform, SimPublication } from "@/lib/simulation/types";

const inputClass = "mt-1.5 block min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground";
const groups: { id: string; label: string; statuses: SimPublication["status"][] }[] = [
  { id: "action", label: "À traiter", statuses: ["to-review", "partial", "draft"] },
  { id: "planned", label: "Validées et planifiées", statuses: ["approved", "scheduled"] },
  { id: "done", label: "Publiées", statuses: ["published"] },
];

/** Publications simulées (CAS D) : préparation, aperçu, validation, planification, publication simulée. */
export function SimPublications() {
  const { world, update, open } = useSimWorld();
  const [client, setClient] = useState("");
  const [creating, setCreating] = useState(false);
  const socialClients = world.clients.filter((item) => item.services.social);
  const [form, setForm] = useState({ clientId: socialClients[0]?.id ?? world.clients[0]?.id ?? "", subject: "", text: "", channels: ["facebook", "instagram"] as SimPlatform[] });
  const list = world.publications.filter((item) => !client || item.clientId === client);
  const agent = world.agents.publications;

  function create() {
    const id = newSimId("pub");
    update((draft) => { draft.publications.unshift({ id, clientId: form.clientId as SimId, projectId: draft.projects.find((project) => project.clientId === form.clientId && project.serviceId === "social")?.id, subject: form.subject.trim(), text: form.text.trim() || "Texte à rédiger.", date: draft.today, time: "18:00", status: "draft", channels: form.channels.map((platform) => ({ platform, status: "pending" })), history: [{ at: `${draft.today}T09:00`, label: "Brouillon créé (simulation)" }] }); });
    setCreating(false); setForm({ ...form, subject: "", text: "" }); open({ type: "publication", id });
  }

  return (
    <>
      <PageHeading eyebrow="Contenus clients" title="Publications" description="Préparées par l’Agent Publications, validées par vous, publiées sur chaque réseau." action={<Action variant="primary" onClick={() => setCreating(true)}>+ Nouvelle publication</Action>} />
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <label className="w-full text-xs text-muted sm:w-56">Client<select value={client} onChange={(event) => setClient(event.target.value)} className={inputClass}><option value="">Tous</option>{world.clients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <button type="button" onClick={() => open({ type: "agent", id: "publications" })} className="inline-flex min-h-11 items-center gap-2 text-sm hover:text-accent">Agent Publications <StatusBadge {...agentStatusLabels[agent.status]} /></button>
      </div>
      {!isAgentWorking(agent.status) && <div className="mb-6"><InlineNotice tone="red" action={<Action onClick={() => open({ type: "agent", id: "publications" })}>Voir l’agent</Action>}>{agent.note ?? "L’Agent Publications n’est pas actif."}</InlineNotice></div>}

      {list.length ? (
        <div className="space-y-8">
          {groups.map((group) => {
            const items = list.filter((item) => group.statuses.includes(item.status));
            if (!items.length) return null;
            return (
              <section key={group.id} aria-labelledby={`pub-${group.id}`}>
                <h2 id={`pub-${group.id}`} className="mb-3 flex items-center gap-2 text-lg font-semibold">{group.label}<span className="text-sm font-normal text-muted">{items.length}</span></h2>
                <Panel className="px-5">
                  <ul className="divide-y divide-border">
                    {items.map((item) => (
                      <li key={item.id}>
                        <button type="button" onClick={() => open({ type: "publication", id: item.id })} className="grid w-full gap-2 py-4 text-left sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                          <span className="min-w-0">
                            <span className="block text-xs text-muted">{clientName(world, item.clientId)} · {formatSimDateTime(item.date)} à {item.time} · {item.channels.map((channel) => platformLabels[channel.platform]).join(", ")}</span>
                            <span className="mt-1 block font-medium hover:text-accent">{item.subject}</span>
                          </span>
                          <StatusBadge {...publicationStatusLabels[item.status]} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </Panel>
              </section>
            );
          })}
        </div>
      ) : <EmptyState icon="publications" title="Aucune publication." description="Créez une publication ou laissez l’Agent Publications en proposer." action={<Action variant="primary" onClick={() => setCreating(true)}>+ Nouvelle publication</Action>} />}

      <Dialog open={creating} onClose={() => setCreating(false)} title="Nouvelle publication" description="Simulation : rien n’est publié ni enregistré."
        footer={<><Action onClick={() => setCreating(false)}>Annuler</Action><Action variant="primary" type="submit" form="sim-new-pub" disabled={!form.subject.trim() || !form.channels.length}>Créer le brouillon</Action></>}>
        <form id="sim-new-pub" className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (form.subject.trim() && form.channels.length) create(); }}>
          <label className="block text-xs text-muted">Client<select value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })} className={inputClass}>{world.clients.map((item) => <option key={item.id} value={item.id}>{item.name}{item.services.social ? "" : " (sans service Réseaux sociaux)"}</option>)}</select></label>
          <label className="block text-xs text-muted">Sujet<input required value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} className={inputClass} /></label>
          <label className="block text-xs text-muted">Texte<textarea rows={4} value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} className="mt-1.5 block w-full rounded-lg border border-border bg-background p-3 text-sm text-foreground" /></label>
          <fieldset><legend className="text-xs text-muted">Canaux</legend><div className="mt-2 flex flex-wrap gap-3">{(Object.keys(platformLabels) as SimPlatform[]).map((platform) => (
            <label key={platform} className="inline-flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={form.channels.includes(platform)} onChange={(event) => setForm({ ...form, channels: event.target.checked ? [...form.channels, platform] : form.channels.filter((item) => item !== platform) })} className="accent-[#b8f49b]" />{platformLabels[platform]}</label>
          ))}</div></fieldset>
        </form>
      </Dialog>
    </>
  );
}
