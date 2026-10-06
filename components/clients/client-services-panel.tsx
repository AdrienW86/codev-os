"use client";

import { useActionState } from "react";
import { createClientServiceAction, deleteClientServiceAction, updateClientServiceAction } from "@/app/(cockpit)/clients/[id]/actions";
import { ConfirmDeleteForm } from "@/components/ui/confirm-delete-form";
import { Panel } from "@/components/ui/primitives";
import type { ClientServiceFormState, ClientServiceRecord } from "@/lib/client-services/types";

const inputClass = "mt-2 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm disabled:opacity-60";
const euroFormatter = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

function ServiceEditor({ clientId, service }: { clientId: string; service: ClientServiceRecord }) {
  const [state, action, pending] = useActionState<ClientServiceFormState, FormData>(updateClientServiceAction, {});
  return <li className="border-t border-border py-5 first:border-t-0 first:pt-0">
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="id" value={service.id} /><input type="hidden" name="client_id" value={clientId} />
      <label className="text-xs text-muted">Service<input name="service_type" required maxLength={120} defaultValue={service.service_type} disabled={pending} className={inputClass} /></label>
      <label className="text-xs text-muted">Statut<input name="status" required maxLength={80} defaultValue={service.status} disabled={pending} className={inputClass} /></label>
      <label className="text-xs text-muted">Tarif mensuel (€)<input name="monthly_fee_eur" type="number" min={0} max={1000000} step="0.01" defaultValue={service.monthly_fee_eur ?? ""} disabled={pending} className={inputClass} /></label>
      <label className="text-xs text-muted sm:col-span-2">Notes<textarea name="notes" rows={2} maxLength={3000} defaultValue={service.notes ?? ""} disabled={pending} className={inputClass} /></label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={pending} className="rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-60">{pending ? "Enregistrement…" : "Enregistrer"}</button>
        <span className="text-xs text-muted">En base : {service.monthly_fee_eur === null ? "Tarif non défini" : euroFormatter.format(service.monthly_fee_eur)}</span>
        {state.message && <span role="status" className="text-xs text-muted">{state.message}</span>}
      </div>
    </form>
    <div className="mt-3"><ConfirmDeleteForm action={deleteClientServiceAction} fields={{ id: service.id, client_id: clientId }} buttonText="Retirer" confirmationMessage={`Retirer le service « ${service.service_type} » de ce client ?`} /></div>
  </li>;
}

export function ClientServicesPanel({ clientId, services }: { clientId: string; services: ClientServiceRecord[] }) {
  const [state, action, pending] = useActionState<ClientServiceFormState, FormData>(createClientServiceAction, {});
  return <section className="mt-8 border-t border-border pt-8" aria-labelledby="client-services">
    <h2 id="client-services" className="mb-4 text-lg font-semibold">Services <span className="text-sm font-normal text-muted">({services.length})</span></h2>
    <Panel className="p-5">
      {services.length ? <ul>{services.map((service) => <ServiceEditor key={service.id} clientId={clientId} service={service} />)}</ul> : <p className="mb-5 text-sm text-muted">Aucun service enregistré.</p>}
      <form action={action} className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
        <input type="hidden" name="client_id" value={clientId} />
        <label className="text-xs text-muted">Nouveau service<input name="service_type" required maxLength={120} disabled={pending} className={inputClass} /></label>
        <label className="text-xs text-muted">Statut<input name="status" required maxLength={80} defaultValue="Actif" disabled={pending} className={inputClass} /></label>
        <label className="text-xs text-muted">Tarif mensuel (€)<input name="monthly_fee_eur" type="number" min={0} max={1000000} step="0.01" disabled={pending} className={inputClass} /></label>
        <label className="text-xs text-muted sm:col-span-2">Notes<textarea name="notes" rows={2} maxLength={3000} disabled={pending} className={inputClass} /></label>
        <div className="sm:col-span-2"><button type="submit" disabled={pending} className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-background disabled:opacity-60">{pending ? "Ajout…" : "+ Ajouter un service"}</button>{state.message && <p role="status" className="mt-2 text-sm text-muted">{state.message}</p>}</div>
      </form>
    </Panel>
  </section>;
}