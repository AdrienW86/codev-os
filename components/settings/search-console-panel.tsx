import { Panel } from "@/components/ui/primitives";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { InlineNotice } from "@/components/ui/states";
import { MutationForm } from "@/components/ui/mutation-form";
import { disconnectSearchConsoleAction, refreshSearchConsolePropertiesAction, startSearchConsoleOAuthAction } from "@/app/(cockpit)/settings/search-console-actions";
import { permissionLabels, propertyLabel } from "@/lib/integrations/search-console/model";
import type { SearchConsoleStatus } from "@/lib/integrations/search-console/connection";

const dateTime = (value: string) => new Date(value).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });

const statusOf = (status: SearchConsoleStatus): { label: string; tone: StatusTone; symbol: string } => {
  const connection = status.connection;
  if (connection?.status === "active") return { label: "Connecté", tone: "green", symbol: "✓" };
  if (connection?.status === "revoked") return { label: "Accès révoqué", tone: "red", symbol: "!" };
  if (connection?.status === "error") return { label: "En erreur", tone: "amber", symbol: "!" };
  if (!status.ready) return { label: "Configuration serveur incomplète", tone: "amber", symbol: "!" };
  return { label: "Non connecté", tone: "neutral", symbol: "○" };
};

/** Connexion Google Search Console (Paramètres → Connexions). Aucune valeur secrète n'est lue ni affichée. */
export function SearchConsolePanel({ status, banner, unavailable }: { status: SearchConsoleStatus | null; banner: { ok: boolean; message: string } | null; unavailable: boolean }) {
  if (unavailable || !status) {
    return (
      <Panel className="p-6">
        <h2 className="font-semibold">Google Search Console</h2>
        <p className="mt-2 text-sm text-warning">État indisponible : la migration Search Console (20261022000000) n’est peut-être pas encore appliquée.</p>
      </Panel>
    );
  }
  const badge = statusOf(status);
  const connection = status.connection;
  const active = connection?.status === "active";
  return (
    <Panel className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">Google Search Console</h2>
          <p className="mt-1 text-sm text-muted">Clics organiques, impressions, CTR et positions des sites clients, en lecture seule (scope <code className="text-xs">webmasters.readonly</code>). Un seul compte Google pour l’agence ; chaque client est ensuite associé à une propriété depuis sa fiche.</p>
        </div>
        <StatusBadge {...badge} />
      </div>

      {banner && <div className="mt-4"><InlineNotice tone={banner.ok ? "green" : "amber"}>{banner.message}</InlineNotice></div>}

      {!status.ready && (
        <div className="mt-4"><InlineNotice tone="amber" title="Variables serveur manquantes ou invalides">
          <p>À définir dans Vercel → Settings → Environment Variables (Production) : <span className="font-mono text-xs">{status.missing.join(", ")}</span>.</p>
          <p className="mt-1">Sans GOOGLE_SEARCH_CONSOLE_CLIENT_ID / _SECRET, le client OAuth déjà configuré pour Google Business Profile est réutilisé.</p>
        </InlineNotice></div>
      )}

      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div className="min-w-0"><dt className="text-muted">URI de redirection à autoriser dans Google Cloud</dt><dd className="mt-0.5 break-all font-mono text-xs">{status.redirectUri ?? "— (PUBLICATIONS_OAUTH_BASE_URL manquante)"}</dd></div>
        <div><dt className="text-muted">Identifiants OAuth utilisés</dt><dd className="mt-0.5">{status.credentials === "search_console" ? "Client dédié (GOOGLE_SEARCH_CONSOLE_*)" : status.credentials === "business_profile" ? "Client partagé avec Google Business Profile" : "—"}</dd></div>
        {connection?.connectedAt && <div><dt className="text-muted">Connecté le</dt><dd className="mt-0.5">{dateTime(connection.connectedAt)}</dd></div>}
        {connection?.discoveredAt && <div><dt className="text-muted">Propriétés actualisées le</dt><dd className="mt-0.5">{dateTime(connection.discoveredAt)}</dd></div>}
      </dl>
      {connection?.lastError && <p className="mt-3 text-sm text-warning">{connection.lastError}</p>}
      {status.legacy && !active && <p className="mt-3 text-xs text-muted">Un ancien jeton serveur (GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN) est encore utilisé tant que la connexion OAuth n’est pas établie.</p>}

      <div className="mt-5 flex flex-wrap items-start gap-3">
        <MutationForm action={startSearchConsoleOAuthAction} label={active ? "Reconnecter Google Search Console" : "Connecter Google Search Console"} pendingLabel="Redirection vers Google…" variant="primary" disabled={!status.ready} />
        {active && <MutationForm action={refreshSearchConsolePropertiesAction} label="Actualiser les propriétés" pendingLabel="Actualisation…" />}
        {connection && connection.status !== "disabled" && (
          <MutationForm action={disconnectSearchConsoleAction} label="Déconnecter" pendingLabel="Déconnexion…" variant="danger"
            confirm="Déconnecter Google Search Console ? Le jeton est supprimé de CODE-V OS ; les données déjà synchronisées sont conservées. L’autorisation Google n’est pas révoquée automatiquement (client OAuth partagé avec d’autres intégrations)." />
        )}
      </div>

      {active && (
        <details className="mt-5 rounded-xl border border-border bg-surface-sunken px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">{connection.properties.length} propriété{connection.properties.length > 1 ? "s" : ""} accessible{connection.properties.length > 1 ? "s" : ""}</summary>
          {connection.properties.length ? (
            <ul className="mt-3 space-y-1.5">
              {connection.properties.map((item) => (
                <li key={item.property} className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-all">{propertyLabel(item.property)}</span><span className="text-xs text-muted">{permissionLabels[item.permission]}</span></li>
              ))}
            </ul>
          ) : <p className="mt-2 text-muted">Aucune propriété validée pour ce compte Google. Ajoutez ce compte comme utilisateur des propriétés dans Search Console, puis actualisez.</p>}
          <p className="mt-3 text-xs text-muted">Association par client : fiche client → onglet Agents → Sources de données.</p>
        </details>
      )}
      <p className="mt-4 text-xs text-subtle">Révocation complète : <a className="text-accent hover:underline" href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer noopener">myaccount.google.com/permissions</a>. Attention : si le client OAuth est partagé, cela retire aussi l’accès des autres intégrations Google de CODE-V OS pour ce compte.</p>
    </Panel>
  );
}
