import 'server-only';
import {getWorkspace} from './workspace';
import {currentVariants,primaryMedia,versionHistory,type MediaState} from './publication-detail';
import type {ReviewCardData,ReviewCardVariant} from './review-cards';
import type {PublicationListItem} from './types';

// Socle Publications, lot 7 (mobile) : cartes de validation de la supervision, avec l'aperçu de CHAQUE variante
// (photo propre à la plateforme). Même projection que buildReviewCards (variantes, médias, historique) : les
// formulaires Valider / Rejeter / Modifier existants reçoivent exactement le même ReviewCardData. Aucune donnée
// technique (pas de vue debug), aucun identifiant de stockage : uniquement l'URL signée courte de getWorkspace.
export type SupervisionVariant=ReviewCardVariant&{media:{state:MediaState;preview:string|null}};
export type SupervisionReviewItem={card:ReviewCardData;variants:SupervisionVariant[]};
export const SUPERVISION_REVIEW_LIMIT=10;

export async function buildSupervisionReviewItems(publications:readonly PublicationListItem[],limit=SUPERVISION_REVIEW_LIMIT):Promise<SupervisionReviewItem[]>{
 const pending=publications.filter(p=>p.status==='pending_review'&&!p.archived_at&&p.current_revision_id&&p.project_id)
  .sort((a,b)=>(a.target_date??a.editorial_week).localeCompare(b.target_date??b.editorial_week)).slice(0,limit);
 const items=await Promise.all(pending.map(async p=>{
  const w=await getWorkspace(p.id);if(!w||w.publication.current_revision_id!==p.current_revision_id)return null;
  const revisionId=p.current_revision_id!,revision=w.revisions.find(r=>r.id===revisionId);
  const detailed=currentVariants(w,revisionId);
  const variants=detailed.map(v=>({platform:v.platform,label:v.label,text:v.text,title:v.title,cta:v.cta,assetIds:v.assetIds,media:v.media}));
  const card:ReviewCardData={publicationId:p.id,revisionId,clientId:p.client_id,projectId:p.project_id!,status:'pending_review',date:p.target_date??p.editorial_week,subject:p.subject,
   clientName:p.client?.name??'Client',projectName:p.project?.name??'Projet',image:primaryMedia(detailed).preview,
   variants:detailed.map(v=>({platform:v.platform,label:v.label,text:v.text,title:v.title,cta:v.cta,assetIds:v.assetIds})),
   editorial:{title:p.subject,angle:revision?.angle??p.subject,source:revision?.source_content??variants[0]?.text??p.subject,targetDate:p.target_date??''},
   rejection:null,versions:versionHistory(w,revisionId),debug:null};
  return {card,variants};
 }));
 return items.filter((i):i is SupervisionReviewItem=>i!==null);
}
