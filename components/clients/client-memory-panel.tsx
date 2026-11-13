import { MutationForm } from "@/components/ui/mutation-form";
import { addClientFactAction, reviewClientFactAction } from "@/app/(cockpit)/clients/[id]/memory-actions";
import { FACT_KINDS, factKindLabels, factSourceLabels, type ClientFact } from "@/lib/client-memory/model";

/**
 * Mémoire client (socle éditorial, lot 1) : faits du client avec leur source et leur statut. Les agents ne reçoivent
 * que les faits confirmés ; une proposition (agent, message du client) attend ici une décision.
 */
export function ClientMemoryPanel({ clientId, facts }: { clientId: string; facts: ClientFact[] | null | "unavailable" }) {
  return (
    <section aria-labelledby="client-memory-title" className="mb-8 rounded-xl border border-border bg-surface p-5">
      <h2 id="client-memory-title" className="text-base font-semibold">Mémoire client</h2>
      <p className="mt-1 text-xs text-muted">Faits vérifiés que tous les agents partagent. Un agent ne cite que les faits confirmés ; « À ne jamais dire » est transmis comme interdit.</p>
      {facts === null ? (
        <p className="mt-2 text-sm text-muted">Mémoire non installée : appliquez la migration 20261209000000_client_memory.</p>
      ) : facts === "unavailable" ? (
        <p className="mt-2 text-sm text-warning">Mémoire illisible pour le moment : les agents gardent leur contexte habituel.</p>
      ) : (
        <>
          <FactList clientId={clientId} title="À valider" facts={facts.filter((f) => f.status === "proposed")} actions={["confirm", "reject"]} empty="Aucune proposition en attente." />
          <FactList clientId={clientId} title="Confirmés" facts={facts.filter((f) => f.status === "confirmed")} actions={["archive"]} empty="Aucun fait confirmé : remplissez la fiche client ou ajoutez un fait." />
          <MutationForm action={addClientFactAction} fields={{ client_id: clientId }} label="Ajouter le fait" className="mt-4 grid gap-2 sm:grid-cols-[auto_1fr_auto_auto] sm:items-end">
            <label className="text-sm">Catégorie
              <select name="kind" defaultValue="service" className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1">
                {FACT_KINDS.map((k) => <option key={k} value={k}>{factKindLabels[k]}</option>)}
              </select>
            </label>
            <label className="text-sm">Fait (tel que le client le confirme)
              <input name="statement" maxLength={600} required className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1" />
            </label>
            <label className="text-sm">Valable jusqu’au
              <input name="valid_until" type="date" className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1" />
            </label>
          </MutationForm>
        </>
      )}
    </section>
  );
}

const ACTION_LABELS = { confirm: "Confirmer", reject: "Rejeter", archive: "Archiver" } as const;

function FactList({ clientId, title, facts, actions, empty }: { clientId: string; title: string; facts: ClientFact[]; actions: (keyof typeof ACTION_LABELS)[]; empty: string }) {
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold">{title} <span className="text-muted">({facts.length})</span></h3>
      {facts.length === 0 ? <p className="mt-1 text-sm text-muted">{empty}</p> : (
        <ul className="mt-2 divide-y divide-border">
          {facts.map((fact) => (
            <li key={fact.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm"><span className="font-medium">{factKindLabels[fact.kind]}</span> · {fact.statement}</p>
                <p className="text-xs text-muted">{factSourceLabels[fact.source]}{fact.validUntil ? ` · jusqu’au ${fact.validUntil}` : ""}</p>
              </div>
              <div className="flex gap-2">
                {actions.map((decision) => (
                  <MutationForm key={decision} action={reviewClientFactAction} fields={{ client_id: clientId, fact_id: fact.id, decision }} label={ACTION_LABELS[decision]} variant={decision === "confirm" ? "primary" : "secondary"} />
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
