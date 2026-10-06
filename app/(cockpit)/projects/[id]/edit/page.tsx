import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectForm } from "@/components/work/project-form";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { listClients } from "@/lib/clients/data";
import { getProjectById } from "@/lib/projects/data";
import { requireAdmin } from "@/lib/require-admin";

export const metadata: Metadata = { title: "Modifier le projet" };

export default async function EditProjectPage({ params }: PageProps<"/projects/[id]/edit">) {
  await requireAdmin();
  const { id } = await params;
  const [project, clients] = await Promise.all([getProjectById(id), listClients()]);
  if (!project) notFound();
  return <><Link href="/projects" className="mb-6 inline-block text-xs text-accent hover:underline">← Tous les projets</Link><PageHeading eyebrow="Pilotage" title="Modifier le projet" description="Mettez à jour les informations du projet." /><Panel className="max-w-3xl p-6"><ProjectForm clients={clients} project={project} /></Panel></>;
}