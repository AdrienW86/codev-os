"use client";

import { useState } from "react";
import { MutationForm, type MutationState } from "@/components/ui/mutation-form";

const field = "mt-1.5 block min-h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground";

export function AgendaForm({ action, clients, defaultDate }: { action: (state: MutationState, form: FormData) => Promise<MutationState>; clients: { value: string; label: string }[]; defaultDate: string }) {
  const [recurrence, setRecurrence] = useState("none");
  return (
    <MutationForm action={action} label="Ajouter" variant="primary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="text-xs text-muted sm:col-span-2">Titre<input name="title" required maxLength={200} className={field} placeholder="Ex. Point mensuel avec Jrenov" /></label>
      <label className="text-xs text-muted">Type
        <select name="kind" defaultValue="meeting" className={field}>
          <option value="meeting">Rendez-vous</option><option value="event">Événement</option><option value="work_block">Créneau de travail</option><option value="check">Contrôle</option>
        </select>
      </label>
      <label className="text-xs text-muted">Date<input type="date" name="date" required defaultValue={defaultDate} className={field} /></label>
      <label className="text-xs text-muted">Heure (Paris)<input type="time" name="time" required defaultValue="09:00" className={field} /></label>
      <label className="text-xs text-muted">Durée (minutes)<input type="number" name="duration" min={5} max={1440} step={5} defaultValue={60} className={field} /></label>
      <label className="text-xs text-muted">Client (facultatif)
        <select name="client_id" defaultValue="" className={field}><option value="">Aucun</option>{clients.map((client) => <option key={client.value} value={client.value}>{client.label}</option>)}</select>
      </label>
      <label className="text-xs text-muted">Récurrence
        <select name="recurrence" value={recurrence} onChange={(event) => setRecurrence(event.target.value)} className={field}>
          <option value="none">Aucune</option><option value="daily">Tous les jours</option><option value="weekly">Chaque semaine</option><option value="monthly">Chaque mois</option>
        </select>
      </label>
      {recurrence !== "none" && <label className="text-xs text-muted">Jusqu’au (facultatif)<input type="date" name="recurrence_until" className={field} /></label>}
      <label className="text-xs text-muted">Priorité
        <select name="priority" defaultValue="normal" className={field}><option value="low">Basse</option><option value="normal">Normale</option><option value="high">Haute</option></select>
      </label>
      <label className="text-xs text-muted sm:col-span-2 lg:col-span-3">Notes<textarea name="notes" maxLength={4000} rows={2} className="mt-1.5 block w-full rounded-lg border border-border bg-background p-3 text-sm text-foreground" /></label>
    </MutationForm>
  );
}
