import { cancelDiscoveryRunAction, createClientAcquisitionWorkspace, discoverPrescribersAction, queueZoneScanAction } from "@/app/(cockpit)/acquisition/actions";
import type { AcquisitionDiscoveryRun, AcquisitionWorkspace } from "@/lib/acquisition/model";
import { PRESCRIBER_SEGMENTS, resolveTradeProfile } from "@/lib/acquisition/prescribers";

type ClientOption = { id: string; name: string; company_name: string | null; activity: string | null; geographic_area: string | null };

const input = "mt-1 w-full rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm";
const button = "rounded-lg bg-accent-strong px-4 py-2.5 text-sm font-semibold text-accent-foreground";
const priorityLabel = { 1: "Prioritaire", 2: "Régulier", 3: "Occasionnel" } as const;
const SOURCE_OPTIONS = [
  { id: "osm", label: "OpenStreetMap", hint: "site, téléphone (ODbL)" },
  { id: "bodacc", label: "BODACC", hint: "créations des 12 derniers mois" },
  { id: "websites", label: "Sites web", hint: "mentions légales, e-mail générique, robots.txt respecté" },
] as const;
const PHASES: Record<string, string> = { sirene_zone: "registre Sirene", osm: "OpenStreetMap", bodacc: "BODACC", websites: "sites web", done: "terminé" };
const ACTIVE = new Set(["queued", "running", "enriching"]);

function SourceChoices({ idPrefix }: { idPrefix: string }) {
  return <fieldset className="space-y-1.5"><legend className="text-sm">Compléter en tâche de fond avec</legend>
    {SOURCE_OPTIONS.map((s) => <label key={s.id} htmlFor={`${idPrefix}-${s.id}`} className="flex items-start gap-2 text-sm">
      <input id={`${idPrefix}-${s.id}`} type="checkbox" name="sources" value={s.id} defaultChecked className="mt-1" />
      <span>{s.label} <span className="text-xs text-muted">— {s.hint}</span></span></label>)}
  </fieldset>;
}

function runSummary(r: AcquisitionDiscoveryRun): string {
  const p = (r.progress ?? {}) as Record<string, unknown>;
  const parts = [`${r.found_count} trouvée(s), ${r.inserted_count} ajoutée(s)`];
  if (typeof p.estimated_total === "number" && r.mode === "zone") parts.push(`≈ ${p.estimated_total.toLocaleString("fr-FR")} dans la zone`);
  if (typeof p.osm_matched === "number") parts.push(`${p.osm_matched} complétée(s) par OSM`);
  if (typeof p.bodacc_matched === "number") parts.push(`${p.bodacc_matched} création(s) récente(s)`);
  if (typeof p.emails_found === "number") parts.push(`${p.emails_found} e-mail(s) sur ${String(p.websites_checked ?? 0)} site(s)`);
  if (Array.isArray(p.truncated) && p.truncated.length) parts.push(`incomplet pour ${p.truncated.join(", ")} (plafond API)`);
  return parts.join(" · ");
}

