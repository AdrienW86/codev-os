import Link from "next/link";
import {Panel} from "@/components/ui/primitives";
import {getProjectCadence} from "@/lib/publications/planning";
import {defaultCadence,editorialMonday,parisToday} from "@/lib/publications/calendar";
import {allowedPlatforms} from "@/lib/publications/editor";
import {PlanningForm} from "./planning-form";
export async function EditorialPlanningSection({project}:{project:{id:string;type:string|null}}){
 if(!allowedPlatforms(project.type).length)return null;let cadence;try{cadence=await getProjectCadence(project.id);}catch{return <Panel className="mt-6 p-6"><h2 className="font-semibold">Planification éditoriale</h2><p className="mt-3 text-sm">Planification indisponible. Vérifiez l’accès au stockage et l’installation du calendrier.</p></Panel>;}
 return <Panel className="mt-6 p-6"><h2 className="font-semibold">Planification éditoriale</h2><Link className="mt-2 inline-block text-accent" href={`/publications/calendar?project=${project.id}`}>Voir le calendrier du projet</Link><PlanningForm key={cadence?.updated_at??project.id} projectId={project.id} cadence={cadence??defaultCadence(project.type)} startWeek={editorialMonday(parisToday())}/></Panel>;
}
