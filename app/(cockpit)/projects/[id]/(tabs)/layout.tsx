import {Suspense} from "react";
import Link from "next/link";
import {notFound} from "next/navigation";
import {PageHeading,Badge} from "@/components/ui/primitives";
import {ProjectTabs,ProjectTabLinks} from "@/components/projects/project-tabs";
import {getProjectById} from "@/lib/projects/data";
import {getPublicationProjectChannels} from "@/lib/publications/project-channels";
import {projectSupportsPublications} from "@/lib/publications/channels";
import {projectTabs} from "@/lib/projects/workspace-view";
// Shared header and tab navigation for the project workspace; /projects/[id]/edit stays outside this group.
export default async function ProjectWorkspaceLayout({children,params}:LayoutProps<"/projects/[id]">){
 const {id}=await params,project=await getProjectById(id);if(!project)notFound();
 const tabs=projectTabs(id,projectSupportsPublications(await getPublicationProjectChannels(project)));
 return <><Link className="text-accent" href={`/clients/${project.client_id}`}>← {project.client?.name??"Client"}</Link>
 <PageHeading eyebrow={project.type??"Projet"} title={project.name} description={`Progression ${project.progress} % · Responsable : ${project.responsible??"Non défini"}`} action={<Badge>{project.status}</Badge>}/>
 <Link className="text-accent" href={`/projects/${id}/edit`}>Modifier le projet</Link>
 <Suspense fallback={<ProjectTabLinks tabs={tabs} active={undefined}/>}><ProjectTabs tabs={tabs}/></Suspense>
 {children}</>;
}
