"use client";

import { useActionState } from "react";
import { actionClass } from "@/components/ui/button";
import { saveCompetitorWatchAction, type WatchSettingsState } from "@/app/(cockpit)/analytics/competitor-watch-actions";

/** Veille active et concurrents à suivre (« Nom | site », 5 au plus) ; sans saisie, les premiers de Google Maps. */
export function CompetitorWatchSettingsForm({ clientId, enabled, competitors }: { clientId: string; enabled: boolean; competitors: string }) {
  const [state, submit, pending] = useActionState<WatchSettingsState, FormData>(saveCompetitorWatchAction, {});
  return (
    <form action={submit} className="space-y-4">
      <input type="hidden" name="client" value={clientId} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={enabled} className="h-4 w-4" />
        Veille mensuelle active pour ce client
      </label>
      <label className="block text-sm">
        <span className="font-medium">Concurrents à suivre</span>
        <span className="block text-xs text-muted">Un par ligne, au format « Nom | site » (site facultatif), 5 au plus. Laissez vide pour suivre les premiers concurrents relevés sur Google Maps.</span>
        <textarea name="competitors" defaultValue={competitors} rows={5} maxLength={1200} placeholder={"Toiture Pro 66 | toiturepro66.fr\nCouvreur Martin"}
          className="mt-2 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" />
      </label>
      <button type="submit" disabled={pending} className={actionClass("secondary")}>{pending ? "Enregistrement…" : "Enregistrer"}</button>
      {state.message && <p role="status" className={`text-sm ${state.ok ? "text-success" : "text-warning"}`}>{state.message}</p>}
    </form>
  );
}
