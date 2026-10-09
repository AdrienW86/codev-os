import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { ProjectForm } from "@/components/work/project-form";
import { listClients } from "@/lib/clients/data";
import { requireAdmin } from "@/lib/require-admin";

export const metadata: Metadata = { title: "Nouveau projet" };

export default async function NewProjectPage() {
  await requireAdmin();
  const clients = await listClients();
  return <><Link href="/projects" className="mb-6 inline-block text-xs text-accent hover:underline">← Tous les projets</Link><PageHeading eyebrow="Pilotage" title="Nouveau projet" description="Ajoutez un projet au portefeuille CODE-V." /><Panel className="max-w-3xl p-6"><ProjectForm clients={clients} /></Panel></>;
}