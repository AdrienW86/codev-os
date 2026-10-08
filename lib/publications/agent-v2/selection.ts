// Agent Publications v2 — deterministic selection and output validation (Lot 4.3 P7-prep). Pure.
import {AGENT_V2_LIMITS,type AgentV2GeneratorInput,type AgentV2GeneratorOutput,type OpenOccurrenceCandidate} from './contract';
import type {PublicationPlatform} from '../types';

const platformOrder:PublicationPlatform[]=['facebook','instagram','google_business_profile'];
const byTime=(a:OpenOccurrenceCandidate,b:OpenOccurrenceCandidate)=>a.scheduledFor.localeCompare(b.scheduledFor)||platformOrder.indexOf(a.platform)-platformOrder.indexOf(b.platform)||a.occurrenceId.localeCompare(b.occurrenceId);
const day=86400000;

// Only future occurrences (an open occurrence is unlinked and not skipped by construction of the loader).
export function futureOccurrences(candidates:readonly OpenOccurrenceCandidate[],now:Date):OpenOccurrenceCandidate[]{
 return candidates.filter(c=>Date.parse(c.scheduledFor)>=now.getTime()).sort(byTime);
}
// One editorial idea = the earliest open occurrence (anchor) + for every OTHER platform its earliest open occurrence
// within `windowDays` after the anchor. At most one occurrence per platform, deterministic order.
export function selectIdeaBatch(candidates:readonly OpenOccurrenceCandidate[],now:Date,windowDays=7):OpenOccurrenceCandidate[]{
 const future=futureOccurrences(candidates,now);const anchor=future[0];if(!anchor)return [];
 const limit=Date.parse(anchor.scheduledFor)+windowDays*day,batch=[anchor];
 for(const c of future){if(batch.length>=AGENT_V2_LIMITS.maxPublicationsPerIdea)break;
  if(c.projectId===anchor.projectId&&Date.parse(c.scheduledFor)<=limit&&!batch.some(b=>b.platform===c.platform))batch.push(c);}
 return batch.sort((a,b)=>platformOrder.indexOf(a.platform)-platformOrder.indexOf(b.platform));
}
// Strict validation of a generator output against its input before anything is written (fail closed).
export function validateGeneratorOutput(input:Pick<AgentV2GeneratorInput,'occurrences'|'media'>,output:unknown):{ok:true;value:AgentV2GeneratorOutput}|{ok:false;reason:string}{
 if(!output||typeof output!=='object')return {ok:false,reason:'invalid_output'};const o=output as AgentV2GeneratorOutput;
 const subject=typeof o.idea?.subject==='string'?o.idea.subject.trim():'',angle=typeof o.idea?.angle==='string'?o.idea.angle.trim():'';
 if(!subject||subject.length>AGENT_V2_LIMITS.subject||!angle||angle.length>AGENT_V2_LIMITS.angle)return {ok:false,reason:'invalid_idea'};
 if(!Array.isArray(o.publications)||o.publications.length!==input.occurrences.length)return {ok:false,reason:'publication_count'};
 const seen=new Set<string>(),media=new Map(input.media.map(m=>[m.id,m]));
 for(const p of o.publications){const occ=input.occurrences.find(c=>c.occurrenceId===p?.occurrenceId);
  if(!occ||seen.has(occ.occurrenceId))return {ok:false,reason:'unknown_or_duplicate_occurrence'};seen.add(occ.occurrenceId);
  if(p.platform!==occ.platform)return {ok:false,reason:'platform_mismatch'};
  if(typeof p.text!=='string'||!p.text.trim()||p.text.length>AGENT_V2_LIMITS.text)return {ok:false,reason:'invalid_text'};
  if(p.cta!==null&&(typeof p.cta!=='string'||p.cta.length>AGENT_V2_LIMITS.cta))return {ok:false,reason:'invalid_cta'};
  if(p.mediaId!==null&&(typeof p.mediaId!=='string'||!media.has(p.mediaId)||media.get(p.mediaId)?.used))return {ok:false,reason:'invalid_media'};}
 return {ok:true,value:{idea:{subject,angle},publications:o.publications.map(p=>({...p,text:p.text.trim(),cta:p.cta?.trim()||null}))}};
}
