"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createAgentTestRunAction } from "@/app/(cockpit)/agents/[id]/actions";
import type { AgentTestRunState } from "@/lib/agents/types";

export function AgentTestRunForm({ agentId, clients }: { agentId: string; clients: Array<{ id: string; name: string }> }) {
  const [state, action, pending] = useActionState<AgentTestRunState, FormData>(createAgentTestRunAction, {});
  if (!clients.length) return <p className="mt-3 text-sm text-muted">Aucune assignation client activée pour cet agent.</p>;
  return <form id="agent-test-run-form" action={action} className="mt-4 flex flex-wrap items-end gap-3">
    <input type="hidden" name="agent_id" value={agentId} />
    <label className="text-xs text-muted">Client assigné<select name="client_id" required defaultValue={clients[0].id} disabled={pending} className="mt-2 block min-w-52 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground">{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
    <button type="submit" disabled={pending} className="rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-background disabled:opacity-60">{pending ? "Lancement du run…" : "Lancer le run de test interne"}</button>
    {state.message && <div role="status" className="basis-full text-sm text-muted"><p>{state.message}</p>{state.recommendationId && <Link href={`/recommendations/${state.recommendationId}`} className="mt-2 inline-block font-medium text-accent hover:underline">Ouvrir la recommandation créée →</Link>}</div>}
  </form>;
}