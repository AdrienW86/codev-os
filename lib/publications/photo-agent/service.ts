import 'server-only';
// Agent Photo (Publications découpées, lot 4). Quand une préparation de l'Agent Rédacteur n'a trouvé aucune photo dans
// la photothèque, l'agent rédige la description d'une image d'illustration à partir du texte, l'image est générée
// (OpenAI Images) puis rangée en attente. RIEN n'est attaché sans la validation explicite de l'administrateur :
// « Valider l'image » attache l'image aux brouillons et les passe « À valider » ; « Valider et approuver » approuve
// aussi la publication ; « Refuser » laisse l'agent proposer une autre image (3 propositions au plus).
// Sans la migration 20261214000000 ou sans clé OpenAI, l'agent reste inactif : comportement d'avant.
import {createHash,randomUUID} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {requireAdmin} from '@/lib/require-admin';
import {writeAudit} from '@/lib/core/audit';
import {clientAiBudget,structuredResponse,withAiScope} from '@/lib/ai/metered';
import {withCharter} from '@/lib/harness/charter';
import {imageGenerationConfigured,openaiImageGenerator,type ImageGenerator} from '@/lib/integrations/publications-openai-images';
import {IMAGE_BUCKET} from '../editor';
import {adaptImage} from '../media/transform';
import {parisToday} from '../calendar';
import {publicationPlatforms,type PublicationPlatform} from '../types';
import {
 IMAGE_COST_EUR,MAX_IMAGES_PER_TICK,PHOTO_PROMPT_INSTRUCTIONS,PHOTO_PROMPT_SCHEMA,isUuid,photoCandidates,readPhotoPrompt,
 type PhotoCandidatePublication,type PhotoCandidateRun,type ProposalRow,
} from './model';

export const GENERATED_BUCKET='publication-generated';
const TABLE='publication_generated_images';
const db=()=>getSupabaseServerClient() as unknown as SupabaseClient;
const log=(step:string,code?:string)=>console.error('[photo-agent]',{step,...(code?{code}:{})});
const missingTable=(error:unknown)=>{const e=error as {code?:string;message?:string}|null;return e?.code==='42P01'||e?.code==='PGRST205'||/could not find the table|does not exist/i.test(e?.message??'');};
const isPlatform=(value:unknown):value is PublicationPlatform=>(publicationPlatforms as readonly unknown[]).includes(value);

export type PhotoAgentSummary={disabled?:'credential'|'migration';candidates:number;generated:number;skipped:number;failed:number;budget:number};

type PubRow={id:string;client_id:string;project_id:string|null;status:string;archived_at:string|null;target_date:string|null;editorial_week:string|null;slot:number|null;current_revision_id:string|null;subject:string|null};
type VariantRow={revision_id:string;platform:string;text_content:string;metadata:unknown};
async function publicationsWithTexts(ids:readonly string[]){
 const pubs=await db().from('publications').select('id,client_id,project_id,status,archived_at,target_date,editorial_week,slot,current_revision_id,subject').in('id',[...ids]);
 if(pubs.error||!pubs.data)throw Error('publications read');
 const rows=pubs.data as PubRow[];
 const revisions=rows.flatMap(row=>row.current_revision_id?[row.current_revision_id]:[]);
 const variants=revisions.length?await db().from('publication_variants').select('revision_id,platform,text_content,metadata').in('revision_id',revisions):{data:[],error:null};
 if(variants.error)throw Error('variants read');
 return {rows,variants:(variants.data??[]) as VariantRow[]};
}

