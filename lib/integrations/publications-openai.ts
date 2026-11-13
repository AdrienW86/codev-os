import 'server-only';
import type {Usage} from '@/lib/publications/ai/provider';
import {estimateCreativeCostEur,creativeReasoning} from '@/lib/ai/creative-models';
export const PUBLICATIONS_MODEL='gpt-4.1-mini-2025-04-14';
export async function structuredResponse(instructions:string,input:unknown,schema:unknown,options:{maxOutputTokens?:number;timeoutMs?:number;model?:string}={}):Promise<{value:unknown;usage:Usage}>{
 const key=process.env.OPENAI_API_KEY;if(!key)throw Error('AI credential unavailable');
 const model=options.model??PUBLICATIONS_MODEL;
 const reasoning=creativeReasoning(model);
 const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,store:false,instructions,input,...(reasoning?{reasoning}:{}),max_output_tokens:Math.min(Math.max(options.maxOutputTokens??3000,500),8000),text:{format:{type:'json_schema',name:'publication_output',strict:true,schema}}}),signal:AbortSignal.timeout(Math.min(Math.max(options.timeoutMs??60000,5000),120000)),redirect:'error'});
 if(!response.ok)throw Error('AI request failed');const r=await response.json() as {status:string;usage:{input_tokens:number;output_tokens:number};output:{content:{type:string;text?:string}[]}[]};if(r.status!=='completed'||!r.usage||!Number.isInteger(r.usage.input_tokens)||!Number.isInteger(r.usage.output_tokens))throw Error('AI incomplete');
 const text=r.output.flatMap(o=>o.content??[]).filter(c=>c.type==='output_text').map(c=>c.text??'').join('');const inputTokens=r.usage.input_tokens,outputTokens=r.usage.output_tokens;
 const usage:Usage={input_tokens:Math.max(0,inputTokens),output_tokens:Math.max(0,outputTokens),estimated_cost_eur:Math.min(1,estimateCreativeCostEur(model,inputTokens,outputTokens)),model};
 // Réponse facturée mais inutilisable : le coût accompagne l'erreur pour que l'appelant puisse le journaliser.
 if(inputTokens<0||outputTokens<0||inputTokens>80000||outputTokens>3000)throw Object.assign(Error('AI usage limit'),{usage});
 let value:unknown;try{value=JSON.parse(text);}catch{throw Object.assign(Error('AI invalid output'),{usage});}
 return {value,usage};
}
