import { Panel } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/status-badge";
import { MutationForm } from "@/components/ui/mutation-form";
import { sourceDefinitions } from "@/lib/connections/sources";
import type { ClientSource } from "@/lib/connections/service";
import { isProviderConfigured } from "@/lib/system/providers";
import { saveClientSourceAction } from "@/app/(cockpit)/clients/[id]/source-actions";

const field = "mt-1.5 block min-h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground";

/** Identifiants des sources de données du client (aucun secret saisi ni affiché). */
export function ClientSourcesPanel({ clientId, sources, unavailable }: { clientId: string; sources: ClientSource[]; unavailable: boolean }) {
  return (
    <Panel className="p-6">
      <h2 className="font-semibold">Sources de données</h2>
      <p className="mt-1 text-sm text-muted">Identifiants utilisés par les agents pour ce client. Les accès (jetons) se configurent côté serveur : Paramètres → Connexions.</p>
      {unavailable ? <p className="mt-4 text-sm text-amber-200">Sources indisponibles (migration du noyau V1 à appliquer).</p> : (
        <ul className="mt-4 grid gap-5 md:grid-cols-3">
          {sourceDefinitions.map((definition) => {
            const source = sources.find((item) => item.provider === definition.provider);
            const ready = isProviderConfigured(definition.provider);
            return (
              <li key={definition.provider} className="min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{definition.label}</p>
                  {source?.lastError ? <StatusBadge label="Erreur" tone="amber" symbol="!" /> : source?.value ? <StatusBadge label={ready ? "Prêt" : "Accès serveur manquant"} tone={ready ? "green" : "amber"} symbol={ready ? "✓" : "!"} /> : <StatusBadge label="Non renseigné" symbol="○" />}
                </div>
                <p className="mt-1 text-xs text-muted">{definition.help} Utilisé par {definition.agent}.</p>
                <MutationForm action={saveClientSourceAction} fields={{ client_id: clientId, provider: definition.provider }} label="Enregistrer" className="mt-2 space-y-2">
                  <label className="block text-xs text-muted">{definition.label}
                    <input name="value" defaultValue={source?.value ?? ""} placeholder={definition.placeholder} maxLength={200} autoComplete="off" spellCheck={false} className={field} />
                  </label>
                </MutationForm>
                {source?.lastError && <p className="mt-1 text-xs text-amber-200">{source.lastError}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
