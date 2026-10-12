"use client";

import { useActionState } from "react";
import { confirmAgentProposalAction } from "@/app/(cockpit)/recommendations/[id]/actions";
import { actionClass } from "@/components/ui/button";
import type { RecommendationActionState } from "@/lib/recommendations/types";

/** Confirmation explicite d'une proposition de l'agent (écarter l'opportunité) : rien n'est fait sans ce clic. */
export function AgentProposalButton({ recommendationId, messageId }: { recommendationId: string; messageId: string }) {
  const [state, action, pending] = useActionState<RecommendationActionState, FormData>(confirmAgentProposalAction, {});
  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="id" value={recommendationId} />
      <input type="hidden" name="message_id" value={messageId} />
      <button type="submit" disabled={pending} className={actionClass("secondary")}>{pending ? "Enregistrement…" : "Confirmer : écarter l’opportunité"}</button>
      {state.message && <p role="status" className="mt-2 text-xs text-muted">{state.message}</p>}
    </form>
  );
}
