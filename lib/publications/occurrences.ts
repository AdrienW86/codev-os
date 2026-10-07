import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {isPublicationUuid} from './validation';
import {addDays,parisToday,validDate} from './calendar';
import {buildOccurrenceEntries,ensureResultMessage,parseEnsureResult,preparationPeriod,type EnsureOccurrencesResult,type LinkedPublication,type OccurrenceEntry,type OccurrenceRow} from './occurrence-model';

// Dated channel occurrences (Lot 4.3 P3). Reads are paginated and batched (no N+1); a read failure throws
// (never a silent fallback). The only write is the explicit, audited publication_channel_occurrences_ensure RPC.
const unavailable='Occurrences indisponibles. Vérifiez la migration des occurrences (Lot 4.3 P3).';
const columns='id,platform,local_date,local_time,timezone,scheduled_for,publication_id,skipped_at,skipped_reason,client_id';

async function readOccurrences(projectId:string,from:string,to:string):Promise<(OccurrenceRow&{client_id:string})[]>{
 const db=getSupabaseServerClient(),rows:(OccurrenceRow&{client_id:string})[]=[];
 for(let offset=0;;offset+=100){
  const {data,error}=await db.from('publication_channel_occurrences').select(columns).eq('project_id',projectId).gte('local_date',from).lte('local_date',to)
   .order('local_date').order('local_time').order('id').range(offset,offset+99);
  if(error||!data)throw Error(unavailable);rows.push(...(data as unknown as (OccurrenceRow&{client_id:string})[]));if(data.length<100)return rows;
 }
}
async function linkedPublications(rows:readonly (OccurrenceRow&{client_id:string})[]):Promise<LinkedPublication[]>{
 const ids=[...new Set(rows.flatMap(r=>r.publication_id?[r.publication_id]:[]))],result:LinkedPublication[]=[];if(!ids.length)return result;
 const clients=[...new Set(rows.map(r=>r.client_id))],db=getSupabaseServerClient();
 for(let offset=0;offset<ids.length;offset+=100){
  const {data,error}=await db.from('publications').select('id,subject,status,client_id').in('id',ids.slice(offset,offset+100)).in('client_id',clients);
  if(error||!data)throw Error(unavailable);result.push(...data.map(p=>({id:p.id,subject:p.subject,status:p.status})));
 }
 return result;
}
export async function getProjectOccurrences(projectId:string,from:string,to:string,now=new Date()):Promise<OccurrenceEntry[]>{
 await requireAdmin();if(!isPublicationUuid(projectId)||!validDate(from)||!validDate(to)||to<from)throw Error(unavailable);
 const rows=await readOccurrences(projectId,from,to);return buildOccurrenceEntries(rows,await linkedPublications(rows),now);
}
// Next occurrences still to prepare or already linked (skipped ones are excluded), over the next 12 weeks.
export async function getUpcomingProjectOccurrences(projectId:string,limit=10,now=new Date()):Promise<OccurrenceEntry[]>{
 const today=parisToday(now);const entries=await getProjectOccurrences(projectId,today,addDays(today,83),now);
 return entries.filter(e=>e.state==='open'||e.state==='linked').slice(0,Math.max(0,Math.min(limit,100)));
}
// Explicit admin action only (no cron, no background generation): 1, 2 or 4 weeks from today (Paris).
export async function ensureProjectOccurrences(projectId:unknown,weeks:unknown,now=new Date()):Promise<{ok:boolean;message:string;result?:EnsureOccurrencesResult}>{
 const {userId}=await requireAdmin();const period=typeof weeks==='number'?preparationPeriod(parisToday(now),weeks):null;
 if(!isPublicationUuid(projectId)||!period)return {ok:false,message:'Choisissez une période de 1, 2 ou 4 semaines.'};
 const {data,error}=await getSupabaseServerClient().rpc('publication_channel_occurrences_ensure',{p_project_id:projectId,p_start_date:period.start,p_end_date:period.end,p_actor_id:userId});
 if(error)return {ok:false,message:error.code==='23514'?'Configurez d’abord les canaux de ce projet (onglet Configuration).':error.code==='22023'?'Période invalide.':'Préparation non confirmée. Réessayez.'};
 const result=parseEnsureResult(data);if(!result)return {ok:false,message:'Résultat de préparation illisible : vérifiez le calendrier avant de relancer.'};
 return {ok:true,message:ensureResultMessage(result),result};
}
