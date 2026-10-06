import Link from "next/link";
import {notFound} from "next/navigation";
import {requireAdmin} from "@/lib/require-admin";
import {getWorkspace} from "@/lib/publications/workspace";
import {listClients} from "@/lib/clients/data";
import {listProjects} from "@/lib/projects/data";
import {ManualPublicationForm} from "@/components/publications/manual-form";
import {PageHeading,Panel} from "@/components/ui/primitives";
export default async function EditPublicationPage({params}:{params:Promise<{id:string}>}){await requireAdmin();const {id}=await params;const workspace=await getWorkspace(id);if(!workspace)notFound();const [clients,projects]=await Promise.all([listClients(),listProjects()]);const revision=workspace.revisions.find(r=>r.id===workspace.publication.current_revision_id);return <><PageHeading title="Nouvelle révision" eyebrow="Publications" description="Les versions précédentes et leurs validations restent conservées."/><Link href={`/publications/${id}`} className="text-sm text-accent">← Fiche publication</Link><Panel className="mt-6 p-6"><ManualPublicationForm clients={clients} projects={projects} publication={workspace.publication} revision={revision} variants={workspace.variants.filter(v=>v.revision_id===revision?.id)} assets={workspace.assets} links={workspace.links}/></Panel></>;}
