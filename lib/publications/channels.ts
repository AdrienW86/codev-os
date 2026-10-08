// Publication capabilities of a project: which channels (platforms) it publishes to. Pure and client-safe.
// Callers never derive platforms themselves: they receive capabilities from project-channels.ts (server).
import {platformLabels} from './editor';
import {publicationPlatforms,type PublicationPlatform} from './types';

export type PublicationProjectChannel={platform:PublicationPlatform;enabled:boolean};
// legacy: derived from the historical project type (never-configured project); configured: explicit channels.
export type PublicationChannelSource='legacy'|'configured';
// legacyAligned (computed by the server boundary only): the enabled platforms equal the historical set of the
// project type. Calendar v1 and Agent v1 only work in that case until their multi-channel migration (P3/P7).
export type PublicationCapabilities={source:PublicationChannelSource;channels:PublicationProjectChannel[];platforms:PublicationPlatform[];legacyAligned:boolean};

const displayOrder:PublicationPlatform[]=['facebook','instagram','google_business_profile'];

// Enabled, known and distinct platforms, in a stable display order.
// legacyAligned defaults to true; only the server boundary sets it for a configured project.
export function publicationCapabilities(channels:readonly PublicationProjectChannel[],source:PublicationChannelSource):PublicationCapabilities{
 const valid=channels.filter(c=>(publicationPlatforms as readonly string[]).includes(c.platform));
 const enabled=new Set(valid.filter(c=>c.enabled).map(c=>c.platform));
 return {source,channels:valid.map(c=>({...c})),platforms:displayOrder.filter(p=>enabled.has(p)),legacyAligned:true};
}
// Workspace (tabs, configuration, history): a configured project keeps it even with every channel disabled.
export function projectHasPublicationsWorkspace(capabilities:PublicationCapabilities):boolean{return capabilities.source==='configured'||capabilities.platforms.length>0;}
// Production (new content, agent, active calendar, generation): at least one enabled channel.
export function projectSupportsPublications(capabilities:PublicationCapabilities):boolean{return capabilities.platforms.length>0;}
export function projectAllowsPlatform(capabilities:PublicationCapabilities,platform:string):boolean{return (capabilities.platforms as string[]).includes(platform);}

// Media capability per platform (Lot 4.3 P8). Mirrored in SQL by publications_private.platform_requires_media, which
// enforces it at approval (Brouillon → À publier). Current product rule kept: every platform requires a media.
// Instagram cannot publish without one; Facebook / Google Business Profile keep the stricter historical rule.
// Making a platform text-only means changing BOTH this table and the SQL function (a new migration).
export const PLATFORM_MEDIA_REQUIREMENT:Readonly<Record<PublicationPlatform,boolean>>={facebook:true,instagram:true,google_business_profile:true};
export function platformRequiresMedia(platform:string):boolean{return (publicationPlatforms as readonly string[]).includes(platform)&&PLATFORM_MEDIA_REQUIREMENT[platform as PublicationPlatform];}

export const SUSPENDED_PUBLICATIONS_MESSAGE='Publications suspendues : aucun canal actif.';
export const CALENDAR_TRANSITION_MESSAGE='Le nouveau planning par canal sera disponible après la migration du calendrier.';
export const AGENT_TRANSITION_MESSAGE='L’agent Publications sera disponible pour cette configuration après sa migration multi-canal.';
// TRANSITIONAL (until P3/P7): legacy calendar and Agent v1 refuse any configuration that is not the historical set.
export function legacyProductionBlock(capabilities:PublicationCapabilities,target:'calendar'|'agent'):string|null{
 if(!projectSupportsPublications(capabilities))return SUSPENDED_PUBLICATIONS_MESSAGE;
 if(!capabilities.legacyAligned)return target==='calendar'?CALENDAR_TRANSITION_MESSAGE:AGENT_TRANSITION_MESSAGE;
 return null;
}
// A publication whose current revision targets a platform that is no longer enabled stays intact but read-only
// (save, media, regeneration, approval). Adding a channel never locks anything; a channel is never re-enabled here.
export function channelLockMessage(capabilities:PublicationCapabilities,revisionPlatforms:readonly string[]):string|null{
 const disabled=displayOrder.filter(p=>revisionPlatforms.includes(p)&&!projectAllowsPlatform(capabilities,p));
 if(!disabled.length)return null;
 const names=disabled.map(p=>platformLabels[p]).join(', ');
 return disabled.length>1
  ?`Cette publication cible ${names}, canaux désactivés pour ce projet. Elle est conservée telle quelle. Pour la modifier, réactivez ces canaux dans la configuration du projet.`
  :`Cette publication cible ${names}, canal désactivé pour ce projet. Elle est conservée telle quelle. Pour la modifier, réactivez le canal dans la configuration du projet.`;
}
