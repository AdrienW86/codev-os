import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {isPublicationUuid} from './validation';
import {getPublicationProjectChannels,type PublicationProjectRef} from './project-channels';
import {getChannelSchedules,saveChannelSchedule} from './channel-schedules';
import {buildChannelConfiguration,type ChannelConfigurationView} from './channel-configuration-model';
import {publicationPlatforms,type PublicationPlatform} from './types';
import type {PublicationCapabilities} from './channels';

// "Configuration" tab of a Publications project (Lot 4.3 P2-b). Reads only; every write goes through the
// existing RPCs (publication_channel_save from P1, publication_channel_schedule_save from P2-a).
// Displaying the page never writes: a legacy project only becomes configured through confirmLegacyChannels.
const unavailable='Configuration des canaux indisponible.';
type Result={ok:boolean;message:string};
const isPlatform=(value:unknown):value is PublicationPlatform=>typeof value==='string'&&(publicationPlatforms as readonly string[]).includes(value);

export async function loadChannelConfiguration(project:PublicationProjectRef,capabilities:PublicationCapabilities):Promise<{view:ChannelConfigurationView;debug:Record<string,unknown>}>{
 await requireAdmin();const db=getSupabaseServerClient();
 const rows=await db.from('publication_project_channels').select('id,platform,enabled,publication_account_id,editorial_rules').eq('project_id',project.id).eq('client_id',project.client_id);
 if(rows.error||!rows.data)throw Error(unavailable);
 const accountIds=rows.data.flatMap(r=>r.publication_account_id?[r.publication_account_id]:[]);
 const accounts=accountIds.length?await db.from('publication_accounts').select('id,status').in('id',accountIds).eq('client_id',project.client_id):{data:[],error:null};
 if(accounts.error||!accounts.data)throw Error(unavailable);
 const schedules=await getChannelSchedules(rows.data.map(r=>r.id));
 const view=buildChannelConfiguration(capabilities,rows.data.map(r=>({platform:r.platform,enabled:r.enabled,rules:r.editorial_rules,
  accountConnected:accounts.data.some(a=>a.id===r.publication_account_id&&a.status==='connected'),schedule:schedules.get(r.id)??null})));
 // Debug only (?debug=1): identifiers and statuses, never account data.
 return {view,debug:{project_id:project.id,source:capabilities.source,legacy_aligned:capabilities.legacyAligned,
  channels:rows.data.map(r=>({id:r.id,platform:r.platform,enabled:r.enabled,schedule_id:schedules.get(r.id)?.scheduleId??null}))}};
}

async function projectRef(projectId:unknown):Promise<PublicationProjectRef|null>{
 if(!isPublicationUuid(projectId))return null;
 const {data,error}=await getSupabaseServerClient().from('projects').select('id,client_id,type').eq('id',projectId).maybeSingle();
 if(error)throw Error(unavailable);return data;
}
async function explicitChannel(project:PublicationProjectRef,platform:PublicationPlatform){
 const {data,error}=await getSupabaseServerClient().from('publication_project_channels').select('id,enabled,publication_account_id,editorial_rules')
  .eq('project_id',project.id).eq('client_id',project.client_id).eq('platform',platform).maybeSingle();
 if(error)throw Error(unavailable);return data;
}
function channelError(code:string|undefined):string{return code==='23514'?'Ce projet ne peut pas encore configurer ses canaux.':code==='22023'?'Valeur invalide.':'Modification non enregistrée. Réessayez.';}

// Explicit admin action: materializes the inherited channels (one atomic P1 RPC call), never on display.
export async function confirmLegacyChannels(projectId:unknown):Promise<Result>{
 const {userId}=await requireAdmin();
 try{
  const project=await projectRef(projectId);if(!project)return {ok:false,message:'Projet invalide.'};
  const capabilities=await getPublicationProjectChannels(project);
  if(capabilities.source==='configured')return {ok:true,message:'Les canaux sont déjà configurés.'};
  const first=capabilities.platforms[0];if(!first)return {ok:false,message:'Aucun canal hérité à confirmer pour ce projet.'};
  const {error}=await getSupabaseServerClient().rpc('publication_channel_save',{p_project_id:project.id,p_platform:first,p_enabled:true,p_publication_account_id:null,p_editorial_rules:null,p_actor_id:userId});
  if(error)return {ok:false,message:channelError(error.code)};
  return {ok:true,message:'Canaux confirmés : vous pouvez maintenant les personnaliser.'};
 }catch{return {ok:false,message:unavailable};}
}
// Enable/disable one channel; its account and editorial rules are preserved. 0 active channel is valid.
export async function setChannelEnabled(projectId:unknown,platform:unknown,enabled:unknown):Promise<Result>{
 const {userId}=await requireAdmin();
 if(!isPlatform(platform)||typeof enabled!=='boolean')return {ok:false,message:'Canal invalide.'};
 try{
  const project=await projectRef(projectId);if(!project)return {ok:false,message:'Projet invalide.'};
  if((await getPublicationProjectChannels(project)).source==='legacy')return {ok:false,message:'Confirmez d’abord les canaux hérités.'};
  const current=await explicitChannel(project,platform);
  const {error}=await getSupabaseServerClient().rpc('publication_channel_save',{p_project_id:project.id,p_platform:platform,p_enabled:enabled,
   p_publication_account_id:current?.publication_account_id??null,p_editorial_rules:current?.editorial_rules??null,p_actor_id:userId});
  if(error)return {ok:false,message:channelError(error.code)};
  return {ok:true,message:enabled?'Canal activé.':'Canal désactivé. Son planning est conservé.'};
 }catch{return {ok:false,message:unavailable};}
}
// Complete schedule of one channel through the atomic P2-a RPC (absent slots are disabled there, never deleted).
export async function saveScheduleForPlatform(projectId:unknown,platform:unknown,input:{enabled:unknown;timezone:unknown;slots:unknown}):Promise<Result>{
 await requireAdmin();
 if(!isPlatform(platform)||typeof input.enabled!=='boolean'||typeof input.timezone!=='string')return {ok:false,message:'Planning invalide.'};
 try{
  const project=await projectRef(projectId);if(!project)return {ok:false,message:'Projet invalide.'};
  const channel=await explicitChannel(project,platform);if(!channel)return {ok:false,message:'Activez ou confirmez d’abord ce canal.'};
  const saved=await saveChannelSchedule({projectChannelId:channel.id,timezone:input.timezone,enabled:input.enabled,slots:input.slots});
  return saved.ok?{ok:true,message:'Planning enregistré.'}:{ok:false,message:saved.message};
 }catch{return {ok:false,message:unavailable};}
}
