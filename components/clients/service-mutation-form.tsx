"use client";

import { useActionState } from "react";
import { activateServiceAction, deactivateServiceAction, type ServiceActionState } from "@/app/(cockpit)/clients/[id]/service-actions";
import { actionClass } from "@/components/ui/button";

/** Activation / désactivation réelle d’un service (Server Action, simulation refusée côté serveur). */
export function ServiceMutationForm({ clientId, serviceKey, mode }: { clientId: string; serviceKey: string; mode: "activate" | "deactivate" }) {
  const [state, action, pending] = useActionState<ServiceActionState, FormData>(mode === "activate" ? activateServiceAction : deactivateServiceAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="service_key" value={serviceKey} />
      <button type="submit" disabled={pending || state.ok === true} className={actionClass(mode === "activate" ? "primary" : "danger")}>
        {pending ? "Enregistrement…" : mode === "activate" ? "Activer ce service" : "Désactiver ce service"}
      </button>
      {state.message && <p role="status" className={`text-sm ${state.ok ? "text-accent" : "text-amber-300"}`}>{state.message}</p>}
    </form>
  );
}
