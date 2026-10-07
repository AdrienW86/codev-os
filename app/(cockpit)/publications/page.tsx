import Link from "next/link";
import {requireAdmin} from "@/lib/require-admin";
import {getPublicationSettingsState} from "@/lib/publications/data";
import {listPublicationBoardRows} from "@/lib/publications/board";
import {parseBoardQuery} from "@/lib/publications/board-query";
import {allowedPlatforms} from "@/lib/publications/editor";
import {listClients} from "@/lib/clients/data";
import {listProjects} from "@/lib/projects/data";
import {PageHeading} from "@/components/ui/primitives";
import {PublicationSettingsPanel} from "@/components/publications/settings-panel";
import {PublicationsBoard,PublicationsNav} from "@/components/publications/publications-board";
// Main operational view: every filter, sort and page lives in the URL (back button, sharing, persistence).
export default async function PublicationsPage({searchParams}:PageProps<"/publications">){
 await requireAdmin();const query=parseBoardQuery(await searchParams);
 const [result,settings,clients,projects]=await Promise.all([listPublicationBoardRows(query),getPublicationSettingsState(),listClients(),listProjects()]);
 return <><PageHeading title="Publications" eyebrow="Contenus clients" description="Tableau opérationnel de toutes les publications. Aucun contenu n’est publié." action={<div className="flex flex-wrap items-center gap-3"><PublicationsNav current="board"/><Link href="/publications/review" className="rounded-lg border border-border px-4 py-2 text-sm">File de validation</Link><Link href="/publications/new" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-background">Nouvelle publication</Link></div>}/>
 <PublicationSettingsPanel settings={settings}/>
 <PublicationsBoard result={result} query={query} clients={clients.map(c=>({id:c.id,name:c.name}))} projects={projects.filter(p=>allowedPlatforms(p.type).length).map(p=>({id:p.id,name:p.name,client_id:p.client_id}))}/></>;
}
