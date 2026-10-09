"use client";

import { useActionState, type FormEvent } from "react";
import { approveActionAction, cancelActionAction, executeActionAction } from "@/app/(cockpit)/actions/actions";
import type { InternalActionRecord } from "@/lib/actions/types";
import type { RecommendationActionState } from "@/lib/recommendations/types";

export function ActionControls({ action: item }: { action: InternalActionRecord }) {
  const [approveState, approve, approving] = useActionState<RecommendationActionState, FormData>(approveActionAction, {});
  const [cancelState, cancel, cancelling] = useActionState<RecommendationActionState, FormData>(cancelActionAction, {});
  const [executeState, execute, executing] = useActionState<RecommendationActionState, FormData>(executeActionAction, {});
  const canApprove = item.status === "pending_approval" && item.requires_approval;
  const canCancel = item.status === "draft" || item.status === "pending_approval";
  const canExecute = item.status === "approved" && item.requires_approval && item.action_type === "internal.test";

  function confirmExecution(event: FormEvent<HTMLFormElement>) {
    if (!window.confirm("Exécuter cette simulation interne ? Aucun service externe ne sera appelé.")) event.preventDefault();
  }

  return <div className="flex flex-wrap items-center gap-2">
    {canApprove && <form action={approve}><input type="hidden" name="id" value={item.id} /><button type="submit" disabled={approving} className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-background disabled:opacity-60">{approving ? "Approbation…" : "Approuver"}</button></form>}
    {canCancel && <form action={cancel}><input type="hidden" name="id" value={item.id} /><button type="submit" disabled={cancelling} className="rounded-lg border border-border px-3 py-2 text-xs font-medium disabled:opacity-60">{cancelling ? "Annulation…" : "Annuler"}</button></form>}
    {canExecute && <form action={execute} onSubmit={confirmExecution}><input type="hidden" name="id" value={item.id} /><button type="submit" disabled={executing} className="rounded-lg border border-accent/40 px-3 py-2 text-xs font-medium text-accent disabled:opacity-60">{executing ? "Exécution…" : "Exécuter"}</button></form>}
    {(approveState.message || cancelState.message || executeState.message) && <span role="status" className="text-xs text-muted">{approveState.message || cancelState.message || executeState.message}</span>}
  </div>;
}