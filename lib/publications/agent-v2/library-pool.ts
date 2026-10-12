// Socle Publications, lots 4-5 — photos de la photothèque proposées à l'Agent v2. Pur et testable.
// Le serveur SQL reste l'autorité (publications_private.agent_v2_library_available) : ce filtre évite seulement de
// proposer au modèle une photo que la base refuserait, ou qui illustrerait mal une plateforme.
import {isPublicationCandidate,type Verdict} from '@/lib/media-intelligence/model';
import type {AgentMediaCandidate} from './contract';

export type LibraryRow={id:string;library_status:string;media_kind:string;mime_type:string;size:number;width:number|null;height:number|null;purged_at:string|null;imported_at:string|null;claimed_agent_v2_run_id:string|null};
export type LibraryAssessment={asset_id:string;verdict:Verdict;confidential:boolean;sensitive:string[];manual_verdict:'relevant'|'off_topic'|null;description:string;topics:string[];
 quality:string;quality_issues:string[];business_relevance:number;publishability:number};
export type LibraryUse={asset_id:string;publication_id:string;used_at:string};
export type ReuseSettings={allowed:boolean;afterDays:number};

const IMAGE_MIMES=['image/jpeg','image/png','image/webp'],MAX_BYTES=8388608,MIN_SIDE=600,MAX_RATIO=3;
// Défauts rédhibitoires pour une publication : flou, capture d'écran, image essentiellement textuelle.
const BLOCKING_ISSUES=['blurry','screenshot','text_heavy'];
export const LIBRARY_FALLBACK_CATEGORY='photo validée';
export const MAX_LIBRARY_CANDIDATES=30;

// Format exploitable par les trois plateformes (les dérivés recadrent ensuite par plateforme).
export function fitsPlatforms(row:Pick<LibraryRow,'width'|'height'>):boolean{
 if(row.width===null||row.height===null)return true;
 const small=Math.min(row.width,row.height),large=Math.max(row.width,row.height);
 return small>=MIN_SIDE&&large/small<=MAX_RATIO;
}
// Réemploi : jamais utilisée, ou réemploi autorisé et dernière utilisation plus ancienne que le délai du client.
export function reusable(uses:readonly LibraryUse[],settings:ReuseSettings,now:Date):boolean{
 if(!uses.length)return true;if(!settings.allowed)return false;
 const last=Math.max(...uses.map(u=>Date.parse(u.used_at)));
 return now.getTime()-last>settings.afterDays*86400000;
}

/**
 * Photos candidates : publiables (décision humaine ou évaluation IA prudente, jamais confidentielle ni hors sujet),
 * au bon format et de bonne qualité, réemploi permis, non réservées, et jamais une photo des dernières publications.
 * Ordre : jamais utilisées d'abord, puis meilleur score IA, puis les plus récentes.
 */
export function libraryCandidates(rows:readonly LibraryRow[],assessments:readonly LibraryAssessment[],uses:readonly LibraryUse[],settings:ReuseSettings,recentPublicationIds:ReadonlySet<string>,now:Date):AgentMediaCandidate[]{
 const byAsset=new Map(assessments.map(a=>[a.asset_id,a]));
 const usesOf=(id:string)=>uses.filter(u=>u.asset_id===id);
 return rows.filter(r=>{const a=byAsset.get(r.id)??null,u=usesOf(r.id);
  return IMAGE_MIMES.includes(r.mime_type)&&r.size>0&&r.size<=MAX_BYTES&&!r.claimed_agent_v2_run_id&&r.imported_at!==null
   &&isPublicationCandidate({libraryStatus:r.library_status,mediaKind:r.media_kind,purged:r.purged_at!==null,assessment:a})
   &&fitsPlatforms(r)&&(!a||(a.quality!=='poor'&&!a.quality_issues.some(i=>BLOCKING_ISSUES.includes(i))))
   &&reusable(u,settings,now)&&!u.some(x=>recentPublicationIds.has(x.publication_id));})
  .map(r=>({r,a:byAsset.get(r.id)??null,used:usesOf(r.id).length>0}))
  .sort((x,y)=>Number(x.used)-Number(y.used)||((y.a?y.a.business_relevance*y.a.publishability:0.5)-(x.a?x.a.business_relevance*x.a.publishability:0.5))||String(y.r.imported_at).localeCompare(String(x.r.imported_at)))
  .slice(0,MAX_LIBRARY_CANDIDATES)
  .map(({r,a})=>({id:r.id,source:'library' as const,used:false,description:a?.description||null,categories:a?.topics.length?a.topics.slice(0,4):[LIBRARY_FALLBACK_CATEGORY]}));
}
