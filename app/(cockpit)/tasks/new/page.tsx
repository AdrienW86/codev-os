import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { TaskForm } from "@/components/work/task-form";
import { listClients } from "@/lib/clients/data";
import { listProjects } from "@/lib/projects/data";
import { requireAdmin } from "@/lib/require-admin";

export const metadata: Metadata = { title: "Nouvelle tâche" };

export default async function NewTaskPage() {
  await requireAdmin();
  const [clients, projects] = await Promise.all([listClients(), listProjects()]);
  return <><Link href="/tasks" className="mb-6 inline-block text-xs text-accent hover:underline">← Toutes les tâches</Link><PageHeading eyebrow="Organisation" title="Nouvelle tâche" description="Ajoutez une tâche au suivi CODE-V." /><Panel className="max-w-3xl p-6"><TaskForm clients={clients} projects={projects} /></Panel></>;
}