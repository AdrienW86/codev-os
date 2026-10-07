import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {legacyPublicationChannelsForType} from './legacy-channels';
import {projectSupportsPublications,publicationCapabilities,type PublicationCapabilities} from './channels';
import type {PublicationPlatform} from './types';

// Business service: project → configured publication channels. Every server caller goes through it.
// P0 (now): no channel table yet, so every project uses the legacy fallback (project type).
// After P1: read publication_project_channels; a project with at least one row uses only its enabled rows,
// and the legacy fallback applies only to projects that have never been configured.
export type PublicationProjectRef={id:string;client_id:string;type:string|null};

function resolve(project:PublicationProjectRef):PublicationCapabilities{
 return publicationCapabilities(legacyPublicationChannelsForType(project.type),'legacy');
}
export async function getPublicationProjectChannels(project:PublicationProjectRef):Promise<PublicationCapabilities>{
 await requireAdmin();return resolve(project);
}
// Batch variant for lists (one call for N projects, never one read per row once backed by the database).
export async function getPublicationCapabilitiesForProjects(projects:readonly PublicationProjectRef[]):Promise<Map<string,PublicationCapabilities>>{
 await requireAdmin();return new Map(projects.map(p=>[p.id,resolve(p)]));
}
// Projects offered in publication forms and filters: only those with at least one channel, with their platforms.
export type PublicationProjectOption={id:string;client_id:string;name:string;type:string|null;platforms:PublicationPlatform[]};
export async function publicationProjectOptions(projects:readonly (PublicationProjectRef&{name:string})[]):Promise<PublicationProjectOption[]>{
 const capabilities=await getPublicationCapabilitiesForProjects(projects);
 return projects.flatMap(p=>{const c=capabilities.get(p.id);return c&&projectSupportsPublications(c)?[{id:p.id,client_id:p.client_id,name:p.name,type:p.type,platforms:c.platforms}]:[];});
}
