import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {safeSupabaseReadError} from '@/lib/supabase/read-error';
import {IMAGE_BUCKET,IMAGE_URL_TTL} from './editor';
import {boardStatus,normalizeSearch,previewText,selectBoardRows,type BoardQuery,type BoardRecord,type BoardSelection,type BoardStatus,type BoardOrigin} from './board-query';
import {BOARD_HIDDEN,BOARD_RESTORED,hiddenPublications,type BoardVisibilityEvent} from './board-visibility';
import {channelsWithoutMedia} from './media-rule';
import type {PublicationPlatform} from './types';

export type BoardRow=Omit<BoardRecord,'imagePath'|'search'>&{image:string|null;debug:Record<string,unknown>|null};
export type BoardResult=Omit<BoardSelection,'rows'>&{rows:BoardRow[]};
type Page<T>={range:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:unknown}>};
type PublicationRow={id:string;client_id:string;project_id:string|null;platform:PublicationPlatform|null;status:string;current_revision_id:string|null;subject:string;target_date:string|null;editorial_week:string;creation_origin:string;updated_at:string;client:{name:string}|null;project:{id:string;name:string}|null};
type RevisionRow={id:string;publication_id:string;origin:string;revision_number:number};
type VariantRow={id:string;revision_id:string;platform:PublicationPlatform;text_content:string};
type LinkRow={variant_id:string;asset_id:string;sort_order:number};
type AssetRow={id:string;storage_path:string};
type DeliveryRow={publication_id:string;variant_id:string;platform:string;status:string};

const CHUNK=100,PAGE=500,unavailable='Impossible de charger les publications. Réessayez dans quelques instants.';
const platformOrder:PublicationPlatform[]=['facebook','instagram','google_business_profile'];
const publicationColumns='id,client_id,project_id,platform,status,current_revision_id,subject,target_date,editorial_week,creation_origin,updated_at,client:clients(name),project:projects(id,name)';

async function all<T>(query:()=>Page<T>):Promise<T[]>{
 const result:T[]=[];for(let offset=0;;offset+=PAGE){const {data,error}=await query().range(offset,offset+PAGE-1);if(error)throw error;result.push(...(data??[]));if(!data||data.length<PAGE)return result;}
}
const chunks=(ids:string[])=>Array.from({length:Math.ceil(ids.length/CHUNK)},(_,i)=>ids.slice(i*CHUNK,(i+1)*CHUNK));
// One query per chunk of 100 identifiers: the number of round trips grows with N/100, never once per row.
async function inChunks<T>(ids:string[],query:(chunk:string[])=>Page<T>):Promise<T[]>{
 const unique=[...new Set(ids)];return (await Promise.all(chunks(unique).map(chunk=>all(()=>query(chunk))))).flat();
}

