import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {isPublicationUuid} from './validation';
import {platformLabels} from './editor';
import {occurrenceState,occurrenceStateLabels,type OccurrenceRow,type OccurrenceState} from './occurrence-model';
import {listEditorialGroupsForProject} from './editorial-groups';
import {creationErrorMessage,groupChoices,skipErrorMessage,validSkipReason,type CreationInput,type GroupChoice} from './occurrence-creation-model';
import type {PublicationPlatform} from './types';

// Occurrence-driven publications (Lot 4.3 P4-b). Reads are scoped to the project; writes only go through the
// atomic RPCs publication_create_from_occurrence and publication_occurrence_skip. Fail closed.
const unavailable='Créneau indisponible.';
export type OccurrenceForCreation={occurrence:{id:string;projectId:string;platform:PublicationPlatform;platformLabel:string;date:string;time:string;timezone:string;
 state:OccurrenceState;stateLabel:string;skippedReason:string|null;publication:{id:string;subject:string;status:string}|null};groups:GroupChoice[]};

export async function getOccurrenceForCreation(occurrenceId:string,projectId:string,now=new Date()):Promise<OccurrenceForCreation|null>{
 await requireAdmin();if(!isPublicationUuid(occurrenceId)||!isPublicationUuid(projectId))return null;const db=getSupabaseServerClient();
 const {data,error}=await db.from('publication_channel_occurrences').select('id,client_id,project_id,platform,local_date,local_time,timezone,scheduled_for,publication_id,skipped_at,skipped_reason')
  .eq('id',occurrenceId).eq('project_id',projectId).maybeSingle();
 if(error)throw Error(unavailable);if(!data)return null;
 const row=data as unknown as OccurrenceRow&{client_id:string;project_id:string};
 let publication:OccurrenceForCreation['occurrence']['publication']=null;
 if(row.publication_id){const p=await db.from('publications').select('id,subject,status').eq('id',row.publication_id).eq('client_id',row.client_id).maybeSingle();if(p.error)throw Error(unavailable);publication=p.data;}
 const groups=await listEditorialGroupsForProject(projectId);
 const state=occurrenceState(row,now);
 return {occurrence:{id:row.id,projectId:row.project_id,platform:row.platform,platformLabel:platformLabels[row.platform],date:row.local_date,time:row.local_time.slice(0,5),timezone:row.timezone,
  state,stateLabel:occurrenceStateLabels[state],skippedReason:row.skipped_reason,publication},groups:groupChoices(groups,row.platform)};
}
export async function createPublicationFromOccurrence(input:CreationInput):Promise<{ok:true;publicationId:string}|{ok:false;message:string}>{
 const {userId}=await requireAdmin();
 const {data,error}=await getSupabaseServerClient().rpc('publication_create_from_occurrence',{p_occurrence_id:input.occurrenceId,p_editorial_group_id:input.groupId,p_new_group_subject:input.newGroupSubject,
  p_subject:input.subject,p_text_content:input.text,p_metadata:input.cta?{cta:input.cta}:{},p_actor_id:userId});
 if(error)return {ok:false,message:creationErrorMessage(error.code)};
 const id=(data as {publication_id?:unknown}|null)?.publication_id;
 return isPublicationUuid(id)?{ok:true,publicationId:id}:{ok:false,message:'Création non confirmée : vérifiez le calendrier avant de relancer.'};
}
export async function skipOccurrence(occurrenceId:unknown,reason:unknown):Promise<{ok:boolean;message:string}>{
 const {userId}=await requireAdmin();const text=validSkipReason(reason);
 if(!isPublicationUuid(occurrenceId)||!text)return {ok:false,message:'Indiquez un motif (500 caractères maximum).'};
 const {error}=await getSupabaseServerClient().rpc('publication_occurrence_skip',{p_occurrence_id:occurrenceId,p_reason:text,p_actor_id:userId});
 return error?{ok:false,message:skipErrorMessage(error.code)}:{ok:true,message:'Créneau ignoré. Il ne sera pas recréé.'};
}
