import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {libraryCandidates,type LibraryAssessment,type LibraryRow,type LibraryUse,type ReuseSettings} from './agent-v2/library-pool';
import {isDocumentPhoto,photoServices,usesWithDuplicates} from './editorial-photos';
import {isPublicationUuid} from './validation';

// Intelligence éditoriale (PR #42) — santé de la photothèque pour la préparation des publications.
// Read model appelé par d'autres modules (supervision, assistant, diagnostic) : clients dont l'Agent Publications est
// actif et qui manquent de photos utilisables, au total et par prestation, avec les comptes. Mêmes règles que le pool
// de l'Agent v2 (publiable, bonne qualité, bon format, jamais un document, réemploi selon le réglage du client,
// doublons exacts comptés une fois), sans plafond. Lecture seule, aucune donnée sensible (ni légende, ni fichier).

export type ServicePhotoHealth={service:string;usable:number};
export type ClientPhotoHealth={clientId:string;clientName:string;totalImages:number;usable:number;libraryUsable:number;catalogUsable:number;documents:number;
 services:ServicePhotoHealth[];servicesLacking:string[];lackingOverall:boolean;lacking:boolean};
export type PhotoHealthThresholds={minUsable:number;minPerService:number};
export const DEFAULT_PHOTO_HEALTH_THRESHOLDS:PhotoHealthThresholds={minUsable:3,minPerService:1};
export const MAX_HEALTH_CLIENTS=100;
type CatalogRow={id:string;analysis:unknown;claimed_run_id?:string|null;claimed_agent_v2_run_id?:string|null;file_hash?:string|null};
const CATALOG_DESCRIPTIONS:Record<string,string>={roof:'Surface de toiture visible.',pests:'Insecte ou nuisible visible.',paint:'Surface peinte ou matériel de peinture visible.',
 facade:'Surface de façade visible.',digital:'Élément numérique visible : écran, ordinateur ou interface.'};

/** Calcul pur pour un client (testable sans base). */
export function computeClientPhotoHealth(input:{clientId:string;clientName:string;services:readonly string[];rows:readonly LibraryRow[];assessments:readonly LibraryAssessment[];
 uses:readonly LibraryUse[];catalog?:readonly CatalogRow[];catalogUsedIds?:ReadonlySet<string>;reuse:ReuseSettings;now:Date;thresholds?:PhotoHealthThresholds}):ClientPhotoHealth{
 const t=input.thresholds??DEFAULT_PHOTO_HEALTH_THRESHOLDS,images=input.rows.filter(r=>r.media_kind==='image');
 const usedHashes=new Set((input.catalog??[]).filter(m=>m.file_hash&&input.catalogUsedIds?.has(m.id)).map(m=>m.file_hash as string));
 const uses=usesWithDuplicates(images,input.uses,usedHashes,assetId=>({asset_id:assetId,publication_id:'',used_at:input.now.toISOString()}));
 const library=libraryCandidates(images,input.assessments,uses,input.reuse,new Set(),input.now,Number.MAX_SAFE_INTEGER);
 const catalog=(input.catalog??[]).flatMap(m=>{const a=(m.analysis??null) as {scene?:unknown;usable?:unknown}|null;const scene=typeof a?.scene==='string'?a.scene:null;
  if(!scene||a?.usable!==true||!(scene in CATALOG_DESCRIPTIONS)||input.catalogUsedIds?.has(m.id)||m.claimed_run_id||m.claimed_agent_v2_run_id)return [];
  return [{id:m.id,categories:[scene],description:CATALOG_DESCRIPTIONS[scene]}];});
 const all=[...library,...catalog];
 const services=input.services.map(service=>({service,usable:all.filter(m=>photoServices(m,input.services).includes(service)).length}));
 const lackingOverall=all.length<t.minUsable,servicesLacking=services.filter(s=>s.usable<t.minPerService).map(s=>s.service);
 return {clientId:input.clientId,clientName:input.clientName,totalImages:images.length,usable:all.length,libraryUsable:library.length,catalogUsable:catalog.length,
  documents:input.assessments.filter(a=>images.some(r=>r.id===a.asset_id)&&isDocumentPhoto(a)).length,services,servicesLacking,lackingOverall,lacking:lackingOverall||servicesLacking.length>0};
}

