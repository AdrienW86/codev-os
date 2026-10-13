import 'server-only';
import {photoStats,tooFewPhotos,type PhotoStats} from './supervision-model';
import type {LibraryAssessment,LibraryRow,LibraryUse} from './agent-v2/library-pool';

// Socle Publications, lot 7 (mobile) : photos utilisables par client, pour la supervision.
// POINT DE REMPLACEMENT UNIQUE : la tâche photothèque (#42) exposera un modèle de lecture « clients à court de photos
// utilisables » et la tâche #43 un historique d'utilisation des photos. En attendant, cette fonction lit localement
// whatsapp_assets, whatsapp_asset_assessments et whatsapp_asset_uses (historique d'utilisation) et applique exactement
// les règles de sélection de l'agent (photoStats → libraryCandidates). Pour basculer, remplacer le corps de cette
// fonction sans changer sa signature ; rien d'autre dans la supervision ne lit la photothèque.
export type PhotoCoverage={photos:PhotoStats;tooFewPhotos:boolean};
export type PhotoCoverageClient={id:string;reuse:{allowed:boolean;afterDays:number}};
type Db={from(table:string):{select(columns:string):{eq(column:string,value:string):{limit(n:number):PromiseLike<{data:unknown;error:unknown}>};limit(n:number):PromiseLike<{data:unknown;error:unknown}>}}};
const MAX_PHOTO_ROWS=5000;

/** Couverture photo de chaque client ; null si la photothèque est illisible (jamais « trop peu » par défaut). */
export async function loadClientPhotoCoverage(db:Db,clients:readonly PhotoCoverageClient[],now:Date):Promise<Map<string,PhotoCoverage>|null>{
 if(!clients.length)return new Map();
 const [assets,assessments,uses]=await Promise.all([
  db.from('whatsapp_assets').select('id,client_id,library_status,media_kind,mime_type,size,width,height,purged_at,imported_at,claimed_agent_v2_run_id').eq('media_kind','image').limit(MAX_PHOTO_ROWS),
  db.from('whatsapp_asset_assessments').select('asset_id,client_id,verdict,confidential,sensitive,manual_verdict,description,topics,quality,quality_issues,business_relevance,publishability').limit(MAX_PHOTO_ROWS),
  db.from('whatsapp_asset_uses').select('asset_id,client_id,publication_id,used_at').limit(MAX_PHOTO_ROWS)]);
 if(assets.error||assessments.error||uses.error)return null;
 const rows=(assets.data??[]) as (LibraryRow&{client_id:string})[],assessed=(assessments.data??[]) as (LibraryAssessment&{client_id:string})[],used=(uses.data??[]) as (LibraryUse&{client_id:string})[];
 return new Map(clients.map(c=>{
  const photos=photoStats(rows.filter(a=>a.client_id===c.id),assessed.filter(a=>a.client_id===c.id),used.filter(u=>u.client_id===c.id),c.reuse,now);
  return [c.id,{photos,tooFewPhotos:tooFewPhotos(photos)}];
 }));
}
