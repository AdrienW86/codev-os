import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {isPublicationUuid} from '../validation';
import {platformLabels} from '../editor';
import {loadPublicationProjectChannels} from '../project-channels';
import {projectSupportsPublications} from '../channels';
import {loadOpenOccurrences} from './open-occurrences';
import {selectIdeaBatch,validateGeneratorOutput} from './selection';
import {AgentV2ContextError,loadAgentV2Context} from './context';
import {openaiAgentV2Generator} from './openai-generator';
import {AGENT_V2_LIMITS,type AgentV2Usage,type PublicationsAgentV2Generator} from './contract';
import {attachAgentV2Media,type AgentV2MediaDb,type ImageAdapter} from './media';
import {getAgentV2RunMedia} from './media-runs';
import {agentV2ResultMessage,mediaCategoryLabel,mediaStateOf,retryMessage,type AgentV2MediaOutcome,type AgentV2MediaView} from './media-view';
import {driveMediaSource,type PublicationMediaSource} from '../media/source';
import {buildEditorialJustification,MAX_JUSTIFICATION_BYTES,type EditorialJustification} from '../editorial-justification';
import {adaptImage} from '../media/transform';
import type {Json} from '@/lib/supabase/database.types';
import {publicationPlatforms,type PublicationPlatform} from '../types';

// Agent Publications v2 orchestration (Lot 4.3 P7). Explicit admin action only. Order: open occurrences → batch →
// context → begin (lease, budget, idempotence) → generation → strict validation → ONE atomic finish (all drafts or
// nothing). Every failure after begin is recorded (fail). Never submits, approves, publishes or schedules.
// P8: when a media was selected, finish reserves it and the compensable media step attaches it (media.ts). A media
// failure keeps the drafts (explicit needs_media, never reported as a full success) and can be retried without AI.
// refused : contenu refusé par les gardes (run échoué et enregistré, réservations libérées) ; une relance est sûre.
export type AgentV2Result={ok:boolean;message:string;publications:{id:string;platform:PublicationPlatform;label:string}[];withMedia:boolean;runId?:string;media?:AgentV2MediaView;mediaMissing?:boolean;missingNotified?:boolean;recoverable?:boolean;refusalDetail?:string;refused?:boolean};
export type AgentV2MediaOptions={mediaSource?:PublicationMediaSource;adapt?:ImageAdapter};
const result=(ok:boolean,message:string,extra:Partial<AgentV2Result>={}):AgentV2Result=>({ok,message,publications:[],withMedia:false,...extra});
const mediaDeps=(db:unknown,options:AgentV2MediaOptions)=>({db:db as AgentV2MediaDb,source:options.mediaSource??driveMediaSource(),adapt:options.adapt??adaptImage});
// Signed preview of an attached media (display only; any failure simply hides the preview).
async function previewOf(runId:string):Promise<string|null>{try{return (await getAgentV2RunMedia(runId))?.media.preview??null;}catch{return null;}}
const json=(value:unknown):Json=>JSON.parse(JSON.stringify(value)) as Json;
const zeroUsage={input_tokens:0,output_tokens:0,estimated_cost_eur:0,model:'gpt-4.1-mini-2025-04-14'};
type CreatedPublication={id:string;platform:PublicationPlatform;label:string};
type StoredPreparation={status:string;client_id:string;project_id:string;publication_ids:unknown;occurrence_ids:unknown};
const publicationIds=(value:unknown,count:number):string[]|null=>Array.isArray(value)&&value.length===count&&value.every(isPublicationUuid)&&new Set(value).size===count?value:null;
async function readPreparation(db:ReturnType<typeof getSupabaseServerClient>,runId:string,clientId:string,projectId:string):Promise<StoredPreparation|null>{
 try{const r=await db.from('publication_agent_v2_runs').select('status,client_id,project_id,publication_ids,occurrence_ids').eq('id',runId).eq('client_id',clientId).eq('project_id',projectId).maybeSingle();
  const row=r.data as StoredPreparation|null;return r.error||!row||row.client_id!==clientId||row.project_id!==projectId?null:row;
 }catch{return null;}
}
// finish creates publications in ascending occurrence UUID order, while the run keeps the original input order.
// Match that SQL order when recovering links from the durable, client-scoped run after a failed detail read.
function storedPublications(row:StoredPreparation|null,batch:{occurrenceId:string;platform:PublicationPlatform}[]):CreatedPublication[]|null{
 if(row?.status!=='completed')return null;
 const ids=publicationIds(row.publication_ids,batch.length),occurrences=row.occurrence_ids;
 if(!ids||!Array.isArray(occurrences)||occurrences.length!==batch.length||new Set(occurrences).size!==batch.length||!occurrences.every(isPublicationUuid))return null;
 const platforms=[...occurrences].sort().map(id=>batch.find(o=>o.occurrenceId===id)?.platform);
 if(platforms.some(p=>!p))return null;
 return ids.map((id,i)=>({id,platform:platforms[i]!,label:platformLabels[platforms[i]!]}));
}
const uncertainPreparation=(runId:string)=>result(false,'Résultat de préparation indéterminé. Consultez les dernières préparations et le calendrier avant toute relance ; les réservations sont conservées.',{runId,recoverable:true});

