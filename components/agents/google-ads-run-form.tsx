"use client";

import { useActionState } from "react";
import Link from "next/link";
import { runGoogleAdsAnalysisAction } from "@/app/(cockpit)/agents/[id]/google-ads-actions";
import { PERIOD_PRESETS, presetLabels } from "@/lib/integrations/google-ads/periods";
import type { AdsFormState } from "@/lib/integrations/google-ads/types";

const presets = PERIOD_PRESETS.filter((preset) => preset !== "day" && preset !== "custom");
const select = "mt-2 block rounded-lg border border-border bg-background px-3 py-2 text-foreground";

/** Analyse réelle (données Google Ads, règles déterministes) : période choisie, campagnes actuellement actives. */
export function GoogleAdsRunForm({ agentId, clients }: { agentId: string; clients: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<AdsFormState, FormData>(runGoogleAdsAnalysisAction, {});
  if (!clients.length) return <p className="mt-4 text-sm text-muted">Assignez et activez un client depuis sa fiche pour lancer une analyse.</p>;
  return <form action={action} className="mt-4 flex flex-wrap items-end gap-3"><input type="hidden" name="agent_id" value={agentId} />
    <label className="text-xs text-muted">Client assigné<select required name="client_id" disabled={pending} className={select}>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
    <label className="text-xs text-muted">Période<select name="period" defaultValue="last_30" disabled={pending} className={select}>{presets.map((preset) => <option key={preset} value={preset}>{presetLabels[preset]}</option>)}</select></label>
    <button disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-background disabled:opacity-60">{pending ? "Analyse en cours…" : "Lancer l’analyse réelle"}</button>
    <p className="basis-full text-xs text-muted">Campagnes actuellement actives. Pour choisir des campagnes précises, utilisez l’onglet Campagnes de la fiche client.</p>
    {state.message && <div role={state.ok ? "status" : "alert"} className="basis-full text-sm text-muted"><p>{state.message}</p>{state.recommendationId && <Link href={`/recommendations/${state.recommendationId}`} className="mt-2 inline-block text-accent hover:underline">Ouvrir la recommandation →</Link>}</div>}
  </form>;
}
