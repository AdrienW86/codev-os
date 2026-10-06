import 'server-only';
import type {Usage} from '@/lib/publications/ai/provider';
export const PUBLICATIONS_MODEL='gpt-4.1-mini-2025-04-14';
export async function structuredResponse(instructions:string,input:unknown,schema:unknown):Promise<{value:unknown;usage:Usage}>{
 const key=process.env.OPENAI_API_KEY;if(!key)throw Error('AI credential unavailable');
 const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:PUBLICATIONS_MODEL,store:false,instructions,input,max_output_tokens:3000,text:{format:{type:'json_schema',name:'publication_output',strict:true,schema}}}),signal:AbortSignal.timeout(60000),redirect:'error'});
 if(!response.ok)throw Error('AI request failed');const r=await response.json() as {status:string;usage:{input_tokens:number;output_tokens:number};output:{content:{type:string;text?:string}[]}[]};if(r.status!=='completed'||!r.usage||!Number.isInteger(r.usage.input_tokens)||!Number.isInteger(r.usage.output_tokens))throw Error('AI incomplete');
 const text=r.output.flatMap(o=>o.content??[]).filter(c=>c.type==='output_text').map(c=>c.text??'').join('');const inputTokens=r.usage.input_tokens,outputTokens=r.usage.output_tokens;if(inputTokens<0||outputTokens<0||inputTokens>80000||outputTokens>3000)throw Error('AI usage limit');
 return {value:JSON.parse(text),usage:{input_tokens:inputTokens,output_tokens:outputTokens,estimated_cost_eur:Math.ceil((inputTokens*.4+outputTokens*1.6)*1.25)/1000000,model:PUBLICATIONS_MODEL}};
}
