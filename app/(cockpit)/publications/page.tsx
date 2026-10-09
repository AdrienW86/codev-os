import Link from "next/link";
import {requireAdmin} from "@/lib/require-admin";
import {getPublicationSettingsState} from "@/lib/publications/data";
import {listPublicationBoardRows} from "@/lib/publications/board";
import {loadPublicationDetail} from "@/lib/publications/drawer";
import {closeDrawerHref,parseBoardQuery} from "@/lib/publications/board-query";
import {publicationProjectOptions} from "@/lib/publications/project-channels";
import {listClients} from "@/lib/clients/data";
import {listProjects} from "@/lib/projects/data";
import {PageHeading} from "@/components/ui/primitives";
import {PublicationSettingsPanel} from "@/components/publications/settings-panel";
import {PublicationsBoard,PublicationsNav} from "@/components/publications/publications-board";
import {PublicationDrawer} from "@/components/publications/publication-drawer";
import {ProcessDueForm} from "@/components/publications/process-due-form";
import {getActiveScenario} from "@/lib/simulation/server";
import {SimPublications} from "@/components/simulation/views/sim-publications";
// Main operational view: every filter, sort, page and the open publication (publication=<id>) live in the URL.
export default async function PublicationsPage({searchParams}:PageProps<"/publications">){
 await requireAdmin();if(await getActiveScenario())return <SimPublications/>;const search=await searchParams,query=parseBoardQuery(search);
 const invalidLink=typeof search.publication==="string"&&search.publication!==""&&!query.publication;
 const [result,settings,clients,projects,drawer]=await Promise.all([listPublicationBoardRows(query),getPublicationSettingsState(),listClients(),listProjects(),
  query.publication?loadPublicationDetail(query.publication,{debug:query.debug}):Promise.resolve(null)]);
 return <><PageHeading title="Publications" eyebrow="Contenus clients" description="Tableau opérationnel de toutes les publications. Aucun envoi sans validation, préparation et action explicite." action={<div className="flex flex-wrap items-center gap-3"><PublicationsNav current="board"/><Link href="/publications/review" className="rounded-lg border border-border px-4 py-2 text-sm">File de validation</Link><Link href="/publications/new" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-background">Nouvelle publication</Link></div>}/>
 <PublicationSettingsPanel settings={settings}/>
 <ProcessDueForm stopped={settings?.emergency_stop!==false||settings?.publishing_enabled!==true}/>
 {invalidLink&&<p role="alert" data-invalid-publication-link="true" className="mt-4 rounded-lg border border-border p-3 text-sm">Lien de publication invalide : le panneau n’a pas été ouvert.</p>}
 <PublicationsBoard result={result} query={query} clients={clients.map(c=>({id:c.id,name:c.name}))} projects={(await publicationProjectOptions(projects)).map(p=>({id:p.id,name:p.name,client_id:p.client_id}))}/>
 {drawer&&<PublicationDrawer key={query.publication} load={drawer} closeHref={closeDrawerHref(query)}/>}</>;
}
