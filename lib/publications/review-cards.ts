import 'server-only';
import {getWorkspace} from './workspace';
import {getAiRunForRevision,getGenerationDetails} from './agent-data';
import {currentVariants,decisionFor,versionHistory,primaryMedia} from './publication-detail';
import type {PublicationListItem,PublicationPlatform} from './types';

export type ReviewCardVariant={platform:PublicationPlatform;label:string;text:string;title:string|null;cta:string|null;assetIds:string[]};
export type ReviewCardVersion={number:number;origin:string;date:string;decision:string|null;reason:string|null;current:boolean};
export type ReviewCardData={
 publicationId:string;revisionId:string;clientId:string;projectId:string;status:'pending_review'|'rejected';
 date:string;subject:string;clientName:string;projectName:string;image:string|null;variants:ReviewCardVariant[];
 editorial:{title:string;angle:string;source:string;targetDate:string};rejection:string|null;versions:ReviewCardVersion[];
 debug:Record<string,unknown>|null};

export {originLabels} from './publication-detail';

// Builds the review cards of pending and rejected publications: a projection of the shared detail logic
// (variants, media, history). Previews are the short-lived signed URLs of getWorkspace; technical data is only
// loaded when the debug view is requested.
export async function buildReviewCards(publications:PublicationListItem[],options:{debug:boolean}):Promise<ReviewCardData[]>{
 const eligible=publications.filter(p=>(p.status==='pending_review'||p.status==='rejected')&&p.current_revision_id&&p.project_id);
 const cards=await Promise.all(eligible.map(async p=>{
  const w=await getWorkspace(p.id);if(!w||w.publication.current_revision_id!==p.current_revision_id)return null;
  const revisionId=p.current_revision_id!,revision=w.revisions.find(r=>r.id===revisionId);
  const detailed=currentVariants(w,revisionId),variants=detailed.map(v=>({platform:v.platform,label:v.label,text:v.text,title:v.title,cta:v.cta,assetIds:v.assetIds}));
  const assetIds=[...new Set(variants.flatMap(v=>v.assetIds))],image=primaryMedia(detailed).preview,rejected=decisionFor(w,revisionId);
  const versions=versionHistory(w,revisionId);
  let debug:Record<string,unknown>|null=null;
  if(options.debug){const [details,run]=await Promise.all([getGenerationDetails(revisionId),getAiRunForRevision(revisionId)]);
   debug={publication_id:p.id,revision_id:revisionId,run_id:details?.run_id??run?.id??null,model:revision?.model??run?.model??null,input_tokens:run?.input_tokens??null,output_tokens:run?.output_tokens??null,estimated_cost_eur:run?.estimated_cost_eur??revision?.estimated_cost??null,
    opportunity:details?.selected_opportunity??null,media_id:details?.media_id??null,asset_ids:assetIds,storage_paths:assetIds.map(id=>w.assets.find(a=>a.id===id)?.storage_path??null),factual_basis:details?.factual_basis??null,generation_summary:details?.generation_summary??null};}
  return {publicationId:p.id,revisionId,clientId:p.client_id,projectId:p.project_id!,status:p.status as ReviewCardData['status'],date:p.target_date??p.editorial_week,subject:p.subject,
   clientName:p.client?.name??'Client',projectName:p.project?.name??'Projet',image,variants,
   editorial:{title:p.subject,angle:revision?.angle??p.subject,source:revision?.source_content??variants[0]?.text??p.subject,targetDate:p.target_date??''},
   rejection:p.status==='rejected'?rejected?.reason??null:null,versions,debug} satisfies ReviewCardData;
 }));
 return cards.filter((c):c is ReviewCardData=>c!==null).sort((a,b)=>a.date.localeCompare(b.date));
}
