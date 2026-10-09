"use client";

import { useActionState, type FormEvent, type ReactNode } from "react";
import { actionClass, type ActionVariant } from "@/components/ui/button";
import { flash } from "@/components/ui/flash";

export type MutationState = { ok?: boolean; message?: string };
type MutationAction = (state: MutationState, form: FormData) => Promise<MutationState>;

/** Formulaire générique branché sur une Server Action ; confirmation facultative, retour accessible. */
export function MutationForm({ action, fields = {}, label, pendingLabel = "Enregistrement…", variant = "secondary", confirm, children, className = "", disableOnSuccess = false, disabled = false, flashOnSuccess = false }: {
  action: MutationAction; fields?: Record<string, string>; label: string; pendingLabel?: string; variant?: ActionVariant;
  confirm?: string; children?: ReactNode; className?: string; disableOnSuccess?: boolean; disabled?: boolean;
  /** L'élément disparaît après succès : confirmation reprise dans la zone persistante de la page. */
  flashOnSuccess?: boolean;
}) {
  const [state, submit, pending] = useActionState<MutationState, FormData>(async (previous, form) => {
    const result = await action(previous, form);
    if (flashOnSuccess && result.ok && result.message) flash(result.message);
    return result;
  }, {});
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (confirm && !window.confirm(confirm)) event.preventDefault();
  }
  return (
    <form action={submit} onSubmit={onSubmit} className={className}>
      {Object.entries(fields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      {children}
      <button type="submit" disabled={disabled || pending || (disableOnSuccess && state.ok === true)} className={actionClass(variant)}>{pending ? pendingLabel : label}</button>
      {state.message && <p role="status" className={`mt-2 text-sm ${state.ok ? "text-accent" : "text-amber-300"}`}>{state.message}</p>}
    </form>
  );
}
