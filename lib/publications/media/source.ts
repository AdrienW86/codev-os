import 'server-only';
import {driveReadProvider} from '@/lib/integrations/publications-drive';
import {assetOriginal} from '@/lib/whatsapp/originals';
import type {AssetOrigin} from '@/lib/whatsapp/types';
import type {MediaProvider} from './types';

// Source of a client media selected by Agent v2 (Lot 4.3 P8). Injectable: Drive in production, a fake in tests.
// The reference always comes from the database (publication_agent_v2_media_claim), never from a browser.
// drive_file_id / folder stay server-side: never logged, returned to a client component or stored elsewhere.
// source « catalog » : catalogue Drive de l'agent ; « library » : photothèque du client (WhatsApp, export, dossier Drive),
// relue par l'accès correspondant à son origine, empreinte MD5 vérifiée.
export type PublicationMediaRef={id:string;driveFileId:string;driveFolderId:string;mimeType:string;fileSize:number;source?:'catalog'|'library';origin?:AssetOrigin;md5?:string};
export type FetchedMedia={bytes:Uint8Array;mimeType:string;fileName?:string};
export interface PublicationMediaSource{fetchMedia(media:PublicationMediaRef):Promise<FetchedMedia>}

// Drive implementation, reusing the v1 read provider (folder parent, mime, size ≤ 8 MB and trashed checks, streamed).
// Credentials are only read on the first fetch, so a missing configuration is a fetch failure (needs_media).
export type LibraryReader=(asset:{origin:AssetOrigin;drive_file_id:string;drive_folder_id:string;md5:string;media_kind:'image'})=>Promise<Uint8Array>;
export function driveMediaSource(provider?:Pick<MediaProvider,'download'>,library:LibraryReader=assetOriginal):PublicationMediaSource{
 let drive=provider;
 return {async fetchMedia(media){
  if(media.source==='library'){
   if(!media.origin||!media.md5)throw Error('Library media incomplete');
   return {bytes:await library({origin:media.origin,drive_file_id:media.driveFileId,drive_folder_id:media.driveFolderId,md5:media.md5,media_kind:'image'}),mimeType:media.mimeType};}
  drive??=driveReadProvider();const bytes=await drive.download(media.driveFileId,media.driveFolderId);return {bytes,mimeType:media.mimeType};}};
}
