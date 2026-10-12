"use client";
import { useActionState } from "react";
import { Action } from "@/components/ui/button";
import { mediaMaintenanceAction, saveMediaProfileAction, type MediaProfileState } from "@/app/(cockpit)/clients/[id]/media-actions";
import { ALWAYS_EXCLUDED, type MediaProfile } from "@/lib/media-intelligence/model";

const initial: MediaProfileState = {};
const field = "mt-1 block w-full rounded-lg border border-border bg-background p-3";

/** Profil média du client : ce que l'analyse IA doit considérer comme pertinent, hors sujet ou confidentiel. */
export function MediaProfileForm({ clientId, profile }: { clientId: string; profile: MediaProfile }) {
  const [state, action, pending] = useActionState(saveMediaProfileAction, initial);
  const area = (name: string, label: string, value: string[], hint: string) => <label className="text-sm">{label}
    <textarea className={field} name={name} rows={4} defaultValue={value.join("\n")} aria-describedby={`${name}-hint`} />
    <span id={`${name}-hint`} className="text-xs text-muted">{hint}</span></label>;
  return <details className="rounded-lg border border-border p-3" open={!profile.saved}>
    <summary className="min-h-10 cursor-pointer font-medium">Profil de la photothèque {profile.saved ? `(version ${profile.version})` : "(à compléter)"}</summary>
    <form action={action} className="mt-3 grid gap-4 lg:grid-cols-2">
      <input type="hidden" name="client_id" value={clientId} />
      <label className="text-sm lg:col-span-2">Activité du client<textarea className={field} name="activity_summary" rows={3} maxLength={2000} defaultValue={profile.activitySummary} placeholder="Ex. couvreur zingueur, rénovation de toitures et charpentes." /></label>
      {area("services", "Prestations confirmées", profile.services, "Une prestation par ligne. Seules ces prestations rendent une photo pertinente.")}
      {area("priority_topics", "Sujets prioritaires", profile.priorityTopics, "Un sujet par ligne, utilisé pour la sélection éditoriale.")}
      {area("accepted_photo_types", "Photos acceptées", profile.acceptedPhotoTypes, "Ex. chantier terminé, avant/après, équipe au travail (de dos).")}
      {area("excluded_photo_types", "Photos exclues", profile.excludedPhotoTypes, `Toujours exclues : ${ALWAYS_EXCLUDED.join(" ; ")}.`)}
      <label className="text-sm lg:col-span-2">Consignes de communication<textarea className={field} name="communication_guidelines" rows={3} maxLength={4000} defaultValue={profile.communicationGuidelines} /></label>
      <fieldset className="space-y-3 text-sm lg:col-span-2">
        <legend className="font-medium">Analyse IA et conservation</legend>
        <label className="flex gap-3"><input type="checkbox" name="ai_classification_enabled" defaultChecked={profile.aiClassificationEnabled} />Analyser automatiquement les nouvelles photos (classement seulement : l’IA ne valide ni ne supprime jamais une photo).</label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label>Budget IA mensuel (€)<input className={field} type="number" name="ai_monthly_budget_eur" min={0} max={50} step={0.5} defaultValue={profile.aiMonthlyBudgetEur} /></label>
          <label>Conservation des rejetés (jours)<input className={field} type="number" name="quarantine_retention_days" min={7} max={365} defaultValue={profile.quarantineRetentionDays} /></label>
          <label>Après conservation<select className={field} name="rejected_deletion_policy" defaultValue={profile.rejectedDeletionPolicy}>
            <option value="keep">Conserver dans Drive</option>
            <option value="trash_drive">Mettre à la corbeille Drive</option>
          </select></label>
        </div>
        <p className="text-xs text-muted">La corbeille ne concerne que les photos rejetées par un humain et importées par l’application ; une photo déposée par vous dans le dossier Drive n’est jamais supprimée.</p>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3 lg:col-span-2">
        <Action type="submit" variant="primary" disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer le profil"}</Action>
        <p role="status" className={`text-sm ${state.ok === false ? "text-danger" : ""}`}>{state.message}</p>
      </div>
    </form>
  </details>;
}

/** Synchronisation du dossier Drive de l'agent et analyse des photos jamais évaluées. */
export function MediaMaintenance({ clientId, profileSaved }: { clientId: string; profileSaved: boolean }) {
  const [state, action, pending] = useActionState(mediaMaintenanceAction, initial);
  return <form action={action} className="flex flex-wrap items-center gap-2">
    <input type="hidden" name="client_id" value={clientId} />
    <Action type="submit" name="intent" value="sync_drive" disabled={pending}>Synchroniser le dossier Drive</Action>
    <Action type="submit" name="intent" value="analyze_new" disabled={pending || !profileSaved} title={profileSaved ? undefined : "Enregistrez d’abord le profil"}>Analyser les nouvelles photos</Action>
    <p role="status" className="text-sm">{pending ? "Traitement…" : state.message}</p>
  </form>;
}
