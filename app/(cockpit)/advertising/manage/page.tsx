import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/require-admin";
import { listClients } from "@/lib/clients/data";
import { getGoogleAdsConnection } from "@/lib/integrations/google-ads/service";
import { AdsManualManager } from "@/components/google-ads/manual-manager";
import { PageHeading } from "@/components/ui/primitives";
import { AutopilotPanel } from "@/components/google-ads/autopilot-panel";
import { listAutopilotChanges, readAutopilotSettings } from "@/lib/ads/autopilot-service";

export const metadata: Metadata = { title: "Gestion Google Ads" };

export default async function ManageAdsPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  await requireAdmin();
  const clients = await listClients();
  const connected = await Promise.all(clients.map(async (client) => {
    try {
      const account = await getGoogleAdsConnection(client.id);
      if (account?.status !== "connected") return null;
      const id = (account.external_account_id ?? "").replace(/-/g, "");
      return /^\d{10}$/.test(id) ? { id: client.id, name: client.name, account: id } : null;
    } catch { return null; }
  }));
  const available = connected.filter((item): item is NonNullable<typeof item> => item !== null);
  const { client } = await searchParams;
  const initialClient = available.some((item) => item.id === client) ? client! : "";
  const selected = available.find((item) => item.id === initialClient) ?? null;
  const [settings, changes] = selected ? await Promise.all([readAutopilotSettings(selected.id), listAutopilotChanges(selected.id)]) : [null, null];
  return <>
    <PageHeading eyebrow="Google Ads" title="Gérer les campagnes" description="Préparer des modifications Google Ads pour les comptes clients connectés." />
    <p className="mb-5 text-sm"><Link href="/advertising" className="text-accent">← Retour aux campagnes</Link></p>
    {!available.length ? <p>Aucun compte Google Ads client connecté.</p> : <AdsManualManager clients={available} initialClient={initialClient} />}
    {selected && settings ? <AutopilotPanel clientId={selected.id} clientName={selected.name} available={settings.available} serverEnabled={settings.serverEnabled} mode={settings.mode} maxPerCampaignWeek={settings.maxPerCampaignWeek} changes={changes} />
      : available.length ? <p className="mt-6 text-sm text-muted">Pilote automatique : {available.map((item, index) => <span key={item.id}>{index ? ", " : ""}<Link href={`/advertising/manage?client=${item.id}`} className="text-accent">{item.name}</Link></span>)}.</p> : null}
  </>;
}