/** Passage du planificateur : au plus MAX_IMAGES_PER_TICK images proposées, jamais attachées. */
export async function runPhotoAgentTick(now=new Date(),generate:ImageGenerator=openaiImageGenerator):Promise<PhotoAgentSummary>{
 const summary:PhotoAgentSummary={candidates:0,generated:0,skipped:0,failed:0,budget:0};
 if(generate===openaiImageGenerator&&!imageGenerationConfigured())return {...summary,disabled:'credential'};
 const since=new Date(now.getTime()-45*86400000).toISOString();
 const runs=await db().from('publication_agent_v2_runs').select('id,client_id,status,media_status,media_attempts,created_at,publication_ids')
  .eq('status','completed').in('media_status',['none','needs_media']).gte('created_at',since).order('created_at',{ascending:true}).limit(100);
 if(runs.error||!runs.data)throw Error('runs read');
 const runRows=runs.data as PhotoCandidateRun[];
 if(!runRows.length)return summary;
 const proposals=await db().from(TABLE).select('run_id,status').in('run_id',runRows.map(run=>run.id));
 if(proposals.error){if(missingTable(proposals.error))return {...summary,disabled:'migration'};throw Error('proposals read');}
 const pubIds=[...new Set(runRows.flatMap(run=>Array.isArray(run.publication_ids)?run.publication_ids.filter(isUuid):[]))];
 const pubs=pubIds.length?await db().from('publications').select('id,status,archived_at,target_date').in('id',pubIds):{data:[],error:null};
 if(pubs.error)throw Error('publications read');
 const candidates=photoCandidates(runRows,(pubs.data??[]) as PhotoCandidatePublication[],(proposals.data??[]) as ProposalRow[],now,parisToday(now));
 summary.candidates=candidates.length;
 for(const candidate of candidates.slice(0,MAX_IMAGES_PER_TICK)){
  const outcome=await proposeImage(candidate,generate).catch(()=>'failed' as const);
  summary[outcome]++;
 }
 return summary;
}

async function proposeImage(candidate:{runId:string;clientId:string;publicationIds:string[]},generate:ImageGenerator):Promise<'generated'|'skipped'|'failed'|'budget'>{
 const budget=await clientAiBudget(candidate.clientId).catch(()=>undefined);
 if(budget===undefined)return 'failed';
 if(budget&&(!budget.allowed||budget.remaining<IMAGE_COST_EUR+0.05))return 'budget';
 const [{rows,variants},client]=await Promise.all([publicationsWithTexts(candidate.publicationIds),db().from('clients').select('name,activity').eq('id',candidate.clientId).maybeSingle()]);
 const texts=variants.map(v=>({platform:v.platform,text:v.text_content.slice(0,1500)}));
 if(!texts.length)return 'failed';
 const activity=(client.data as {activity?:string|null}|null)?.activity??null;
 const response=await withAiScope({agent:'publication-photo',clientId:candidate.clientId},()=>structuredResponse(withCharter('publication-photo',PHOTO_PROMPT_INSTRUCTIONS),
  JSON.stringify({activity_untrusted:activity,subject_untrusted:rows[0]?.subject??null,texts_untrusted:texts}),PHOTO_PROMPT_SCHEMA,{maxOutputTokens:800,timeoutMs:60000}));
 const prompt=readPhotoPrompt(response.value);
 const id=randomUUID();
 if(!prompt.ok){
  const r=await db().from(TABLE).insert({id,client_id:candidate.clientId,run_id:candidate.runId,publication_ids:candidate.publicationIds,status:'skipped',prompt:prompt.reason,storage_path:null,model:'none'});
  if(r.error)log('skip','not_recorded');
  return 'skipped';
 }
 const image=await generate(prompt.prompt);
 const path=`${candidate.clientId}/${id}.png`;
 const upload=await db().storage.from(GENERATED_BUCKET).upload(path,image.bytes,{contentType:'image/png',upsert:false});
 if(upload.error){log('upload','failed');return 'failed';}
 const inserted=await db().from(TABLE).insert({id,client_id:candidate.clientId,run_id:candidate.runId,publication_ids:candidate.publicationIds,status:'pending_review',prompt:prompt.prompt,storage_path:path,model:image.model,estimated_cost_eur:IMAGE_COST_EUR});
 if(inserted.error){await db().storage.from(GENERATED_BUCKET).remove([path]);log('insert',inserted.error.code);return 'failed';}
 // Coût de l'image compté dans le budget IA du client (journal ai_usage, absent = non mesuré).
 const usage=await db().from('ai_usage').insert({agent:'publication-photo',client_id:candidate.clientId,input_tokens:0,output_tokens:0,estimated_cost_eur:IMAGE_COST_EUR,model:image.model});
 if(usage.error&&!missingTable(usage.error))log('usage','not_recorded');
 await db().from('admin_notifications').upsert({event_key:`generated-image:${id}`,category:'media_missing',href:'/publications/images'},{onConflict:'event_key',ignoreDuplicates:true}).then(r=>{if(r.error)log('notify','failed');});
 await writeAudit({kind:'system',worker:'photo-agent'},{action:'publication_image.generated',resource_type:'publication_agent_v2_run',resource_id:candidate.runId,metadata:{client_id:candidate.clientId,image_id:id,model:image.model}}).catch(()=>undefined);
 return 'generated';
}

