import Link from "next/link";
import {notFound} from "next/navigation";
import {Panel,Badge} from "@/components/ui/primitives";
import {DebugDetails} from "@/components/projects/debug-details";
import {getProjectById} from "@/lib/projects/data";
import {listPublications} from "@/lib/publications/data";
import {allowedPlatforms} from "@/lib/publications/editor";
import {formatDay,isDebugView,publicationStatusLabel} from "@/lib/projects/workspace-view";
// Lot 4.1-b: navigation and base structure only. Review cards and actions arrive in 4.1-c; decisions stay on the existing pages.
export default async function ProjectReviewPage({params,searchParams}:PageProps<"/projects/[id]/review">){
 const {id}=await params,search=await searchParams,project=await getProjectById(id);if(!project||!allowedPlatforms(project.type).length)notFound();
 const publications=await listPublications(project.client_id,id),byDate=(a:{target_date:string|null;editorial_week:string},b:{target_date:string|null;editorial_week:string})=>(a.target_date??a.editorial_week).localeCompare(b.target_date??b.editorial_week);
 const pending=publications.filter(p=>p.status==="pending_review").sort(byDate),rejected=publications.filter(p=>p.status==="rejected").sort(byDate);
 const card=(p:(typeof publications)[number])=><li key={p.id} className="rounded-lg border border-border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-muted">{formatDay(p.target_date??p.editorial_week)}</p><Badge>{publicationStatusLabel(p.status)}</Badge></div><p className="mt-2 font-medium">{p.subject}</p><Link className="mt-2 inline-block text-sm text-accent" href={`/publications/${p.id}`}>Ouvrir la publication</Link></li>;
 return <><Panel className="mt-6 p-6"><h2 className="font-semibold">À valider <span className="text-sm font-normal text-muted">({pending.length})</span></h2>{pending.length?<ul className="mt-4 grid gap-3 md:grid-cols-2">{pending.map(card)}</ul>:<p className="mt-3 text-sm text-muted">Aucune publication en attente de validation pour ce projet.</p>}<Link className="mt-4 inline-block text-sm text-accent" href="/publications/review">Ouvrir la file de validation complète</Link></Panel>
 <Panel className="mt-6 p-6"><h2 className="font-semibold">Rejetées <span className="text-sm font-normal text-muted">({rejected.length})</span></h2>{rejected.length?<ul className="mt-4 grid gap-3 md:grid-cols-2">{rejected.map(card)}</ul>:<p className="mt-3 text-sm text-muted">Aucune publication rejetée.</p>}</Panel>
 <DebugDetails enabled={isDebugView(search)} data={{project_id:id,pending:pending.map(p=>({id:p.id,current_revision_id:p.current_revision_id})),rejected:rejected.map(p=>({id:p.id,current_revision_id:p.current_revision_id}))}}/></>;
}
