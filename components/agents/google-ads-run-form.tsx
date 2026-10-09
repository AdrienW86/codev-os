"use client";

import { useActionState } from "react";
import Link from "next/link";
import { runGoogleAdsAnalysisAction } from "@/app/(cockpit)/agents/[id]/google-ads-actions";
import type { AdsFormState } from "@/lib/integrations/google-ads/types";

export function GoogleAdsRunForm({ agentId, clients }: { agentId: string; clients: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<AdsFormState, FormData>(runGoogleAdsAnalysisAction, {});
  if (!clients.length) return <p className="mt-4 text-sm text-muted">Assignez et activez un client depuis sa fiche pour lancer une analyse.</p>;
  return <form action={action} className="mt-4 flex flex-wrap items-end gap-3"><input type="hidden" name="agent_id" value={agentId} /><label className="text-xs text-muted">Client assigné<select required name="client_id" disabled={pending} className="mt-2 block rounded-lg border border-border bg-background px-3 py-2 text-foreground">{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><button disabled={pending} className="rounded-lg border border-border px-4 py-2 text-sm">{pending ? "Analyse en cours…" : "Lancer une analyse Google Ads"}</button>{state.message && <div role={state.ok ? "status" : "alert"} className="basis-full text-sm text-muted"><p>{state.message}</p>{state.recommendationId && <Link href={`/recommendations/${state.recommendationId}`} className="mt-2 inline-block text-accent hover:underline">Ouvrir la recommandation →</Link>}</div>}</form>;
}
