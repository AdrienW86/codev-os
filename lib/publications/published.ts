import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {safeSupabaseReadError} from '@/lib/supabase/read-error';
import {signBoardImages} from './board';
import {monthRange,type CalendarItem,type CalendarItemStatus,type CalendarView} from './published-model';
import type {PublicationPlatform} from './types';

// Calendrier des publications : lecture seule, tous clients, un mois. Publiées : diffusions confirmées (published_at).
// À traiter : diffusions en échec, bloquées, à vérifier ou en attente d'un nouvel essai (date prévue). À venir :
// créneaux occupés par une publication pas encore partie (à valider, validée ou programmée).
type DeliveryRow={id:string;publication_id:string;client_id:string;variant_id:string;platform:PublicationPlatform;status:string;published_at:string|null;scheduled_for:string;remote_id:string|null;asset_ids:string[]|null;last_error_code:string|null};
type OccurrenceRow={id:string;client_id:string;platform:PublicationPlatform;scheduled_for:string;publication_id:string};
type PublicationRow={id:string;client_id:string;status:string;current_revision_id:string|null;editorial_group_id:string|null;archived_at:string|null};
const PROBLEM:Record<string,CalendarItemStatus>={failed:'failed',blocked:'blocked',uncertain:'uncertain',retryable_error:'retry'};
const PROBLEM_STATUSES=['failed','blocked','uncertain','retryable_error'] as const;
const db=()=>getSupabaseServerClient();
const chunks=<T,>(list:T[],size=150)=>Array.from({length:Math.ceil(list.length/size)},(_,i)=>list.slice(i*size,i*size+size));
async function inChunks<R>(ids:string[],run:(chunk:string[])=>PromiseLike<{data:unknown;error:unknown}>):Promise<R[]>{
 const out:R[]=[];for(const c of chunks([...new Set(ids)])){const {data,error}=await run(c);if(error)throw error;out.push(...((data??[]) as R[]));}return out;
}

