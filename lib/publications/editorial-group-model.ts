// Editorial groups (Lot 4.3 P4-a): one shared idea producing sister publications, each on ONE platform.
// Pure and client-safe. Legacy multi-variant publications (platform NULL) stay valid and are reported as such.
import {platformLabels} from './editor';
import type {PublicationPlatform} from './types';

export type EditorialGroup={id:string;client_id:string;project_id:string;subject:string;origin:'manual'|'agent'};
export type GroupPublication={id:string;editorial_group_id:string|null;occurrence_id:string|null;platform:PublicationPlatform|null;subject:string;status:string;editorial_week:string};
export type PublicationKind='legacy'|'mono_platform';
export type SisterPublication={publicationId:string;platform:PublicationPlatform;platformLabel:string;subject:string;status:string;bound:boolean};
export type EditorialGroupView={groupId:string;subject:string;origin:'manual'|'agent';sisters:SisterPublication[];missingPlatforms:PublicationPlatform[]};

const order:PublicationPlatform[]=['facebook','instagram','google_business_profile'];
// A publication with a platform is mono-platform (target model); without one it is a legacy multi-variant publication.
export function publicationKind(p:{platform?:PublicationPlatform|null}):PublicationKind{return p.platform?'mono_platform':'legacy';}
// Sisters sorted Facebook, Instagram, Google Business Profile; publications of other groups or without a platform are ignored.
export function buildEditorialGroupView(group:EditorialGroup,publications:readonly GroupPublication[],expectedPlatforms:readonly PublicationPlatform[]=[]):EditorialGroupView{
 const sisters=publications.filter((p):p is GroupPublication&{platform:PublicationPlatform}=>p.editorial_group_id===group.id&&p.platform!==null&&order.includes(p.platform))
  .sort((a,b)=>order.indexOf(a.platform)-order.indexOf(b.platform))
  .map(p=>({publicationId:p.id,platform:p.platform,platformLabel:platformLabels[p.platform],subject:p.subject,status:p.status,bound:Boolean(p.occurrence_id)}));
 return {groupId:group.id,subject:group.subject,origin:group.origin,sisters,missingPlatforms:order.filter(p=>expectedPlatforms.includes(p)&&!sisters.some(s=>s.platform===p))};
}
// Mirror of the SQL rule (one publication per platform in a group), for future creation forms (P4-b).
export function duplicateSisterPlatforms(platforms:readonly (PublicationPlatform|null)[]):PublicationPlatform[]{
 const seen=new Set<PublicationPlatform>(),dup=new Set<PublicationPlatform>();
 for(const p of platforms){if(!p)continue;if(seen.has(p))dup.add(p);seen.add(p);}
 return order.filter(p=>dup.has(p));
}
