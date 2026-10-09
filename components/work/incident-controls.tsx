"use client";

import { MutationForm } from "@/components/ui/mutation-form";
import { investigateIncidentAction, resolveIncidentAction } from "@/app/(cockpit)/work/actions";

export function IncidentControls({ id, section }: { id: string; section: string }) {
  if (section === "done") return null;
  return (
    <div className="flex flex-wrap gap-2">
      {section === "todo" && <MutationForm action={investigateIncidentAction} fields={{ id }} label="Prendre en charge" disableOnSuccess flashOnSuccess />}
      <MutationForm action={resolveIncidentAction} fields={{ id }} label="Marquer comme résolu" variant="primary" disableOnSuccess flashOnSuccess confirm="Marquer cet incident comme résolu ? Un nouvel incident sera ouvert si le problème est de nouveau détecté." />
    </div>
  );
}
