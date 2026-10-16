import Link from "next/link";
import {requireAdmin} from "@/lib/require-admin";
import {listClients} from "@/lib/clients/data";
import {listProjects} from "@/lib/projects/data";
import {ManualPublicationForm} from "@/components/publications/manual-form";
import {publicationProjectOptions} from "@/lib/publications/project-channels";
import {PageHeading,Panel} from "@/components/ui/primitives";
export default async function NewPublicationPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 await requireAdmin();const [clients,projects,search]=await Promise.all([listClients(),listProjects(),searchParams]);const options=await publicationProjectOptions(projects);
 const requestedClient=typeof search?.client==='string'?search.client:'',requestedProject=typeof search?.project==='string'?search.project:'';
 const initialClient=clients.some(c=>c.id===requestedClient)?requestedClient:'',initialProject=options.some(p=>p.id===requestedProject&&p.client_id===initialClient)?requestedProject:'';
 return <><PageHeading title="Nouvelle publication" eyebrow="Préparation manuelle" description="Rédigez et validez vos contenus sans API. L’enregistrement ne déclenche aucune diffusion."/><Link href="/publications" className="text-sm text-accent">← Publications</Link><Panel className="mt-6 p-6"><ManualPublicationForm clients={clients} projects={options} initialClient={initialClient} initialProject={initialProject}/></Panel></>;
}