// Batch read of every board record. Storage paths never leave the server; images are signed per displayed page.
export async function loadBoardRecords(filters:Pick<BoardQuery,'client'|'project'>={client:'',project:''}):Promise<BoardRecord[]>{
 const db=getSupabaseServerClient();
 const publications=await all<PublicationRow>(()=>{let q=db.from('publications').select(publicationColumns).order('id');if(filters.client)q=q.eq('client_id',filters.client);if(filters.project)q=q.eq('project_id',filters.project);return q as unknown as Page<PublicationRow>;});
 const ids=publications.map(p=>p.id),currentIds=publications.flatMap(p=>p.current_revision_id?[p.current_revision_id]:[]);
 const [revisions,variants,deliveries,visibility]=await Promise.all([
  inChunks<RevisionRow>(ids,c=>db.from('publication_revisions').select('id,publication_id,origin,revision_number').in('publication_id',c).order('id') as unknown as Page<RevisionRow>),
  inChunks<VariantRow>(currentIds,c=>db.from('publication_variants').select('id,revision_id,platform,text_content').in('revision_id',c).order('id') as unknown as Page<VariantRow>),
  inChunks<DeliveryRow>(ids,c=>db.from('publication_deliveries').select('publication_id,variant_id,platform,status').in('publication_id',c).order('id') as unknown as Page<DeliveryRow>),
  inChunks<BoardVisibilityEvent>(ids,c=>db.from('publication_events').select('resource_id,action,created_at').eq('resource_type','publication').in('action',[BOARD_HIDDEN,BOARD_RESTORED]).in('resource_id',c).order('created_at').order('id') as unknown as Page<BoardVisibilityEvent>)]);
 const hidden=hiddenPublications(visibility);
 const links=await inChunks<LinkRow>(variants.map(v=>v.id),c=>db.from('publication_variant_assets').select('variant_id,asset_id,sort_order').in('variant_id',c).order('variant_id').order('sort_order') as unknown as Page<LinkRow>);
 const assets=await inChunks<AssetRow>(links.map(l=>l.asset_id),c=>db.from('publication_assets').select('id,storage_path').in('id',c).order('id') as unknown as Page<AssetRow>);
 const group=<T,>(items:T[],key:(item:T)=>string)=>{const map=new Map<string,T[]>();for(const item of items){const k=key(item);map.set(k,[...(map.get(k)??[]),item]);}return map;};
 const revisionsBy=group(revisions,r=>r.publication_id),variantsBy=group(variants,v=>v.revision_id),linksBy=group(links,l=>l.variant_id),deliveriesBy=group(deliveries,d=>d.publication_id),pathOf=new Map(assets.map(a=>[a.id,a.storage_path]));
 return publications.map(p=>{
  const history=revisionsBy.get(p.id)??[],current=history.find(r=>r.id===p.current_revision_id)??null;
  const own=(p.current_revision_id?variantsBy.get(p.current_revision_id)??[]:[]).sort((a,b)=>platformOrder.indexOf(a.platform)-platformOrder.indexOf(b.platform));
  // Mono-platform publication (Lot 4.3 P4): its native platform; legacy publication: platforms of its current variants.
  const platforms=p.platform?[p.platform]:own.map(v=>v.platform),variantIds=new Set(own.map(v=>v.id)),sent=(deliveriesBy.get(p.id)??[]).filter(d=>variantIds.has(d.variant_id));
  const status:BoardStatus=boardStatus(p,platforms,new Set(sent.filter(d=>d.status==='published').map(d=>d.platform)));
  const origin:BoardOrigin=!current?'planning':history.some(r=>r.origin!=='manual')?'agent':'manual';
  const firstAsset=own.flatMap(v=>(linksBy.get(v.id)??[]).sort((a,b)=>a.sort_order-b.sort_order)).map(l=>pathOf.get(l.asset_id)).find((x):x is string=>Boolean(x))??null;
  return {id:p.id,clientId:p.client_id,clientName:p.client?.name??'Client',projectId:p.project_id,projectName:p.project?.name??null,date:p.target_date??p.editorial_week,dateIsWeek:!p.target_date,
   status,rawStatus:p.status,subject:p.subject,preview:previewText(own[0]?.text_content??''),search:normalizeSearch([p.subject,p.client?.name,p.project?.name,...own.map(v=>v.text_content)].join(' ')),
   platforms,origin,edited:origin==='agent'&&current?.origin==='manual',updatedAt:p.updated_at,revisionId:current?.id??null,revisionNumber:current?.revision_number??null,
   creationOrigin:p.creation_origin,imagePath:firstAsset,hasMedia:own.some(v=>linksBy.has(v.id)),missingMedia:channelsWithoutMedia(own,own.flatMap(v=>linksBy.get(v.id)??[])),
   hidden:hidden.has(p.id),deliveries:{published:sent.filter(d=>d.status==='published').length,total:sent.length}} satisfies BoardRecord;
 });
}

// One signing request per displayed page, short-lived URLs only; any failure falls back to the placeholder.
export async function signBoardImages(paths:string[]):Promise<Map<string,string>>{
 const unique=[...new Set(paths)];if(!unique.length)return new Map();
 const {data,error}=await getSupabaseServerClient().storage.from(IMAGE_BUCKET).createSignedUrls(unique,IMAGE_URL_TTL);
 if(error||!data)return new Map();
 return new Map(data.flatMap(d=>d.path&&d.signedUrl&&!d.error?[[d.path,d.signedUrl] as [string,string]]:[]));
}

export async function listPublicationBoardRows(query:BoardQuery):Promise<BoardResult>{
 await requireAdmin();
 let records:BoardRecord[];
 try{records=await loadBoardRecords(query);}catch(error){console.error('[publications] Lecture du tableau indisponible.',safeSupabaseReadError(error));throw new Error(unavailable);}
 const selection=selectBoardRows(records,query),signed=await signBoardImages(selection.rows.flatMap(r=>r.imagePath?[r.imagePath]:[]));
 return {...selection,rows:selection.rows.map(record=>{const {imagePath,...row}=toRow(record);return {...row,image:imagePath?signed.get(imagePath)??null:null,
  debug:query.debug?{publication_id:row.id,revision_id:row.revisionId,revision_number:row.revisionNumber,sql_status:row.rawStatus,creation_origin:row.creationOrigin,storage_path:imagePath,deliveries:row.deliveries}:null};})};
}
// The normalized search text is only used for filtering and never sent to the page.
function toRow(record:BoardRecord):Omit<BoardRecord,'search'>{const copy:Partial<BoardRecord>={...record};delete copy.search;return copy as Omit<BoardRecord,'search'>;}
