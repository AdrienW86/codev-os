import 'server-only';
import {structuredResponse} from '@/lib/integrations/publications-openai';
import {AGENT_V2_INSTRUCTIONS,buildGeneratorPayload,fromModelOutput,generatorSchema} from './prompt';
import type {PublicationsAgentV2Generator} from './contract';

// Real Agent v2 generator: the existing Responses API integration (same model, strict JSON schema, store:false).
// Injected by the service; tests always use a deterministic double (no real call).
export function openaiAgentV2Generator():PublicationsAgentV2Generator{return {
 async generate(input){const payload=JSON.stringify(buildGeneratorPayload(input));if(payload.length>40000)throw Error('AI context too large');
  const r=await structuredResponse(AGENT_V2_INSTRUCTIONS,payload,generatorSchema(input));return {output:fromModelOutput(input,r.value),usage:r.usage};}
};}
