import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {isPublicationUuid} from '../validation';
import type {AgentMediaCandidate,AgentV2GeneratorInput,OpenOccurrenceCandidate} from './contract';
import type {PublicationPlatform} from '../types';

// Agent Publications v2 — context of one preparation (Lot 4.3 P7). Only facts actually stored; an absent value
// stays null/empty (never a fictitious default). Every critical read fails closed. Each table is read once.
export class AgentV2ContextError extends Error{constructor(readonly code:'context_unavailable'|'agent_disabled'){super(code);}}
const descriptions:Record<string,string>={roof:'Surface de toiture visible.',pests:'Insecte ou nuisible visible.',paint:'Surface peinte ou matériel de peinture visible.',
 facade:'Surface de façade visible.',digital:'Élément numérique visible : écran, ordinateur ou interface.'};
type Analysis={scene?:unknown;usable?:unknown};

export async function buildAgentV2Context(projectId:string,occurrences:readonly OpenOccurrenceCandidate[]):Promise<{input:AgentV2GeneratorInput;clientId:string}>{
 await requireAdmin();if(!isPublicationUuid(projectId)||!occurrences.length||occurrences.some(o=>o.projectId!==projectId))throw new AgentV2ContextError('context_unavailable');
 const db=getSupabaseServerClient();
 const project=await db.from('projects').select('id,client_id,name').eq('id',projectId).maybeSingle();
 if(project.error||!project.data)throw new AgentV2ContextError('context_unavailable');
 const clientId=project.data.client_id;
 const [client,config,channels,settings,recent]=await Promise.all([
  db.from('clients').select('name,activity,geographic_area').eq('id',clientId).maybeSingle(),
  db.from('publication_agent_projects').select('enabled,rights_confirmed,verified_services,editorial_rules,drive_folder_id').eq('project_id',projectId).eq('client_id',clientId).maybeSingle(),
  db.from('publication_project_channels').select('platform,enabled,editorial_rules').eq('project_id',projectId).eq('client_id',clientId),
  db.from('publication_client_settings').select('editorial_brief').eq('client_id',clientId).maybeSingle(),
  db.from('publications').select('subject').eq('project_id',projectId).eq('client_id',clientId).order('created_at',{ascending:false}).limit(20)]);
 if(client.error||!client.data||config.error||channels.error||!channels.data||settings.error||recent.error||!recent.data)throw new AgentV2ContextError('context_unavailable');
 if(!config.data?.enabled||!config.data.rights_confirmed)throw new AgentV2ContextError('agent_disabled');
 const services=Array.isArray(config.data.verified_services)?config.data.verified_services.filter((s):s is string=>typeof s==='string'):[];
 const media=await db.from('publication_drive_media').select('id,analysis,claimed_run_id').eq('client_id',clientId).eq('drive_folder_id',config.data.drive_folder_id).limit(200);
 if(media.error||!media.data)throw new AgentV2ContextError('context_unavailable');
 const ids=media.data.map(m=>m.id),uses=ids.length?await db.from('publication_media_uses').select('media_id').eq('client_id',clientId).in('media_id',ids):{data:[],error:null};
 if(uses.error||!uses.data)throw new AgentV2ContextError('context_unavailable');
 const used=new Set(uses.data.map(u=>u.media_id));
 const candidates:AgentMediaCandidate[]=media.data.flatMap(m=>{const a=(m.analysis??null) as Analysis|null;const scene=typeof a?.scene==='string'?a.scene:null;
  if(!scene||a?.usable!==true||!(scene in descriptions))return [];return [{id:m.id,categories:[scene],description:descriptions[scene],used:used.has(m.id)||m.claimed_run_id!==null}];});
 const enabled=(channels.data as {platform:PublicationPlatform;enabled:boolean;editorial_rules:string|null}[]).filter(c=>c.enabled);
 return {clientId,input:{client:{name:client.data.name,activity:client.data.activity?.trim()||null,zone:client.data.geographic_area?.trim()||null},project:{name:project.data.name},services,
  rules:[config.data.editorial_rules,settings.data?.editorial_brief??''].map(r=>r.trim()).filter(Boolean).join('\n').slice(0,8000),
  channelRules:enabled.flatMap(c=>c.editorial_rules?.trim()?[{platform:c.platform,rules:c.editorial_rules.trim()}]:[]),
  occurrences:[...occurrences],media:candidates,previousSubjects:recent.data.map(p=>p.subject).filter(Boolean).slice(0,20)}};
}
