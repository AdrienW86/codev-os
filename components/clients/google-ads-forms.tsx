"use client";

import { useActionState } from "react";
import { configureGoogleAdsAction, testGoogleAdsConnectionAction, refreshGoogleAdsAction } from "@/app/(cockpit)/clients/[id]/google-ads-actions";
import type { AdsFormState } from "@/lib/integrations/google-ads/types";

const inputClass = "mt-2 block w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground";
export function GoogleAdsConfigurationForm({ clientId, customerId, managerId }: { clientId: string; customerId?: string; managerId?: string }) {
  const [state, action, pending] = useActionState<AdsFormState, FormData>(configureGoogleAdsAction, {});
  return <details className="mt-5"><summary className="cursor-pointer text-sm font-medium text-accent">Configurer Google Ads</summary><form action={action} className="mt-4 space-y-4">
    <input type="hidden" name="client_id" value={clientId} />
    <p className="text-xs leading-5 text-muted">Associez uniquement les identifiants des comptes. Les credentials sont configurés sur le serveur.</p>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm">Customer ID<input name="customer_id" required pattern="[0-9]{10}|[0-9]{3}-[0-9]{3}-[0-9]{4}" maxLength={12} defaultValue={customerId} disabled={pending} className={inputClass} /></label>
      <label className="text-sm">Manager Customer ID (facultatif)<input name="manager_customer_id" pattern="[0-9]{10}|[0-9]{3}-[0-9]{3}-[0-9]{4}" maxLength={12} defaultValue={managerId} disabled={pending} className={inputClass} /></label>
    </div>
    <button disabled={pending} className="rounded-lg border border-border px-4 py-2 text-sm">{pending ? "Enregistrement…" : "Enregistrer l’association"}</button>
    {state.message && <p role={state.ok ? "status" : "alert"} className="text-sm text-muted">{state.message}</p>}
  </form></details>;
}

export function GoogleAdsCheckForm({ clientId, refresh = false }: { clientId: string; refresh?: boolean }) {
  const [state, action, pending] = useActionState<AdsFormState, FormData>(refresh ? refreshGoogleAdsAction : testGoogleAdsConnectionAction, {});
  return <form action={action} className="mt-4 space-y-3"><input type="hidden" name="client_id" value={clientId} /><button disabled={pending} className="rounded-lg border border-border px-4 py-2 text-sm">{pending ? "Vérification…" : refresh ? "Actualiser" : "Tester la connexion"}</button>{state.message && <p role={state.ok ? "status" : "alert"} className="text-sm text-muted">{state.message}</p>}</form>;
}
