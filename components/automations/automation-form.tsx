"use client";

import { useState } from "react";
import { MutationForm, type MutationState } from "@/components/ui/mutation-form";

type Option = { value: string; label: string };
const field = "mt-1.5 block min-h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground";
const days = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

/** Création d'une automatisation : les champs dépendent de la fréquence ; toute la validation est refaite côté serveur. */
export function AutomationForm({ action, runTypes, clients }: { action: (state: MutationState, form: FormData) => Promise<MutationState>; runTypes: (Option & { scope: "global" | "client" })[]; clients: Option[] }) {
  const [frequency, setFrequency] = useState("weekly");
  const [runType, setRunType] = useState(runTypes[0]?.value ?? "");
  const needsClient = runTypes.find((item) => item.value === runType)?.scope === "client";
  return (
    <MutationForm action={action} label="Créer l’automatisation" variant="primary" className="grid gap-4 sm:grid-cols-2">
      <label className="text-xs text-muted sm:col-span-2">Nom
        <input name="name" required minLength={2} maxLength={120} placeholder="Ex. Rapports du lundi" className={field} />
      </label>
      <label className="text-xs text-muted">Exécution
        <select name="run_type" value={runType} onChange={(event) => setRunType(event.target.value)} className={field}>
          {runTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <label className="text-xs text-muted">Client {needsClient ? "(requis)" : "(facultatif : tous les clients suivis)"}
        <select name="client_id" required={needsClient} defaultValue="" className={field}>
          <option value="">{needsClient ? "Choisir…" : "Tous les clients suivis"}</option>
          {clients.map((client) => <option key={client.value} value={client.value}>{client.label}</option>)}
        </select>
      </label>
      {runType === "report.generate" && (
        <label className="text-xs text-muted">Rapport
          <select name="kind" defaultValue="weekly" className={field}><option value="weekly">Hebdomadaire</option><option value="monthly">Mensuel</option></select>
        </label>
      )}
      <label className="text-xs text-muted">Fréquence
        <select name="frequency" value={frequency} onChange={(event) => setFrequency(event.target.value)} className={field}>
          <option value="once">Une fois</option><option value="daily">Tous les jours</option><option value="weekly">Chaque semaine</option><option value="monthly">Chaque mois</option>
        </select>
      </label>
      {frequency === "once"
        ? <label className="text-xs text-muted">Date et heure (Europe/Paris)<input type="datetime-local" name="run_at" required className={field} /></label>
        : <label className="text-xs text-muted">Heure (Europe/Paris)<input type="time" name="time" required defaultValue="08:00" className={field} /></label>}
      {frequency === "weekly" && (
        <fieldset className="text-xs text-muted sm:col-span-2">
          <legend>Jours</legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {days.map((day, index) => (
              <label key={day} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm text-foreground">
                <input type="checkbox" name="weekdays" value={index + 1} defaultChecked={index === 0} />{day}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {frequency === "monthly" && <label className="text-xs text-muted">Jour du mois<input type="number" name="month_day" min={1} max={31} defaultValue={1} required className={field} /></label>}
      <input type="hidden" name="timezone" value="Europe/Paris" />
    </MutationForm>
  );
}
