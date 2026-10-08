import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {isPublicationUuid} from '../validation';
import {signBoardImages} from '../board';
import {mediaCategoryLabel,type AgentV2MediaRunView,type AgentV2MediaState} from './media-view';

// Latest completed Agent v2 preparations of a project and the state of their media (Lot 4.3 P8). Read only.
// Exposes the category, the state and a short-lived signed preview; never a Drive id, folder, storage path or token.
export type {AgentV2MediaRunView};
type RunRow={id:string;created_at:string;publication_ids:string[];selected_media_id:string|null;media_status:string;media_lease_until:string|null};
const failed='Préparations indisponibles.';

export function mediaStateOfRun(row:Pick<RunRow,'media_status'>):AgentV2MediaState{
 return row.media_status==='attached'?'attached':row.media_status==='needs_media'?'failed':row.media_status==='pending'?'pending':'none';
}
// A failed attempt, or a pending one that never started / whose lease expired, can be retried (no new generation).
export function isRetryable(row:Pick<RunRow,'media_status'|'media_lease_until'>,now:Date):boolean{
 return row.media_status==='needs_media'||(row.media_status==='pending'&&(!row.media_lease_until||Date.parse(row.media_lease_until)<=now.getTime()));
}

export async function getAgentV2MediaRuns(projectId:string,limit=5,now=new Date()):Promise<AgentV2MediaRunView[]>{
 await requireAdmin();if(!isPublicationUuid(projectId))return [];
 const runs=await getSupabaseServerClient().from('publication_agent_v2_runs').select(columns).eq('project_id',projectId).eq('status','completed').order('created_at',{ascending:false}).limit(limit);
 if(runs.error||!runs.data)throw new Error(failed);
 return describeRuns(runs.data as RunRow[],now);
}
// Media of one run (result of a preparation or of a retry).
export async function getAgentV2RunMedia(runId:string,now=new Date()):Promise<AgentV2MediaRunView|null>{
 await requireAdmin();if(!isPublicationUuid(runId))return null;
 const run=await getSupabaseServerClient().from('publication_agent_v2_runs').select(columns).eq('id',runId).eq('status','completed').maybeSingle();
 if(run.error)throw new Error(failed);
 return run.data?(await describeRuns([run.data as RunRow],now))[0]:null;
}
const columns='id,created_at,publication_ids,selected_media_id,media_status,media_lease_until';
async function describeRuns(rows:RunRow[],now:Date):Promise<AgentV2MediaRunView[]>{
 const db=getSupabaseServerClient();
 const mediaIds=[...new Set(rows.flatMap(r=>r.selected_media_id?[r.selected_media_id]:[]))];
 const attachedDrafts=rows.filter(r=>r.media_status==='attached').flatMap(r=>r.publication_ids);
 const [media,uses]=await Promise.all([
  mediaIds.length?db.from('publication_drive_media').select('id,analysis').in('id',mediaIds):Promise.resolve({data:[],error:null}),
  attachedDrafts.length?db.from('publication_media_uses').select('publication_id,asset_id,media_id').in('publication_id',attachedDrafts):Promise.resolve({data:[],error:null})]);
 if(media.error||uses.error)throw new Error(failed);
 const useRows=(uses.data??[]) as {publication_id:string;asset_id:string;media_id:string}[];
 const assetIds=[...new Set(useRows.map(u=>u.asset_id))];
 const assets=assetIds.length?await db.from('publication_assets').select('id,storage_path').in('id',assetIds):{data:[],error:null};
 if(assets.error)throw new Error(failed);
 const paths=new Map(((assets.data??[]) as {id:string;storage_path:string}[]).map(a=>[a.id,a.storage_path]));
 const signed=await signBoardImages([...paths.values()]);
 const scenes=new Map(((media.data??[]) as {id:string;analysis:{scene?:unknown}|null}[]).map(m=>[m.id,m.analysis?.scene]));
 return rows.map(r=>{const state=mediaStateOfRun(r);
  const use=state==='attached'?useRows.find(u=>u.media_id===r.selected_media_id&&r.publication_ids.includes(u.publication_id)):undefined;
  const path=use?paths.get(use.asset_id):undefined;
  return {id:r.id,createdAt:r.created_at,drafts:r.publication_ids.length,retryable:isRetryable(r,now),
   media:{state,category:r.selected_media_id?mediaCategoryLabel(scenes.get(r.selected_media_id)):null,preview:path?signed.get(path)??null:null}};});
}