const refusals:Record<string,string>={unsupported_claim:'Contenu refusé : il contenait une affirmation absente du contexte (prix, garantie, délai, prestation non vérifiée…). Aucun brouillon créé.',
 repetition:'Contenu refusé : trop proche des dernières publications (sujet, prestation, formulation ou accroche). Aucun brouillon créé ; relancez.',
 similar_texts:'Contenu refusé : les textes des plateformes étaient presque identiques (un texte natif par plateforme). Aucun brouillon créé ; relancez.',
 platform_rules:'Contenu refusé : hors des règles d’une plateforme (longueur ou hashtags). Aucun brouillon créé ; relancez.',
 // Intelligence éditoriale (PR #42) : le détail (lieu, accroche, CTA…) est ajouté au message.
 place_not_allowed:'Contenu refusé : un lieu absent des données du client était cité. Aucun brouillon créé ; relancez.',
 intro_repetition:'Contenu refusé : accroche déjà employée ou même style d’accroche que les dernières publications. Aucun brouillon créé ; relancez.',
 cta_repetition:'Contenu refusé : appel à l’action déjà employé ou même style que les dernières publications. Aucun brouillon créé ; relancez.',
 phrase_repetition:'Contenu refusé : formulation récurrente des publications passées. Aucun brouillon créé ; relancez.',
 photo_mismatch:'Contenu refusé : la photo choisie illustre une autre prestation que le sujet. Aucun brouillon créé ; relancez.',
 document_photo:'Contenu refusé : une photo de document ne peut pas illustrer une intervention. Aucun brouillon créé ; relancez.'};
