import "server-only";
import { Badge, Panel } from "@/components/ui/primitives";
import Link from "next/link";
import { getGoogleAdsConnection } from "@/lib/integrations/google-ads/service";
import { GoogleAdsCheckForm, GoogleAdsConfigurationForm } from "./google-ads-forms";
import type { GoogleAdsConnection } from "@/lib/integrations/google-ads/types";
import { formatDate } from "@/lib/format-date";
import { requireAdmin } from "@/lib/require-admin";

export async function GoogleAdsPanel({ clientId }: { clientId: string }) {
  await requireAdmin();
  let connection: GoogleAdsConnection | null = null;
  let unavailable = false;
  try { connection = await getGoogleAdsConnection(clientId); } catch { unavailable = true; }
  const status = unavailable ? "Indisponible" : connection?.status === "connected" ? "Connecté" : connection?.status === "error" ? "Erreur" : "Non connecté";
  return <Panel className="mt-8 p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Google Ads</h2><div className="flex gap-2"><Badge>Lecture seule</Badge><Badge tone={status === "Connecté" ? "green" : status === "Erreur" || unavailable ? "amber" : "neutral"}>{status}</Badge></div></div>
    {connection && <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-muted">Customer ID</dt><dd>{connection.external_account_id}</dd></div><div><dt className="text-muted">Compte</dt><dd>{connection.metadata.account_name ?? "À vérifier"}</dd></div><div><dt className="text-muted">Devise</dt><dd>{connection.metadata.currency_code ?? "À vérifier"}</dd></div><div><dt className="text-muted">Dernière vérification</dt><dd>{formatDate(connection.last_checked_at)}</dd></div></dl>}
    {unavailable && <p role="alert" className="mt-4 text-sm text-amber-300">Impossible de charger Google Ads. Vérifiez la connexion et les credentials serveur.</p>}
    {connection?.status === "connected" && <p className="mt-4 text-sm"><Link href={`/advertising?client=${clientId}`} className="text-accent hover:underline">Campagnes publicitaires (période, statut, type) →</Link></p>}
    <GoogleAdsConfigurationForm clientId={clientId} customerId={connection?.external_account_id ?? undefined} managerId={connection?.metadata.manager_customer_id} />
    {connection && <GoogleAdsCheckForm clientId={clientId} refresh={connection.status === "connected"} />}
  </Panel>;
}
