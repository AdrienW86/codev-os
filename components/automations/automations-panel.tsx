import { Panel } from "@/components/ui/primitives";
import { SectionHeader } from "@/components/ui/layout";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { MutationForm } from "@/components/ui/mutation-form";
import { ModuleUnavailable } from "@/components/ui/module-unavailable";
import { AutomationForm } from "@/components/automations/automation-form";
import { automationPresets } from "@/lib/automations/definitions";
import type { AutomationRecord } from "@/lib/automations/service";
import { runTypes } from "@/lib/agents/registry";
import { describeSchedule, type Schedule } from "@/lib/scheduler/recurrence";
import { formatDateTime } from "@/lib/format-date";
import type { AutomationStatus } from "@/lib/supabase/core.types";
import { archiveAutomationAction, createAutomationAction, createPresetAutomationAction, pauseAutomationAction, resumeAutomationAction, runAutomationNowAction } from "@/app/(cockpit)/settings/automation-actions";

const statusLabels: Record<AutomationStatus, { label: string; tone: StatusTone }> = {
  active: { label: "Active", tone: "green" }, paused: { label: "En pause", tone: "neutral" }, error: { label: "En erreur", tone: "red" },
  completed: { label: "Terminée", tone: "blue" }, archived: { label: "Archivée", tone: "neutral" },
};

export function AutomationsPanel({ automations, unavailable, clients, schedulerConfigured }: { automations: AutomationRecord[]; unavailable: boolean; clients: { id: string; name: string }[]; schedulerConfigured: boolean }) {
  const existing = new Set(automations.map((item) => `${item.run_type}:${JSON.stringify(item.config)}:${item.client_id ?? ""}`));
  const presets = automationPresets.filter((preset) => !existing.has(`${preset.runType}:${JSON.stringify(preset.config)}:`));
  return (
    <div className="space-y-8">
      {unavailable && <ModuleUnavailable module="Automatisations" />}
      {!schedulerConfigured && (
        <p className="rounded-xl border border-amber-300/25 bg-amber-400/10 p-4 text-sm text-amber-200">
          Planificateur non configuré (CRON_SECRET absent) : les automatisations ne partiront pas seules. « Exécuter maintenant » reste disponible. Voir docs/automation.md.
        </p>
      )}

      <section>
        <SectionHeader title="Automatisations" count={automations.length} description="Planification → job → exécution → résultat → journal." />
        {automations.length ? (
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {automations.map((automation) => {
              const state = statusLabels[automation.status];
              const runType = runTypes[automation.run_type as keyof typeof runTypes];
              return (
                <li key={automation.id} className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{automation.name}</p>
                    <p className="text-sm text-muted">{describeSchedule(automation.frequency, automation.schedule as Schedule, automation.timezone)} → {automation.agent?.name ?? "Agent"} → {automation.client?.name ?? "tous les clients suivis"}</p>
                    <p className="mt-1 text-xs text-muted">{runType?.label ?? automation.run_type} · prochaine : {automation.next_run_at ? formatDateTime(automation.next_run_at) : "—"} · dernière : {automation.last_run_at ? formatDateTime(automation.last_run_at) : "jamais"}{automation.consecutive_failures ? ` · ${automation.consecutive_failures} échec(s) consécutif(s)` : ""}</p>
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    <StatusBadge label={state.label} tone={state.tone} />
                    {automation.status !== "archived" && automation.status !== "completed" && <MutationForm action={runAutomationNowAction} fields={{ id: automation.id }} label="Exécuter maintenant" pendingLabel="Exécution…" />}
                    {["active", "error"].includes(automation.status) && <MutationForm action={pauseAutomationAction} fields={{ id: automation.id }} label="Mettre en pause" variant="ghost" />}
                    {["paused", "error"].includes(automation.status) && <MutationForm action={resumeAutomationAction} fields={{ id: automation.id }} label="Réactiver" variant="ghost" />}
                    {automation.status !== "archived" && <MutationForm action={archiveAutomationAction} fields={{ id: automation.id }} label="Archiver" variant="ghost" confirm="Archiver cette automatisation ? Son historique est conservé." />}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : !unavailable && <EmptyState icon="calendar" compact title="Aucune automatisation." description="Commencez par une automatisation recommandée ci-dessous." />}
      </section>

      {presets.length > 0 && (
        <section>
          <SectionHeader title="Recommandées" description="Créées en un clic, en heure de Paris. Aucune action externe : les agents préparent, vous validez." />
          <ul className="grid gap-4 md:grid-cols-2">
            {presets.map((preset) => (
              <li key={preset.id} className="flex flex-col rounded-xl border border-border bg-surface p-5">
                <p className="font-medium">{preset.name}</p>
                <p className="mt-1 text-sm text-muted">{describeSchedule(preset.frequency, preset.schedule, "Europe/Paris")}</p>
                <p className="mt-2 flex-1 text-sm leading-6 text-muted">{preset.why}</p>
                <MutationForm action={createPresetAutomationAction} fields={{ preset: preset.id }} label="Créer" className="mt-4" disableOnSuccess />
              </li>
            ))}
          </ul>
        </section>
      )}

      <Panel className="p-6">
        <h2 className="mb-4 font-semibold">Nouvelle automatisation</h2>
        <AutomationForm action={createAutomationAction} clients={clients.map((client) => ({ value: client.id, label: client.name }))}
          runTypes={Object.values(runTypes).map((item) => ({ value: item.id, label: item.label, scope: item.scope }))} />
      </Panel>
    </div>
  );
}
