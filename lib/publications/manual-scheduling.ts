import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {revisionChannelsWithoutMedia,type MediaRuleDb} from './media-rule';
import {manualScheduleErrorMessage,parseManualScheduleForm,type ManualApproval} from './manual-scheduling-model';
import type {PublicationPlatform} from './types';

// Publication manuelle à tout moment : la RPC publication_schedule_manual crée une occurrence manuelle par plateforme
// du brouillon (maintenant ou à la date choisie) et y rattache le brouillon, en une transaction. L'administrateur qui
// programme valide ensuite chaque publication (soumission + approbation, mêmes RPC que la fiche), sauf TikTok dont les
// réglages imposés se choisissent sur la fiche. La diffusion suit le circuit habituel : le planificateur (toutes les
// 15 minutes) prépare et envoie les publications validées dont l'heure est venue.
export type ManualScheduledPublication={publicationId:string;platform:PublicationPlatform;approval:ManualApproval};
export type ManualScheduleResult={ok:boolean;message:string;publications?:ManualScheduledPublication[];scheduledFor?:string;now?:boolean;
 sourceArchived?:boolean;clientId?:string;projectId?:string};
type Scheduled={mode:'in_place'|'split';publications:{publication_id:string;platform:PublicationPlatform;revision_id:string}[];archived_source_id:string|null;scheduled_for:string};

async function approve(db:ReturnType<typeof getSupabaseServerClient>,userId:string,p:Scheduled['publications'][number]):Promise<ManualApproval>{
 if(p.platform==='tiktok')return 'tiktok';
 try{
  const missing=await revisionChannelsWithoutMedia(db as unknown as MediaRuleDb,p.revision_id);
  if(missing===null)return 'failed';if(missing.length)return 'media';
  const submitted=await db.rpc('publication_submit_manual',{p_publication_id:p.publication_id,p_revision_id:p.revision_id,p_actor_id:userId});
  if(submitted.error)return 'failed';
  const reviewed=await db.rpc('publication_review_manual',{p_publication_id:p.publication_id,p_revision_id:p.revision_id,p_decision:'approved',p_reason:null,p_actor_id:userId});
  if(reviewed.error)return /media required/i.test(reviewed.error.message??'')?'media':'failed';
  return 'approved';
 }catch{return 'failed';}
}
export async function scheduleManually(form:FormData,now=new Date()):Promise<ManualScheduleResult>{
 const {userId}=await requireAdmin();const input=parseManualScheduleForm(form,now);
 if(!input)return {ok:false,message:'Choisissez « maintenant » ou une date à venir (12 semaines maximum).'};
 const db=getSupabaseServerClient();
 const {data,error}=await db.from('publications').select('id,client_id,project_id,current_revision_id').eq('id',input.publicationId).maybeSingle();
 if(error||!data)return {ok:false,message:manualScheduleErrorMessage(undefined,undefined)};
 if(data.current_revision_id!==input.revisionId)return {ok:false,message:manualScheduleErrorMessage('40001',undefined)};
 const result=await db.rpc('publication_schedule_manual',{p_publication_id:input.publicationId,p_expected_revision_id:input.revisionId,p_at:input.at,p_actor_id:userId});
 if(result.error)return {ok:false,message:manualScheduleErrorMessage(result.error.code,result.error.message)};
 const body=result.data as Scheduled;
 const publications:ManualScheduledPublication[]=[];
 for(const p of body.publications)publications.push({publicationId:p.publication_id,platform:p.platform,approval:await approve(db,userId,p)});
 const pending=publications.filter(p=>p.approval!=='approved').length;
 const message=pending===0?(input.now?'Programmée pour maintenant : envoi dans les 15 prochaines minutes.':'Programmée et validée.')
  :pending===publications.length?'Programmée. Validez-la sur sa fiche pour qu’elle parte.':'Programmée. Certaines publications restent à valider sur leur fiche.';
 return {ok:true,message,publications,scheduledFor:body.scheduled_for,now:input.now,sourceArchived:Boolean(body.archived_source_id),clientId:data.client_id,projectId:data.project_id??undefined};
}
