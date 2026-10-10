import { Panel } from "@/components/ui/primitives";
import { SectionHeader } from "@/components/ui/layout";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { ModuleUnavailable } from "@/components/ui/module-unavailable";
import { allProviderStatuses, connectionState, type ConnectionState } from "@/lib/system/providers";
import type { SystemHealth } from "@/lib/system/health";
import { formatDateTime } from "@/lib/format-date";
import { MutationForm } from "@/components/ui/mutation-form";
import { testAIProviderAction } from "@/app/(cockpit)/settings/ai-actions";

const states: Record<ConnectionState, { symbol: string; label: string; tone: "green" | "neutral" | "amber" }> = {
  ok: { symbol: "✓", label: "Configuré", tone: "green" },
  todo: { symbol: "○", label: "À configurer", tone: "neutral" },
  attention: { symbol: "!", label: "À vérifier", tone: "amber" },
};

/**
 * État du système : présence des variables serveur uniquement. Seuls les NOMS de variables
 * manquantes sont affichés — jamais une valeur, jamais un extrait de secret.
 */
export function SystemStatus({ errors }: { errors: SystemHealth["connectionErrors"] }) {
  const statuses = allProviderStatuses();
  const counts = { ok: 0, todo: 0, attention: 0 };
  const rows = statuses.map((status) => {
    const lastError = errors.find((item) => item.provider === status.id)?.last_error ?? null;
    const state = connectionState(status.requirement, process.env, lastError);
    counts[state]++;
    return { status, state, lastError };
  });
  return (
    <section aria-labelledby="system-status">
      <SectionHeader id="system-status" title="État du système" description={`${counts.ok} configuré(s) · ${counts.todo} à configurer · ${counts.attention} à vérifier`} />
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface px-5">
        {rows.map(({ status, state, lastError }) => {
          const view = states[state];
          return (
            <li key={status.id} className="flex flex-wrap items-start justify-between gap-3 py-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{status.label}</p>
                <p className="text-sm text-muted">{status.requirement.description}</p>
                {state !== "ok" && (
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-muted hover:text-foreground">Comment configurer</summary>
                    <div className="mt-2 space-y-1 text-muted">
                      <p>{status.requirement.setup}</p>
                      {status.missing.length > 0 && <p>Variables serveur manquantes : {status.missing.map((name) => <code key={name} className="mr-1 rounded bg-white/5 px-1">{name}</code>)}</p>}
                      {lastError && <p>Dernière erreur : {lastError}</p>}
                      <p>Documentation : <code>{status.requirement.docs}</code></p>
                    </div>
                  </details>
                )}
                {state === "ok" && status.optionalMissing.length > 0 && <p className="mt-1 text-xs text-muted">Facultatif : {status.optionalMissing.join(", ")}</p>}
              </div>
              <StatusBadge label={view.label} tone={view.tone} symbol={view.symbol} />
            </li>
          );
        })}
      </ul>
      <div className="mt-6 rounded-xl border border-border bg-surface p-5">
        <h3 className="font-medium">Assistant : tester la connexion IA</h3>
        <p className="mt-1 text-sm text-muted">Vérifie le fournisseur et le modèle retenus par ce déploiement, et que la clé est acceptée. Aucune génération, aucun coût de jetons ; la clé n’est jamais affichée.</p>
        <MutationForm action={testAIProviderAction} label="Tester la connexion IA" pendingLabel="Test en cours…" className="mt-3" />
      </div>
      <p className="mt-3 text-xs text-muted">Les secrets se configurent uniquement côté serveur (variables d’environnement Vercel / coffre). Ils ne sont jamais saisis ni affichés ici.</p>
    </section>
  );
}

const jobLabels = { queued: "En file", running: "En cours", succeeded: "Réussis", skipped: "Ignorés", failed: "Échoués", cancelled: "Annulés" } as const;

export function Observability({ health, unavailable }: { health: SystemHealth | null; unavailable: boolean }) {
  if (unavailable || !health) return <ModuleUnavailable module="Observabilité" />;
  return (
    <div className="space-y-8">
      <section>
        <SectionHeader title="Jobs des 7 derniers jours" description={`Dernier job planifié : ${health.lastScheduledJobAt ? formatDateTime(health.lastScheduledJobAt) : "aucun"}`} />
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Object.entries(jobLabels).map(([key, label]) => (
            <Panel key={key} className="p-4"><dt className="text-xs text-muted">{label}</dt><dd className={`mt-1 text-2xl font-semibold ${key === "failed" && health.jobCounts.failed ? "text-red-300" : ""}`}>{health.jobCounts[key as keyof typeof jobLabels]}</dd></Panel>
          ))}
        </dl>
        {health.schedulerStale && <p className="mt-3 text-sm text-amber-200">Aucun job planifié depuis plus de 36 h : vérifiez que le cron appelle /api/internal/scheduler/tick et qu’au moins une automatisation est active.</p>}
      </section>
      <section>
        <SectionHeader title="Incidents ouverts" count={health.openIncidents.length} />
        {health.openIncidents.length ? (
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface px-5">
            {health.openIncidents.map((incident) => (
              <li key={incident.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span>{incident.title}{incident.client ? ` · ${incident.client}` : ""}</span><span className="text-muted">{incident.severity} · {formatDateTime(incident.detected_at)}</span></li>
            ))}
          </ul>
        ) : <EmptyState compact icon="dashboard" title="Aucun incident ouvert." />}
      </section>
      <section>
        <SectionHeader title="Exécutions d’agents en échec" count={health.failedRuns.length} />
        {health.failedRuns.length ? (
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface px-5">
            {health.failedRuns.map((run) => (
              <li key={run.id} className="py-3 text-sm"><p className="font-medium">{run.agent} · {formatDateTime(run.started_at)}</p><p className="text-muted">{run.summary ?? "Sans détail."}</p></li>
            ))}
          </ul>
        ) : <EmptyState compact icon="agents" title="Aucun échec sur 7 jours." />}
      </section>
      <section>
        <SectionHeader title="Synchronisations en erreur" count={health.connectionErrors.length} />
        {health.connectionErrors.length ? (
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface px-5">
            {health.connectionErrors.map((item, index) => <li key={`${item.provider}-${index}`} className="py-3 text-sm"><span className="font-medium">{item.provider}</span> · <span className="text-muted">{item.last_error}</span></li>)}
          </ul>
        ) : <EmptyState compact icon="settings" title="Aucune synchronisation en erreur." />}
      </section>
    </div>
  );
}
