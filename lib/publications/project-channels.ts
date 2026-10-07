import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {legacyPublicationChannelsForType} from './legacy-channels';
import {channelLockMessage,legacyProductionBlock,projectSupportsPublications,publicationCapabilities,type PublicationCapabilities,type PublicationProjectChannel} from './channels';
import {isPublicationUuid} from './validation';
import type {PublicationPlatform} from './types';

// Business service: project → configured publication channels. Every server caller goes through it.
// A project with at least one publication_project_channels row is "configured": only its enabled rows count,
// even when none is enabled (Publications suspended). Projects never configured use the TRANSITIONAL legacy
// fallback (project type). A read failure throws: never a silent fallback.
export type PublicationProjectRef={id:string;client_id:string;type:string|null};
const unavailable='Canaux de publication indisponibles. Vérifiez la migration des canaux (Lot 4.3 P1).';

async function readChannels(projects:readonly PublicationProjectRef[]):Promise<Map<string,PublicationProjectChannel[]>>{
 const rows=new Map<string,PublicationProjectChannel[]>(),ids=[...new Set(projects.map(p=>p.id))],client=new Map(projects.map(p=>[p.id,p.client_id]));
 if(ids.some(id=>!isPublicationUuid(id)))throw Error(unavailable);
 const db=getSupabaseServerClient();
 for(let offset=0;offset<ids.length;offset+=100){
  const {data,error}=await db.from('publication_project_channels').select('project_id,client_id,platform,enabled').in('project_id',ids.slice(offset,offset+100));
  if(error||!data)throw Error(unavailable);
  for(const row of data){if(row.client_id!==client.get(row.project_id))continue;rows.set(row.project_id,[...rows.get(row.project_id)??[],{platform:row.platform,enabled:row.enabled}]);}
 }
 return rows;
}
function sameSet(a:readonly string[],b:readonly string[]){return a.length===b.length&&a.every(x=>b.includes(x));}
function resolve(project:PublicationProjectRef,rows:Map<string,PublicationProjectChannel[]>):PublicationCapabilities{
 const legacy=legacyPublicationChannelsForType(project.type),own=rows.get(project.id);
 if(!own?.length)return publicationCapabilities(legacy,'legacy');
 const configured=publicationCapabilities(own,'configured');
 return {...configured,legacyAligned:sameSet(configured.platforms,legacy.map(c=>c.platform))};
}
export async function getPublicationProjectChannels(project:PublicationProjectRef):Promise<PublicationCapabilities>{
 await requireAdmin();return resolve(project,await readChannels([project]));
}
// Batch variant for lists: one read per 100 projects, never one read per row.
export async function getPublicationCapabilitiesForProjects(projects:readonly PublicationProjectRef[]):Promise<Map<string,PublicationCapabilities>>{
 await requireAdmin();if(!projects.length)return new Map();const rows=await readChannels(projects);return new Map(projects.map(p=>[p.id,resolve(p,rows)]));
}
// Projects offered in publication forms and filters: only those able to produce, with their platforms.
export type PublicationProjectOption={id:string;client_id:string;name:string;type:string|null;platforms:PublicationPlatform[]};
export async function publicationProjectOptions(projects:readonly (PublicationProjectRef&{name:string})[]):Promise<PublicationProjectOption[]>{
 const capabilities=await getPublicationCapabilitiesForProjects(projects);
 return projects.flatMap(p=>{const c=capabilities.get(p.id);return c&&projectSupportsPublications(c)?[{id:p.id,client_id:p.client_id,name:p.name,type:p.type,platforms:c.platforms}]:[];});
}
async function projectRef(projectId:string):Promise<PublicationProjectRef|null>{
 const {data,error}=await getSupabaseServerClient().from('projects').select('id,client_id,type').eq('id',projectId).maybeSingle();
 if(error)throw Error(unavailable);return data;
}
// TRANSITIONAL server guard for legacy calendar generation and Agent v1 (see legacyProductionBlock).
// Any read failure blocks (fail closed); nothing is written.
export async function projectProductionBlock(projectId:string,target:'calendar'|'agent'):Promise<string|null>{
 await requireAdmin();if(!isPublicationUuid(projectId))return 'Projet invalide.';
 try{const project=await projectRef(projectId);if(!project)return 'Projet invalide.';return legacyProductionBlock(await getPublicationProjectChannels(project),target);}
 catch{return 'Vérification des canaux impossible : action bloquée par sécurité.';}
}
// Legacy calendar generation (publication_calendar_slots): never for an explicitly configured project, whose
// calendar is made of channel occurrences since Lot 4.3 P3. Legacy projects keep the historical rules.
export async function legacyCalendarBlock(projectId:string):Promise<string|null>{
 await requireAdmin();if(!isPublicationUuid(projectId))return 'Projet invalide.';
 try{const project=await projectRef(projectId);if(!project)return 'Projet invalide.';const capabilities=await getPublicationProjectChannels(project);
  if(capabilities.source==='configured')return 'Ce projet utilise le planning par canal : utilisez « Préparer les prochaines semaines » dans le calendrier.';
  return legacyProductionBlock(capabilities,'calendar');}
 catch{return 'Vérification des canaux impossible : action bloquée par sécurité.';}
}
// Server guard for every write on an existing publication (save, media, regeneration, approval): its current
// revision must only target enabled channels of its project. Unscoped historical content is not concerned.
export async function publicationChannelLock(publicationId:string):Promise<string|null>{
 await requireAdmin();if(!isPublicationUuid(publicationId))return null;
 try{
  const db=getSupabaseServerClient();
  const pub=await db.from('publications').select('project_id,client_id,current_revision_id').eq('id',publicationId).maybeSingle();
  if(pub.error)throw Error(unavailable);if(!pub.data?.project_id||!pub.data.current_revision_id)return null;
  const [project,variants]=await Promise.all([projectRef(pub.data.project_id),db.from('publication_variants').select('platform').eq('revision_id',pub.data.current_revision_id).eq('client_id',pub.data.client_id)]);
  if(!project||project.client_id!==pub.data.client_id||variants.error||!variants.data)throw Error(unavailable);
  return channelLockMessage(await getPublicationProjectChannels(project),variants.data.map(v=>v.platform));
 }catch{return 'Vérification des canaux impossible : lecture seule par sécurité.';}
}
