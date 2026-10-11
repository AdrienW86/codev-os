import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/require-admin";
import { safeRead } from "@/lib/core/safe-read";
import { getActiveScenario } from "@/lib/simulation/server";
import { getAnalyticsDashboard, listAnalyticsClients, type AnalyticsDashboardState } from "@/lib/analytics/dashboard";
import { resolveChannel, resolveCompare, resolvePeriod } from "@/lib/analytics/view-model";
import { getSeoDashboard, listSeoClients, type SeoDashboardState } from "@/lib/integrations/search-console/dashboard";
import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";
import { SeoDashboard } from "@/components/analytics/seo-dashboard";
import { PageHeading } from "@/components/ui/primitives";
import { EmptyState, InlineNotice } from "@/components/ui/states";
import { ModuleUnavailable } from "@/components/ui/module-unavailable";
import { Tabs } from "@/components/ui/tabs";

export const metadata: Metadata = { title: "Données et performances" };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Source = "audience" | "seo";

// Deux sources distinctes, jamais additionnées : Vercel Web Analytics (visiteurs du site) et Google Search Console
// (clics organiques depuis Google). Client, période et comparaison restent dans l'URL quand on change d'onglet.
function sourceTabs(params: Record<string, string | string[] | undefined>, current: Source) {
  const href = (source: Source) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (typeof value === "string" && key !== "source" && key !== "channel") next.set(key, value);
    if (source === "seo") next.set("source", "seo");
    return `/analytics?${next.toString()}`;
  };
  return <Tabs label="Source des données" current={current} items={[
    { id: "audience", label: "Audience · Vercel Web Analytics", href: href("audience") },
    { id: "seo", label: "Référencement · Google Search Console", href: href("seo") },
  ]} />;
}

// Tableau de bord centralisé : un seul écran pour tous les clients, client choisi dans l'URL (?client=…).
export default async function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  await requireAdmin();
  const heading = <PageHeading eyebrow="Pilotage" title="Données et performances" description="Audience des sites clients (Vercel Web Analytics) et référencement naturel (Google Search Console)." />;
  if (await getActiveScenario()) return <>{heading}<InlineNotice tone="info" title="Mode simulation actif">Les données Analytics réelles ne sont pas affichées en simulation. Quittez la simulation depuis les paramètres pour consulter ce tableau de bord.</InlineNotice></>;

  const params = await searchParams;
  const source: Source = params.source === "seo" ? "seo" : "audience";
  const tabs = sourceTabs(params, source);
  const clients = await safeRead("analytics-clients", () => listAnalyticsClients(), []);
  if (clients.unavailable) return <>{heading}<ModuleUnavailable module="Données et performances" /></>;
  if (!clients.data.length) return <>{heading}<EmptyState icon="analytics" title="Aucun client enregistré" description="Ajoutez un client puis associez son projet Vercel ou sa propriété Search Console pour suivre ses performances." action={<Link href="/clients/new" className="text-sm text-accent hover:underline">Ajouter un client</Link>} /></>;

  const requested = typeof params.client === "string" && uuid.test(params.client) ? clients.data.find((client) => client.id === params.client) : undefined;
  if (!requested) {
    // Le client sélectionné est toujours porté par l'URL (vue partageable) : premier client connecté par défaut.
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (typeof value === "string" && key !== "client") next.set(key, value);
    next.set("client", clients.data[0].id);
    redirect(`/analytics?${next.toString()}`);
  }

  const period = resolvePeriod(params);
  const today = new Date().toISOString().slice(0, 10);

  if (source === "seo") {
    // Le sélecteur client choisit aussi la propriété Search Console associée à CE client (jamais celle d'un autre).
    const seoClients = await safeRead("search-console-clients", () => listSeoClients(), []);
    if (seoClients.unavailable) return <>{tabs}<ModuleUnavailable module="Google Search Console" /></>;
    const seoClient = seoClients.data.find((client) => client.id === requested.id);
    if (!seoClient) return <>{tabs}<ModuleUnavailable module="Google Search Console" /></>;
    const fallback: SeoDashboardState = { status: "unavailable", error: seoClient.lastError };
    const state = await safeRead("search-console-dashboard", () => getSeoDashboard(seoClient, period), fallback);
    return (
      <>
        {tabs}
        <SeoDashboard
          key={`${seoClient.id}:${period.start}:${period.end}`}
          clients={seoClients.data.map(({ id, name, property }) => ({ id, name, property }))}
          client={{ id: seoClient.id, name: seoClient.name }}
          property={seoClient.property}
          period={period}
          initialCompare={resolveCompare(params.compare)}
          today={today}
          state={state.data}
        />
      </>
    );
  }

  const fallback: AnalyticsDashboardState = { status: "unavailable", lastError: requested.lastError, latest: null };
  const state = await safeRead("analytics-dashboard", () => getAnalyticsDashboard(requested, period), fallback);

  return (
    <>
      {tabs}
      <AnalyticsDashboard
        key={`${requested.id}:${period.start}:${period.end}`}
        clients={clients.data.map(({ id, name, connected }) => ({ id, name, connected }))}
        client={{ id: requested.id, name: requested.name }}
        period={period}
        initialCompare={resolveCompare(params.compare)}
        initialChannel={resolveChannel(params.channel)}
        today={today}
        state={state.data}
      />
    </>
  );
}
