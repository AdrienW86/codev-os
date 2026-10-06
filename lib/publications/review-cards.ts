import 'server-only';
import {getWorkspace} from './workspace';
import {getAiRunForRevision,getGenerationDetails} from './agent-data';
import {platformLabels} from './editor';
import type {PublicationListItem,PublicationPlatform,PublicationRevision} from './types';

export type ReviewCardVariant={platform:PublicationPlatform;label:string;text:string;title:string|null;cta:string|null;assetIds:string[]};
export type ReviewCardVersion={number:number;origin:string;date:string;decision:string|null;reason:string|null;current:boolean};
export type ReviewCardData={
 publicationId:string;revisionId:string;clientId:string;projectId:string;status:'pending_review'|'rejected';
 date:string;subject:string;clientName:string;projectName:string;image:string|null;variants:ReviewCardVariant[];
 editorial:{title:string;angle:string;source:string;targetDate:string};rejection:string|null;versions:ReviewCardVersion[];
 debug:Record<string,unknown>|null};

export const originLabels:Record<PublicationRevision['origin'],string>={generated:'IA',regenerated:'Régénération IA',manual:'Modification manuelle'};
const decisionLabels:Record<string,string>={approved:'Validée',rejected:'Rejetée'};
const text=(value:unknown)=>typeof value==='string'&&value.trim()?value:null;

// Builds the review cards of pending and rejected publications. Previews are the existing short-lived signed URLs of
// getWorkspace; technical data is only loaded when the debug view is requested.
export async function buildReviewCards(publications:PublicationListItem[],options:{debug:boolean}):Promise<ReviewCardData[]>{
 const eligible=publications.filter(p=>(p.status==='pending_review'||p.status==='rejected')&&p.current_revision_id&&p.project_id);
 const cards=await Promise.all(eligible.map(async p=>{
  const w=await getWorkspace(p.id);if(!w||w.publication.current_revision_id!==p.current_revision_id)return null;
  const revisionId=p.current_revision_id!,revision=w.revisions.find(r=>r.id===revisionId);
  const current=w.variants.filter(v=>v.revision_id===revisionId).sort((a,b)=>Object.keys(platformLabels).indexOf(a.platform)-Object.keys(platformLabels).indexOf(b.platform));
  const variants=current.map(v=>{const m=(v.metadata??{}) as Record<string,unknown>;return {platform:v.platform,label:platformLabels[v.platform],text:v.text_content,title:text(m.title),cta:text(m.cta),
   assetIds:w.links.filter(l=>l.variant_id===v.id).sort((a,b)=>a.sort_order-b.sort_order).map(l=>l.asset_id)};});
  const assetIds=[...new Set(variants.flatMap(v=>v.assetIds))],image=assetIds.map(id=>w.assets.find(a=>a.id===id)?.preview).find((url):url is string=>Boolean(url))??null;
  const decisionOf=(id:string)=>w.reviews.find(r=>r.revision_id===id)??null,rejected=decisionOf(revisionId);
  const versions=w.revisions.map(r=>{const d=decisionOf(r.id);return {number:r.revision_number,origin:originLabels[r.origin]??'Version',date:r.created_at,decision:d?decisionLabels[d.decision]??null:null,reason:d?.reason??null,current:r.id===revisionId};}).sort((a,b)=>b.number-a.number);
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
