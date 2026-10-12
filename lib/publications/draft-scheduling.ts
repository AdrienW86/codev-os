import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {isPublicationUuid} from './validation';
import {getOpenOccurrencesForAgent} from './agent-v2/open-occurrences';
import {isUnscheduledDraft,parseScheduleForm,scheduleChoices,scheduleErrorMessage,type ScheduleChoice,type ScheduledPublication} from './draft-scheduling-model';
import type {PublicationPlatform} from './types';

// Planification d'un brouillon non planifié : lecture des créneaux ouverts du calendrier existant (12 semaines), puis
// rattachement par la seule RPC publication_schedule_draft (transactionnelle, aucun moteur parallèle).
const HORIZON_DAYS=84;
type DraftRow={id:string;client_id:string;project_id:string|null;slot:number|null;occurrence_id:string|null;editorial_group_id:string|null;archived_at:string|null;current_revision_id:string|null};
async function draftPlatforms(db:ReturnType<typeof getSupabaseServerClient>,revisionId:string):Promise<PublicationPlatform[]|null>{
 const {data,error}=await db.from('publication_variants').select('platform').eq('revision_id',revisionId);
 return error||!data?null:[...new Set(data.map(v=>v.platform as PublicationPlatform))].sort();
}
export type DraftSchedulingOptions={publicationId:string;revisionId:string;choices:ScheduleChoice[]};
/** `null` si la publication n'est pas un brouillon planifiable. Échec fermé si le calendrier est illisible. */
export async function getDraftSchedulingOptions(publicationId:string,now=new Date()):Promise<DraftSchedulingOptions|null>{
 await requireAdmin();if(!isPublicationUuid(publicationId))return null;const db=getSupabaseServerClient();
 const {data,error}=await db.from('publications').select('id,client_id,project_id,slot,occurrence_id,editorial_group_id,archived_at,current_revision_id').eq('id',publicationId).maybeSingle();
 if(error)throw Error('Brouillon indisponible.');const p=data as DraftRow|null;
 if(!p||!isUnscheduledDraft(p)||!p.current_revision_id||!p.project_id)return null;
 const platforms=await draftPlatforms(db,p.current_revision_id);if(!platforms?.length)throw Error('Brouillon indisponible.');
 const occurrences=await getOpenOccurrencesForAgent(p.project_id,HORIZON_DAYS,now);
 return {publicationId:p.id,revisionId:p.current_revision_id,choices:scheduleChoices(platforms,occurrences.filter(o=>o.clientId===p.client_id))};
}
export type ScheduleResult={ok:boolean;message:string;mode?:'in_place'|'split';publications?:ScheduledPublication[];sourceArchived?:boolean;clientId?:string;projectId?:string};
export async function scheduleDraft(form:FormData):Promise<ScheduleResult>{
 const {userId}=await requireAdmin();const db=getSupabaseServerClient();const id=form.get('publication_id');
 if(!isPublicationUuid(id))return {ok:false,message:scheduleErrorMessage('22023',undefined)};
 const {data,error}=await db.from('publications').select('id,client_id,project_id,current_revision_id').eq('id',id).maybeSingle();
 if(error||!data?.current_revision_id)return {ok:false,message:scheduleErrorMessage(undefined,undefined)};
 // Plateformes lues côté serveur sur la révision attendue : le formulaire ne peut pas en ajouter ni en retirer.
 const revision=form.get('revision_id');if(revision!==data.current_revision_id)return {ok:false,message:scheduleErrorMessage('40001',undefined)};
 const platforms=await draftPlatforms(db,data.current_revision_id);const input=platforms?parseScheduleForm(form,platforms):null;
 if(!input)return {ok:false,message:scheduleErrorMessage('22023',undefined)};
 const result=await db.rpc('publication_schedule_draft',{p_publication_id:input.publicationId,p_expected_revision_id:input.revisionId,p_assignments:input.assignments,p_actor_id:userId});
 if(result.error)return {ok:false,message:scheduleErrorMessage(result.error.code,result.error.message)};
 const body=result.data as {mode:'in_place'|'split';publications:{publication_id:string;platform:PublicationPlatform;occurrence_id:string}[];archived_source_id:string|null};
 const publications=body.publications.map(p=>({publicationId:p.publication_id,platform:p.platform,occurrenceId:p.occurrence_id}));
 return {ok:true,mode:body.mode,publications,sourceArchived:Boolean(body.archived_source_id),clientId:data.client_id,projectId:data.project_id??undefined,
  message:body.mode==='in_place'?'Brouillon rattaché au créneau. Relisez-le puis soumettez-le à validation : une approbation antérieure ne vaut pas pour la date choisie.'
   :`Brouillon planifié en ${publications.length} publications (une par plateforme), à relire puis à soumettre à validation. Le brouillon d’origine est archivé et reste consultable.`};
}
