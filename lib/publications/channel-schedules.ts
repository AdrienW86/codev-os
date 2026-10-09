import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {isPublicationUuid} from './validation';
import {normalizeScheduleSlots,sortScheduleSlots,type ChannelSchedule} from './channel-schedule-model';

// Schedules of explicit project channels (Lot 4.3 P2-a). Reads are batched; a read failure throws (never a
// silent fallback). Writes only go through publication_channel_schedule_save.
const unavailable='Planning des canaux indisponible. Vérifiez la migration des plannings (Lot 4.3 P2-a).';

export async function getChannelSchedules(projectChannelIds:readonly string[]):Promise<Map<string,ChannelSchedule>>{
 await requireAdmin();const ids=[...new Set(projectChannelIds)];const result=new Map<string,ChannelSchedule>();
 if(!ids.length)return result;if(ids.some(id=>!isPublicationUuid(id)))throw Error(unavailable);
 const db=getSupabaseServerClient();
 for(let offset=0;offset<ids.length;offset+=100){
  const batch=ids.slice(offset,offset+100);
  const schedules=await db.from('publication_channel_schedules').select('id,client_id,project_channel_id,timezone,enabled').in('project_channel_id',batch);
  if(schedules.error||!schedules.data)throw Error(unavailable);
  const scheduleIds=schedules.data.map(s=>s.id);
  const slots=scheduleIds.length?await db.from('publication_channel_schedule_slots').select('id,schedule_id,client_id,weekday,local_time,enabled').in('schedule_id',scheduleIds):{data:[],error:null};
  if(slots.error||!slots.data)throw Error(unavailable);
  for(const s of schedules.data)result.set(s.project_channel_id,{scheduleId:s.id,projectChannelId:s.project_channel_id,enabled:s.enabled,timezone:s.timezone,
   slots:sortScheduleSlots(slots.data.filter(x=>x.schedule_id===s.id&&x.client_id===s.client_id).map(x=>({id:x.id,weekday:x.weekday,localTime:x.local_time.slice(0,5),enabled:x.enabled})))});
 }
 return result;
}
export async function getChannelSchedule(projectChannelId:string):Promise<ChannelSchedule|null>{
 return (await getChannelSchedules([projectChannelId])).get(projectChannelId)??null;
}
// Complete schedule of one channel (atomic RPC, audited). No UI uses it yet (P2-b).
export async function saveChannelSchedule(input:{projectChannelId:string;timezone:string;enabled:boolean;slots:unknown}):Promise<{ok:true;scheduleId:string}|{ok:false;message:string}>{
 const {userId}=await requireAdmin();const slots=normalizeScheduleSlots(input.slots);
 if(!isPublicationUuid(input.projectChannelId)||typeof input.timezone!=='string'||!input.timezone||typeof input.enabled!=='boolean'||!slots)
  return {ok:false,message:'Planning invalide : créneaux distincts (jour 1–7, heure HH:MM), 28 au maximum.'};
 const {data,error}=await getSupabaseServerClient().rpc('publication_channel_schedule_save',{p_project_channel_id:input.projectChannelId,p_timezone:input.timezone,p_enabled:input.enabled,p_slots:slots,p_actor_id:userId});
 if(error||typeof data!=='string')return {ok:false,message:error?.code==='22023'?'Planning invalide (fuseau horaire ou créneaux).':error?.code==='23514'?'Canal introuvable ou hors périmètre.':'Planning non enregistré. Réessayez.'};
 return {ok:true,scheduleId:data};
}
