import { isEditorialWeek, isPublicationUuid } from "./validation";
import { publicationPlatforms, type PublicationPlatform } from "./types";
export const platformLabels: Record<PublicationPlatform,string> = {facebook:"Facebook",instagram:"Instagram",google_business_profile:"Google Business Profile"};
export type EditorialVariant={platform:PublicationPlatform;text_content:string;asset_ids:string[];metadata:{title?:string;cta?:string}};
export type EditorialDraft={publication_id:string|null;expected_revision_id:string|null;client_id:string;project_id:string;title:string;angle:string;source:string;target_date:string|null;week:string|null;slot:1|2|null;variants:EditorialVariant[]};
function date(value:string){const d=new Date(value+"T00:00:00Z");return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value;}
export function parseEditorialForm(form:FormData):EditorialDraft|null{
 const field=(key:string)=>{const entries=form.getAll(key);return entries.length===1&&typeof entries[0]==="string"?entries[0].trim():"";};
 const publication=field("publication_id"),revision=field("revision_id"),client=field("client_id"),project=field("project_id"),title=field("title"),angle=field("angle"),source=field("source"),target=field("target_date"),week=field("week"),slot=field("slot");
 if(!isPublicationUuid(client)||!isPublicationUuid(project)|| (publication&&!isPublicationUuid(publication)) || (revision&&!isPublicationUuid(revision)) || (!publication&&Boolean(revision))||!title||title.length>300||!angle||angle.length>3000||!source||source.length>20000||(target&&!date(target))||(week&&!isEditorialWeek(week))||(slot&&!['1','2'].includes(slot))||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(title+angle+source))return null;
 const variants:EditorialVariant[]=[];
 for(const platform of publicationPlatforms){if(field(platform+"_enabled")!=="on")continue;const text=field(platform+"_text"),heading=field(platform+"_title"),cta=field(platform+"_cta");const ids=form.getAll(platform+"_assets");if(!text||text.length>10000||heading.length>500||cta.length>500||ids.length>10||!ids.every(isPublicationUuid)||new Set(ids).size!==ids.length)return null;variants.push({platform,text_content:text,asset_ids:ids as string[],metadata:{...(heading?{title:heading}:{}),...(cta?{cta}: {})}});}
 if(!variants.length)return null;
 return {publication_id:publication||null,expected_revision_id:revision||null,client_id:client,project_id:project,title,angle,source,target_date:target||null,week:week||null,slot:slot?Number(slot) as 1|2:null,variants};
}
export const IMAGE_BUCKET="publication-images";
export const IMAGE_URL_TTL=120;
export const MAX_IMAGE_BYTES=786432;
export function imageMime(bytes:Uint8Array):"image/png"|"image/jpeg"|"image/webp"|null{
 if(bytes.length<12)return null;
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return "image/jpeg";
 if([137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return "image/png";
 if(String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP")return "image/webp";
 return null;
}