export type CalendarData={items:CalendarItem[];images:Map<string,string>;clients:{id:string;name:string}[]};
export async function loadPublicationCalendar(view:CalendarView,month:string,now=new Date()):Promise<CalendarData>{
 await requireAdmin();
 const {from,to}=monthRange(month);
 // Marge d'un jour de chaque côté : le jour affiché est celui de Paris.
 const start=new Date(Date.parse(from+'T00:00:00Z')-86400000).toISOString(),end=new Date(Date.parse(to+'T00:00:00Z')+2*86400000).toISOString();
 try{
  const clientsRes=await db().from('clients').select('id,name').order('name');
  if(clientsRes.error)throw clientsRes.error;
  const clients=(clientsRes.data??[]) as {id:string;name:string}[],names=new Map(clients.map(c=>[c.id,c.name]));
  const items:CalendarItem[]=[];
  if(view==='upcoming'){
   const occ=await db().from('publication_channel_occurrences').select('id,client_id,platform,scheduled_for,publication_id')
    .not('publication_id','is',null).is('skipped_at',null).gte('scheduled_for',new Date(Math.max(Date.parse(start),now.getTime())).toISOString()).lt('scheduled_for',end).order('scheduled_for').limit(1000);
   if(occ.error)throw occ.error;
   const occurrences=(occ.data??[]) as OccurrenceRow[];
   const pubs=await inChunks<PublicationRow>(occurrences.map(o=>o.publication_id),c=>db().from('publications').select('id,client_id,status,current_revision_id,editorial_group_id,archived_at').in('id',c));
   const byPub=new Map(pubs.map(p=>[p.id,p]));
   const live=occurrences.filter(o=>{const p=byPub.get(o.publication_id);return p&&!p.archived_at&&['pending_review','approved','draft'].includes(p.status);});
   const variants=await inChunks<{id:string;revision_id:string;platform:PublicationPlatform;text_content:string}>(live.flatMap(o=>{const r=byPub.get(o.publication_id)?.current_revision_id;return r?[r]:[];}),
    c=>db().from('publication_variants').select('id,revision_id,platform,text_content').in('revision_id',c));
   const links=await inChunks<{variant_id:string;asset_id:string;sort_order:number}>(variants.map(v=>v.id),c=>db().from('publication_variant_assets').select('variant_id,asset_id,sort_order').in('variant_id',c).order('sort_order'));
   const paths=await assetPaths(links.map(l=>l.asset_id));
   for(const o of live){
    const p=byPub.get(o.publication_id)!,v=variants.find(x=>x.revision_id===p.current_revision_id&&x.platform===o.platform);
    const asset=v?links.find(l=>l.variant_id===v.id)?.asset_id:undefined;
    items.push({key:`o:${o.id}`,publicationId:p.id,groupKey:p.editorial_group_id??p.id,clientId:o.client_id,clientName:names.get(o.client_id)??'Client',platform:o.platform,
     status:p.status==='approved'?'approved':p.status==='pending_review'?'pending_review':'scheduled',at:o.scheduled_for,text:v?.text_content??null,imagePath:asset?paths.get(asset)??null:null,remoteId:null,errorCode:null});
   }
  }else{
   let q=db().from('publication_deliveries').select('id,publication_id,client_id,variant_id,platform,status,published_at,scheduled_for,remote_id,asset_ids,last_error_code');
   q=view==='published'?q.eq('status','published').gte('published_at',start).lt('published_at',end):q.in('status',PROBLEM_STATUSES).gte('scheduled_for',start).lt('scheduled_for',end);
   const res=await q.order('scheduled_for',{ascending:false}).limit(1000);
   if(res.error)throw res.error;
   const deliveries=(res.data??[]) as DeliveryRow[];
   const [pubs,variants]=await Promise.all([
    inChunks<PublicationRow>(deliveries.map(d=>d.publication_id),c=>db().from('publications').select('id,client_id,status,current_revision_id,editorial_group_id,archived_at').in('id',c)),
    inChunks<{id:string;text_content:string}>(deliveries.map(d=>d.variant_id),c=>db().from('publication_variants').select('id,text_content').in('id',c))]);
   const byPub=new Map(pubs.map(p=>[p.id,p])),text=new Map(variants.map(v=>[v.id,v.text_content]));
   const paths=await assetPaths(deliveries.flatMap(d=>d.asset_ids?.slice(0,1)??[]));
   for(const d of deliveries){
    const p=byPub.get(d.publication_id);
    // Un problème sur une publication archivée n'est plus à traiter ; une publication publiée reste visible.
    if(view==='problems'&&p?.archived_at)continue;
    items.push({key:`d:${d.id}`,publicationId:d.publication_id,groupKey:p?.editorial_group_id??d.publication_id,clientId:d.client_id,clientName:names.get(d.client_id)??'Client',platform:d.platform,
     status:view==='published'?'published':PROBLEM[d.status]??'failed',at:(view==='published'?d.published_at:null)??d.scheduled_for,text:text.get(d.variant_id)??null,
     imagePath:d.asset_ids?.[0]?paths.get(d.asset_ids[0])??null:null,remoteId:d.remote_id,errorCode:d.last_error_code});
   }
  }
  return {items,images:new Map(),clients};
 }catch(error){console.error('[publications] Calendrier des publications indisponible.',safeSupabaseReadError(error));throw new Error('Calendrier des publications indisponible.');}
}
async function assetPaths(ids:string[]):Promise<Map<string,string>>{
 if(!ids.length)return new Map();
 const rows=await inChunks<{id:string;storage_path:string|null;mime_type:string|null}>(ids,c=>db().from('publication_assets').select('id,storage_path,mime_type').in('id',c));
 return new Map(rows.flatMap(r=>r.storage_path&&(r.mime_type??'').startsWith('image/')?[[r.id,r.storage_path] as [string,string]]:[]));
}
/** Miniatures signées (courte durée) des seules cartes affichées. */
export async function signCalendarImages(paths:string[]):Promise<Map<string,string>>{return signBoardImages(paths);}
