"use client";

import { useActionState, type FormEvent } from "react";
import type { DeleteFormState, DeleteServerAction } from "@/lib/action-state";

export function ConfirmDeleteForm({ action, fields, confirmationMessage, buttonText = "Supprimer" }: {
  action: DeleteServerAction;
  fields: Record<string, string>;
  confirmationMessage: string;
  buttonText?: string;
}) {
  const [state, formAction, pending] = useActionState<DeleteFormState, FormData>(action, {});

  function confirmSubmit(event: FormEvent<HTMLFormElement>) {
    if (!window.confirm(confirmationMessage)) event.preventDefault();
  }

  return (
    <form action={formAction} onSubmit={confirmSubmit}>
      {Object.entries(fields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <button type="submit" disabled={pending} className="rounded-lg border border-amber-400/40 px-4 py-2.5 text-sm font-medium text-amber-300 disabled:opacity-60">{pending ? "Suppression…" : buttonText}</button>
      {state.message && <p role="alert" className="mt-2 max-w-xs text-xs text-amber-300">{state.message}</p>}
    </form>
  );
}