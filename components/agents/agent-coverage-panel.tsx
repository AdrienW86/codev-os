import Link from "next/link";
import { MutationForm } from "@/components/ui/mutation-form";
import { coverageGapMessages, fixableGaps, type CoverageGap } from "@/lib/agents/coverage";
import { createMissingAutomationsAction } from "@/app/(cockpit)/agents/coverage-actions";

/** Agents qui devraient travailler et ne le font pas : jamais masqué tant que l'écart existe. */
export function AgentCoveragePanel({ gaps, clientNames, compact = false }: { gaps: CoverageGap[]; clientNames: Record<string, string>; compact?: boolean }) {
  if (!gaps.length) return null;
  const fixable = fixableGaps(gaps).length;
  if (compact) {
    return (
      <p role="status" className="mb-6 rounded-xl border border-warning/25 bg-warning/10 p-4 text-sm text-warning">
        {gaps.length === 1 ? "Un agent ne tourne pas comme prévu." : `${gaps.length} exécutions d’agents ne tournent pas comme prévu.`}{" "}
        <Link href="/agents#supervision" className="font-semibold underline">Voir la supervision des agents</Link>
      </p>
    );
  }
  return (
    <section id="supervision" aria-labelledby="supervision-title" className="mb-8 rounded-xl border border-warning/25 bg-warning/10 p-5">
      <h2 id="supervision-title" className="text-base font-semibold text-warning">Supervision : {gaps.length} écart{gaps.length > 1 ? "s" : ""}</h2>
      <ul className="mt-3 space-y-2 text-sm">
        {gaps.map((gap) => (
          <li key={`${gap.agentId}:${gap.runType}:${gap.clientId ?? ""}`}>
            <span className="font-semibold">{gap.agentName}</span>
            {gap.clientId ? <> · {clientNames[gap.clientId] ?? "Client"}</> : null} · {gap.label} : <span className="text-muted">{coverageGapMessages[gap.kind]}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {fixable > 0 && <MutationForm action={createMissingAutomationsAction} label={`Planifier les ${fixable} exécution${fixable > 1 ? "s" : ""} manquante${fixable > 1 ? "s" : ""}`} pendingLabel="Planification…" variant="primary" disableOnSuccess />}
        <Link href="/settings?tab=automations" className="text-sm text-accent hover:underline">Gérer les automatisations</Link>
      </div>
      <p className="mt-2 text-xs text-muted">Les agents et automatisations mis en pause restent en pause : seule l’administration peut les réactiver.</p>
    </section>
  );
}
