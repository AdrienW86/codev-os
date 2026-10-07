// Pure board logic: query params, UX statuses, filtering, sorting and pagination. No I/O, safe for tests.
import {publicationPlatforms,type PublicationPlatform} from './types';

export const boardStatuses=['to_prepare','draft','ready','rejected','published'] as const;
export type BoardStatus=typeof boardStatuses[number];
export const boardStatusLabels:Record<BoardStatus,string>={to_prepare:'À préparer',draft:'Brouillon',ready:'À publier',rejected:'Rejeté',published:'Publié'};
export const boardViewLabels:Record<BoardStatus,string>={to_prepare:'À préparer',draft:'Brouillons',ready:'À publier',rejected:'Rejetées',published:'Publiées'};
export const boardStatusClasses:Record<BoardStatus,string>={to_prepare:'border-dashed border-border text-muted',draft:'border-amber-500 bg-amber-500/10',
 ready:'border-emerald-600 bg-emerald-600/10',rejected:'border-red-600 bg-red-600/10',published:'border-sky-600 bg-sky-600/10'};
export const boardOrigins=['agent','manual'] as const;
export type BoardOrigin=typeof boardOrigins[number]|'planning';
export const boardOriginLabels:Record<BoardOrigin,string>={agent:'Agent',manual:'Manuel',planning:'Planning'};
export const boardSorts=['date_asc','date_desc','client','status','updated'] as const;
export type BoardSort=typeof boardSorts[number];
export const boardSortLabels:Record<BoardSort,string>={date_asc:'Date croissante',date_desc:'Date décroissante',client:'Client',status:'Statut',updated:'Dernière modification'};
export const BOARD_PAGE_SIZE=50;

export type BoardQuery={q:string;client:string;project:string;status:BoardStatus|'';platform:PublicationPlatform|'';origin:typeof boardOrigins[number]|'';
 media:'with'|'without'|'';from:string;to:string;sort:BoardSort;published:boolean;hidden:boolean;page:number;debug:boolean;publication:string};
// Everything the filters, sorting and the row need. imagePath and search stay server-side.
// hasMedia: at least one media is linked to the current revision; missingMedia: channels still without media.
export type BoardRecord={id:string;clientId:string;clientName:string;projectId:string|null;projectName:string|null;date:string;dateIsWeek:boolean;
 status:BoardStatus;rawStatus:string;subject:string;preview:string;search:string;platforms:PublicationPlatform[];origin:BoardOrigin;edited:boolean;
 updatedAt:string;revisionId:string|null;revisionNumber:number|null;creationOrigin:string;imagePath:string|null;hasMedia:boolean;missingMedia:PublicationPlatform[];
 hidden:boolean;deliveries:{published:number;total:number}};

type Search=Record<string,string|string[]|undefined>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,day=/^\d{4}-\d{2}-\d{2}$/;
const one=(search:Search,key:string)=>{const v=search[key];return typeof v==='string'?v.trim():'';};
const pick=<T extends string>(value:string,allowed:readonly T[]):T|''=>(allowed as readonly string[]).includes(value)?value as T:'';
const validDay=(value:string)=>day.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))?value:'';

// Unknown or malformed values are ignored, never echoed into queries.
export function parseBoardQuery(search:Search):BoardQuery{
 const page=Number.parseInt(one(search,'page'),10);
 return {q:one(search,'q').slice(0,200),client:uuid.test(one(search,'client'))?one(search,'client'):'',project:uuid.test(one(search,'project'))?one(search,'project'):'',
  status:pick(one(search,'status'),boardStatuses),platform:pick(one(search,'platform'),publicationPlatforms),origin:pick(one(search,'origin'),boardOrigins),
  media:pick(one(search,'media'),['with','without'] as const),from:validDay(one(search,'from')),to:validDay(one(search,'to')),
  sort:pick(one(search,'sort'),boardSorts)||'date_asc',published:one(search,'published')==='1',hidden:one(search,'hidden')==='1',page:Number.isFinite(page)&&page>=1&&page<=10000?page:1,debug:one(search,'debug')==='1',
  publication:uuid.test(one(search,'publication'))?one(search,'publication').toLowerCase():''};
}

// Canonical URL of a view: defaults are omitted so shared URLs stay short and stable. Any change returns to page 1
// and closes the drawer unless the change itself sets them.
export function boardHref(query:BoardQuery,changes:Partial<BoardQuery>={}):string{
 const q={...query,page:1,publication:'',...changes},params=new URLSearchParams();
 for(const key of ['q','client','project','status','platform','origin','media','from','to'] as const)if(q[key])params.set(key,q[key]);
 if(q.sort!=='date_asc')params.set('sort',q.sort);if(q.published)params.set('published','1');if(q.hidden)params.set('hidden','1');if(q.page>1)params.set('page',String(q.page));if(q.debug)params.set('debug','1');if(q.publication)params.set('publication',q.publication);
 const s=params.toString();return s?`/publications?${s}`:'/publications';
}