export type PhotoHealthOptions={clientIds?:readonly string[];now?:Date;thresholds?:PhotoHealthThresholds};
/**
 * Sans session (planificateur, diagnostic) : l'appelant a vérifié son accès. Clients dont un projet a l'Agent
 * Publications activé (ou ceux de clientIds), 100 au plus. Lève une erreur si une lecture échoue (échec fermé).
 */
export async function loadEditorialPhotoHealth(options:PhotoHealthOptions={}):Promise<ClientPhotoHealth[]>{
 const db=getSupabaseServerClient(),now=options.now??new Date();
 if(options.clientIds&&options.clientIds.some(id=>!isPublicationUuid(id)))throw Error('Invalid client');
 const agents=await db.from('publication_agent_projects').select('client_id,verified_services,enabled').eq('enabled',true);
 if(agents.error||!agents.data)throw Error('Photo health unavailable');
 const agentRows=agents.data as {client_id:string;verified_services:unknown}[];
 const ids=[...new Set(options.clientIds??agentRows.map(a=>a.client_id))].sort().slice(0,MAX_HEALTH_CLIENTS);
 const out:ClientPhotoHealth[]=[];
 for(const clientId of ids){
  const [client,profile,settings,assets,assessed,uses,catalog,catalogUses]=await Promise.all([
   db.from('clients').select('name').eq('id',clientId).maybeSingle(),
   db.from('client_media_profiles').select('services').eq('client_id',clientId).maybeSingle(),
   db.from('publication_client_settings').select('media_reuse_allowed,media_reuse_after_days').eq('client_id',clientId).maybeSingle(),
   db.from('whatsapp_assets').select('id,library_status,media_kind,mime_type,size,width,height,purged_at,imported_at,claimed_agent_v2_run_id,sha256').eq('client_id',clientId).eq('media_kind','image').limit(1000),
   db.from('whatsapp_asset_assessments').select('asset_id,verdict,confidential,sensitive,manual_verdict,description,topics,quality,quality_issues,business_relevance,publishability').eq('client_id',clientId),
   db.from('whatsapp_asset_uses').select('asset_id,publication_id,used_at').eq('client_id',clientId),
   db.from('publication_drive_media').select('id,analysis,claimed_run_id,claimed_agent_v2_run_id,file_hash').eq('client_id',clientId).limit(500),
   db.from('publication_media_uses').select('media_id').eq('client_id',clientId)]);
  if(client.error||!client.data||profile.error||settings.error||assets.error||assessed.error||uses.error||catalog.error||catalogUses.error)throw Error('Photo health unavailable');
  const strings=(v:unknown)=>Array.isArray(v)?v.filter((s):s is string=>typeof s==='string'&&s.trim()!=='').map(s=>s.trim()):[];
  const services=[...new Set([...agentRows.filter(a=>a.client_id===clientId).flatMap(a=>strings(a.verified_services)),...strings(profile.data?.services)])].slice(0,30);
  out.push(computeClientPhotoHealth({clientId,clientName:client.data.name,services,rows:(assets.data??[]) as LibraryRow[],assessments:(assessed.data??[]) as LibraryAssessment[],
   uses:(uses.data??[]) as LibraryUse[],catalog:(catalog.data??[]) as CatalogRow[],catalogUsedIds:new Set(((catalogUses.data??[]) as {media_id:string}[]).map(u=>u.media_id)),
   reuse:{allowed:settings.data?.media_reuse_allowed===true,afterDays:Number(settings.data?.media_reuse_after_days??180)},now,thresholds:options.thresholds}));
 }
 return out;
}
/** Clients qui manquent de photos utilisables (au total ou pour au moins une prestation), les plus démunis d'abord. */
export async function listClientsLackingPhotos(options:PhotoHealthOptions={}):Promise<ClientPhotoHealth[]>{
 return (await loadEditorialPhotoHealth(options)).filter(c=>c.lacking).sort((a,b)=>a.usable-b.usable||b.servicesLacking.length-a.servicesLacking.length||a.clientName.localeCompare(b.clientName,'fr'));
}
/** Même lecture pour une page ou une action d'administration (session administrateur exigée). */
export async function getEditorialPhotoHealth(options:PhotoHealthOptions={}):Promise<ClientPhotoHealth[]>{
 await requireAdmin();return loadEditorialPhotoHealth(options);
}
