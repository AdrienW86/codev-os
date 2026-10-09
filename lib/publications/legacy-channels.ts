// LEGACY DEBT, isolated on purpose: the ONLY place in the application that maps a project type to publication
// channels. It is consumed exclusively by project-channels.ts, as the fallback for projects without explicit
// channel configuration (P1: publication_project_channels). Never import it elsewhere.
import type {PublicationPlatform} from './types';
import type {PublicationProjectChannel} from './channels';

const LEGACY_TYPE_CHANNELS:Readonly<Record<string,readonly PublicationPlatform[]>>=Object.freeze({
 'Réseaux sociaux':Object.freeze(['facebook','instagram'] as const),
 'Google Business Profile':Object.freeze(['google_business_profile'] as const),
});

export function legacyPublicationChannelsForType(type:string|null|undefined):PublicationProjectChannel[]{
 if(!type||!Object.hasOwn(LEGACY_TYPE_CHANNELS,type))return [];
 return LEGACY_TYPE_CHANNELS[type].map(platform=>({platform,enabled:true}));
}
