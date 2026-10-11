import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/require-admin";
import { safeRead } from "@/lib/core/safe-read";
import { getActiveScenario } from "@/lib/simulation/server";
import { getAnalyticsDashboard, listAnalyticsClients, type AnalyticsDashboardState } from "@/lib/analytics/dashboard";
import { resolveChannel, resolveCompare, resolvePeriod } from "@/lib/analytics/view-model";
import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";
import { PageHeading } from "@/components/ui/primitives";
import { EmptyState, InlineNotice } from "@/components/ui/states";
import { ModuleUnavailable } from "@/components/ui/module-unavailable";

export const metadata: Metadata = { title: "Données et performances" };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Tableau de bord Analytics centralisé : un seul écran pour tous les clients, client choisi dans l'URL (?client=…).
export default async function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  await requireAdmin();
  const heading = <PageHeading eyebrow="Pilotage" title="Données et performances" description="Audience, acquisition et conversions des sites clients, depuis Vercel Web Analytics." />;
  if (await getActiveScenario()) return <>{heading}<InlineNotice tone="info" title="Mode simulation actif">Les données Analytics réelles ne sont pas affichées en simulation. Quittez la simulation depuis les paramètres pour consulter ce tableau de bord.</InlineNotice></>;

  const params = await searchParams;
  const clients = await safeRead("analytics-clients", () => listAnalyticsClients(), []);
  if (clients.unavailable) return <>{heading}<ModuleUnavailable module="Données et performances" /></>;
  if (!clients.data.length) return <>{heading}<EmptyState icon="analytics" title="Aucun client enregistré" description="Ajoutez un client puis associez son projet Vercel pour suivre ses performances." action={<Link href="/clients/new" className="text-sm text-accent hover:underline">Ajouter un client</Link>} /></>;

  const requested = typeof params.client === "string" && uuid.test(params.client) ? clients.data.find((client) => client.id === params.client) : undefined;
  if (!requested) {
    // Le client sélectionné est toujours porté par l'URL (vue partageable) : premier client connecté par défaut.
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (typeof value === "string" && key !== "client") next.set(key, value);
    next.set("client", clients.data[0].id);
    redirect(`/analytics?${next.toString()}`);
  }

  const period = resolvePeriod(params);
  const fallback: AnalyticsDashboardState = { status: "unavailable", lastError: requested.lastError, latest: null };
  const state = await safeRead("analytics-dashboard", () => getAnalyticsDashboard(requested, period), fallback);

  return (
    <AnalyticsDashboard
      key={`${requested.id}:${period.start}:${period.end}`}
      clients={clients.data.map(({ id, name, connected }) => ({ id, name, connected }))}
      client={{ id: requested.id, name: requested.name }}
      period={period}
      initialCompare={resolveCompare(params.compare)}
      initialChannel={resolveChannel(params.channel)}
      today={new Date().toISOString().slice(0, 10)}
      state={state.data}
    />
  );
}
