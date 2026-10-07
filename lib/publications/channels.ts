// Publication capabilities of a project: which channels (platforms) it publishes to. Pure and client-safe.
// Callers never derive platforms themselves: they receive capabilities from project-channels.ts (server).
import {publicationPlatforms,type PublicationPlatform} from './types';

export type PublicationProjectChannel={platform:PublicationPlatform;enabled:boolean};
// legacy: derived from the historical project type; configured: explicit channels (after P1).
export type PublicationChannelSource='legacy'|'configured';
export type PublicationCapabilities={source:PublicationChannelSource;channels:PublicationProjectChannel[];platforms:PublicationPlatform[]};

const displayOrder:PublicationPlatform[]=['facebook','instagram','google_business_profile'];

// Enabled, known and distinct platforms, in a stable display order.
export function publicationCapabilities(channels:readonly PublicationProjectChannel[],source:PublicationChannelSource):PublicationCapabilities{
 const valid=channels.filter(c=>(publicationPlatforms as readonly string[]).includes(c.platform));
 const enabled=new Set(valid.filter(c=>c.enabled).map(c=>c.platform));
 return {source,channels:valid.map(c=>({...c})),platforms:displayOrder.filter(p=>enabled.has(p))};
}
export function projectSupportsPublications(capabilities:PublicationCapabilities):boolean{return capabilities.platforms.length>0;}
export function projectAllowsPlatform(capabilities:PublicationCapabilities,platform:string):boolean{return (capabilities.platforms as string[]).includes(platform);}
