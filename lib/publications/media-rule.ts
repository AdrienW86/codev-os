// Business rule: a publication cannot be approved (Brouillon → À publier) unless every channel of its current
// revision whose platform requires a media (PLATFORM_MEDIA_REQUIREMENT, channels.ts) carries at least one media.
// Drafts and empty slots may stay incomplete while they are edited. The database enforces the same invariant (P8);
// this check only gives the precise message before the RPC.
// The backend currently stores images only (JPEG, PNG, WebP); video support requires a migration.
import {platformLabels} from './editor';
import {platformRequiresMedia} from './channels';
import type {PublicationPlatform} from './types';

type VariantRef={id:string;platform:PublicationPlatform};
type LinkRef={variant_id:string};
type Rows<T>={data:T[]|null;error:unknown};
export type MediaRuleDb={from:(table:string)=>{select:(columns:string)=>{in:(column:string,values:string[])=>PromiseLike<Rows<unknown>>;eq:(column:string,value:string)=>PromiseLike<Rows<unknown>>}}};

export function channelsWithoutMedia(variants:VariantRef[],links:LinkRef[]):PublicationPlatform[]{
 const covered=new Set(links.map(l=>l.variant_id));return variants.filter(v=>platformRequiresMedia(v.platform)&&!covered.has(v.id)).map(v=>v.platform);
}
export const MEDIA_REQUIRED_MESSAGE='Média requis avant validation';
export function missingMediaMessage(platforms:PublicationPlatform[]):string{
 return `${MEDIA_REQUIRED_MESSAGE} : ajoutez une photo avant de passer à « À publier »${platforms.length?` (${platforms.map(p=>platformLabels[p]).join(', ')})`:''}.`;
}
// Returns the channels without media, or null when the check itself could not be confirmed (approval is then refused).
export async function revisionChannelsWithoutMedia(db:MediaRuleDb,revisionId:string):Promise<PublicationPlatform[]|null>{
 const variants=await db.from('publication_variants').select('id,platform').eq('revision_id',revisionId);
 if(variants.error||!variants.data)return null;
 const own=variants.data as VariantRef[];if(!own.length)return null;
 const links=await db.from('publication_variant_assets').select('variant_id').in('variant_id',own.map(v=>v.id));
 if(links.error||!links.data)return null;
 return channelsWithoutMedia(own,links.data as LinkRef[]);
}
