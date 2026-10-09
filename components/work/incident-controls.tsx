"use client";

import { MutationForm } from "@/components/ui/mutation-form";
import { investigateIncidentAction, resolveIncidentAction } from "@/app/(cockpit)/work/actions";

export function IncidentControls({ id, section }: { id: string; section: string }) {
  if (section === "done") return null;
  return (
    <div className="flex flex-wrap gap-2">
      {section === "todo" && <MutationForm action={investigateIncidentAction} fields={{ id }} label="Prendre en charge" disableOnSuccess />}
      <MutationForm action={resolveIncidentAction} fields={{ id }} label="Marquer comme résolu" variant="primary" disableOnSuccess confirm="Marquer cet incident comme résolu ? Il sera rouvert automatiquement si le problème est de nouveau détecté." />
    </div>
  );
}
