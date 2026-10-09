"use client";

import { useActionState } from "react";
import { createInternalTestActionAction, createRecommendationMessageAction, updateRecommendationAction } from "@/app/(cockpit)/recommendations/[id]/actions";
import type { RecommendationActionState, RecommendationStatus } from "@/lib/recommendations/types";

function StatusButton({ id, status, label }: { id: string; status: RecommendationStatus; label: string }) {
  const [state, action, pending] = useActionState<RecommendationActionState, FormData>(updateRecommendationAction, {});
  return <form action={action}>
    <input type="hidden" name="id" value={id} /><input type="hidden" name="status" value={status} />
    <button type="submit" disabled={pending} className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium disabled:opacity-60">{pending ? "Mise à jour…" : label}</button>
    {state.message && <p role="status" className="mt-2 text-xs text-muted">{state.message}</p>}
  </form>;
}

export function RecommendationControls({ id, status }: { id: string; status: string }) {
  const [messageState, messageAction, messagePending] = useActionState<RecommendationActionState, FormData>(createRecommendationMessageAction, {});
  const [actionState, createAction, actionPending] = useActionState<RecommendationActionState, FormData>(createInternalTestActionAction, {});
  const nextStatuses: RecommendationStatus[] = status === "pending" ? ["accepted", "rejected", "archived"] : status === "accepted" || status === "rejected" ? ["archived"] : [];
  const labels: Record<RecommendationStatus, string> = { pending: "En attente", accepted: "Accepter", rejected: "Rejeter", archived: "Archiver" };
  return <div className="space-y-6">
    <div className="flex flex-wrap gap-2">{nextStatuses.map((nextStatus) => <StatusButton key={nextStatus} id={id} status={nextStatus} label={labels[nextStatus]} />)}</div>
    <form action={createAction} className="border-t border-border pt-5">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={actionPending} className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-background disabled:opacity-60">{actionPending ? "Création…" : "Proposer une action de test"}</button>
      {actionState.message && <p role="status" className="mt-2 text-sm text-muted">{actionState.message}</p>}
    </form>
    <form action={messageAction} className="border-t border-border pt-5">
      <input type="hidden" name="id" value={id} />
      <label htmlFor="admin-message" className="text-sm font-medium">Message admin</label>
      <textarea id="admin-message" name="message" required maxLength={5000} rows={3} className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm" />
      <button type="submit" disabled={messagePending} className="mt-3 rounded-lg border border-border px-4 py-2.5 text-sm font-medium disabled:opacity-60">{messagePending ? "Envoi…" : "Ajouter un message"}</button>
      {messageState.message && <p role="status" className="mt-2 text-sm text-muted">{messageState.message}</p>}
    </form>
  </div>;
}