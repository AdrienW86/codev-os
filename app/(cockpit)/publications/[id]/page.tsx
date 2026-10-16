import Link from "next/link";
import {notFound} from "next/navigation";
import {requireAdmin} from "@/lib/require-admin";
import {getWorkspace} from "@/lib/publications/workspace";
import {loadPublicationDetail} from "@/lib/publications/drawer";
import {platformLabels} from "@/lib/publications/editor";
import {boardOriginLabels} from "@/lib/publications/board-query";
import {PublicationWorkspace} from "@/components/publications/publication-drawer";
import {PageHeading,Panel,Badge} from "@/components/ui/primitives";
import {formatDate} from "@/lib/format-date";
import {publicationActorLabel} from "@/lib/publications/actor-label";
import {getDraftSchedulingOptions} from "@/lib/publications/draft-scheduling";
import {ScheduleDraftForm} from "@/components/publications/schedule-draft-form";

const labels={draft:"Brouillon",pending_review:"À valider",approved:"Approuvée",rejected:"Refusée"};
const eventLabels:Record<string,string>={"publication.scheduled":"Brouillon rattaché à un créneau du calendrier (nouvelle révision à valider)","publication.scheduled_split":"Brouillon planifié en une publication par plateforme, puis archivé","publication.created_from_occurrence":"Publication créée sur un créneau du calendrier","publication.archived":"Publication archivée","publication.placeholder_created":"Brouillon vide créé par le système","publication.created":"Publication créée","publication.revised":"Nouvelle révision","publication.draft_saved":"Brouillon enregistré","publication.project_changed":"Projet modifié","publication.variant_saved":"Variante enregistrée","publication.media_uploaded":"Image privée ajoutée","publication.media_attached":"Image associée à la révision","publication.media_detached":"Image retirée de la révision","publication.submitted":"Révision soumise à validation","publication.reviewed":"Décision de validation enregistrée","publication.preparation_started":"Préparation manuelle démarrée","publication.media_catalog_read":"Catalogue de photos lu","publication.media_reserved":"Photo réservée","publication.ai_prepared":"Préparation IA soumise à validation","publication.preparation_failed":"Préparation interrompue ou échouée"};

export default async function PublicationDetailPage({params}:{params:Promise<{id:string}>}){
 await requireAdmin();const {id}=await params,w=await getWorkspace(id);if(!w)notFound();
 // Reuse the already-authorized workspace; delivery and channel locks are freshly read by the shared loader.
 const load=await loadPublicationDetail(id,{debug:false,workspace:w}),p=w.publication;
 const revision=w.revisions.find(r=>r.id===p.current_revision_id),detail=load.state==='ok'?load.detail:null;
 const scheduling=detail&&!detail.readOnly?await getDraftSchedulingOptions(id).catch(()=>undefined):null;
 const section="mt-6 min-w-0 space-y-4 break-words [overflow-wrap:anywhere] p-4 sm:p-6";
 return <div className="min-w-0 break-words [overflow-wrap:anywhere]">
  <PageHeading title={p.subject} eyebrow={`Publication · ${p.creation_origin==="agent"?boardOriginLabels.agent:p.creation_origin==="system"?boardOriginLabels.planning:boardOriginLabels.manual}`} description={`Révision ${revision?.revision_number??"—"} · Dernière modification ${formatDate(p.updated_at)}`}/>
  <div className="flex flex-wrap items-center gap-4"><Badge>{labels[p.status]}</Badge><Link href="/publications" className="text-sm text-accent">← Publications</Link>{detail&&!detail.readOnly&&<Link href={`/publications/${id}/edit`} className="text-sm text-accent">Créer une nouvelle révision</Link>}</div>
  {detail?<>
   <Panel className={section}><h2 className="font-semibold">Client et projet</h2><p><Link className="text-accent" href={`/clients/${p.client_id}?tab=publications`}>{detail.clientName}</Link> · {detail.projectName??"Historique sans projet"}</p><p className="text-sm text-muted">Date cible : {p.target_date?formatDate(p.target_date):"Non définie"} · {p.slot?<>Semaine du {formatDate(p.editorial_week)} · Créneau {p.slot}</>:p.occurrence_id?<>Créneau du calendrier</>:<>Non planifié : aucun créneau réservé, diffusion impossible avant planification</>}</p>{p.project_id&&<Link className="text-sm text-accent" href={`/projects/${p.project_id}/calendar`}>Ouvrir le calendrier du projet →</Link>}</Panel>
   {scheduling!==null&&p.slot==null&&!p.occurrence_id&&!p.archived_at&&<Panel className={section}><h2 className="font-semibold">Planifier ce brouillon</h2>{scheduling?<ScheduleDraftForm publicationId={scheduling.publicationId} revisionId={scheduling.revisionId} choices={scheduling.choices}/>:<p role="alert" className="text-sm text-danger">Créneaux du calendrier indisponibles. Rechargez la page.</p>}</Panel>}
   <div className="mt-6 space-y-5" data-publication-workspace="true"><PublicationWorkspace detail={detail} showHistory={false}/></div>
   <Panel className={section}><h2 className="font-semibold">Contenu source</h2><p className="whitespace-pre-wrap">{revision?.angle??"Angle historique non renseigné"}</p><p className="whitespace-pre-wrap text-sm">{revision?.source_content??"Source historique non renseignée"}</p></Panel>
  </>:<Panel className={section}><p role="alert">Vérification des envois ou des canaux impossible. La publication reste en lecture seule par sécurité ; rechargez la page.</p></Panel>}
  <Panel className={section}><h2 className="font-semibold">Historique des révisions</h2>{w.revisions.map(r=><details key={r.id} className="rounded-lg border border-border p-4"><summary>Version {r.revision_number} · {publicationActorLabel(r.actor_id)} · {formatDate(r.created_at)} {r.id===p.current_revision_id?"· Actuelle":"· Historique"}</summary><p className="mt-3 text-sm">{r.project_id===p.project_id?detail?.projectName??"Projet indisponible":r.project_id?"Projet historique":"Sans projet"}</p><p>{r.internal_title}</p><p className="whitespace-pre-wrap text-sm">{r.angle}</p><p className="whitespace-pre-wrap text-sm">{r.source_content}</p>{w.variants.filter(v=>v.revision_id===r.id).map(v=><p key={v.id} className="mt-4 whitespace-pre-wrap text-sm">{platformLabels[v.platform]} : {v.text_content}</p>)}{w.reviews.filter(v=>v.revision_id===r.id).map(v=><p key={v.id} className="mt-2 text-xs text-muted">Validation {r.id===p.current_revision_id?"actuelle":"historique"} : {v.decision==='approved'?'Approuvée':'Refusée'} par {publicationActorLabel(v.actor_id)} · {formatDate(v.created_at)}{v.reason&&r.id!==p.current_revision_id&&` · ${v.reason}`}</p>)}</details>)}</Panel>
  <Panel className={section}><h2 className="font-semibold">Journal non supprimable</h2><ol className="space-y-3">{w.events.map(e=><li key={e.id} className="border-t border-border pt-3 text-sm"><p>{eventLabels[e.action]??"Événement interne"}</p><p className="text-xs text-muted">{formatDate(e.created_at)} · {publicationActorLabel(e.actor_id,e.actor_type)}</p></li>)}</ol></Panel>
 </div>;
}
