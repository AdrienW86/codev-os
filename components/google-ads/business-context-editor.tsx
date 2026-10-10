"use client";
import { useRef, useState, type FormEvent } from "react";
import { businessLabels, EMPTY_ADS_CONTEXT } from "@/lib/integrations/google-ads/business-context";
import type { BusinessContextResult } from "@/lib/integrations/google-ads/context-service";
import { saveAdsContextAction } from "@/app/(cockpit)/advertising/actions";

const field = "mt-2 block min-h-11 w-full rounded-lg border border-border bg-background p-3 text-sm";
export function AdsBusinessContextEditor({ clientId, initial }: { clientId: string; initial: BusinessContextResult }) {
  const [revision, setRevision] = useState(initial.revision), [message, setMessage] = useState(""), [pending, setPending] = useState(false);
  const busy = useRef(false);
  const context = initial.context ?? EMPTY_ADS_CONTEXT;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const form = new FormData(event.currentTarget);
    const input: Record<string, unknown> = Object.fromEntries(Object.keys(businessLabels).map((key) => [key, String(form.get(key) ?? "")]));
    for (const key of ["advertisingMonthlyBudget", "targetCostPerLead"] as const) input[key] = form.get(key) === "" ? null : Number(form.get(key));
    input.currency = String(form.get("currency"));
    busy.current = true; setPending(true);
    try { const result = await saveAdsContextAction(clientId, input, revision); setMessage(result.message); if (result.ok) setRevision((value) => value + 1); }
    catch { setMessage("Contexte non enregistré. Rechargez la page."); }
    finally { busy.current = false; setPending(false); }
  }
  return <details className="mb-6 rounded-xl border border-border bg-surface p-4">
    <summary className="min-h-10 cursor-pointer font-medium">Contexte commercial du client</summary>
    {!initial.available ? <p className="mt-3 text-sm text-amber-200">Contexte indisponible : migration 20261018000000 requise.</p> : <form onSubmit={submit} className="mt-4 space-y-4">
      <p className="text-sm text-muted">Ces informations guident l’analyse IA. Le budget publicitaire est distinct du budget de fonctionnement de l’agent.</p>
      <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
        {(Object.entries(businessLabels) as [keyof typeof businessLabels, string][]).map(([name, label]) => <label key={name} className="text-sm">{label}<textarea name={name} rows={3} maxLength={800} defaultValue={context[name]} className={field} /></label>)}
        <label className="text-sm">Budget publicitaire mensuel<input name="advertisingMonthlyBudget" type="number" step="0.01" min="0" max="1000000" defaultValue={context.advertisingMonthlyBudget ?? ""} className={field} /></label>
        <label className="text-sm">Coût par prospect cible<input name="targetCostPerLead" type="number" step="0.01" min="0" max="1000000" defaultValue={context.targetCostPerLead ?? ""} className={field} /></label>
        <label className="text-sm">Devise des budgets (code ISO)<input name="currency" required pattern="[A-Z]{3}" maxLength={3} defaultValue={context.currency} className={field} /></label>
      </fieldset>
      <button disabled={pending} className="min-h-11 rounded-lg border border-border px-4 text-sm">{pending ? "Enregistrement…" : "Enregistrer le contexte commercial"}</button>
      {message && <p role="status" className="text-sm">{message}</p>}
    </form>}
  </details>;
}
