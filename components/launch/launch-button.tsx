"use client";

import Link from "next/link";
import { useActionState, type FormEvent } from "react";
import { actionClass } from "@/components/ui/button";
import { launchTaskAction, type LaunchState } from "@/app/(cockpit)/lancer/actions";

/** Bouton « Lancer maintenant » d'une tâche d'agent ; le résultat s'affiche sur place, avec un lien vers le détail. */
export function LaunchButton({ task, clientId, label = "Lancer maintenant", confirm, compact = false }: { task: string; clientId: string | null; label?: string; confirm?: string; compact?: boolean }) {
  const [state, submit, pending] = useActionState<LaunchState, FormData>(launchTaskAction, {});
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (confirm && !window.confirm(confirm)) event.preventDefault();
  }
  return (
    <form action={submit} onSubmit={onSubmit} data-launch-task={task}>
      <input type="hidden" name="task" value={task} />
      {clientId && <input type="hidden" name="client" value={clientId} />}
      <button type="submit" disabled={pending} className={actionClass(compact ? "secondary" : "primary")}>{pending ? "En cours…" : label}</button>
      {state.message && (
        <p role="status" className={`mt-2 text-sm ${state.ok ? "text-success" : "text-warning"}`}>
          {state.message}{state.href && <> <Link href={state.href} className="text-accent hover:underline">Voir</Link></>}
        </p>
      )}
    </form>
  );
}
