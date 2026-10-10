"use client";

import { useActionState, type FormEvent } from "react";
import { approveActionAction, cancelActionAction, completeManualActionAction, executeActionAction, rejectActionAction } from "@/app/(cockpit)/actions/actions";
import type { InternalActionRecord } from "@/lib/actions/types";
import type { RecommendationActionState } from "@/lib/recommendations/types";
import { executionModeOf } from "@/lib/actions/modes";
import { flash } from "@/components/ui/flash";

type Server = (state: RecommendationActionState, form: FormData) => Promise<RecommendationActionState>;

function Control({ id, action, label, pendingLabel, className, confirm }: { id: string; action: Server; label: string; pendingLabel: string; className: string; confirm?: string }) {
  // Le bouton disparaît après une transition réussie : la confirmation est aussi affichée dans la zone persistante.
  const [state, submit, pending] = useActionState<RecommendationActionState, FormData>(async (previous, form) => {
    const result = await action(previous, form);
    if (result.message) flash(result.message);
    return result;
  }, {});
  function onSubmit(event: FormEvent<HTMLFormElement>) { if (confirm && !window.confirm(confirm)) event.preventDefault(); }
  return (
    <form action={submit} onSubmit={onSubmit} className="contents">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className={className}>{pending ? pendingLabel : label}</button>
      {state.message && <span role="status" className="basis-full text-xs text-muted">{state.message}</span>}
    </form>
  );
}

const primary = "min-h-10 rounded-lg bg-accent px-3 text-xs font-semibold text-background disabled:opacity-60";
const secondary = "min-h-10 rounded-lg border border-border px-3 text-xs font-medium disabled:opacity-60";
const accent = "min-h-10 rounded-lg border border-accent/40 px-3 text-xs font-medium text-accent disabled:opacity-60";

export function ActionControls({ action: item }: { action: InternalActionRecord }) {
  const mode = executionModeOf(item.action_type);
  const pendingApproval = item.status === "pending_approval" && item.requires_approval;
  const canCancel = item.status === "draft" || item.status === "pending_approval";
  const approved = item.status === "approved" && item.requires_approval;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {pendingApproval && <Control id={item.id} action={approveActionAction} label="Approuver" pendingLabel="Approbation…" className={primary} confirm="Approuver cette action ? Son contenu sera figé : toute modification ultérieure exigera une nouvelle validation." />}
      {pendingApproval && <Control id={item.id} action={rejectActionAction} label="Refuser" pendingLabel="Refus…" className={secondary} />}
      {canCancel && <Control id={item.id} action={cancelActionAction} label="Annuler" pendingLabel="Annulation…" className={secondary} />}
      {approved && mode === "internal" && <Control id={item.id} action={executeActionAction} label="Exécuter" pendingLabel="Exécution…" className={accent} confirm="Exécuter cette action interne ? Aucun service externe ne sera appelé." />}
      {approved && mode === "manual" && <Control id={item.id} action={completeManualActionAction} label="Marquer comme réalisée" pendingLabel="Enregistrement…" className={accent} confirm="Confirmez-vous avoir réalisé cette action vous-même, exactement telle qu’approuvée ?" />}
      {approved && mode === "manual" && <p className="basis-full text-xs text-muted">Action externe : CODE-V OS ne l’exécute pas. Réalisez-la vous-même, puis confirmez.</p>}
    </div>
  );
}
