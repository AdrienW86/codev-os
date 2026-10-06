import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {planningRows} from './planning';
import {isPublicationUuid} from './validation';
import type {Publication,CalendarSlot} from './types';

export async function getPublicationsAgentProject(projectId:string){
 await requireAdmin();if(!isPublicationUuid(projectId))throw Error('Invalid project');const db=getSupabaseServerClient();
 const config=await db.from('publication_agent_projects').select('*').eq('project_id',projectId).maybeSingle();
 if(config.error?.code==='PGRST205'||config.error?.code==='42P01')return {ready:false as const,config:null,placeholders:[]};
 if(config.error)throw Error('Configuration de l’Agent Publications indisponible.');
 const [slots,publications]=await Promise.all([
  planningRows<CalendarSlot>(()=>db.from('publication_calendar_slots').select('*').eq('project_id',projectId).order('id')),
  planningRows<Publication>(()=>db.from('publications').select('*').eq('project_id',projectId).eq('status','draft').is('current_revision_id',null).order('id')),
 ]);
 return {ready:true as const,config:config.data,placeholders:publications.filter(p=>slots.some(s=>s.publication_id===p.id&&s.client_id===p.client_id)).sort((a,b)=>(a.target_date??a.editorial_week).localeCompare(b.target_date??b.editorial_week))};
}
export async function getGenerationDetails(revisionId:string|null){
 await requireAdmin();if(!revisionId||!isPublicationUuid(revisionId))return null;
 const result=await getSupabaseServerClient().from('publication_generation_details').select('*').eq('revision_id',revisionId).maybeSingle();
 // The legacy manual workflow remains available before deployment of Lot 4.
 if(result.error?.code==='PGRST205'||result.error?.code==='42P01')return null;
 if(result.error)throw Error('Justification de préparation indisponible.');return result.data;
}
