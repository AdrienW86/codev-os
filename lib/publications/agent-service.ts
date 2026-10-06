import 'server-only';
import {randomUUID,createHash} from 'node:crypto';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {driveReadProvider} from '@/lib/integrations/publications-drive';
import {openaiPublicationsProvider} from './ai/openai-provider';
import {validateGeneratedContent} from './ai/schemas';
import {MANUAL_RUN_RESERVE_EUR,type PublicationsAIProvider,type GenerationContext,type Usage} from './ai/provider';
import {adaptImage} from './media/transform';
import {selectSubjectPhoto} from './media/matching';
import type {MediaProvider} from './media/types';
import {buildPublicationAgentContext} from './agent-context';
import {isPublicationUuid} from './validation';
import type {Json} from '@/lib/supabase/database.types';
const json=(value:unknown):Json=>JSON.parse(JSON.stringify(value)) as Json;
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export async function configurePublicationsAgent(form:FormData){const {userId}=await requireAdmin();const project=form.get('project_id'),folder=form.get('folder'),services=form.get('services'),rules=form.get('rules');if(!isPublicationUuid(project)||typeof folder!=='string'||!/^[a-zA-Z0-9_-]{10,200}$/.test(folder)||typeof services!=='string'||typeof rules!=='string'||rules.length>4000||form.get('rights')!=='on')return {message:'Projet, dossier Drive, prestations confirmées et droits requis.'};const list=services.split('\n').map(s=>s.trim()).filter(Boolean);if(list.length<1||list.length>20||list.some(s=>s.length>100||!/^[\p{L} '-]{2,100}$/u.test(s))||new Set(list).size!==list.length)return {message:'Indiquez 1 à 20 prestations réelles distinctes, une par ligne, sans chiffres ni URL.'};const {error}=await getSupabaseServerClient().rpc('publication_agent_configure',{p_project:project,p_folder:folder,p_services:list,p_rules:rules,p_enabled:form.get('enabled')==='on',p_rights:true,p_actor:userId});return {message:error?'Configuration non confirmée. Vérifiez la migration du Lot 4.':'Agent configuré et explicitement assigné au projet.'};}

export async function preparePublication(projectId:string,publicationId:string,authorization:{allowRealAI:boolean},providers?:{ai:PublicationsAIProvider;media:MediaProvider}){
 const {userId}=await requireAdmin();if(!providers&&!authorization.allowRealAI)return {message:'Un appel IA réel doit être explicitement autorisé pour cette publication.'};
 const context=await buildPublicationAgentContext(projectId,publicationId),db=getSupabaseServerClient();let run:string|null=null,calledAI=false,completed=false;const uploads:{bucket:string;path:string}[]=[];const usage:Usage={input_tokens:0,output_tokens:0,estimated_cost_eur:0,model:'gpt-4.1-mini-2025-04-14'};
 const accumulate=(u:Usage)=>{if(!Number.isInteger(u.input_tokens)||!Number.isInteger(u.output_tokens)||u.input_tokens<0||u.output_tokens<0||!Number.isFinite(u.estimated_cost_eur)||u.estimated_cost_eur<0)throw Error('Invalid usage');usage.input_tokens+=u.input_tokens;usage.output_tokens+=u.output_tokens;usage.estimated_cost_eur+=u.estimated_cost_eur;if(usage.estimated_cost_eur>MANUAL_RUN_RESERVE_EUR)throw Error('Cost reservation exceeded');};
 try{
  const started=await db.rpc('publication_ai_begin',{p_publication:publicationId,p_expected:context.workspace.publication.current_revision_id,p_actor:userId});if(started.error)throw Error('Preparation guard refused');const state=started.data as {run_id:string;reused:boolean;status:string};if(state.reused)return {message:state.status==='completed'?'Cette préparation est déjà enregistrée.':'Une préparation est déjà en cours.'};run=state.run_id;
  const media=providers?.media??driveReadProvider(),ai=providers?.ai??openaiPublicationsProvider();
  const candidates=await media.list(context.config.drive_folder_id,context.client.id,projectId);if(candidates.some(p=>p.client_id!==context.client.id||p.project_id!==projectId))throw Error('Cross-client media');
  const catalog=await db.rpc('publication_ai_catalog',{p_run:run,p_photos:json(candidates)});if(catalog.error)throw Error('Catalog unavailable');const mapped=catalog.data as {id:string;drive_file_id:string;used:boolean}[];
  const available=candidates.flatMap(p=>{const m=mapped.find(m=>m.drive_file_id===p.drive_file_id);return m&&!m.used?[{...p,id:m.id}]:[];}).slice(0,3);
  if(!available.length){const failed=await db.rpc('publication_ai_fail',{p_run:run,p_error:'media_required',p_cost:0,p_input:0,p_output:0});if(failed.error)throw Error('Failure not confirmed');return {message:'media_required : aucune photo client disponible et non utilisée. Aucun contenu créé.'};}
  const binaries=new Map<string,Uint8Array>();for(const p of available){const bytes=await media.download(p.drive_file_id,context.config.drive_folder_id);if(bytes.length>8388608)throw Error('Media too large');binaries.set(p.id,bytes);}
  calledAI=true;const analysis=await ai.analyze(available.map(p=>({id:p.id,bytes:binaries.get(p.id)!})));accumulate(analysis.usage);
  const analyzed=available.map(p=>({...p,analysis:analysis.analyses.find(a=>a.id===p.id)?.analysis??null}));const pair=selectSubjectPhoto(context.opportunities,analyzed,context.client.id,projectId);
  if(!pair){const failed=await db.rpc('publication_ai_fail',{p_run:run,p_error:'needs_review',p_cost:usage.estimated_cost_eur,p_input:usage.input_tokens,p_output:usage.output_tokens});if(failed.error)throw Error('Failure not confirmed');return {message:'needs_review : aucune association sujet/photo suffisamment fiable. Aucun texte créé.'};}
  const bytes=binaries.get(pair.photo.id)!;const claim=await db.rpc('publication_ai_claim_media',{p_run:run,p_media:pair.photo.id,p_hash:hash(bytes),p_analysis:json(pair.photo.analysis)});if(claim.error)throw Error('Media already reserved');
  const refused=context.workspace.reviews.find(r=>r.revision_id===context.workspace.publication.current_revision_id&&r.decision==='rejected');
  const generation:GenerationContext={client_name:context.client.name,client_activity:context.client.activity,client_notes:context.client.notes?.slice(0,3000),project_name:context.project.name,cadence:context.cadence,history:{revisions:context.history.slice(0,10),variants:context.historyVariants.slice(0,20).map(v=>({platform:v.platform,text:v.text_content.slice(0,1000)})),reviews:context.historyReviews.slice(0,20),media_uses:context.mediaUses.slice(-20)},services:context.config.verified_services as string[],zone:context.client.geographic_area,website:context.client.website,rules:context.rules.slice(0,8000),subject:pair.opportunity.subject,opportunity:pair.opportunity,photo:pair.photo,platforms:context.platforms,
   approved_sentences:[`${pair.opportunity.service} : les points à vérifier avant une intervention.`,`${context.client.name} : ${pair.opportunity.service}.`,'Chaque situation mérite une analyse adaptée.','Contactez-nous pour parler de votre besoin.'],rejection:refused?.reason??null,previous_texts:context.workspace.variants.filter(v=>v.revision_id===context.workspace.publication.current_revision_id).map(v=>v.text_content.slice(0,3000))};
  const response=await ai.generate(generation);accumulate(response.usage);const content=validateGeneratedContent(response.content,generation);
  const original=`${context.client.id}/${publicationId}/${run}/original`;const uploaded=await db.storage.from('publication-originals').upload(original,bytes,{contentType:pair.photo.mime_type,upsert:false});if(uploaded.error)throw Error('Original storage failed');uploads.push({bucket:'publication-originals',path:original});
  const derivatives=[];const shared=new Map<string,{asset_id:string;path:string}>();for(const platform of context.platforms){const transformed=await adaptImage(bytes,platform),digest=hash(transformed.bytes);let asset=shared.get(digest);if(!asset){asset={asset_id:randomUUID(),path:''};asset.path=`${context.client.id}/${publicationId}/${asset.asset_id}`;const uploaded=await db.storage.from('publication-images').upload(asset.path,transformed.bytes,{contentType:transformed.mime_type,upsert:false});if(uploaded.error)throw Error('Derivative storage failed');uploads.push({bucket:'publication-images',path:asset.path});shared.set(digest,asset);}derivatives.push({platform,...asset,hash:digest,width:transformed.width,height:transformed.height});}
  const saved=await db.rpc('publication_ai_finish',{p_run:run,p_media:pair.photo.id,p_content:json(content),p_opportunity:json(pair.opportunity),p_derivatives:json(derivatives),p_original:original,p_usage:json(usage),p_actor:userId});
  if(saved.error){const reconciled=await db.from('publication_ai_runs').select('status,revision_id').eq('id',run).single();if(reconciled.error)throw Error('Commit outcome uncertain');if(reconciled.data.status!=='completed')throw Error('Commit failed');}completed=true;
  return {message:'Publication préparée : révision, variantes et photos privées soumises à validation. Aucune diffusion.'};
 }catch{
  // Never log raw provider errors, keys, request bodies or client instructions.
  if(run){const confirmed=await db.from('publication_ai_runs').select('status').eq('id',run).maybeSingle();if(confirmed.error)return {message:'Résultat indéterminé. Relisez la fiche avant de relancer ; budget et médias réservés.'};if(confirmed.data?.status==='completed')return {message:'Préparation enregistrée ; rechargez la file de validation.'};
   const failed=await db.rpc('publication_ai_fail',{p_run:run,p_error:'preparation_failed',p_cost:calledAI?MANUAL_RUN_RESERVE_EUR:0,p_input:usage.input_tokens,p_output:usage.output_tokens});if(failed.error)return {message:'Échec non confirmé ; réservation conservée. Vérifiez le run avant toute reprise.'};}
  if(!completed)for(const upload of uploads)await db.storage.from(upload.bucket).remove([upload.path]);
  return {message:'Préparation échouée. Aucun contenu partiel soumis ; consultez le run et relancez si nécessaire.'};
 }
}
