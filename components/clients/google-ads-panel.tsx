import "server-only";
import { Badge, Panel } from "@/components/ui/primitives";
import { getGoogleAdsConnection, buildGoogleAdsAnalysisContext } from "@/lib/integrations/google-ads/service";
import { GoogleAdsCheckForm, GoogleAdsConfigurationForm } from "./google-ads-forms";
import type { AdsAnalysisContext, GoogleAdsConnection } from "@/lib/integrations/google-ads/types";
import { formatDate } from "@/lib/format-date";
import { requireAdmin } from "@/lib/require-admin";

export async function GoogleAdsPanel({ clientId, days = 30 }: { clientId: string; days?: number }) {
  await requireAdmin();
  let connection: GoogleAdsConnection | null = null;
  let context: AdsAnalysisContext | null = null;
  let unavailable = false;
  try {
    connection = await getGoogleAdsConnection(clientId);
    if (connection?.status === "connected") context = await buildGoogleAdsAnalysisContext(clientId, days);
  } catch { unavailable = true; }
  const money = (value: number | null) => value === null || !context ? "Indisponible" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: context.account.currency }).format(value);
  const number = (value: number | null) => value === null ? "Indisponible" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);
  const status = unavailable ? "Indisponible" : connection?.status === "connected" ? "Connecté" : connection?.status === "error" ? "Erreur" : "Non connecté";
  return <Panel className="mt-8 p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Google Ads</h2><div className="flex gap-2"><Badge>Lecture seule</Badge><Badge tone={status === "Connecté" ? "green" : status === "Erreur" || unavailable ? "amber" : "neutral"}>{status}</Badge></div></div>
    {connection && <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-muted">Customer ID</dt><dd>{connection.external_account_id}</dd></div><div><dt className="text-muted">Compte</dt><dd>{context?.account.name ?? connection.metadata.account_name ?? "À vérifier"}</dd></div><div><dt className="text-muted">Devise</dt><dd>{context?.account.currency ?? connection.metadata.currency_code ?? "À vérifier"}</dd></div><div><dt className="text-muted">Dernière vérification</dt><dd>{formatDate(connection.last_checked_at)}</dd></div></dl>}
    {unavailable && <p role="alert" className="mt-4 text-sm text-amber-300">Impossible de charger Google Ads. Vérifiez la connexion et les credentials serveur.</p>}
    {context && <>
      <p className="mt-5 text-xs text-muted">Résumé {context.period.days} jours · {context.period.start} → {context.period.end} · {context.account.timezone} · aujourd’hui exclu</p>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
        ["Dépenses", money(context.totals.cost)], ["Clics", number(context.totals.clicks)], ["Impressions", number(context.totals.impressions)], ["Conversions", number(context.totals.conversions)],
        ["CTR", context.totals.ctr === null ? "Indisponible" : `${number(context.totals.ctr * 100)} %`], ["CPC moyen", money(context.totals.averageCpc)], ["Coût / conversion", money(context.totals.costPerConversion)], ["Valeur des conversions", money(context.totals.conversionValue)],
      ].map(([label, value]) => <div key={label} className="rounded-lg border border-border p-3"><dt className="text-xs text-muted">{label}</dt><dd className="mt-2 font-semibold">{value}</dd></div>)}</dl>
      <p className="mt-3 text-xs text-muted">{context.campaigns.length} campagnes. Les conversions peuvent être retardées ou leur suivi incomplet.</p>
    </>}
    <form method="get" className="mt-4 flex flex-wrap items-end gap-3"><label className="text-xs text-muted">Période<select name="ads_days" defaultValue={days} className="ml-2 rounded-lg border border-border bg-background px-3 py-2 text-foreground">{[7, 30, 90].map((value) => <option key={value} value={value}>{value} jours</option>)}</select></label><button className="text-sm text-accent">Afficher</button></form>
    <GoogleAdsConfigurationForm clientId={clientId} customerId={connection?.external_account_id ?? undefined} managerId={connection?.metadata.manager_customer_id} />
    {connection && <GoogleAdsCheckForm clientId={clientId} refresh={connection.status === "connected"} />}
  </Panel>;
}
