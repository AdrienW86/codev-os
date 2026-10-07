import Link from "next/link";
import {requireAdmin} from "@/lib/require-admin";
import {listClients} from "@/lib/clients/data";
import {listProjects} from "@/lib/projects/data";
import {ManualPublicationForm} from "@/components/publications/manual-form";
import {publicationProjectOptions} from "@/lib/publications/project-channels";
import {PageHeading,Panel} from "@/components/ui/primitives";
export default async function NewPublicationPage(){await requireAdmin();const [clients,projects]=await Promise.all([listClients(),listProjects()]);return <><PageHeading title="Nouvelle publication" eyebrow="Préparation manuelle" description="Brouillon interne, sans génération ni publication externe."/><Link href="/publications" className="text-sm text-accent">← Publications</Link><Panel className="mt-6 p-6"><ManualPublicationForm clients={clients} projects={await publicationProjectOptions(projects)}/></Panel></>;}
