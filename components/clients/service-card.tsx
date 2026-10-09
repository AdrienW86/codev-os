import { AgentStateBadge } from "@/components/agents/capability-list";
import { Icon } from "@/components/ui/icon";
import { serviceStatusLabels } from "@/lib/services/catalog";
import type { ClientServiceView } from "@/lib/services/client-view";

const tones = { neutral: "bg-white/5 text-muted", green: "bg-accent/10 text-accent", amber: "bg-amber-400/10 text-amber-300" };

export function ServiceStatusBadge({ status, preview = false }: { status: ClientServiceView["status"]; preview?: boolean }) {
  const { label, tone } = preview ? { label: "Aperçu", tone: "amber" as const } : serviceStatusLabels[status];
  return <span className={`inline-flex shrink-0 items-center rounded-md px-2 py-1 text-xs font-medium ${tones[tone]}`}>{label}</span>;
}

/** Carte compacte : service → agents associés. Les détails s’ouvrent au clic. */
export function ServiceCard({ service, preview = false, onOpen }: { service: ClientServiceView; preview?: boolean; onOpen: () => void }) {
  return (
    <article className={`flex min-w-0 flex-col rounded-xl border bg-surface p-5 ${preview ? "border-dashed border-amber-300/30" : "border-border"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-accent"><Icon name={service.icon} width={18} height={18} /></span>
          <h3 className="min-w-0 font-semibold">{service.name}</h3>
        </div>
        <ServiceStatusBadge status={service.status} preview={preview} />
      </div>
      <ul className="mt-4 space-y-2" aria-label={`Agents associés à ${service.name}`}>
        {service.agents.map((agent) => (
          <li key={agent.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-3 py-2">
            <span className="flex min-w-0 items-center gap-2 text-sm">
              <Icon name="agents" width={16} height={16} className="shrink-0 text-muted" />
              <span className="truncate">{agent.name}</span>
            </span>
            {agent.includedForAllClients
              ? <span className="text-xs text-muted">Inclus par défaut · <AgentStateBadge state={agent.state} /></span>
              : <AgentStateBadge state={agent.state} />}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted">{service.description}</p>
      <button type="button" onClick={onOpen} className="mt-auto inline-flex min-h-10 items-center gap-1.5 self-start pt-4 text-sm text-accent hover:underline">
        Détails<span className="sr-only"> du service {service.name}</span><Icon name="arrow" width={16} height={16} />
      </button>
    </article>
  );
}
