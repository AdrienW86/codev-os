import { requireAdmin } from "@/lib/require-admin";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading } from "@/components/ui/primitives";
import { ProjectCard } from "@/components/work/work-cards";
import { listProjects } from "@/lib/projects/data";

export const metadata: Metadata = { title: "Projets" };

export default async function ProjectsPage() {
  await requireAdmin();
  const projects = await listProjects();
  return (
    <>
      <PageHeading eyebrow="Pilotage" title="Projets" description="Les projets CODE-V, de leur préparation à leur livraison." action={<div className="flex flex-wrap items-center gap-4"><span className="text-xs text-muted">{projects.length} projets · {projects.filter((project) => project.status !== "Terminé").length} en cours de suivi</span><Link href="/projects/new" className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-background">+ Nouveau projet</Link></div>} />
      <h2 className="sr-only">Tous les projets</h2>
      {projects.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{projects.map((project) => <ProjectCard key={project.id} project={project} />)}</div> : <p className="border-t border-border py-8 text-sm text-muted">Aucun projet enregistré. Créez le premier projet pour commencer le suivi.</p>}
    </>
  );
}
