import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { ClientInformation } from "@/components/clients/client-information";
import { listClients } from "@/lib/clients/data";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage() {
  const clients = await listClients(); // Vérification admin avant toute lecture.
  return (
    <>
      <PageHeading eyebrow="Portefeuille" title="Clients" description="Votre portefeuille CODE-V. Les informations clients sont enregistrées dans Supabase." action={<Link href="/clients/new" className="rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-background">+ Nouveau client</Link>} />
      <Panel>
        <div className="flex items-center justify-between border-b border-border p-5"><h2 className="font-semibold">Votre portefeuille</h2><span className="text-xs text-muted">{clients.length} clients</span></div>
        {clients.length ? <ul className="divide-y divide-border">
          {clients.map((client) => (
            <li key={client.id} className="p-5">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-semibold"><Link href={`/clients/${client.id}`} className="hover:text-accent hover:underline">{client.name}</Link></h3>
                <Link href={`/clients/${client.id}`} className="text-xs text-accent hover:underline" aria-label={`Voir la fiche de ${client.name}`}>Voir la fiche →</Link>
              </div>
              <ClientInformation client={client} />
            </li>
          ))}
        </ul> : <div className="p-8"><h3 className="font-semibold">Votre portefeuille est prêt.</h3><p className="mt-2 text-sm text-muted">Aucun client enregistré. Ajoutez votre premier client pour commencer.</p><Link href="/clients/new" className="mt-5 inline-block text-sm text-accent">+ Nouveau client</Link></div>}
      </Panel>
    </>
  );
}
