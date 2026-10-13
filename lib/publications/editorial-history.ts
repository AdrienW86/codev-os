import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {buildEditorialHistory,mainCtaStyle,mainIntroStyle,type HistoryCatalogUse,type HistoryLibraryUse,type HistoryPublicationRow,type HistoryVariantRow} from './editorial-memory';
import {CTA_STYLE_LABELS,INTRO_STYLE_LABELS} from './editorial-text';
import {isPublicationUuid} from './validation';
import type {PublicationPlatform} from './types';

// Intelligence éditoriale (PR #42) — historique éditorial d'un client, lecture serveur (read model).
// Mêmes règles que le contexte de l'Agent v2 (editorial-memory.ts) : publications réellement proposées, tous projets du
// client, révision courante. Chaque table lue une fois. Jamais de légende, de nom de fichier ni d'identifiant Drive ;
// une photo est décrite par la description de son évaluation (ou de son analyse catalogue).

export type EditorialHistoryEntry={subject:string;date:string|null;platforms:PublicationPlatform[];services:string[];introStyle:string|null;ctaStyle:string|null;
 photos:{source:'library'|'catalog';id:string;description:string|null}[];publicationIds:string[]};
export type ClientEditorialHistory={clientId:string;services:string[];entries:EditorialHistoryEntry[]};

/** Sans session : l'appelant a vérifié son accès (contexte serveur). Échec fermé si une lecture échoue. */
export async function loadClientEditorialHistory(clientId:string,limit=30):Promise<ClientEditorialHistory>{
 if(!isPublicationUuid(clientId))throw Error('Invalid client');
 const db=getSupabaseServerClient(),max=Math.min(Math.max(Math.trunc(limit)||30,1),30);
 const [publications,agents,profile,libraryUses,catalogUses]=await Promise.all([
  db.from('publications').select('id,subject,current_revision_id,status,archived_at,platform,created_at').eq('client_id',clientId).order('created_at',{ascending:false}).limit(100),
  db.from('publication_agent_projects').select('verified_services').eq('client_id',clientId),
  db.from('client_media_profiles').select('services').eq('client_id',clientId).maybeSingle(),
  db.from('whatsapp_asset_uses').select('asset_id,publication_id,used_at').eq('client_id',clientId),
  db.from('publication_media_uses').select('media_id,publication_id').eq('client_id',clientId)]);
 if(publications.error||!publications.data||agents.error||profile.error||libraryUses.error||catalogUses.error)throw Error('Editorial history unavailable');
 const strings=(v:unknown)=>Array.isArray(v)?v.filter((s):s is string=>typeof s==='string'&&s.trim()!=='').map(s=>s.trim()):[];
 const services=[...new Set([...((agents.data??[]) as {verified_services:unknown}[]).flatMap(a=>strings(a.verified_services)),...strings(profile.data?.services)])];
 const rows=publications.data as HistoryPublicationRow[],revisionIds=rows.flatMap(p=>p.current_revision_id?[p.current_revision_id]:[]);
 const variants=revisionIds.length?await db.from('publication_variants').select('publication_id,revision_id,platform,text_content,metadata').eq('client_id',clientId).in('revision_id',revisionIds)
  :{data:[],error:null};
 if(variants.error)throw Error('Editorial history unavailable');
 const history=buildEditorialHistory({publications:rows,variants:(variants.data??[]) as HistoryVariantRow[],libraryUses:(libraryUses.data??[]) as HistoryLibraryUse[],
  catalogUses:(catalogUses.data??[]) as HistoryCatalogUse[],services},max);
 const assetIds=[...new Set(history.flatMap(h=>h.photos.filter(p=>p.source==='library').map(p=>p.id)))],mediaIds=[...new Set(history.flatMap(h=>h.photos.filter(p=>p.source==='catalog').map(p=>p.id)))];
 const [assessed,catalog]=await Promise.all([
  assetIds.length?db.from('whatsapp_asset_assessments').select('asset_id,description').eq('client_id',clientId).in('asset_id',assetIds):Promise.resolve({data:[],error:null}),
  mediaIds.length?db.from('publication_drive_media').select('id,analysis').eq('client_id',clientId).in('id',mediaIds):Promise.resolve({data:[],error:null})]);
 if(assessed.error||catalog.error)throw Error('Editorial history unavailable');
 const describe=(p:{source:'library'|'catalog';id:string})=>p.source==='library'?((assessed.data??[]) as {asset_id:string;description:string}[]).find(a=>a.asset_id===p.id)?.description||null
  :(()=>{const a=((catalog.data??[]) as {id:string;analysis:unknown}[]).find(m=>m.id===p.id)?.analysis as {description?:unknown}|null|undefined;return typeof a?.description==='string'?a.description:null;})();
 return {clientId,services,entries:history.map(h=>{const intro=mainIntroStyle(h),cta=mainCtaStyle(h);
  return {subject:h.subject,date:h.date,platforms:h.platforms,services:h.services,introStyle:intro?INTRO_STYLE_LABELS[intro]:null,ctaStyle:cta?CTA_STYLE_LABELS[cta]:null,
   photos:h.photos.map(p=>({...p,description:describe(p)})),publicationIds:h.publicationIds};})};
}
/** Même lecture pour l'interface d'administration (session administrateur exigée). */
export async function getClientEditorialHistory(clientId:string,limit=30):Promise<ClientEditorialHistory>{
 await requireAdmin();return loadClientEditorialHistory(clientId,limit);
}