/** Agent Prospection : trouve les entreprises prescriptrices d'un client (registre Sirene). */
export function PrescriberDiscovery({ workspaces, clients, runs, prescribersReady, placesReady, focusClientId, multisourceReady = false }: {
  workspaces: AcquisitionWorkspace[]; clients: ClientOption[]; runs: AcquisitionDiscoveryRun[];
  prescribersReady: boolean; placesReady: boolean; focusClientId?: string; multisourceReady?: boolean;
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
              <select id="prescriber-workspace" name="workspace_id" required className={input} defaultValue={clientWorkspaces.find((w) => w.client_id === focusClientId)?.id}>{clientWorkspaces.map((w) => <option key={w.id} value={w.id}>{w.label}{clientOf(w)?.activity ? ` — ${clientOf(w)?.activity}` : ""}{clientOf(w)?.geographic_area ? `, ${clientOf(w)?.geographic_area}` : ""}</option>)}</select></div>
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
            {multisourceReady && <SourceChoices idPrefix="prescriber-src" />}
            <button type="submit" className={button} disabled={!prescribersReady}>Trouver les prescripteurs</button>
            <p className="text-xs text-muted">Recherche limitée à 150 nouvelles fiches par lancement. Les entreprises déjà présentes ne sont pas dupliquées.</p>
          </form>}
        {clientWorkspaces.length > 0 && <details className="mt-5 border-t border-border pt-4">
          <summary className="cursor-pointer text-sm font-medium">Balayer toute la zone (toutes les entreprises du rayon)</summary>
          {!multisourceReady ? <p className="mt-2 text-sm text-muted">Migration <code>20261204000000_acquisition_multisource</code> à appliquer avant le premier balayage.</p> :
          <form action={queueZoneScanAction} className="mt-3 space-y-3">
            <p className="text-xs text-muted">Toutes les entreprises actives du registre Sirene dans le rayon, tous métiers confondus, puis enrichissement multi-sources. Traitement en tâche de fond (environ 50 s toutes les 15 min) : comptez quelques heures pour une grande ville. Aucun contact n&apos;est pris.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label htmlFor="zone-workspace" className="text-sm">Client</label>
                <select id="zone-workspace" name="workspace_id" required className={input} defaultValue={clientWorkspaces.find((w) => w.client_id === focusClientId)?.id}>{clientWorkspaces.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</select></div>
              <div><label htmlFor="zone-place" className="text-sm">Commune (facultatif)</label>
                <input id="zone-place" name="place" maxLength={120} placeholder="Par défaut : zone du client" className={input} /></div>
              <div><label htmlFor="zone-radius" className="text-sm">Rayon</label>
                <select id="zone-radius" name="radius_km" defaultValue="10" className={input}>{[5, 10, 20, 30, 50].map((r) => <option key={r} value={r}>{r} km</option>)}</select></div>
              <div><label htmlFor="zone-max" className="text-sm">Nombre maximal d&apos;entreprises</label>
                <select id="zone-max" name="max_companies" defaultValue="20000" className={input}>{[[5000, "5 000"], [20000, "20 000"], [50000, "50 000"], [200000, "Toute la zone (200 000 max)"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            </div>
            <label htmlFor="zone-sole" className="flex items-center gap-2 text-sm"><input id="zone-sole" type="checkbox" name="exclude_sole_proprietors" /> Exclure les entrepreneurs individuels</label>
            <label htmlFor="zone-nonop" className="flex items-center gap-2 text-sm"><input id="zone-nonop" type="checkbox" name="include_non_operating" /> Inclure les SCI et holdings (exclues par défaut : sans activité commerciale)</label>
            <SourceChoices idPrefix="zone-src" />
            <button type="submit" className={button}>Lancer le balayage</button>
          </form>}
        </details>}
        {withoutWorkspace.length > 0 && <form action={createClientAcquisitionWorkspace} className="mt-5 flex flex-wrap items-end gap-3 border-t border-border pt-4">
          <div className="min-w-0 flex-1"><label htmlFor="acq-client" className="text-sm">Ouvrir un espace pour un client</label>
            <select id="acq-client" name="client_id" required className={input} defaultValue={withoutWorkspace.some((c) => c.id === focusClientId) ? focusClientId : undefined}>{withoutWorkspace.map((c) => <option key={c.id} value={c.id}>{c.company_name || c.name}</option>)}</select></div>
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
          <ul className="mt-2 space-y-2 text-xs text-muted">{runs.slice(0, 6).map((r) => <li key={r.id} className="flex flex-wrap items-center gap-x-2">
            <span>{new Date(r.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" })} · {workspaces.find((w) => w.id === r.workspace_id)?.label ?? "—"} · {r.mode === "zone" ? "zone complète" : "prescripteurs"} · {r.place}, {r.radius_km} km ·{" "}
              {ACTIVE.has(r.status) ? `en cours (${PHASES[r.phase ?? ""] ?? "file d'attente"}) · ${runSummary(r)}` : r.status === "succeeded" ? runSummary(r) : r.status === "cancelled" ? "annulée" : `échec${r.error ? ` (${r.error})` : ""}`}</span>
            {ACTIVE.has(r.status) && <form action={cancelDiscoveryRunAction}><input type="hidden" name="run_id" value={r.id} /><button type="submit" className="text-accent hover:underline">Arrêter</button></form>}
          </li>)}</ul></div>}
      </div>
    </div>
  </section>;
}
