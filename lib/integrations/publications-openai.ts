import 'server-only';
// Passerelle des sorties structurées des agents (Publications, Blog, Visuels, Vidéo, Newsletter, Photothèque).
// Le modèle est choisi par agent (lib/ai/models.ts) : Claude si la clé Anthropic est configurée, sinon OpenAI comme avant.
// Les clés restent côté serveur ; aucune n'est journalisée ni renvoyée.
import type {Usage} from '@/lib/publications/ai/provider';
import {estimateCallCostEur} from '@/lib/ai/budget';
import {claudeEnabledFor} from '@/lib/ai/client-routing';
import {anthropicMessages,anthropicSchema,modelForAgent,OPENAI_AGENT_MODEL,type ModelChoice} from '@/lib/ai/models';
export const PUBLICATIONS_MODEL=OPENAI_AGENT_MODEL;
export type StructuredOptions={maxOutputTokens?:number;timeoutMs?:number;/** Agent du harness : choisit la famille de modèle. Absent : parcours OpenAI historique. */agent?:string;
 /** Client concerné : Claude seulement s'il est activé pour lui (fiche client → Agents). */clientId?:string};
const MAX_INPUT_TOKENS=80000;
export async function structuredResponse(instructions:string,input:unknown,schema:unknown,options:StructuredOptions={}):Promise<{value:unknown;usage:Usage}>{
 const choice=modelForAgent(options.agent,process.env,{claudeAllowed:options.agent?await claudeEnabledFor(options.clientId):false});
 return choice.provider==='anthropic'?anthropicStructured(choice,instructions,input,schema,options):openaiStructured(instructions,input,schema,options,choice.model);
}
function parsed(text:string,usage:Usage){let value:unknown;try{value=JSON.parse(text);}catch{throw Object.assign(Error('AI invalid output'),{usage});}return {value,usage};}
async function openaiStructured(instructions:string,input:unknown,schema:unknown,options:StructuredOptions,model:string){
 const key=process.env.OPENAI_API_KEY;if(!key)throw Error('AI credential unavailable');
 const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,store:false,instructions,input,max_output_tokens:Math.min(Math.max(options.maxOutputTokens??3000,500),8000),text:{format:{type:'json_schema',name:'publication_output',strict:true,schema}}}),signal:AbortSignal.timeout(Math.min(Math.max(options.timeoutMs??60000,5000),120000)),redirect:'error'});
 if(!response.ok)throw Error('AI request failed');const r=await response.json() as {status:string;usage:{input_tokens:number;output_tokens:number};output:{content:{type:string;text?:string}[]}[]};if(r.status!=='completed'||!r.usage||!Number.isInteger(r.usage.input_tokens)||!Number.isInteger(r.usage.output_tokens))throw Error('AI incomplete');
 const text=r.output.flatMap(o=>o.content??[]).filter(c=>c.type==='output_text').map(c=>c.text??'').join('');const inputTokens=r.usage.input_tokens,outputTokens=r.usage.output_tokens;
 const usage:Usage={input_tokens:Math.max(0,inputTokens),output_tokens:Math.max(0,outputTokens),estimated_cost_eur:Math.min(1,estimateCallCostEur(model,inputTokens,outputTokens)),model};
 // Réponse facturée mais inutilisable : le coût accompagne l'erreur pour que l'appelant puisse le journaliser.
 if(inputTokens<0||outputTokens<0||inputTokens>MAX_INPUT_TOKENS||outputTokens>3000)throw Object.assign(Error('AI usage limit'),{usage});
 return parsed(text,usage);
}
/**
 * Claude (Messages API, sorties structurées output_config.format). La réflexion adaptative est toujours active sur les
 * modèles récents : le plafond de sortie couvre la réflexion et la réponse, d'où une marge large. Pas de température
 * (refusée par ces modèles). Repli serveur en cas de refus de sécurité (« fallbacks: default »).
 */
async function anthropicStructured(choice:Extract<ModelChoice,{provider:'anthropic'}>,instructions:string,input:unknown,schema:unknown,options:StructuredOptions){
 const key=process.env.ANTHROPIC_API_KEY;if(!key)throw Error('AI credential unavailable');
 const maxTokens=Math.min(Math.max((options.maxOutputTokens??3000)*4,8000),32000);
 const response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',
  headers:{'x-api-key':key,'anthropic-version':'2023-06-01','anthropic-beta':'server-side-fallback-2026-07-01','Content-Type':'application/json'},
  body:JSON.stringify({model:choice.model,max_tokens:maxTokens,system:instructions,messages:anthropicMessages(input),fallbacks:'default',
   output_config:{effort:choice.effort,format:{type:'json_schema',schema:anthropicSchema(schema)}}}),
  signal:AbortSignal.timeout(Math.min(Math.max((options.timeoutMs??60000)*2,30000),180000)),redirect:'error'});
 if(!response.ok)throw Error('AI request failed');
 const r=await response.json() as {model?:unknown;stop_reason?:unknown;usage?:{input_tokens?:unknown;output_tokens?:unknown;cache_read_input_tokens?:unknown;cache_creation_input_tokens?:unknown};content?:{type?:unknown;text?:unknown}[]};
 const int=(n:unknown)=>Number.isInteger(n)&&(n as number)>=0?n as number:null;
 const inputTokens=int(r.usage?.input_tokens),outputTokens=int(r.usage?.output_tokens);
 if(inputTokens===null||outputTokens===null||!Array.isArray(r.content))throw Error('AI incomplete');
 const billedInput=inputTokens+(int(r.usage?.cache_read_input_tokens)??0)+(int(r.usage?.cache_creation_input_tokens)??0);
 // Modèle réellement servi (un repli peut en avoir changé) : c'est lui qui est facturé et journalisé.
 const model=typeof r.model==='string'&&r.model.length>0&&r.model.length<=100?r.model:choice.model;
 const usage:Usage={input_tokens:billedInput,output_tokens:outputTokens,estimated_cost_eur:Math.min(1,estimateCallCostEur(model,billedInput,outputTokens)),model};
 if(r.stop_reason==='refusal')throw Object.assign(Error('AI refused'),{usage});
 if(r.stop_reason==='max_tokens')throw Object.assign(Error('AI incomplete'),{usage});
 if(billedInput>MAX_INPUT_TOKENS)throw Object.assign(Error('AI usage limit'),{usage});
 const text=r.content.filter(c=>c.type==='text'&&typeof c.text==='string').map(c=>c.text as string).join('');
 return parsed(text,usage);
}
