import { Panel } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/status-badge";
import { InlineNotice } from "@/components/ui/states";
import { MutationForm } from "@/components/ui/mutation-form";
import { startGa4OAuthAction, refreshGa4PropertiesAction, disconnectGa4Action } from "@/app/(cockpit)/settings/google-analytics-actions";
import type { AwaitedGa4Status } from "@/lib/integrations/ga4/ui-types";

export function GoogleAnalyticsPanel({ status, banner, unavailable }: {
  status: AwaitedGa4Status | null; banner: { ok: boolean; message: string } | null; unavailable: boolean
}) {
  if (unavailable || !status) return <Panel className="p-6"><h2 className="font-semibold">Google Analytics 4</h2><p className="mt-2 text-warning">Connexion indisponible. Vérifiez la migration OAuth GA4 dans Supabase.</p></Panel>;
  const active = status.connection?.status === "active";
  return <Panel className="p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-semibold">Google Analytics 4</h2><p className="mt-1 text-sm text-muted">Sessions, taux de rebond, engagement, sources et événements en lecture seule. Connexion native sans Windsor.ai.</p></div>
      <StatusBadge label={active ? "Connecté" : status.ready ? "Non connecté" : "Configuration serveur requise"} tone={active ? "green" : status.ready ? "neutral" : "amber"} symbol={active ? "✓" : "○"} />
    </div>
    {banner && <div className="mt-4"><InlineNotice tone={banner.ok ? "green" : "amber"}>{banner.message}</InlineNotice></div>}
    {!status.ready && <div className="mt-4"><InlineNotice tone="amber">Variables manquantes : {status.missing.join(", ")}.</InlineNotice></div>}
    <dl className="mt-4 text-sm">
      <dt className="text-muted">URI OAuth à ajouter à Google Cloud → Identifiants → URI de redirection autorisés</dt>
      <dd className="break-all font-mono text-xs">{status.redirectUri ?? "—"}</dd>
      <dt className="mt-3 text-muted">Client OAuth</dt>
      <dd>{status.credentials === "analytics" ? "Google Analytics dédié" : status.credentials === "business_profile" ? "Client Google Business Profile existant (portée GA4 isolée)" : "—"}</dd>
      {status.connection?.lastError && <dd className="mt-2 text-warning">{status.connection.lastError}</dd>}
    </dl>
    <div className="mt-5 flex flex-wrap gap-2">
      <MutationForm action={startGa4OAuthAction} label={active ? "Reconnecter GA4" : "Connecter Google Analytics"} pendingLabel="Connexion à Google…" variant="primary" disabled={!status.ready} />
      {active && <MutationForm action={refreshGa4PropertiesAction} label="Actualiser les propriétés" pendingLabel="Actualisation…" />}
      {active && <MutationForm action={disconnectGa4Action} label="Déconnecter GA4" pendingLabel="Déconnexion…" variant="danger" confirm="Déconnecter Google Analytics ? Les données déjà synchronisées sont conservées. Les autres accès Google de CODE-V OS ne seront pas modifiés." />}
    </div>
    {active && <details className="mt-4 rounded-lg border border-border p-3 text-sm">
      <summary className="cursor-pointer">{status.connection?.properties.length ?? 0} propriété(s) GA4 accessible(s)</summary>
      <ul className="mt-2 space-y-1">{status.connection?.properties.map(p => <li key={p.id}>{p.name} · <code>{p.id}</code></li>)}</ul>
      <p className="mt-2 text-xs text-muted">Pour associer une propriété à un client, ouvrez sa fiche → Agents → Sources de données.</p>
    </details>}
  </Panel>;
}
