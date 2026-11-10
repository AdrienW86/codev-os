import { createClientAcquisitionWorkspace, discoverPrescribersAction } from "@/app/(cockpit)/acquisition/actions";
import type { AcquisitionDiscoveryRun, AcquisitionWorkspace } from "@/lib/acquisition/model";
import { PRESCRIBER_SEGMENTS, resolveTradeProfile } from "@/lib/acquisition/prescribers";

type ClientOption = { id: string; name: string; company_name: string | null; activity: string | null; geographic_area: string | null };

const input = "mt-1 w-full rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm";
const button = "rounded-lg bg-accent-strong px-4 py-2.5 text-sm font-semibold text-accent-foreground";
const priorityLabel = { 1: "Prioritaire", 2: "Régulier", 3: "Occasionnel" } as const;

/** Agent Prospection : trouve les entreprises prescriptrices d'un client (registre Sirene). */
export function PrescriberDiscovery({ workspaces, clients, runs, prescribersReady, placesReady }: {
  workspaces: AcquisitionWorkspace[]; clients: ClientOption[]; runs: AcquisitionDiscoveryRun[];
  prescribersReady: boolean; placesReady: boolean;
}) {
  const clientWorkspaces = workspaces.filter((w) => w.client_id);
  const withoutWorkspace = clients.filter((c) => !workspaces.some((w) => w.client_id === c.id));
  const clientOf = (w: AcquisitionWorkspace) => clients.find((c) => c.id === w.client_id);
  return <section className="rounded-xl border border-border bg-surface p-5" aria-labelledby="prescriber-title" data-acquisition="prescribers">
    <h2 id="prescriber-title" className="text-lg font-semibold">Agent Prospection — prescripteurs d&apos;un client</h2>
    <p className="mt-1 text-sm text-muted">À partir du métier et de la zone du client, l&apos;agent liste les entreprises actives susceptibles de le recommander (architectes, syndics, agences immobilières…). Source : registre public Sirene (INSEE){placesReady ? ", complété par Google Places" : ""}. Aucun dirigeant ni e-mail n&apos;est collecté, aucun contact n&apos;est pris.</p>
    {!prescribersReady && <p role="status" className="mt-3 rounded-lg border border-border-strong bg-surface-raised p-3 text-sm">Migration <code>20261203000000_acquisition_prescribers</code> à appliquer avant la première recherche.</p>}
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <div>
        {clientWorkspaces.length === 0 ? <p className="text-sm text-muted">Créez d&apos;abord l&apos;espace Acquisition d&apos;un client.</p> :
          <form action={discoverPrescribersAction} className="space-y-3">
            <div><label htmlFor="prescriber-workspace" className="text-sm">Client</label>
              <select id="prescriber-workspace" name="workspace_id" required className={input}>{clientWorkspaces.map((w) => <option key={w.id} value={w.id}>{w.label}{clientOf(w)?.activity ? ` — ${clientOf(w)?.activity}` : ""}{clientOf(w)?.geographic_area ? `, ${clientOf(w)?.geographic_area}` : ""}</option>)}</select></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label htmlFor="prescriber-activity" className="text-sm">Métier (facultatif)</label>
                <input id="prescriber-activity" name="activity" maxLength={120} placeholder="Par défaut : fiche client" className={input} /></div>
              <div><label htmlFor="prescriber-place" className="text-sm">Commune (facultatif)</label>
                <input id="prescriber-place" name="place" maxLength={120} placeholder="Par défaut : zone du client" className={input} /></div>
              <div><label htmlFor="prescriber-radius" className="text-sm">Rayon</label>
                <select id="prescriber-radius" name="radius_km" defaultValue="20" className={input}>{[5, 10, 20, 30, 50].map((r) => <option key={r} value={r}>{r} km</option>)}</select></div>
              <div><label htmlFor="prescriber-max" className="text-sm">Entreprises par segment</label>
                <select id="prescriber-max" name="max_per_segment" defaultValue="25" className={input}>{[10, 25, 50].map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
            </div>
            <button type="submit" className={button} disabled={!prescribersReady}>Trouver les prescripteurs</button>
            <p className="text-xs text-muted">Recherche limitée à 150 nouvelles fiches par lancement. Les entreprises déjà présentes ne sont pas dupliquées.</p>
          </form>}
        {withoutWorkspace.length > 0 && <form action={createClientAcquisitionWorkspace} className="mt-5 flex flex-wrap items-end gap-3 border-t border-border pt-4">
          <div className="min-w-0 flex-1"><label htmlFor="acq-client" className="text-sm">Ouvrir un espace pour un client</label>
            <select id="acq-client" name="client_id" required className={input}>{withoutWorkspace.map((c) => <option key={c.id} value={c.id}>{c.company_name || c.name}</option>)}</select></div>
          <button type="submit" className={button}>Créer l&apos;espace</button>
        </form>}
      </div>
      <div className="space-y-4">
        {clientWorkspaces.slice(0, 6).map((w) => {
          const profile = resolveTradeProfile(clientOf(w)?.activity);
          return <details key={w.id} className="rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium">Cibles pour {w.label} · {profile.label}</summary>
            <ul className="mt-2 space-y-1 text-xs text-muted">{profile.targets.map((t) => <li key={t.segment}>
              <strong className="text-foreground">{PRESCRIBER_SEGMENTS[t.segment].label}</strong> · {priorityLabel[t.priority]} — {t.reason}</li>)}</ul>
          </details>;
        })}
        {runs.length > 0 && <div><h3 className="text-sm font-medium">Dernières recherches</h3>
          <ul className="mt-2 space-y-1 text-xs text-muted">{runs.slice(0, 5).map((r) => <li key={r.id}>
            {new Date(r.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" })} · {workspaces.find((w) => w.id === r.workspace_id)?.label ?? "—"} · {r.place}, {r.radius_km} km · {r.status === "succeeded" ? `${r.found_count} trouvée(s), ${r.inserted_count} ajoutée(s)` : r.status === "failed" ? `échec${r.error ? ` (${r.error})` : ""}` : "en cours"}
          </li>)}</ul></div>}
      </div>
    </div>
  </section>;
}
