import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {isPublicationUuid} from '../validation';
import type {AgentMediaCandidate,AgentV2GeneratorInput,OpenOccurrenceCandidate,PreviousPublication} from './contract';
import {libraryCandidates,type LibraryAssessment,type LibraryRow,type LibraryUse} from './library-pool';
import type {PublicationPlatform} from '../types';

// Agent Publications v2 — context of one preparation (Lot 4.3 P7). Only facts actually stored; an absent value
// stays null/empty (never a fictitious default). Every critical read fails closed. Each table is read once.
// Socle lots 4-5 : les 3 dernières publications (sujets, textes, photo), le profil média du client et sa photothèque
// (photos publiables, réemploi selon le réglage du client) complètent le contexte. Jamais de légende WhatsApp.
export class AgentV2ContextError extends Error{constructor(readonly code:'context_unavailable'|'agent_disabled'){super(code);}}
const descriptions:Record<string,string>={roof:'Surface de toiture visible.',pests:'Insecte ou nuisible visible.',paint:'Surface peinte ou matériel de peinture visible.',
 facade:'Surface de façade visible.',digital:'Élément numérique visible : écran, ordinateur ou interface.'};
type Analysis={scene?:unknown;usable?:unknown};

export async function buildAgentV2Context(projectId:string,occurrences:readonly OpenOccurrenceCandidate[]):Promise<{input:AgentV2GeneratorInput;clientId:string}>{
 await requireAdmin();return loadAgentV2Context(projectId,occurrences);
}
// Sans session : planificateur authentifié par CRON_SECRET (socle lot 6) ; les appelants ont vérifié leur accès.
export async function loadAgentV2Context(projectId:string,occurrences:readonly OpenOccurrenceCandidate[]):Promise<{input:AgentV2GeneratorInput;clientId:string}>{
 if(!isPublicationUuid(projectId)||!occurrences.length||occurrences.some(o=>o.projectId!==projectId))throw new AgentV2ContextError('context_unavailable');
 const db=getSupabaseServerClient();
 const project=await db.from('projects').select('id,client_id,name').eq('id',projectId).maybeSingle();
 if(project.error||!project.data)throw new AgentV2ContextError('context_unavailable');
 const clientId=project.data.client_id;
 const [client,config,channels,settings,recent,profile,library,assessed,libraryUses]=await Promise.all([
  db.from('clients').select('name,activity,geographic_area').eq('id',clientId).maybeSingle(),
  db.from('publication_agent_projects').select('enabled,rights_confirmed,verified_services,editorial_rules,drive_folder_id').eq('project_id',projectId).eq('client_id',clientId).maybeSingle(),
  db.from('publication_project_channels').select('platform,enabled,editorial_rules').eq('project_id',projectId).eq('client_id',clientId),
  db.from('publication_client_settings').select('editorial_brief,media_reuse_allowed,media_reuse_after_days').eq('client_id',clientId).maybeSingle(),
  db.from('publications').select('id,subject,current_revision_id,status,archived_at').eq('client_id',clientId).order('created_at',{ascending:false}).limit(50),
  db.from('client_media_profiles').select('services,priority_topics,communication_guidelines').eq('client_id',clientId).maybeSingle(),
  db.from('whatsapp_assets').select('id,library_status,media_kind,mime_type,size,width,height,purged_at,imported_at,claimed_agent_v2_run_id').eq('client_id',clientId).eq('media_kind','image').order('imported_at',{ascending:false}).limit(300),
  db.from('whatsapp_asset_assessments').select('asset_id,verdict,confidential,sensitive,manual_verdict,description,topics,quality,quality_issues,business_relevance,publishability').eq('client_id',clientId),
  db.from('whatsapp_asset_uses').select('asset_id,publication_id,used_at').eq('client_id',clientId)]);
 if(client.error||!client.data||config.error||channels.error||!channels.data||settings.error||recent.error||!recent.data||profile.error||library.error||assessed.error||libraryUses.error)throw new AgentV2ContextError('context_unavailable');
 if(!config.data?.enabled||!config.data.rights_confirmed)throw new AgentV2ContextError('agent_disabled');
 const strings=(v:unknown)=>Array.isArray(v)?v.filter((s):s is string=>typeof s==='string'&&s.trim()!=='').map(s=>s.trim()):[];
 const services=[...new Set([...strings(config.data.verified_services),...strings(profile.data?.services)])];
 // Les 3 dernières idées (sujets distincts) du CLIENT, tous projets confondus (même photothèque, même audience) :
 // seules les publications réellement proposées comptent — jamais une refusée, ni un brouillon archivé (une
 // publication approuvée puis archivée reste comptée). Leurs publications, textes de la révision courante et photo.
 const proposed=(p:{status?:string|null;archived_at?:string|null})=>p.status!=='rejected'&&(!p.archived_at||p.status==='approved');
 const rows=(recent.data as {id:string;subject:string|null;current_revision_id:string|null;status?:string|null;archived_at?:string|null}[]).filter(proposed).slice(0,20);
 const lastSubjects=[...new Set(rows.map(p=>p.subject?.trim()).filter((s):s is string=>Boolean(s)))].slice(0,3);
 const lastRows=rows.filter(p=>p.subject&&lastSubjects.includes(p.subject.trim()));
 const revisionIds=lastRows.flatMap(p=>p.current_revision_id?[p.current_revision_id]:[]);
 const [media,uses,variants]=await Promise.all([
  db.from('publication_drive_media').select('id,analysis,claimed_run_id,claimed_agent_v2_run_id').eq('client_id',clientId).eq('drive_folder_id',config.data.drive_folder_id).limit(200),
  db.from('publication_media_uses').select('media_id,publication_id').eq('client_id',clientId),
  revisionIds.length?db.from('publication_variants').select('publication_id,revision_id,platform,text_content').eq('client_id',clientId).in('revision_id',revisionIds):Promise.resolve({data:[],error:null})]);
 if(media.error||!media.data||uses.error||!uses.data||variants.error)throw new AgentV2ContextError('context_unavailable');
 const used=new Set(uses.data.map(u=>u.media_id));
 const catalog:AgentMediaCandidate[]=media.data.flatMap(m=>{const a=(m.analysis??null) as Analysis|null;const scene=typeof a?.scene==='string'?a.scene:null;
  if(!scene||a?.usable!==true||!(scene in descriptions))return [];return [{id:m.id,categories:[scene],description:descriptions[scene],used:used.has(m.id)||(m.claimed_run_id??null)!==null||(m.claimed_agent_v2_run_id??null)!==null,source:'catalog' as const}];});
 const recentIds=new Set(lastRows.map(p=>p.id));
 const assessments=(assessed.data??[]) as LibraryAssessment[],libUses=(libraryUses.data??[]) as LibraryUse[];
 const pool=libraryCandidates((library.data??[]) as LibraryRow[],assessments,libUses,
  {allowed:settings.data?.media_reuse_allowed===true,afterDays:Number(settings.data?.media_reuse_after_days??180)},recentIds,new Date());
 // Photo de chaque publication récente : description du catalogue ou de l'évaluation (jamais un nom de fichier).
 const describe=(publicationId:string)=>{const c=uses.data.find(u=>u.publication_id===publicationId);if(c)return catalog.find(m=>m.id===c.media_id)?.description??null;
  const l=libUses.find(u=>u.publication_id===publicationId);return l?assessments.find(a=>a.asset_id===l.asset_id)?.description||null:null;};
 const texts=(variants.data??[]) as {publication_id:string;revision_id:string;platform:PublicationPlatform;text_content:string}[];
 const previousPublications:PreviousPublication[]=lastSubjects.map(subject=>{const pubs=lastRows.filter(p=>p.subject?.trim()===subject);
  return {subject,texts:pubs.flatMap(p=>texts.filter(t=>t.publication_id===p.id&&t.revision_id===p.current_revision_id).map(t=>({platform:t.platform,text:t.text_content.slice(0,600)}))),
   media:pubs.map(p=>describe(p.id)).find(Boolean)??null};});
 const enabled=(channels.data as {platform:PublicationPlatform;enabled:boolean;editorial_rules:string|null}[]).filter(c=>c.enabled);
 return {clientId,input:{client:{name:client.data.name,activity:client.data.activity?.trim()||null,zone:client.data.geographic_area?.trim()||null},project:{name:project.data.name},services,
  rules:[config.data.editorial_rules,settings.data?.editorial_brief??'',profile.data?.communication_guidelines??''].map(r=>r.trim()).filter(Boolean).join('\n').slice(0,8000),
  channelRules:enabled.flatMap(c=>c.editorial_rules?.trim()?[{platform:c.platform,rules:c.editorial_rules.trim()}]:[]),
  occurrences:[...occurrences],media:[...catalog,...pool],previousSubjects:rows.map(p=>p.subject).filter((s):s is string=>Boolean(s)).slice(0,20),
  previousPublications,priorityTopics:strings(profile.data?.priority_topics).slice(0,30)}};
}
