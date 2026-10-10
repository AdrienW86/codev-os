import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/require-admin";
import { listClients } from "@/lib/clients/data";
import { getGoogleAdsConnection, loadCampaignDashboard, ANALYSIS_ENGINE_NOTE } from "@/lib/integrations/google-ads/service";
import { parseFilters, writeFilters } from "@/lib/integrations/google-ads/dashboard";
import { CampaignDashboard } from "@/components/google-ads/campaign-dashboard";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { loadGoogleAdsDashboardAction, prepareGoogleAdsReportAction, runGoogleAdsScopeAnalysisAction } from "../clients/[id]/google-ads-actions";
import { getActiveScenario } from "@/lib/simulation/server";
import { saveTrackedCampaignsAction } from "./actions";

export const metadata: Metadata = { title: "Campagnes publicitaires" };

export default async function AdvertisingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  if (await getActiveScenario()) return <><PageHeading eyebrow="Google Ads" title="Campagnes publicitaires" description="" /><p>Cette vue utilise les comptes réels. Quittez la simulation pour la consulter.</p></>;
  const search = await searchParams;
  const clients = await listClients();
  const client = clients.find((item) => item.id === search.client);
  const filters = parseFilters(search);
  // Le changement de client conserve la période, mais jamais les identifiants des campagnes de l'ancien compte.
  const preserved = writeFilters(new URLSearchParams(), { ...filters, campaigns: [], includeUntracked: false });
  let connection = null;
  let connectionError = false;
  if (client) try { connection = await getGoogleAdsConnection(client.id); } catch { connectionError = true; }
  const initial = client && connection?.status === "connected" ? await loadCampaignDashboard(client.id, filters) : null;
  return <>
    <PageHeading eyebrow="Google Ads" title="Campagnes publicitaires" description="Campagnes suivies, analyses et rapports par client. Google Ads reste en lecture seule." />
    <Panel className="mb-6 p-4">
      <form action="/advertising" className="flex flex-wrap items-end gap-3">
        {Array.from(preserved.entries()).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <label className="min-w-0 flex-1 text-sm">Client
          <select name="client" defaultValue={client?.id ?? ""} className="mt-2 block min-h-12 w-full rounded-lg border border-border bg-background px-3">
            <option value="">Choisir un client</option>{clients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <button className="min-h-12 rounded-lg border border-border px-4 text-sm">Afficher</button>
      </form>
      {client && <div className="mt-4 flex flex-wrap gap-3 text-sm"><span>Compte associé : {connection?.external_account_id ?? "aucun"}{connection?.metadata.account_name ? ` · ${connection.metadata.account_name}` : ""}</span><Link href={`/clients/${client.id}?tab=agents`} className="text-accent">Connexion et agents</Link><Link href={`/reports?client=${client.id}`} className="text-accent">Rapports du client</Link></div>}
    </Panel>
    {!clients.length ? <p>Aucun client enregistré. <Link href="/clients/new" className="text-accent">Créer un client</Link></p>
      : !client ? <p role={search.client ? "alert" : "status"}>{search.client ? "Client introuvable. Choisissez un client de votre portefeuille." : "Choisissez un client pour consulter son compte publicitaire."}</p>
      : connectionError ? <p role="alert">Connexion indisponible. Rechargez la page pour réessayer.</p>
      : !initial ? <p role="status">Aucun compte Google Ads connecté et vérifié. <Link href={`/clients/${client.id}?tab=agents`} className="text-accent">Configurer la connexion</Link></p>
      : <CampaignDashboard key={client.id} clientId={client.id} initial={initial} initialFilters={filters} load={loadGoogleAdsDashboardAction} prepareReport={prepareGoogleAdsReportAction} runAnalysis={runGoogleAdsScopeAnalysisAction} analysisNote={ANALYSIS_ENGINE_NOTE} saveTracking={saveTrackedCampaignsAction} />}
  </>;
}
