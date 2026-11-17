import { Panel } from "@/components/ui/primitives";
import { CONSENT_BASES } from "@/lib/emailing/contacts";
import { CONTACTS_PAGE, type ContactFilter, type ContactRow } from "@/lib/emailing/client-email-service";
import { eraseContactAction, unsubscribeContactAction } from "@/app/(cockpit)/emailing/actions";

const STATUS: Record<string, string> = { pending: "En attente", subscribed: "Abonné", unsubscribed: "Désabonné", bounced: "Adresse invalide", complained: "Plainte (spam)" };
const BASIS: Record<string, string> = Object.fromEntries(CONSENT_BASES.map((b) => [b.id, b.label]));
const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });

// Liste des contacts d'un client, avec la preuve de consentement de chacun, recherche, filtre de statut et pages.
// Actions : désabonnement à la demande du contact, suppression définitive (droit à l'effacement).
export function ContactsList({ clientId, list, filter }: { clientId: string; list: { rows: ContactRow[]; total: number; page: number } | null; filter: ContactFilter }) {
  if (!list) return <Panel className="p-4"><h2 className="font-semibold">Liste des contacts</h2><p className="mt-1 text-sm text-danger">Lecture des contacts impossible.</p></Panel>;
  const pages = Math.max(1, Math.ceil(list.total / CONTACTS_PAGE));
  const link = (page: number) => `/emailing?${new URLSearchParams({ client: clientId, ...(filter.q ? { q: filter.q } : {}), ...(filter.status ? { status: filter.status } : {}), page: String(page) })}#contacts`;
  return <Panel className="p-4">
    <h2 id="contacts" className="font-semibold">Liste des contacts <span className="text-sm font-normal text-muted">({list.total})</span></h2>
    <form action="/emailing" className="mt-3 flex flex-wrap items-end gap-2 text-sm"><input type="hidden" name="client" value={clientId} />
      <label>Rechercher<br /><input name="q" defaultValue={filter.q ?? ""} placeholder="adresse" className="mt-1 rounded-lg border border-border bg-surface p-2" /></label>
      <label>Statut<br /><select name="status" defaultValue={filter.status ?? ""} className="mt-1 rounded-lg border border-border bg-surface p-2"><option value="">Tous</option>{Object.entries(STATUS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <button className="rounded-lg border border-border px-3 py-2">Filtrer</button>
    </form>
    {list.rows.length === 0 ? <p className="mt-3 text-sm text-muted">Aucun contact.</p> :
      <ul className="mt-3 divide-y divide-border text-sm">{list.rows.map((c) => <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
        <div className="min-w-0">
          <p className="break-all font-medium">{c.email_normalized}{(c.first_name || c.last_name) && <span className="font-normal text-muted"> · {[c.first_name, c.last_name].filter(Boolean).join(" ")}</span>}</p>
          <p className="text-xs text-muted">{STATUS[c.status] ?? c.status} · {BASIS[c.consent_basis] ?? c.consent_basis} · {c.consent_source} · consentement du {day(c.consent_at)}{c.unsubscribed_at ? ` · désabonné le ${day(c.unsubscribed_at)}` : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {(c.status === "subscribed" || c.status === "pending") && <form action={unsubscribeContactAction}><input type="hidden" name="client_id" value={clientId} /><input type="hidden" name="id" value={c.id} />
            <button className="rounded-lg border border-border px-2 py-1">Désabonner</button></form>}
          <form action={eraseContactAction} className="flex items-center gap-1"><input type="hidden" name="client_id" value={clientId} /><input type="hidden" name="id" value={c.id} />
            <label><input type="checkbox" name="confirm" className="mr-1" />confirmer</label>
            <button className="rounded-lg border border-warning/40 px-2 py-1 text-warning">Supprimer</button></form>
        </div>
      </li>)}</ul>}
    {pages > 1 && <p className="mt-3 flex gap-3 text-sm">
      {list.page > 1 && <a href={link(list.page - 1)} className="text-accent">← Précédents</a>}
      <span className="text-muted">Page {list.page} / {pages}</span>
      {list.page < pages && <a href={link(list.page + 1)} className="text-accent">Suivants →</a>}
    </p>}
  </Panel>;
}
