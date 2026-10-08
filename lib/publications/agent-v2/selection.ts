// Agent Publications v2 — deterministic selection, output validation and anti-invention check (Lot 4.3 P7). Pure.
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

// Claims that must never appear unless the very same wording is present in the stored facts.
// Word boundaries are Unicode-aware (French accents), so « certifié » or « étoiles » are matched as words.
const word=(body:string)=>new RegExp(String.raw`(?<![\p{L}\p{N}])(?:`+body+String.raw`)(?![\p{L}\p{N}])`,'giu');
const CLAIM_PATTERNS:{name:string;pattern:RegExp}[]=[
 {name:'price',pattern:/\d+(?:[.,]\d+)?\s?(?:€|euros?(?![\p{L}]))/giu},{name:'percent',pattern:/\d+(?:[.,]\d+)?\s?%/gu},
 {name:'promotion',pattern:word('promo(?:tion)?s?|réductions?|remises?|soldes?|offre spéciale|gratuit(?:e|s|es)?|offert(?:e|s|es)?')},
 {name:'guarantee',pattern:word('garanti(?:e|es|s)?|décennale|decennale')},
 {name:'certification',pattern:word('certifi(?:é|ée|és|ées|cation|cations)|qualibat|rge|label(?:lisé|lisée|s)?')},
 {name:'experience',pattern:/\d+\s+ans(?![\p{L}])|depuis\s+(?:19|20)\d{2}|expérience de/giu},
 {name:'reviews',pattern:word(String.raw`avis|étoiles?|clients?\s+satisfaits?|note de`)},
 {name:'speed',pattern:/intervention\s+rapide|rapidement|sous\s+\d+\s?h(?![\p{L}])|\d+\s?h\s?\/\s?24|24\s?h(?![\p{L}])|48\s?h(?![\p{L}])|7\s?j\s?\/\s?7|en urgence/giu},
 {name:'counts',pattern:/\d+\s+(?:clients|chantiers|interventions|projets|réalisations)(?![\p{L}])/giu}];
// Text fragments reporting a claim absent from the facts (case-insensitive containment).
export function unsupportedClaims(text:string,facts:string):string[]{
 const known=facts.toLocaleLowerCase('fr'),found:string[]=[];
 for(const {name,pattern} of CLAIM_PATTERNS)for(const m of text.matchAll(pattern))if(!known.includes(m[0].toLocaleLowerCase('fr')))found.push(`${name}:${m[0]}`);
 return found;
}
// All stored facts the texts may quote (anything else is an invention).
export function factsOf(input:AgentV2GeneratorInput):string{
 return [input.client.name,input.client.activity??'',input.client.zone??'',input.project.name,...input.services,input.rules,...input.channelRules.map(c=>c.rules),
  ...input.media.map(m=>[...m.categories,m.description??''].join(' '))].join('\n');
}

export type OutputCheck={ok:true;value:AgentV2GeneratorOutput}|{ok:false;reason:string};
// Strict validation of a generator output against its input before anything is written (fail closed).
export function validateGeneratorOutput(input:Pick<AgentV2GeneratorInput,'occurrences'|'media'>&Partial<AgentV2GeneratorInput>,output:unknown):OutputCheck{
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
 if(new Set(o.publications.map(p=>p.mediaId)).size>1)return {ok:false,reason:'invalid_media'};
 const texts=o.publications.map(p=>p.text.trim().toLocaleLowerCase('fr'));if(new Set(texts).size!==texts.length)return {ok:false,reason:'identical_texts'};
 const value={idea:{subject,angle},publications:o.publications.map(p=>({...p,text:p.text.trim(),cta:p.cta?.trim()||null}))};
 // Anti-invention: when the full context is known, every claim must already be in the stored facts.
 if(input.client&&input.project){const facts=factsOf(input as AgentV2GeneratorInput);
  for(const t of [value.idea.subject,value.idea.angle,...value.publications.flatMap(p=>[p.text,p.cta??''])])if(unsupportedClaims(t,facts).length)return {ok:false,reason:'unsupported_claim'};}
 return {ok:true,value};
}