// Justification éditoriale enregistrée avec le run (PR #42) tant qu'il est en cours : une erreur n'empêche jamais la
// préparation (information pour l'admin), elle est seulement journalisée sans contenu.
async function recordJustification(db:ReturnType<typeof getSupabaseServerClient>,runId:string,userId:string,justification:EditorialJustification){
 try{const payload=json(justification);if(JSON.stringify(payload).length>MAX_JUSTIFICATION_BYTES)throw Error('too large');
  const r=await db.rpc('publication_editorial_justification_record',{p_run_id:runId,p_justification:payload,p_actor_id:userId});if(r.error)throw Error('refused');return true;}
 catch{console.error('[publications-agent-v2] editorial justification not recorded',{run_id:runId});return false;}
}
// « Photo manquante » : une notification par client et par jour au plus, vers sa photothèque (jamais de nom ni de texte).
async function notifyMissingPhoto(db:{from(table:string):unknown},clientId:string,now:Date){
 try{const table=db.from('admin_notifications') as {upsert(row:Record<string,string>,o:{onConflict:string;ignoreDuplicates:boolean}):PromiseLike<{error:unknown}>};
  const r=await table.upsert({event_key:`media-missing:${clientId}:${now.toISOString().slice(0,10)}`,category:'media_missing',href:`/clients/${clientId}?tab=media`},{onConflict:'event_key',ignoreDuplicates:true});
  if(r.error)throw Error('notification refused');return true;}
 catch{console.error('[publications-agent-v2] missing photo notification not recorded');return false;}
}
function safeUsage(u:AgentV2Usage|null):AgentV2Usage{
 if(!u||!Number.isInteger(u.input_tokens)||!Number.isInteger(u.output_tokens)||u.input_tokens<0||u.output_tokens<0||!Number.isFinite(u.estimated_cost_eur)||u.estimated_cost_eur<0)return {...zeroUsage,estimated_cost_eur:AGENT_V2_LIMITS.maxCost};
 return {...u,estimated_cost_eur:Math.min(u.estimated_cost_eur,AGENT_V2_LIMITS.maxCost)};
}
export const NO_OPEN_OCCURRENCE='Aucune occurrence ouverte. Préparez d’abord les prochaines semaines.';
// excludeOccurrenceIds (planificateur) : occurrences dont la préparation a trop échoué, laissées à un humain.
export type PrepareOptions={allowRealAI:boolean;retryFeedback?:string;generator?:PublicationsAgentV2Generator;now?:Date;leadDays?:number;excludeOccurrenceIds?:readonly string[]}&AgentV2MediaOptions;
export async function prepareNextPublications(projectId:unknown,options:PrepareOptions):Promise<AgentV2Result>{
 const {userId}=await requireAdmin();return prepareNextPublicationsAs(userId,projectId,options);
}
/**
 * Même préparation pour le planificateur (socle lot 6), au nom de l'administrateur qui a activé la préparation
 * automatique du client (délégation journalisée par l'appelant). leadDays : seules les occurrences de l'horizon de
 * préparation du client sont candidates. Jamais de soumission, d'approbation ni de diffusion ici.
 */
