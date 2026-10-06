"use client";

import Link from "next/link";
import { useActionState } from "react";
import { assignAgentAction, removeAgentFromClientAction, updateAgentClientAssignmentAction } from "@/app/(cockpit)/clients/[id]/actions";
import { Badge, Panel } from "@/components/ui/primitives";
import type { AgentAssignmentFormState, AgentAssignmentSummary, AgentSummary } from "@/lib/agents/types";

const inputClass = "mt-2 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm disabled:opacity-60";

function AssignmentEditor({ clientId, assignment }: { clientId: string; assignment: AgentAssignmentSummary }) {
  const [state, action, pending] = useActionState<AgentAssignmentFormState, FormData>(updateAgentClientAssignmentAction, {});
  const [removeState, removeAction, removing] = useActionState<AgentAssignmentFormState, FormData>(removeAgentFromClientAction, {});
  const agent = assignment.agent;
  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">{agent?.name ?? "Agent indisponible"}</h3>
          {agent && <p className="mt-2 text-xs text-muted">Portée {agent.agent_scope === "project" ? "projet / spécialiste" : "client"}{agent.scope_review_required ? " · à vérifier" : ""} · <Link href={`/agents/${agent.id}`} className="text-accent">Autorisations</Link></p>}
          {agent && <p className="mt-1 text-xs text-muted">{agent.status} · Autonomie {agent.autonomy_level} / 3</p>}
        </div>
        <Badge tone={assignment.enabled ? "green" : "neutral"}>{assignment.enabled ? "Activé pour ce client" : "Désactivé pour ce client"}</Badge>
      </div>
      {agent && <p className="mt-3 text-xs text-muted">État global : {agent.enabled ? "activé" : "désactivé"}</p>}
      <form action={action} className="mt-4 space-y-4">
        <input type="hidden" name="agent_id" value={assignment.agent_id} />
        <input type="hidden" name="client_id" value={clientId} />
        <label className="flex items-center gap-3 text-sm font-medium">
          <input type="checkbox" name="enabled" value="true" defaultChecked={assignment.enabled} disabled={pending} className="h-4 w-4 accent-[var(--color-accent)]" />
          Activation pour ce client
        </label>
        <div>
          <label htmlFor={`instructions-${assignment.agent_id}`} className="text-sm font-medium">Instructions propres au client</label>
          <textarea id={`instructions-${assignment.agent_id}`} name="client_instructions" rows={3} maxLength={3000} defaultValue={assignment.client_instructions ?? ""} disabled={pending} className={inputClass} />
        </div>
        {state.message && <p role="status" className="text-sm text-muted">{state.message}</p>}
        <button type="submit" disabled={pending} className="rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-60">{pending ? "Enregistrement…" : "Enregistrer"}</button>
      </form>
      <form action={removeAction} className="mt-3">
        <input type="hidden" name="agent_id" value={assignment.agent_id} />
        <input type="hidden" name="client_id" value={clientId} />
        {removeState.message && <p role="status" className="mb-2 text-sm text-muted">{removeState.message}</p>}
        <button type="submit" disabled={removing} className="text-sm text-amber-300 underline-offset-4 hover:underline disabled:opacity-60">{removing ? "Retrait…" : "Retirer l’assignation"}</button>
      </form>
    </Panel>
  );
}

export function ClientAgentAssignments({ clientId, agents, assignments }: { clientId: string; agents: AgentSummary[]; assignments: AgentAssignmentSummary[] }) {
  const [state, action, pending] = useActionState<AgentAssignmentFormState, FormData>(assignAgentAction, {});
  const assignedIds = new Set(assignments.map((assignment) => assignment.agent_id));
  const availableAgents = agents.filter((agent) => !assignedIds.has(agent.id));

  return (
    <section className="mt-8 border-t border-border pt-8" aria-labelledby="client-agent-assignments">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div><h2 id="client-agent-assignments" className="text-lg font-semibold">Agents assignés <span className="text-sm font-normal text-muted">({assignments.length})</span></h2><p className="mt-2 text-xs text-muted">Les assignations n’activent aucune exécution externe.</p></div>
      </div>
      {assignments.length ? <div className="grid gap-4 md:grid-cols-2">{assignments.map((assignment) => <AssignmentEditor key={assignment.agent_id} clientId={clientId} assignment={assignment} />)}</div> : <p className="mb-5 text-sm text-muted">Aucun agent n’est assigné à ce client.</p>}
      <div className="mt-6 max-w-2xl">
        {availableAgents.length ? <form action={action} className="grid gap-4 sm:grid-cols-[minmax(12rem,0.8fr)_minmax(16rem,1.2fr)_auto] sm:items-end">
          <input type="hidden" name="client_id" value={clientId} />
          <div><label htmlFor="agent_id" className="text-sm font-medium">Nouvelle assignation</label><select id="agent_id" name="agent_id" required defaultValue="" disabled={pending} className={inputClass}><option value="" disabled>Sélectionner un agent</option>{availableAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}{agent.enabled ? "" : " (désactivé)"}</option>)}</select></div>
          <div><label htmlFor="new-client-instructions" className="text-sm font-medium">Instructions client</label><input id="new-client-instructions" name="client_instructions" maxLength={3000} disabled={pending} className={inputClass} /></div>
          <button type="submit" disabled={pending} className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-background disabled:opacity-60">{pending ? "Assignation…" : "+ Assigner"}</button>
        </form> : agents.length ? <p className="text-sm text-muted">Tous les agents existants sont déjà assignés.</p> : <p className="text-sm text-muted">Créez un agent avant de l’assigner à ce client. <Link href="/agents/new" className="text-accent hover:underline">Nouvel agent</Link></p>}
        {state.message && <p role="status" className="mt-3 text-sm text-muted">{state.message}</p>}
      </div>
    </section>
  );
}
