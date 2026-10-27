// Intelligence éditoriale (PR #42) — historique éditorial d'un client, construit à partir des données existantes
// (publications, variantes de la révision courante, usages des photos). Pur : le chargement est fait par l'appelant
// (contexte de l'Agent v2, lecture serveur editorial-history.ts), chaque table une seule fois.
import {ctaStyleOf,introStyleOf,openingOf,servicesIn,shingles,type CtaStyle,type IntroStyle} from './editorial-text';
import type {PublicationPlatform} from './types';

export type HistoryPublicationRow={id:string;subject:string|null;current_revision_id:string|null;status?:string|null;archived_at?:string|null;platform?:string|null;created_at?:string|null};
export type HistoryVariantRow={publication_id:string;revision_id:string;platform:PublicationPlatform;text_content:string;metadata?:unknown};
export type HistoryLibraryUse={asset_id:string;publication_id:string;used_at?:string};
export type HistoryCatalogUse={media_id:string;publication_id:string};
// Une idée éditoriale passée (publications de même sujet regroupées) : jamais de légende, de nom de fichier ni d'identifiant Drive.
export type EditorialHistoryItem={subject:string;date:string|null;platforms:PublicationPlatform[];services:string[];introStyles:IntroStyle[];ctaStyles:CtaStyle[];
 openings:string[];ctas:string[];texts:string[];photos:{source:'library'|'catalog';id:string}[];publicationIds:string[]};

export const HISTORY_MAX_IDEAS=30;
const PLATFORMS:PublicationPlatform[]=['facebook','instagram','google_business_profile','tiktok'];
// Une publication réellement proposée : jamais une refusée ni un brouillon archivé (une approuvée puis archivée compte).
export const proposedPublication=(p:{status?:string|null;archived_at?:string|null})=>p.status!=='rejected'&&(!p.archived_at||p.status==='approved');
const ctaOf=(metadata:unknown)=>{const c=(metadata as {cta?:unknown}|null)?.cta;return typeof c==='string'&&c.trim()?c.trim():null;};

/**
 * Historique des idées du client, plus récente d'abord (ordre des lignes reçues), au plus `limit` idées. Pour chaque idée :
 * date, plateformes, prestations mises en avant (parmi les prestations vérifiées du client), styles d'accroche et
 * d'appel à l'action, accroches, CTA, textes (bornés) et photos utilisées.
 */
export function buildEditorialHistory(input:{publications:readonly HistoryPublicationRow[];variants:readonly HistoryVariantRow[];libraryUses:readonly HistoryLibraryUse[];
 catalogUses:readonly HistoryCatalogUse[];services:readonly string[]},limit=HISTORY_MAX_IDEAS):EditorialHistoryItem[]{
 const items=new Map<string,EditorialHistoryItem>();
 for(const p of input.publications){
  const subject=p.subject?.trim();if(!subject||!proposedPublication(p))continue;
  let item=items.get(subject);
  if(!item){if(items.size>=limit)continue;item={subject,date:p.created_at??null,platforms:[],services:servicesIn(subject,input.services),introStyles:[],ctaStyles:[],openings:[],ctas:[],texts:[],photos:[],publicationIds:[]};items.set(subject,item);}
  item.publicationIds.push(p.id);
  const variants=input.variants.filter(v=>v.publication_id===p.id&&v.revision_id===p.current_revision_id).sort((a,b)=>PLATFORMS.indexOf(a.platform)-PLATFORMS.indexOf(b.platform));
  for(const v of variants){
   if(PLATFORMS.includes(v.platform)&&!item.platforms.includes(v.platform))item.platforms.push(v.platform);
   const text=v.text_content.slice(0,600),cta=ctaOf(v.metadata);
   item.texts.push(text);item.introStyles.push(introStyleOf(text));item.openings.push(openingOf(text));
   item.ctaStyles.push(ctaStyleOf(cta));if(cta)item.ctas.push(cta.slice(0,200));
  }
  if(!variants.length&&p.platform&&PLATFORMS.includes(p.platform as PublicationPlatform)&&!item.platforms.includes(p.platform as PublicationPlatform))item.platforms.push(p.platform as PublicationPlatform);
  for(const u of input.libraryUses)if(u.publication_id===p.id&&!item.photos.some(x=>x.id===u.asset_id))item.photos.push({source:'library',id:u.asset_id});
  for(const u of input.catalogUses)if(u.publication_id===p.id&&!item.photos.some(x=>x.id===u.media_id))item.photos.push({source:'catalog',id:u.media_id});
 }
 return [...items.values()];
}

// Formulations récurrentes : suites de 4 mots présentes dans au moins deux idées distinctes, les plus fréquentes d'abord.
export function recurringPhrases(history:readonly EditorialHistoryItem[],max=10):string[]{
 const count=new Map<string,number>();
 for(const item of history){const seen=new Set<string>();for(const t of item.texts)for(const s of shingles(t,4))seen.add(s);for(const s of seen)count.set(s,(count.get(s)??0)+1);}
 return [...count].filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,max).map(([s])=>s);
}
// Style dominant d'une idée (premier texte de la publication la plus récente), pour la rotation des accroches et des CTA.
export const mainIntroStyle=(item:EditorialHistoryItem):IntroStyle|null=>item.introStyles[0]??null;
export const mainCtaStyle=(item:EditorialHistoryItem):CtaStyle|null=>item.ctaStyles.find(s=>s!=='aucun')??item.ctaStyles[0]??null;
