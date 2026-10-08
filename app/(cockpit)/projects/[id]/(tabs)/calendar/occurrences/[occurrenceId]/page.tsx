import Link from "next/link";
import {notFound} from "next/navigation";
import {requireAdmin} from "@/lib/require-admin";
import {Panel} from "@/components/ui/primitives";
import {OccurrencePublicationForm} from "@/components/publications/occurrence-publication-form";
import {getProjectById} from "@/lib/projects/data";
import {getPublicationProjectChannels} from "@/lib/publications/project-channels";
import {getOccurrenceForCreation} from "@/lib/publications/occurrence-publications";
import {formatDay} from "@/lib/projects/workspace-view";
// Calendrier → créneau → Créer la publication (Lot 4.3 P4-b). Reading this page never writes.
export default async function OccurrencePublicationPage({params}:PageProps<"/projects/[id]/calendar/occurrences/[occurrenceId]">){
 await requireAdmin();const {id,occurrenceId}=await params,project=await getProjectById(id);if(!project)notFound();
 if((await getPublicationProjectChannels(project)).source!=="configured")notFound();
 const data=await getOccurrenceForCreation(occurrenceId,id);if(!data)notFound();
 const o=data.occurrence,back=`/projects/${id}/calendar?date=${o.date}`;
 return <Panel className="mt-6 p-6"><Link className="text-sm text-accent" href={back}>← Calendrier</Link>
  <h2 className="mt-3 font-semibold">{o.platformLabel} · <span className="capitalize">{formatDay(o.date)}</span> à {o.time}</h2>
  <p className="mt-1 text-sm text-muted">{o.stateLabel} · fuseau {o.timezone}</p>
  {o.publication?<p className="mt-4 text-sm">Publication liée : <Link className="text-accent" href={`/publications/${o.publication.id}`}>{o.publication.subject}</Link></p>
   :o.state==="skipped"?<p className="mt-4 text-sm">Créneau ignoré{o.skippedReason?` : ${o.skippedReason}`:""}. Aucune publication ne peut y être créée.</p>
   :<><p className="mt-4 text-sm text-muted">Une publication {o.platformLabel} unique, enregistrée en brouillon puis soumise à votre validation. Rien n’est diffusé.</p>
    <OccurrencePublicationForm projectId={id} occurrenceId={o.id} date={o.date} platformLabel={o.platformLabel} groups={data.groups}/></>}</Panel>;
}
