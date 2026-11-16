import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {isPublicationUuid} from './validation';
import {loadPublicationProjectChannels} from './project-channels';
import {prepareNextPublicationsAs,type AgentV2Result,type PrepareOptions} from './agent-v2/service';
import {approveForDelivery} from './manual-scheduling';
import {localParts,publishNowInstant,publishNowMessage,publishNowPlatforms,PUBLISH_NOW_SKIP_REASON} from './publish-now-model';
import type {PublicationPlatform} from './types';

// « Rédiger et publier maintenant » (fiche client, onglet Publications) : un clic de l'administrateur.
// 1. une occurrence MANUELLE par réseau actif du projet (Facebook, Instagram, Google), quelques minutes plus tard ;
// 2. l'Agent Publications rédige sur ces seules occurrences et choisit la photo (même service que « Préparer les
//    prochaines publications », mêmes gardes ; jusqu'à 2 régénérations avec les motifs des refus) ;
// 3. chaque publication complète est soumise puis approuvée par cet administrateur (même circuit que
//    « Publier maintenant » d'un brouillon) ; le planificateur prépare la diffusion et envoie à l'heure.
// Si l'agent ne rédige rien, les occurrences créées sont ignorées : aucun créneau vide ne reste au calendrier.
export const PUBLISH_NOW_REFUSAL_RETRIES=2;
export type PublishNowResult={ok:boolean;message:string;publications?:{id:string;platform:PublicationPlatform;label:string;approval:string}[];scheduledFor?:string};
type Db=ReturnType<typeof getSupabaseServerClient>;
export type PublishNowDeps={db:()=>Db;now:()=>Date;platforms:(project:{id:string;client_id:string;type:string|null})=>Promise<PublicationPlatform[]|null>;
 prepare:(userId:string,projectId:string,options:PrepareOptions)=>Promise<AgentV2Result>;approve:typeof approveForDelivery};
const productionDeps:PublishNowDeps={db:getSupabaseServerClient,now:()=>new Date(),
 platforms:async project=>{const c=await loadPublicationProjectChannels(project);return c.source==='configured'?c.platforms:null;},
 prepare:prepareNextPublicationsAs,approve:approveForDelivery};

