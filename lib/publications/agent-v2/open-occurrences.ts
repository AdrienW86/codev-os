import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {isPublicationUuid} from '../validation';
import type {OpenOccurrenceCandidate} from './contract';

// Agent Publications v2 — read-only loader of OPEN occurrences (unlinked, not skipped, not in the past) of a
// configured project, paginated (no N+1). Fail closed. No write, no AI, no Drive (Lot 4.3 P7-prep).
const unavailable='Occurrences ouvertes indisponibles.';
export async function getOpenOccurrencesForAgent(projectId:string,horizonDays=28,now=new Date()):Promise<OpenOccurrenceCandidate[]>{
 await requireAdmin();if(!isPublicationUuid(projectId)||!Number.isInteger(horizonDays)||horizonDays<1||horizonDays>84)throw Error(unavailable);
 const db=getSupabaseServerClient(),from=now.toISOString(),to=new Date(now.getTime()+horizonDays*86400000).toISOString(),result:OpenOccurrenceCandidate[]=[];
 for(let offset=0;;offset+=100){
  const {data,error}=await db.from('publication_channel_occurrences').select('id,client_id,project_id,platform,local_date,local_time,timezone,scheduled_for')
   .eq('project_id',projectId).is('publication_id',null).is('skipped_at',null).gte('scheduled_for',from).lte('scheduled_for',to)
   .order('scheduled_for').order('id').range(offset,offset+99);
  if(error||!data)throw Error(unavailable);
  result.push(...data.map(r=>({occurrenceId:r.id,projectId:r.project_id,clientId:r.client_id,platform:r.platform,date:r.local_date,time:r.local_time.slice(0,5),timezone:r.timezone,scheduledFor:r.scheduled_for})));
  if(data.length<100)return result;
 }
}
