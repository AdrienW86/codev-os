import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {isPublicationUuid} from '../validation';
import {platformLabels} from '../editor';
import {getPublicationProjectChannels} from '../project-channels';
import {projectSupportsPublications} from '../channels';
import {getOpenOccurrencesForAgent} from './open-occurrences';
import {selectIdeaBatch,validateGeneratorOutput} from './selection';
import {AgentV2ContextError,buildAgentV2Context} from './context';
import {openaiAgentV2Generator} from './openai-generator';
import {AGENT_V2_LIMITS,type AgentV2Usage,type PublicationsAgentV2Generator} from './contract';
import type {Json} from '@/lib/supabase/database.types';
import type {PublicationPlatform} from '../types';

// Agent Publications v2 orchestration (Lot 4.3 P7). Explicit admin action only. Order: open occurrences → batch →
// context → begin (lease, budget, idempotence) → generation → strict validation → ONE atomic finish (all drafts or
// nothing). Every failure after begin is recorded (fail). Never submits, approves, publishes or schedules.
export type AgentV2Result={ok:boolean;message:string;publications:{id:string;platform:PublicationPlatform;label:string}[];withMedia:boolean};
const result=(ok:boolean,message:string,extra:Partial<AgentV2Result>={}):AgentV2Result=>({ok,message,publications:[],withMedia:false,...extra});
const json=(value:unknown):Json=>JSON.parse(JSON.stringify(value)) as Json;
const zeroUsage={input_tokens:0,output_tokens:0,estimated_cost_eur:0,model:'gpt-4.1-mini-2025-04-14'};

function safeUsage(u:AgentV2Usage|null):AgentV2Usage{
 if(!u||!Number.isInteger(u.input_tokens)||!Number.isInteger(u.output_tokens)||u.input_tokens<0||u.output_tokens<0||!Number.isFinite(u.estimated_cost_eur)||u.estimated_cost_eur<0)return {...zeroUsage,estimated_cost_eur:AGENT_V2_LIMITS.maxCost};
 return {...u,estimated_cost_eur:Math.min(u.estimated_cost_eur,AGENT_V2_LIMITS.maxCost)};
}
export async function prepareNextPublications(projectId:unknown,options:{allowRealAI:boolean;generator?:PublicationsAgentV2Generator;now?:Date}):Promise<AgentV2Result>{
 const {userId}=await requireAdmin();const now=options.now??new Date();
 if(!isPublicationUuid(projectId))return result(false,'Projet invalide.');
 if(!options.generator&&!options.allowRealAI)return result(false,'Un appel IA réel doit être explicitement autorisé.');
 const db=getSupabaseServerClient();
 const project=await db.from('projects').select('id,client_id,type').eq('id',projectId).maybeSingle();
 if(project.error||!project.data)return result(false,'Projet indisponible.');
 const capabilities=await getPublicationProjectChannels(project.data);
 if(capabilities.source!=='configured')return result(false,'Confirmez d’abord les canaux du projet (onglet Configuration).');
 if(!projectSupportsPublications(capabilities))return result(false,'Publications suspendues : aucun canal actif.');
 // The state is re-read here: occurrences linked by a previous run are no longer candidates (idempotence).
 const open=(await getOpenOccurrencesForAgent(projectId,28,now)).filter(o=>capabilities.platforms.includes(o.platform));
 const batch=selectIdeaBatch(open,now);
 if(!batch.length)return result(false,'Aucune occurrence ouverte. Préparez d’abord les prochaines semaines.');
 let context;
 try{context=await buildAgentV2Context(projectId,batch);}
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
 try{const generated=await (options.generator??openaiAgentV2Generator()).generate(context.input);raw=generated.output;usage=generated.usage;}
 catch{console.error('[publications-agent-v2] generation failed',{run_id:run});return fail('generation_failed','Génération indisponible. Aucun brouillon créé.');}
 const checked=validateGeneratorOutput(context.input,raw);
 if(!checked.ok)return fail(checked.reason==='unsupported_claim'?'unsupported_claim':'invalid_output',checked.reason==='unsupported_claim'
  ?'Contenu refusé : il contenait une affirmation absente du contexte (prix, garantie, délai…). Aucun brouillon créé.':'Contenu généré invalide. Aucun brouillon créé.');
 const value=checked.value,mediaId=value.publications[0]?.mediaId??null;
 const finished=await db.rpc('publication_agent_v2_finish',{p_run_id:run,p_output:json({idea:value.idea,publications:value.publications.map(p=>({occurrence_id:p.occurrenceId,text:p.text,cta:p.cta}))}),
  p_media_id:mediaId,p_usage:json({input_tokens:usage?.input_tokens??0,output_tokens:usage?.output_tokens??0,estimated_cost_eur:safeUsage(usage).estimated_cost_eur}),p_actor_id:userId});
 if(finished.error)return fail('occurrence_unavailable','Une occurrence a changé pendant la préparation. Aucun brouillon créé ; relancez.');
 const ids=((finished.data as {publication_ids?:unknown}|null)?.publication_ids??[]) as string[];
 const byOccurrence=new Map(value.publications.map(p=>[p.occurrenceId,p.platform]));
 const created=await db.from('publications').select('id,platform,occurrence_id').in('id',ids);
 const publications=(created.data??[]).map(p=>({id:p.id as string,platform:(p.platform??byOccurrence.get(p.occurrence_id as string)) as PublicationPlatform}))
  .map(p=>({...p,label:platformLabels[p.platform]}));
 return result(true,`${ids.length} brouillon${ids.length>1?'s':''} créé${ids.length>1?'s':''}${mediaId?' avec un média suggéré':' sans média'}. À relire et valider manuellement.`,{publications,withMedia:Boolean(mediaId)});
}
