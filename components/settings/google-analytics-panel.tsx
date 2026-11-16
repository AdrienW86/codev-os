import { Panel } from "@/components/ui/primitives";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { InlineNotice } from "@/components/ui/states";
import { MutationForm } from "@/components/ui/mutation-form";
import { disconnectGoogleAnalyticsAction, refreshGoogleAnalyticsPropertiesAction, startGoogleAnalyticsOAuthAction } from "@/app/(cockpit)/settings/google-analytics-actions";
import { analyticsPropertyLabel } from "@/lib/integrations/google-analytics/model";
import type { GoogleAnalyticsStatus } from "@/lib/integrations/google-analytics/connection";

const dateTime = (value: string) => new Date(value).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });
const credentialLabels = { google_analytics: "Client dédié (GOOGLE_ANALYTICS_*)", search_console: "Client partagé avec Search Console", business_profile: "Client partagé avec Google Business Profile" } as const;

const statusOf = (status: GoogleAnalyticsStatus): { label: string; tone: StatusTone; symbol: string } => {
  const connection = status.connection;
  if (connection?.status === "active") return { label: "Connecté", tone: "green", symbol: "✓" };
  if (connection?.status === "revoked") return { label: "Accès révoqué", tone: "red", symbol: "!" };
  if (!status.ready) return { label: "Configuration serveur incomplète", tone: "amber", symbol: "!" };
  return { label: "Non connecté", tone: "neutral", symbol: "○" };
};

/** Connexion Google Analytics 4 (Paramètres → Connexions). Aucune valeur secrète n'est lue ni affichée. */
export function GoogleAnalyticsPanel({ status, banner, unavailable }: { status: GoogleAnalyticsStatus | null; banner: { ok: boolean; message: string } | null; unavailable: boolean }) {
  if (unavailable || !status) {
    return (
      <Panel className="p-6">
        <h2 className="font-semibold">Google Analytics 4</h2>
        <p className="mt-2 text-sm text-warning">État indisponible pour le moment.</p>
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
          <h2 className="font-semibold">Google Analytics 4</h2>
          <p className="mt-1 text-sm text-muted">Sessions, canaux, pages de destination, engagement et événements clés des sites clients, en lecture seule (scope <code className="text-xs">analytics.readonly</code>). Utilisé par l’Agent SEO et l’Agent Google Ads. Un seul compte Google pour l’agence ; chaque client est associé à une propriété depuis sa fiche.</p>
        </div>
        <StatusBadge {...badge} />
      </div>

      {banner && <div className="mt-4"><InlineNotice tone={banner.ok ? "green" : "amber"}>{banner.message}</InlineNotice></div>}

      {!status.ready && (
        <div className="mt-4"><InlineNotice tone="amber" title="Variables serveur manquantes ou invalides">
          <p>À définir dans Vercel → Settings → Environment Variables (Production) : <span className="font-mono text-xs">{status.missing.join(", ")}</span>.</p>
          <p className="mt-1">Sans GOOGLE_ANALYTICS_CLIENT_ID / _SECRET, le client OAuth de Search Console (ou à défaut celui de Google Business Profile) est réutilisé.</p>
        </InlineNotice></div>
      )}

      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div className="min-w-0"><dt className="text-muted">URI de redirection à autoriser dans Google Cloud</dt><dd className="mt-0.5 break-all font-mono text-xs">{status.redirectUri ?? "— (PUBLICATIONS_OAUTH_BASE_URL manquante)"}</dd></div>
        <div><dt className="text-muted">Identifiants OAuth utilisés</dt><dd className="mt-0.5">{status.credentials ? credentialLabels[status.credentials] : "—"}</dd></div>
        {connection?.connectedAt && <div><dt className="text-muted">Connecté le</dt><dd className="mt-0.5">{dateTime(connection.connectedAt)}</dd></div>}
        {connection?.discoveredAt && <div><dt className="text-muted">Propriétés actualisées le</dt><dd className="mt-0.5">{dateTime(connection.discoveredAt)}</dd></div>}
      </dl>
      {connection?.lastError && <p className="mt-3 text-sm text-warning">{connection.lastError}</p>}

      <div className="mt-5 flex flex-wrap items-start gap-3">
        <MutationForm action={startGoogleAnalyticsOAuthAction} label={active ? "Reconnecter Google Analytics" : "Connecter Google Analytics"} pendingLabel="Redirection vers Google…" variant="primary" disabled={!status.ready} />
        {active && <MutationForm action={refreshGoogleAnalyticsPropertiesAction} label="Actualiser les propriétés" pendingLabel="Actualisation…" />}
        {connection && connection.status !== "disabled" && (
          <MutationForm action={disconnectGoogleAnalyticsAction} label="Déconnecter" pendingLabel="Déconnexion…" variant="danger"
            confirm="Déconnecter Google Analytics ? Le jeton est supprimé de CODE-V OS ; les données déjà synchronisées sont conservées. L’autorisation Google n’est pas révoquée automatiquement (client OAuth partagé avec d’autres intégrations)." />
        )}
      </div>

      {active && (
        <details className="mt-5 rounded-xl border border-border bg-surface-sunken px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">{connection.properties.length} propriété{connection.properties.length > 1 ? "s" : ""} GA4 accessible{connection.properties.length > 1 ? "s" : ""}</summary>
          {connection.properties.length ? (
            <ul className="mt-3 space-y-1.5">
              {connection.properties.map((item) => <li key={item.property} className="min-w-0 break-words">{analyticsPropertyLabel(item)}</li>)}
            </ul>
          ) : <p className="mt-2 text-muted">Aucune propriété GA4 pour ce compte Google. Ajoutez ce compte avec le rôle « Lecteur » dans Google Analytics (Administration → Gestion des accès à la propriété), puis actualisez.</p>}
          <p className="mt-3 text-xs text-muted">Association par client : fiche client → onglet Agents → Sources de données.</p>
        </details>
      )}
    </Panel>
  );
}
