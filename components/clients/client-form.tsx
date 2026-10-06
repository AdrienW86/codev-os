"use client";

import { useActionState } from "react";
import { createClientAction } from "@/app/(cockpit)/clients/new/actions";
import { updateClientAction } from "@/app/(cockpit)/clients/[id]/actions";
import { clientFieldLimits } from "@/lib/clients/validation";
import type { Client, ClientField, ClientFormState } from "@/lib/clients/types";

const fields: { name: ClientField; label: string; type?: string; autoComplete?: string }[] = [
  { name: "name", label: "Nom", autoComplete: "name" },
  { name: "company_name", label: "Entreprise", autoComplete: "organization" },
  { name: "activity", label: "Activité" },
  { name: "email", label: "Email", type: "email", autoComplete: "email" },
  { name: "phone", label: "Téléphone", type: "tel", autoComplete: "tel" },
  { name: "website", label: "Site web", type: "url", autoComplete: "url" },
  { name: "geographic_area", label: "Zone géographique" },
  { name: "notes", label: "Notes" },
];

export function ClientForm({ client }: { client?: Client }) {
  const selectedAction = client ? updateClientAction : createClientAction;
  const [state, action, pending] = useActionState<ClientFormState, FormData>(selectedAction, {});
  const inputClass = "mt-2 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm disabled:opacity-60";
  return (
    <form action={action} className="space-y-6">
      {client && <input type="hidden" name="id" value={client.id} />}
      <p className="text-xs text-muted">Seul le nom est obligatoire. Les autres champs sont facultatifs.</p>
      <div className="grid gap-5 sm:grid-cols-2">
        {fields.map(({ name, label, type = "text", autoComplete }) => (
          <div key={name} className={name === "notes" ? "sm:col-span-2" : ""}>
            <label htmlFor={name} className="text-sm font-medium">{label}{name === "name" ? " *" : ""}</label>
            {name === "notes" ? <textarea id={name} name={name} rows={4} defaultValue={state.values?.[name] ?? client?.[name] ?? ""} maxLength={clientFieldLimits[name]} disabled={pending} aria-invalid={Boolean(state.errors?.[name])} aria-describedby={state.errors?.[name] ? `${name}-error` : undefined} className={inputClass} /> :
              <input id={name} name={name} type={type} autoComplete={autoComplete} defaultValue={state.values?.[name] ?? client?.[name] ?? ""} required={name === "name"} maxLength={clientFieldLimits[name]} placeholder={name === "website" ? "https://…" : undefined} disabled={pending} aria-invalid={Boolean(state.errors?.[name])} aria-describedby={state.errors?.[name] ? `${name}-error` : undefined} className={inputClass} />}
            {state.errors?.[name] && <p id={`${name}-error`} className="mt-2 text-xs text-amber-300">{state.errors[name]}</p>}
          </div>
        ))}
      </div>
      {state.message && <p role="alert" className="text-sm text-amber-300">{state.message}</p>}
      <button type="submit" disabled={pending} className="rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-background disabled:cursor-wait disabled:opacity-60">{pending ? "Enregistrement en cours…" : client ? "Enregistrer les modifications" : "Créer le client"}</button>
    </form>
  );
}
