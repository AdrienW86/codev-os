import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {cleanupCategories,cleanupCategory,type CleanupCategory} from './cleanup-rules';

// Bulk clean-up of the board: one audited publication_remove call per publication (pending sends cancelled, nothing deleted on networks).
const MAX=200;
type Row={id:string;client_id:string;status:string;target_date:string|null;editorial_week:string};
export type CleanupCounts=Record<CleanupCategory,number>;
const parisToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const empty=():CleanupCounts=>({published:0,failed:0,rejected:0,past:0});

async function candidates(clientId:string):Promise<{id:string;category:CleanupCategory}[]>{
 const db=getSupabaseServerClient();
 let query=db.from('publications').select('id,client_id,status,target_date,editorial_week').is('archived_at',null).order('id').limit(2000);
 if(clientId)query=query.eq('client_id',clientId);
 const {data,error}=await query;if(error)throw error;
 const rows=(data??[]) as Row[],statuses=new Map<string,string[]>();
 for(let i=0;i<rows.length;i+=100){
  const ids=rows.slice(i,i+100).map(r=>r.id);
  const deliveries=await db.from('publication_deliveries').select('publication_id,status').in('publication_id',ids).limit(5000);
  if(deliveries.error)throw deliveries.error;
  for(const d of (deliveries.data??[]) as {publication_id:string;status:string}[])statuses.set(d.publication_id,[...(statuses.get(d.publication_id)??[]),d.status]);
 }
 const today=parisToday();
 return rows.flatMap(r=>{const category=cleanupCategory({status:r.status,targetDate:r.target_date,editorialWeek:r.editorial_week,deliveries:statuses.get(r.id)??[]},today);return category?[{id:r.id,category}]:[];});
}

/** Number of publications each category would archive (shown before confirming). */
export async function previewCleanup(clientId=''):Promise<CleanupCounts|null>{
 await requireAdmin();
 try{const counts=empty();for(const c of await candidates(clientId))counts[c.category]++;return counts;}catch{return null;}
}

export async function archiveFinishedPublications(categories:readonly CleanupCategory[],clientId=''):Promise<{ok:boolean;message:string;archived:number}>{
 const {userId}=await requireAdmin();
 const wanted=new Set(categories.filter(c=>cleanupCategories.includes(c)));
 if(!wanted.size)return {ok:false,message:'Choisissez au moins une catégorie à archiver.',archived:0};
 let list:{id:string;category:CleanupCategory}[];
 try{list=(await candidates(clientId)).filter(c=>wanted.has(c.category));}catch{return {ok:false,message:'Lecture des publications impossible. Réessayez.',archived:0};}
 const db=getSupabaseServerClient();let archived=0,refused=0;
 for(const item of list.slice(0,MAX)){
  const {error}=await db.rpc('publication_remove',{p_publication_id:item.id,p_actor_id:userId});
  if(error)refused++;else archived++;
 }
 const rest=Math.max(0,list.length-MAX);
 const message=archived===0&&list.length===0?'Rien à archiver dans ces catégories.'
  :`${archived} publication${archived>1?'s':''} archivée${archived>1?'s':''}${refused?`, ${refused} refusée${refused>1?'s':''} (envoi en cours d’exécution ou déjà archivée)`:''}${rest?`, ${rest} restante${rest>1?'s':''} : relancez`:''}. Elles restent consultables dans la vue « Archivées ».`;
 return {ok:refused===0,message,archived};
}
