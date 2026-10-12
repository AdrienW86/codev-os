"use client";

import { changeStatusAction } from "@/app/(cockpit)/agents/[id]/opportunities/actions";
import { MutationForm } from "@/components/ui/mutation-form";
import type { OpportunityStatus } from "@/lib/supabase/seo-opportunities.types";

const verbs: Record<OpportunityStatus, string> = {
  detected: "Remettre en détectée",
  to_review: "Passer à examiner",
  approved: "Approuver",
  in_progress: "Marquer en cours",
  done: "Marquer réalisée",
  dismissed: "Écarter",
};

/** Décisions possibles depuis le statut courant ; écarter exige une explication, conservée dans l'historique. */
export function OpportunityDecision({ id, status, next }: { id: string; status: OpportunityStatus; next: OpportunityStatus[] }) {
  if (!next.length) return <p className="text-sm text-muted">Aucune décision disponible depuis ce statut.</p>;
  const reopening = status === "done" || status === "dismissed";
  return (
    <div className="space-y-4">
      {next.map((target) => {
        const needsReason = target === "dismissed";
        return (
          <MutationForm key={target} action={changeStatusAction} fields={{ id, status: target }} label={reopening && target === "to_review" ? "Rouvrir l’examen" : verbs[target]} variant={target === "approved" ? "primary" : "secondary"} disableOnSuccess flashOnSuccess className="space-y-2">
            {(needsReason || reopening) && (
              <label className="block text-xs text-muted">
                {needsReason ? "Raison (obligatoire)" : "Raison de la réouverture (facultatif)"}
                <textarea name="reason" required={needsReason} minLength={needsReason ? 5 : undefined} maxLength={2000} rows={2} className="mt-1 block w-full py-2" />
              </label>
            )}
          </MutationForm>
        );
      })}
    </div>
  );
}