export async function prepareNextPublicationsAs(userId:string,projectId:unknown,options:PrepareOptions):Promise<AgentV2Result>{
 const now=options.now??new Date();
 if(!/^user_[a-zA-Z0-9_-]{1,200}$/.test(userId))return result(false,'Acteur invalide.');
 if(!isPublicationUuid(projectId))return result(false,'Projet invalide.');
 if(!options.generator&&!options.allowRealAI)return result(false,'Un appel IA réel doit être explicitement autorisé.');
 const db=getSupabaseServerClient();
 const project=await db.from('projects').select('id,client_id,type').eq('id',projectId).maybeSingle();
 if(project.error||!project.data)return result(false,'Projet indisponible.');
 // Sans session (#planificateur) : l'acteur est vérifié par l'appelant (requireAdmin ou administrateur délégué).
 const capabilities=await loadPublicationProjectChannels(project.data);
 if(capabilities.source!=='configured')return result(false,'Confirmez d’abord les canaux du projet (onglet Configuration).');
 if(!projectSupportsPublications(capabilities))return result(false,'Publications suspendues : aucun canal actif.');
 // The state is re-read here: occurrences linked by a previous run are no longer candidates (idempotence).
 const horizon=options.leadDays?Math.min(Math.max(Math.trunc(options.leadDays),1),28):28;
 const excluded=new Set(options.excludeOccurrenceIds??[]);
 const open=(await loadOpenOccurrences(projectId,horizon,now)).filter(o=>capabilities.platforms.includes(o.platform)&&!excluded.has(o.occurrenceId));
 const batch=selectIdeaBatch(open,now);
 if(!batch.length)return result(false,NO_OPEN_OCCURRENCE);
 let context;
 try{context=await loadAgentV2Context(projectId,batch,now);}
 catch(error){return result(false,error instanceof AgentV2ContextError&&error.code==='agent_disabled'?'Activez et configurez l’Agent Publications (droits médias confirmés) avant la préparation.':'Contexte indisponible : aucune préparation lancée.');}
 const begun=await db.rpc('publication_agent_v2_begin',{p_project_id:projectId,p_occurrence_ids:batch.map(o=>o.occurrenceId),p_considered:open.length,p_actor_id:userId});
 if(begun.error)return result(false,begun.error.code==='55000'?(/budget/i.test(begun.error.message??'')?'Budget mensuel de l’agent atteint.':'Agent désactivé pour ce projet.'):'Occurrences indisponibles : rechargez le calendrier.');
 const state=begun.data as {run_id?:string;reused?:boolean}|null;if(!state?.run_id)return result(false,'Préparation non confirmée.');
 if(state.reused)return result(false,'Une préparation est déjà en cours pour ce projet.');
 const run=state.run_id;let usage:AgentV2Usage|null=null;
 const fail=async(code:'invalid_output'|'unsupported_claim'|'occurrence_unavailable'|'generation_failed',message:string)=>{
  const f=await db.rpc('publication_agent_v2_fail',{p_run_id:run,p_error_code:code,p_usage:json(safeUsage(usage??(code==='generation_failed'?null:zeroUsage))),p_actor_id:userId});
  return result(false,f.error?'Échec non confirmé : vérifiez le run avant toute reprise.':message);};
 let raw:unknown;
 const genInput=options.retryFeedback?{...context.input,retryFeedback:options.retryFeedback.slice(0,400)}:context.input;
 try{const generated=await (options.generator??openaiAgentV2Generator()).generate(genInput);raw=generated.output;usage=generated.usage;}
 catch{console.error('[publications-agent-v2] generation failed',{run_id:run});return fail('generation_failed','Génération indisponible. Aucun brouillon créé.');}
 const checked=validateGeneratorOutput(context.input,raw);
 if(!checked.ok){
  await recordJustification(db,run,userId,buildEditorialJustification(context.input,{refusal:{reason:checked.reason,detail:checked.detail??null}},now));
  const message=refusals[checked.reason]??'Contenu généré invalide. Aucun brouillon créé.';
  const text=checked.detail?`${message} Motif : ${checked.detail}.`:message;
  const failed=await fail(checked.reason==='unsupported_claim'?'unsupported_claim':'invalid_output',text);
  return failed.message===text?{...failed,refused:true,refusalDetail:checked.detail??message}:failed;}
 const value=checked.value,mediaId=value.publications[0]?.mediaId??null;
 await recordJustification(db,run,userId,buildEditorialJustification(context.input,{value},now));
 const finishArgs={p_run_id:run,p_output:json({idea:value.idea,publications:value.publications.map(p=>({occurrence_id:p.occurrenceId,text:p.text,cta:p.cta}))}),
  p_media_id:mediaId,p_usage:json({input_tokens:usage?.input_tokens??0,output_tokens:usage?.output_tokens??0,estimated_cost_eur:safeUsage(usage).estimated_cost_eur}),p_actor_id:userId};
 let finished;
 try{finished=await db.rpc('publication_agent_v2_finish',finishArgs);}catch{finished={data:null,error:{code:'network'}};}
 let ids=publicationIds((finished.data as {publication_ids?:unknown}|null)?.publication_ids,batch.length),stored:StoredPreparation|null=null;
 if(finished.error||!ids){
  stored=await readPreparation(db,run,context.clientId,projectId);
  const recovered=storedPublications(stored,batch);
  if(recovered)ids=recovered.map(p=>p.id);
  else{
   // A PostgreSQL rejection confirms rollback. A transport error can arrive after COMMIT, or while the server is
   // still finishing: never fail that run, release its reservations, or invite a second generation.
   if(stored?.status==='processing'&&finished.error&&['23505','23514','40001','22023','55000','P0001'].includes(finished.error.code??''))
    return fail('occurrence_unavailable','Une occurrence a changé pendant la préparation. Aucun brouillon créé ; relancez.');
   if(stored?.status==='failed')return result(false,'Préparation interrompue. Consultez les dernières préparations avant de relancer.',{runId:run});
   return uncertainPreparation(run);
  }
 }
 // IDs belong to this project's run; a detail query is additionally scoped to the same client and project.
 let publications:CreatedPublication[]|null=null,detailsUnavailable=false;
 try{
  const created=await db.from('publications').select('id,client_id,project_id,platform,occurrence_id').eq('client_id',context.clientId).eq('project_id',projectId).in('id',ids!);
  const rows=created.data??[];
  if(!created.error&&rows.length===ids!.length&&new Set(rows.map(p=>p.id)).size===ids!.length&&rows.every(p=>ids!.includes(p.id)&&p.client_id===context.clientId&&p.project_id===projectId
    &&publicationPlatforms.includes(p.platform as PublicationPlatform)&&batch.some(o=>o.occurrenceId===p.occurrence_id&&o.platform===p.platform)))
   publications=rows.map(p=>({id:p.id,platform:p.platform as PublicationPlatform,label:platformLabels[p.platform as PublicationPlatform]}));
 }catch{/* Durable run below remains the authority after a failed detail read. */}
 if(!publications){
  stored??=await readPreparation(db,run,context.clientId,projectId);
  publications=storedPublications(stored,batch);detailsUnavailable=true;
  if(!publications)return uncertainPreparation(run);
 }
 // Media step (only when a media was selected): drafts already exist, whatever happens next.
 const outcome=mediaId?await attachAgentV2Media(run,userId,mediaDeps(db,options)):null;
 const mediaState=mediaStateOf(outcome);
 const chosen=context.input.media.find(m=>m.id===mediaId);
 const media:AgentV2MediaView={state:mediaState,category:chosen?.source==='library'?'Photothèque':mediaId?mediaCategoryLabel(chosen?.categories[0]):null,preview:mediaState==='attached'?await previewOf(run):null};
 if(outcome&&outcome.state!=='attached')console.error('[publications-agent-v2] media not attached',{run_id:run,state:outcome.state,code:'code' in outcome?outcome.code:null});
 // Aucune photo adaptée : les brouillons existent, la photo manque (approbation impossible tant qu'elle manque).
 const missing=!mediaId&&await notifyMissingPhoto(db,context.clientId,now);
 return result(true,agentV2ResultMessage(publications.length,mediaState)+(!mediaId?' Photo manquante signalée : ajoutez des photos à la photothèque du client.':'')
  +(detailsUnavailable?' Les liens proviennent de la préparation enregistrée ; les détails sont temporairement indisponibles.':''),{publications,withMedia:mediaState==='attached',runId:run,media,mediaMissing:!mediaId,missingNotified:missing});
}

