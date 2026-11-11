import { MutationForm } from "@/components/ui/mutation-form";
import { saveClientAiCapAction } from "@/app/(cockpit)/clients/[id]/ai-budget-actions";
import { harnessCharters } from "@/lib/harness/charter";
import type { Budget } from "@/lib/ai/budget";

const eur = (value: number) => value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const nameOf = (id: string) => harnessCharters.find((c) => c.id === id)?.name ?? id;

/** Budget IA du client : dépense du mois par agent et plafond mensuel, appliqué avant chaque appel des agents mesurés. */
export function ClientAiBudgetPanel({ clientId, budget }: { clientId: string; budget: Budget | null | "unavailable" }) {
  return (
    <section aria-labelledby="ai-budget-title" className="mb-8 rounded-xl border border-border bg-surface p-5">
      <h2 id="ai-budget-title" className="text-base font-semibold">Budget IA du client</h2>
      {budget === null ? (
        <p className="mt-1 text-sm text-muted">Suivi non installé : appliquez la migration 20261206000000_ai_usage_budget pour mesurer et plafonner la dépense IA de ce client.</p>
      ) : budget === "unavailable" ? (
        <p className="mt-1 text-sm text-warning">Dépense IA illisible pour le moment : les agents mesurés suspendent leurs appels IA tant qu’elle n’est pas lisible.</p>
      ) : (
        <>
          <p className="mt-1 text-sm">
            <span className="font-semibold">{eur(budget.spent)}</span> dépensés ce mois sur un plafond de <span className="font-semibold">{eur(budget.cap)}</span>{budget.capIsDefault ? " (plafond par défaut)" : ""}.
            {!budget.allowed && <span className="text-warning"> Plafond atteint : les agents Blog, Visuels et Vidéo n’appellent plus l’IA ce mois-ci (les visuels et vidéos gardent un texte générique).</span>}
          </p>
          {Object.keys(budget.byAgent).length > 0 && (
            <p className="mt-1 text-xs text-muted">{Object.entries(budget.byAgent).filter(([, v]) => v > 0).map(([agent, value]) => `${nameOf(agent)} ${eur(value)}`).join(" · ") || "Aucune dépense ce mois."}</p>
          )}
          <p className="mt-1 text-xs text-muted">Compte les agents Publications, Photothèque, Blog, Visuels et Vidéo. Le plafond bloque les agents Blog, Visuels et Vidéo ; Publications et Photothèque gardent en plus leur propre garde-fou.</p>
          <MutationForm action={saveClientAiCapAction} fields={{ client_id: clientId }} label="Enregistrer le plafond" className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-sm">Plafond mensuel (€)
              <input name="monthly_cap_eur" inputMode="decimal" defaultValue={String(budget.cap)} className="ml-2 w-24 rounded-md border border-border bg-background px-2 py-1" />
            </label>
          </MutationForm>
        </>
      )}
    </section>
  );
}
