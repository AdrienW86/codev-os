import 'server-only';
import {driveReadProvider} from '@/lib/integrations/publications-drive';
import type {MediaProvider} from './types';

// Source of a client media selected by Agent v2 (Lot 4.3 P8). Injectable: Drive in production, a fake in tests.
// The reference always comes from the database (publication_agent_v2_media_claim), never from a browser.
// drive_file_id / folder stay server-side: never logged, returned to a client component or stored elsewhere.
export type PublicationMediaRef={id:string;driveFileId:string;driveFolderId:string;mimeType:string;fileSize:number};
export type FetchedMedia={bytes:Uint8Array;mimeType:string;fileName?:string};
export interface PublicationMediaSource{fetchMedia(media:PublicationMediaRef):Promise<FetchedMedia>}

// Drive implementation, reusing the v1 read provider (folder parent, mime, size ≤ 8 MB and trashed checks, streamed).
// Credentials are only read on the first fetch, so a missing configuration is a fetch failure (needs_media).
export function driveMediaSource(provider?:Pick<MediaProvider,'download'>):PublicationMediaSource{
 let drive=provider;
 return {async fetchMedia(media){drive??=driveReadProvider();const bytes=await drive.download(media.driveFileId,media.driveFolderId);return {bytes,mimeType:media.mimeType};}};
}