// ---------------------------------------------------------------------------------------------
// Validation par l'administrateur.
// ---------------------------------------------------------------------------------------------

export type PendingImage={id:string;clientId:string;clientName:string;createdAt:string;preview:string|null;prompt:string;model:string;
 publications:{id:string;platform:string;targetDate:string|null;text:string}[]};

export async function listPendingImages():Promise<{available:boolean;items:PendingImage[]}>{
 await requireAdmin();
 const rows=await db().from(TABLE).select('id,client_id,publication_ids,prompt,storage_path,model,created_at').eq('status','pending_review').order('created_at',{ascending:true}).limit(30);
 if(rows.error){if(missingTable(rows.error))return {available:false,items:[]};throw Error('images read');}
 const data=(rows.data??[]) as {id:string;client_id:string;publication_ids:string[];prompt:string;storage_path:string;model:string;created_at:string}[];
 const clientIds=[...new Set(data.map(row=>row.client_id))];
 const clients=clientIds.length?await db().from('clients').select('id,name').in('id',clientIds):{data:[],error:null};
 const names=new Map(((clients.data??[]) as {id:string;name:string}[]).map(row=>[row.id,row.name]));
 const items:PendingImage[]=[];
 for(const row of data){
  const [{rows:pubs,variants},signed]=await Promise.all([publicationsWithTexts(row.publication_ids),db().storage.from(GENERATED_BUCKET).createSignedUrl(row.storage_path,900)]);
  items.push({id:row.id,clientId:row.client_id,clientName:names.get(row.client_id)??'Client',createdAt:row.created_at,preview:signed.error?null:signed.data?.signedUrl??null,prompt:row.prompt,model:row.model,
   publications:pubs.flatMap(pub=>variants.filter(v=>v.revision_id===pub.current_revision_id).map(v=>({id:pub.id,platform:v.platform,targetDate:pub.target_date,text:v.text_content})))});
 }
 return {available:true,items};
}

export type ImageDecision='approve'|'approve_publish'|'reject';
/** Décision de l'administrateur. L'attache passe par les RPC existantes (image enregistrée, nouvelle révision). */
export async function decideGeneratedImage(id:string,decision:ImageDecision,reason?:string):Promise<{ok:boolean;message:string}>{
 const {userId}=await requireAdmin();
 if(!isUuid(id)||!['approve','approve_publish','reject'].includes(decision))return {ok:false,message:'Demande invalide.'};
 const found=await db().from(TABLE).select('id,client_id,run_id,publication_ids,storage_path,model,status').eq('id',id).maybeSingle();
 const row=found.data as {id:string;client_id:string;run_id:string;publication_ids:string[];storage_path:string;model:string;status:string}|null;
 if(found.error||!row)return {ok:false,message:'Image introuvable.'};
 if(row.status!=='pending_review')return {ok:false,message:'Cette image a déjà été traitée.'};
 const decide=(status:string,extra:Record<string,unknown>={})=>db().from(TABLE).update({status,decided_by:userId,decided_at:new Date().toISOString(),...extra}).eq('id',id).eq('status','pending_review').select('id');
 if(decision==='reject'){
  const r=await decide('rejected',{rejection_reason:(reason??'').trim().slice(0,500)||null});
  if(r.error||!r.data?.length)return {ok:false,message:'Refus non enregistré. Rechargez la page.'};
  await writeAudit({kind:'admin',userId},{action:'publication_image.rejected',resource_type:'publication_agent_v2_run',resource_id:row.run_id,metadata:{image_id:id}}).catch(()=>undefined);
  return {ok:true,message:'Image refusée. L’Agent Photo proposera une autre image au prochain passage (3 propositions au plus).'};
 }
 const attached=await attachToPublications(row,userId,decision==='approve_publish').catch(()=>null);
 if(!attached){await decide('attach_failed');return {ok:false,message:'Image validée mais non attachée (publication modifiée, archivée ou déjà diffusée). Ajoutez une photo depuis la publication.'};}
 const r=await decide('approved');
 if(r.error)log('decide','not_recorded');
 await writeAudit({kind:'admin',userId},{action:'publication_image.approved',resource_type:'publication_agent_v2_run',resource_id:row.run_id,metadata:{image_id:id,publications:row.publication_ids,approved_publication:decision==='approve_publish'}}).catch(()=>undefined);
 return {ok:true,message:decision==='approve_publish'?'Image attachée et publication approuvée : elle partira à son créneau.':'Image attachée : la publication est maintenant « À valider ».'};
}

