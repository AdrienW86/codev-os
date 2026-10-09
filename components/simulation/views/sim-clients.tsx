"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Action } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EntityCard } from "@/components/ui/layout";
import { PageHeading } from "@/components/ui/primitives";
import { EmptyState, InlineNotice } from "@/components/ui/states";
import { useSimWorld } from "@/components/simulation/simulation-provider";
import { newSimId } from "@/components/simulation/entity-drawer";
import { getService, type ServiceId } from "@/lib/services/catalog";

const inputClass = "mt-1.5 block min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground";

/** Portefeuille simulé + création de client (CAS A). */
export function SimClients() {
  const { world, update } = useSimWorld();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", activity: "", zone: "" });

  function create() {
    const id = newSimId("client");
    update((draft) => { draft.clients.unshift({ id, name: form.name.trim(), activity: form.activity.trim() || "Activité à préciser", zone: form.zone.trim() || "Zone à préciser", website: "", createdAt: draft.today, services: {}, isNew: true }); });
    setOpen(false);
    setForm({ name: "", activity: "", zone: "" });
    router.push(`/clients/${id}`);
  }

  return (
    <>
      <PageHeading eyebrow="Portefeuille" title="Clients" description="Vos clients, leurs services et leurs agents." action={<Action variant="primary" onClick={() => setOpen(true)}>+ Nouveau client</Action>} />
      {world.clients.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {world.clients.map((client) => {
            const services = Object.entries(client.services) as [ServiceId, string][];
            const pending = world.work.filter((item) => item.clientId === client.id && ["to-review", "to-approve", "open"].includes(item.status)).length;
            return (
              <EntityCard key={client.id} href={`/clients/${client.id}`} icon="clients" title={client.name} eyebrow={`${client.activity} · ${client.zone}`}
                status={client.isNew ? { label: "Nouveau", tone: "blue" } : pending ? { label: `${pending} à traiter`, tone: "amber" } : undefined}
                description={services.length ? services.map(([id]) => getService(id)?.name).join(" · ") : "Aucun service pour l’instant"} />
            );
          })}
        </div>
      ) : <EmptyState icon="clients" title="Aucun client dans ce scénario." action={<Action variant="primary" onClick={() => setOpen(true)}>+ Nouveau client</Action>} />}

      <Dialog open={open} onClose={() => setOpen(false)} title="Nouveau client" description="Simulation : le client n’est pas enregistré en base."
        footer={<><Action onClick={() => setOpen(false)}>Annuler</Action><Action variant="primary" type="submit" form="sim-new-client" disabled={!form.name.trim()}>Créer et ouvrir la fiche</Action></>}>
        <form id="sim-new-client" className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (form.name.trim()) create(); }}>
          <label className="block text-xs text-muted">Nom du client<input required autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputClass} placeholder="Ex. Atelier Bois & Co" /></label>
          <label className="block text-xs text-muted">Activité<input value={form.activity} onChange={(event) => setForm({ ...form, activity: event.target.value })} className={inputClass} placeholder="Ex. Menuiserie" /></label>
          <label className="block text-xs text-muted">Zone géographique<input value={form.zone} onChange={(event) => setForm({ ...form, zone: event.target.value })} className={inputClass} placeholder="Ex. Perpignan" /></label>
          <InlineNotice tone="info">Étape suivante : ajouter ses services depuis la fiche client.</InlineNotice>
        </form>
      </Dialog>
    </>
  );
}