// Reprise de l'étape média par le planificateur (socle lot 6), au nom de l'administrateur délégué : jamais de
// génération (aucun appel OpenAI), mêmes brouillons, même étape compensable (attachAgentV2Media).
export async function retryAgentV2MediaAs(userId:string,runId:string,options:AgentV2MediaOptions={}):Promise<AgentV2MediaOutcome['state']>{
 if(!/^user_[a-zA-Z0-9_-]{1,200}$/.test(userId)||!isPublicationUuid(runId))return 'unconfirmed';
 return (await attachAgentV2Media(runId,userId,mediaDeps(getSupabaseServerClient(),options))).state;
}
// Explicit retry of the media step of a completed run: never any generation (no OpenAI call), same drafts.
export type AgentV2MediaRetryResult={ok:boolean;message:string;projectId?:string;media?:AgentV2MediaView};
export async function retryAgentV2Media(runId:unknown,options:AgentV2MediaOptions={}):Promise<AgentV2MediaRetryResult>{
 const {userId}=await requireAdmin();if(!isPublicationUuid(runId))return {ok:false,message:'Préparation invalide.'};
 const db=getSupabaseServerClient();
 const run=await db.from('publication_agent_v2_runs').select('id,project_id,status,media_status').eq('id',runId).maybeSingle();
 const row=run.data as {project_id:string;status:string;media_status:string}|null;
 if(run.error||!row)return {ok:false,message:'Préparation introuvable.'};
 if(row.status!=='completed'||row.media_status==='none')return {ok:false,message:'Aucun média à attacher pour cette préparation.',projectId:row.project_id};
 if(row.media_status==='attached')return {ok:true,message:retryMessage('attached'),projectId:row.project_id};
 const state=mediaStateOf(await attachAgentV2Media(runId,userId,mediaDeps(db,options)));
 return {ok:state==='attached',message:retryMessage(state),projectId:row.project_id};
}
