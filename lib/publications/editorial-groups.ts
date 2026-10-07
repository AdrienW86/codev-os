import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {isPublicationUuid} from './validation';
import {buildEditorialGroupView,type EditorialGroup,type EditorialGroupView,type GroupPublication} from './editorial-group-model';
import type {PublicationPlatform} from './types';

// Editorial groups of a project (Lot 4.3 P4-a). Read-only: groups and their sister publications are read in
// batches (no N+1); a read failure throws (never a silent fallback). No creation path yet (P4-b).
const unavailable='Groupes éditoriaux indisponibles. Vérifiez la migration des groupes (Lot 4.3 P4-a).';
const publicationColumns='id,editorial_group_id,occurrence_id,platform,subject,status,editorial_week,client_id,project_id';

async function sisters(groups:readonly EditorialGroup[]):Promise<GroupPublication[]>{
 const ids=groups.map(g=>g.id),result:GroupPublication[]=[];if(!ids.length)return result;
 const db=getSupabaseServerClient(),scope=new Map(groups.map(g=>[g.id,g]));
 for(let offset=0;offset<ids.length;offset+=100){
  const {data,error}=await db.from('publications').select(publicationColumns).in('editorial_group_id',ids.slice(offset,offset+100));
  if(error||!data)throw Error(unavailable);
  for(const p of data as unknown as (GroupPublication&{client_id:string;project_id:string|null})[]){const g=p.editorial_group_id?scope.get(p.editorial_group_id):undefined;
   if(g&&g.client_id===p.client_id&&g.project_id===p.project_id)result.push(p);}
 }
 return result;
}
export async function getProjectEditorialGroups(projectId:string,expectedPlatforms:readonly PublicationPlatform[]=[]):Promise<EditorialGroupView[]>{
 await requireAdmin();if(!isPublicationUuid(projectId))throw Error(unavailable);
 const {data,error}=await getSupabaseServerClient().from('publication_editorial_groups').select('id,client_id,project_id,subject,origin').eq('project_id',projectId).order('created_at').order('id');
 if(error||!data)throw Error(unavailable);
 const groups=data as EditorialGroup[],pubs=await sisters(groups);
 return groups.map(g=>buildEditorialGroupView(g,pubs,expectedPlatforms));
}
export async function getEditorialGroup(groupId:string,expectedPlatforms:readonly PublicationPlatform[]=[]):Promise<EditorialGroupView|null>{
 await requireAdmin();if(!isPublicationUuid(groupId))return null;
 const {data,error}=await getSupabaseServerClient().from('publication_editorial_groups').select('id,client_id,project_id,subject,origin').eq('id',groupId).maybeSingle();
 if(error)throw Error(unavailable);if(!data)return null;
 const group=data as EditorialGroup;return buildEditorialGroupView(group,await sisters([group]),expectedPlatforms);
}
