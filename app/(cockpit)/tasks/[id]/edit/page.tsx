import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TaskForm } from "@/components/work/task-form";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { listClients } from "@/lib/clients/data";
import { listProjects } from "@/lib/projects/data";
import { getTaskById } from "@/lib/tasks/data";
import { requireAdmin } from "@/lib/require-admin";

export const metadata: Metadata = { title: "Modifier la tâche" };

export default async function EditTaskPage({ params }: PageProps<"/tasks/[id]/edit">) {
  await requireAdmin();
  const { id } = await params;
  const [task, clients, projects] = await Promise.all([getTaskById(id), listClients(), listProjects()]);
  if (!task) notFound();
  return <><Link href="/tasks" className="mb-6 inline-block text-xs text-accent hover:underline">← Toutes les tâches</Link><PageHeading eyebrow="Organisation" title="Modifier la tâche" description="Mettez à jour les informations de suivi." /><Panel className="max-w-3xl p-6"><TaskForm clients={clients} projects={projects} task={task} /></Panel></>;
}