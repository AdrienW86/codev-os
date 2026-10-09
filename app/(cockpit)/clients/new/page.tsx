import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/require-admin";
import { ClientForm } from "@/components/clients/client-form";
import { PageHeading, Panel } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Nouveau client" };

export default async function NewClientPage() {
  await requireAdmin();
  return <><Link href="/clients" className="mb-6 inline-block text-xs text-accent hover:underline">← Tous les clients</Link><PageHeading eyebrow="Portefeuille" title="Nouveau client" description="Ajoutez un client au portefeuille CODE-V." /><Panel className="max-w-3xl p-6"><ClientForm /></Panel></>;
}
