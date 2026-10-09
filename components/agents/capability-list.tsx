import { agentStateLabels, type AgentDisplayState, type CapabilityState } from "@/lib/agents/catalog";

const tones = { neutral: "bg-white/5 text-muted", green: "bg-accent/10 text-accent", amber: "bg-amber-400/10 text-amber-300" };

/** État d’un agent : ● Actif · ○ À connecter / Configuration requise / Désactivé · ◌ À venir. */
export function AgentStateBadge({ state }: { state: AgentDisplayState }) {
  const { label, tone, symbol } = agentStateLabels[state];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap ${tones[tone]}`}>
      <span aria-hidden="true">{symbol}</span>{label}
    </span>
  );
}

/** Capacités : ✓ disponible aujourd’hui, ○ prévue (non active). */
export function CapabilityList({ capabilities, className = "" }: { capabilities: { label: string; state: CapabilityState }[]; className?: string }) {
  return (
    <ul className={`space-y-1.5 text-sm ${className}`}>
      {capabilities.map((capability) => (
        <li key={capability.label} className={`flex items-start gap-2 ${capability.state === "available" ? "" : "text-muted"}`}>
          <span aria-hidden="true" className={`w-4 shrink-0 text-center ${capability.state === "available" ? "text-accent" : ""}`}>{capability.state === "available" ? "✓" : "○"}</span>
          <span>{capability.label}<span className="sr-only">{capability.state === "available" ? " (disponible)" : " (prévue, non active)"}</span></span>
        </li>
      ))}
    </ul>
  );
}

export function CapabilityLegend() {
  return <p className="text-xs text-muted"><span aria-hidden="true" className="text-accent">✓</span> disponible · <span aria-hidden="true">○</span> prévue, non active</p>;
}