export async function draftAndPublishNow(projectId:unknown,deps:PublishNowDeps=productionDeps):Promise<PublishNowResult>{
 const {userId}=await requireAdmin();
 if(!isPublicationUuid(projectId))return {ok:false,message:'Projet invalide.'};
 const db=deps.db();
 const project=await db.from('projects').select('id,client_id,type').eq('id',projectId).maybeSingle();
 if(project.error||!project.data)return {ok:false,message:'Projet indisponible.'};
 const clientId=project.data.client_id as string;
 let projectPlatforms:PublicationPlatform[]|null;
 try{projectPlatforms=await deps.platforms(project.data as {id:string;client_id:string;type:string|null});}catch{projectPlatforms=null;}
 if(!projectPlatforms)return {ok:false,message:'Confirmez d’abord les canaux du projet (onglet Configuration).'};
 const platforms=publishNowPlatforms(projectPlatforms);
 if(!platforms.length)return {ok:false,message:'Aucun réseau Facebook, Instagram ou Google actif sur ce projet.'};
 const channels=await db.from('publication_project_channels').select('id,platform,enabled').eq('project_id',projectId).eq('client_id',clientId).in('platform',platforms);
 if(channels.error||!channels.data)return {ok:false,message:'Canaux indisponibles. Rechargez la page.'};
 const active=(channels.data as {id:string;platform:PublicationPlatform;enabled:boolean}[]).filter(c=>c.enabled&&platforms.includes(c.platform));
 if(!active.length)return {ok:false,message:'Aucun réseau Facebook, Instagram ou Google actif sur ce projet.'};
 // Fuseau : celui du planning du canal, sinon celui du client, sinon Paris (comme la programmation libre).
 const schedules=await db.from('publication_channel_schedules').select('project_channel_id,timezone').in('project_channel_id',active.map(c=>c.id));
 const settings=await db.from('publication_client_settings').select('timezone').eq('client_id',clientId).maybeSingle();
 const clientZone=(settings.data as {timezone?:string}|null)?.timezone??'Europe/Paris';
 const zoneOf=(channelId:string)=>(schedules.data as {project_channel_id:string;timezone:string}[]|null)?.find(s=>s.project_channel_id===channelId)?.timezone??clientZone;
 const at=publishNowInstant(deps.now());
 const created:string[]=[];
 const release=async()=>{for(const id of created){
  try{await db.rpc('publication_occurrence_skip',{p_occurrence_id:id,p_reason:PUBLISH_NOW_SKIP_REASON,p_actor_id:userId});}
  catch{console.error('[publish-now] occurrence not released');}}};
 for(const channel of active){
  const zone=zoneOf(channel.id),local=localParts(at,zone);
  if(!local){await release();return {ok:false,message:'Fuseau horaire du canal invalide.'};}
  const inserted=await db.from('publication_channel_occurrences').insert({client_id:clientId,project_id:projectId,project_channel_id:channel.id,platform:channel.platform,
   local_date:local.date,local_time:local.time,timezone:zone,scheduled_for:at.toISOString(),origin:'manual'}).select('id').single();
  if(inserted.error||!inserted.data){await release();return {ok:false,message:'Créneau immédiat non créé. Rien n’a été rédigé ni publié.'};}
  created.push((inserted.data as {id:string}).id);
 }
 const options:PrepareOptions={allowRealAI:true,onlyOccurrenceIds:created};
 let prepared:AgentV2Result;const reasons:string[]=[];
 try{
  prepared=await deps.prepare(userId,projectId,options);
  for(let retry=0;retry<PUBLISH_NOW_REFUSAL_RETRIES&&!prepared.ok&&prepared.refused;retry++){
   if(prepared.refusalDetail&&!reasons.includes(prepared.refusalDetail))reasons.push(prepared.refusalDetail);
   prepared=await deps.prepare(userId,projectId,{...options,retryFeedback:reasons.join(' ; ').slice(0,400)});
  }
 }catch{await releaseUnused(db,created,release);return {ok:false,message:'Rédaction indisponible. Rien n’a été publié.'};}
 if(!prepared.ok){await releaseUnused(db,created,release);
  return {ok:false,message:`${reasons.length?'Contenu refusé par les contrôles qualité après plusieurs essais. ':''}${prepared.message} Rien n’a été publié.`};}
 const zone=zoneOf(active[0].id);
 if(!prepared.withMedia)return {ok:true,message:publishNowMessage(0,prepared.publications.length,at,zone,true),
  publications:prepared.publications.map(p=>({...p,approval:'media'})),scheduledFor:at.toISOString()};
 const revisions=await db.from('publications').select('id,platform,current_revision_id').in('id',prepared.publications.map(p=>p.id));
 const rows=(revisions.data??[]) as {id:string;platform:PublicationPlatform;current_revision_id:string|null}[];
 const publications:NonNullable<PublishNowResult['publications']>=[];
 for(const p of prepared.publications){
  const row=rows.find(r=>r.id===p.id);
  const approval=row?.current_revision_id?await deps.approve(db,userId,{publication_id:p.id,platform:p.platform,revision_id:row.current_revision_id}):'failed';
  publications.push({...p,approval});
 }
 const approved=publications.filter(p=>p.approval==='approved').length;
 return {ok:true,message:publishNowMessage(approved,publications.length,at,zone,false),publications,scheduledFor:at.toISOString()};
}
// Occurrences restées sans publication (aucune rédaction, ou un réseau non couvert) : ignorées, jamais laissées vides.
async function releaseUnused(db:Db,created:string[],release:()=>Promise<void>){
 const open=await db.from('publication_channel_occurrences').select('id').in('id',created).is('publication_id',null).is('skipped_at',null);
 if(open.error||!open.data){await release();return;}
 const ids=new Set((open.data as {id:string}[]).map(o=>o.id));
 created.splice(0,created.length,...created.filter(id=>ids.has(id)));
 await release();
}
