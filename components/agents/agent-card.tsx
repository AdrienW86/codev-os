import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { Badge, Panel } from "@/components/ui/primitives";
import type { AgentRecord } from "@/lib/agents/types";

const euroFormatter = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

export function AgentCard({ agent }: { agent: AgentRecord }) {
  return (
    <Panel className="flex flex-col p-6">
      <div className="mb-5 flex items-center justify-between">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-white/3 text-accent">
          <Icon name="agents" width={24} height={24} />
        </span>
        <div className="flex gap-2"><Badge tone={agent.status === "Actif" ? "green" : "neutral"}>{agent.status}</Badge><Badge tone={agent.enabled ? "green" : "neutral"}>{agent.enabled ? "Activé" : "Désactivé"}</Badge></div>
      </div>
      <h2 className="text-lg font-semibold"><Link href={`/agents/${agent.id}`} className="hover:text-accent">{agent.name}</Link></h2>
      <p className="mt-2 mb-6 text-sm leading-6 text-muted">{agent.description ?? "Aucune description."}</p>
      <dl className="mt-auto space-y-3 border-t border-border pt-5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Autonomie</dt>
          <dd className="font-medium">{agent.autonomy_level} / 3</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-muted">Modèle</dt>
          <dd className="text-xs leading-5">{agent.model ?? "Non défini"}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-muted">Planning</dt>
          <dd className="text-xs leading-5">{agent.schedule ?? "Non défini"}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-muted">Budget de l’agent / mois</dt>
          <dd className="text-xs leading-5">{agent.max_monthly_budget_eur === null ? "Non défini" : euroFormatter.format(agent.max_monthly_budget_eur)}</dd>
        </div>
      </dl>
      <Link href={`/agents/${agent.id}`} aria-label={`Ouvrir ${agent.name}`} className="mt-5 inline-flex justify-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-accent hover:bg-white/5">Ouvrir</Link>
    </Panel>
  );
}