// The drawer is the same view plus publication=<id>: opening and closing keep every other param, page included.
export function drawerHref(query:BoardQuery,publicationId:string):string{return boardHref(query,{page:query.page,publication:publicationId});}
export function closeDrawerHref(query:BoardQuery):string{return boardHref(query,{page:query.page,publication:''});}

// URL after one filter change: the value is re-validated by parseBoardQuery, the page goes back to 1, and a project
// that does not belong to a newly selected client is cleared.
export function applyFilterChange(query:BoardQuery,field:string,value:string,projects:{id:string;client_id:string}[]=[]):string{
 const params=new URLSearchParams(boardHref(query).split('?')[1]??'');
 if(value.trim())params.set(field,value.trim());else params.delete(field);params.delete('page');
 const next=parseBoardQuery(Object.fromEntries(params));
 if(field==='client'&&next.client&&next.project&&!projects.some(p=>p.id===next.project&&p.client_id===next.client))next.project='';
 return boardHref(next);
}

// UX status on top of the unchanged SQL statuses. Published needs a published delivery for every current variant.
export function boardStatus(p:{status:string;current_revision_id:string|null},platforms:readonly string[],publishedPlatforms:ReadonlySet<string>):BoardStatus{
 if(!p.current_revision_id)return 'to_prepare';
 if(p.status==='approved')return platforms.length>0&&platforms.every(x=>publishedPlatforms.has(x))?'published':'ready';
 if(p.status==='rejected')return 'rejected';
 return 'draft';
}
// A real publication (not an empty slot) still missing media cannot be approved yet.
export function needsMedia(r:Pick<BoardRecord,'status'|'missingMedia'>):boolean{return r.status!=='to_prepare'&&r.status!=='published'&&r.missingMedia.length>0;}
export function normalizeSearch(value:string):string{return value.normalize('NFD').replace(/[̀-ͯ]/g,'').toLocaleLowerCase('fr').replace(/\s+/g,' ').trim();}
export function previewText(value:string,max=220):string{const flat=value.replace(/\s+/g,' ').trim();return flat.length>max?flat.slice(0,max-1).trimEnd()+'…':flat;}

// Every filter except the status ones; quick-view counters are computed on this set.
function matchesFilters(r:BoardRecord,q:BoardQuery,needle:string):boolean{
 return (!q.client||r.clientId===q.client)&&(!q.project||r.projectId===q.project)&&(!q.platform||r.platforms.includes(q.platform))
  &&(!q.origin||r.origin===q.origin)&&(!q.media||(q.media==='with')===r.hasMedia)&&(q.hidden||!r.hidden)&&(!q.from||r.date>=q.from)&&(!q.to||r.date<=q.to)&&(!needle||r.search.includes(needle));
}
const statusOrder=Object.fromEntries(boardStatuses.map((s,i)=>[s,i])) as Record<BoardStatus,number>;
const byDate=(a:BoardRecord,b:BoardRecord)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id);
const sorters:Record<BoardSort,(a:BoardRecord,b:BoardRecord)=>number>={
 date_asc:byDate,date_desc:(a,b)=>byDate(b,a),
 client:(a,b)=>a.clientName.localeCompare(b.clientName,'fr')||byDate(a,b),
 status:(a,b)=>statusOrder[a.status]-statusOrder[b.status]||byDate(a,b),
 updated:(a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id)};

export type BoardSelection={rows:BoardRecord[];total:number;page:number;pageCount:number;counts:Record<BoardStatus|'all',number>};
// Published rows are hidden unless requested or explicitly selected as the view; rows removed from the board only with hidden=1.
export function selectBoardRows(records:BoardRecord[],q:BoardQuery,pageSize=BOARD_PAGE_SIZE):BoardSelection{
 const needle=normalizeSearch(q.q),base=records.filter(r=>matchesFilters(r,q,needle));
 const counts={all:base.filter(r=>q.published||r.status!=='published').length,...Object.fromEntries(boardStatuses.map(s=>[s,base.filter(r=>r.status===s).length]))} as BoardSelection['counts'];
 const visible=base.filter(r=>q.status?r.status===q.status:q.published||r.status!=='published').sort(sorters[q.sort]);
 const pageCount=Math.max(1,Math.ceil(visible.length/pageSize)),page=Math.min(q.page,pageCount);
 return {rows:visible.slice((page-1)*pageSize,page*pageSize),total:visible.length,page,pageCount,counts};
}
