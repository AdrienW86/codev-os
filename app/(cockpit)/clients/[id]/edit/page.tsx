import type { Metadata } from "next";
import Link from "next/link";
import { ClientForm } from "@/components/clients/client-form";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { getClientOrNotFound } from "@/lib/clients/data";
import { requireAdmin } from "@/lib/require-admin";

export const metadata: Metadata = { title: "Modifier le client" };

export default async function EditClientPage({ params }: PageProps<"/clients/[id]/edit">) {
  await requireAdmin();
  const { id } = await params;
  const client = await getClientOrNotFound(id);
  return <><Link href={`/clients/${client.id}`} className="mb-6 inline-block text-xs text-accent hover:underline">← Fiche client</Link><PageHeading eyebrow="Portefeuille" title="Modifier le client" description="Mettez à jour les informations enregistrées du client." /><Panel className="max-w-3xl p-6"><ClientForm client={client} /></Panel></>;
}