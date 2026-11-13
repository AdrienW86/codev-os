import { registerChannelLabels, type RegisterEntry } from "@/lib/editorial-register/model";

/**
 * Registre éditorial (socle éditorial, lot 3) : sujets publiés ou proposés sur chaque canal, et sujets réservés par un
 * agent en cours d'écriture. Lecture seule : les agents le consultent avant d'écrire et refusent un sujet déjà traité.
 */
export function EditorialRegisterPanel({ entries }: { entries: RegisterEntry[] | "unavailable" }) {
  const recent = entries === "unavailable" ? [] : [...entries].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  const reserved = recent.filter((e) => e.status === "reserved");
  return (
    <section aria-labelledby="editorial-register-title" className="mb-8 rounded-xl border border-border bg-surface p-5">
      <h2 id="editorial-register-title" className="text-base font-semibold">Registre éditorial</h2>
      <p className="mt-1 text-xs text-muted">Tous les sujets du client, tous canaux confondus. Avant d’écrire, chaque agent réserve son sujet ; un sujet déjà traité, même reformulé, est refusé.</p>
      {entries === "unavailable" ? <p className="mt-2 text-sm text-warning">Registre illisible pour le moment : l’Agent Blog et l’Agent Newsletter attendent avant d’écrire.</p>
        : recent.length === 0 ? <p className="mt-2 text-sm text-muted">Aucun sujet pour l’instant.</p>
        : (
          <>
            {reserved.length > 0 && <p className="mt-2 text-sm">{reserved.length} sujet{reserved.length > 1 ? "s" : ""} réservé{reserved.length > 1 ? "s" : ""} en cours d’écriture.</p>}
            <ul className="mt-2 divide-y divide-border">
              {recent.map((e) => (
                <li key={e.ref} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5 text-sm">
                  <span className="min-w-0 flex-1">{e.topic}</span>
                  <span className="text-xs text-muted">{registerChannelLabels[e.channel]} · {e.status === "reserved" ? "réservé" : e.date.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
    </section>
  );
}