async function attachToPublications(row:{client_id:string;publication_ids:string[];storage_path:string;model:string},userId:string,approve:boolean):Promise<true|null>{
 const original=await db().storage.from(GENERATED_BUCKET).download(row.storage_path);
 if(original.error||!original.data)return null;
 const bytes=new Uint8Array(await original.data.arrayBuffer());
 const {rows,variants}=await publicationsWithTexts(row.publication_ids);
 const day=new Date().toISOString().slice(0,10);
 for(const pub of rows){
  if(pub.status!=='draft'||pub.archived_at||!pub.current_revision_id||pub.client_id!==row.client_id)return null;
  const revision=await db().from('publication_revisions').select('internal_title,angle,source_content').eq('id',pub.current_revision_id).maybeSingle();
  const rev=revision.data as {internal_title:string|null;angle:string|null;source_content:string|null}|null;
  if(revision.error||!rev)return null;
  const own=variants.filter(v=>v.revision_id===pub.current_revision_id&&isPlatform(v.platform));
  if(!own.length)return null;
  const assets=new Map<string,string>();
  for(const variant of own){
   const d=await adaptImage(bytes,variant.platform as PublicationPlatform),assetId=randomUUID(),path=`${pub.client_id}/${pub.id}/${assetId}`;
   const up=await db().storage.from(IMAGE_BUCKET).upload(path,d.bytes,{contentType:d.mime_type,upsert:false});if(up.error)return null;
   const reg=await db().rpc('publication_register_image',{p_publication_id:pub.id,p_revision_id:pub.current_revision_id,p_asset_id:assetId,p_path:path,
    p_hash:createHash('sha256').update(d.bytes).digest('hex'),p_mime:d.mime_type,
    p_provenance:`Image d’illustration générée par IA (Agent Photo, ${row.model}), validée par l’administrateur le ${day}. Ce n’est pas une photo d’un chantier du client.`,p_actor_id:userId});
   if(reg.error){await db().storage.from(IMAGE_BUCKET).remove([path]);return null;}
   assets.set(variant.platform,assetId);
  }
  const saved=await db().rpc('publication_save_draft',{p_publication_id:pub.id,p_expected_revision_id:pub.current_revision_id,p_client_id:pub.client_id,p_project_id:pub.project_id,
   p_title:rev.internal_title,p_angle:rev.angle,p_source:rev.source_content,p_target_date:pub.target_date,p_week:pub.editorial_week,p_slot:pub.slot,
   p_variants:own.map(v=>({platform:v.platform,text_content:v.text_content,asset_ids:[assets.get(v.platform)],metadata:v.metadata??{}})),p_actor_id:userId});
  if(saved.error)return null;
  const current=await db().from('publications').select('current_revision_id').eq('id',pub.id).maybeSingle();
  const revisionId=(current.data as {current_revision_id?:string|null}|null)?.current_revision_id;
  if(current.error||!revisionId)return null;
  const submitted=await db().rpc('publication_submit_manual',{p_publication_id:pub.id,p_revision_id:revisionId,p_actor_id:userId});
  if(submitted.error)return null;
  if(approve){const approved=await db().rpc('publication_review_manual',{p_publication_id:pub.id,p_revision_id:revisionId,p_decision:'approved',p_reason:null,p_actor_id:userId});if(approved.error)return null;}
 }
 return true;
}
