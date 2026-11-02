import 'server-only';
import type {FetchLike} from './publications-oauth/http';
import {publicationRetryAfterSeconds} from './publications-retry-after';

// Snapchat publishing transport (Snap Public Profile API, businessapi.snapchat.com), séparé du transport OAuth en lecture.
// Liste fermée d'appels, tous sous /v1/public_profiles/<profil>/ : création d'un média (conteneur chiffré), envoi du
// fichier chiffré en morceaux puis finalisation (chemins donnés par Snap, vérifiés ici), création d'une Story ou d'un
// Spotlight. Plus la lecture du fichier dans le stockage du projet (URL signée de ce stockage uniquement). Jeton dans
// l'en-tête Authorization, délai, aucune redirection, corps JSON borné, JAMAIS de nouvelle tentative ici (une création
// de Story peut avoir abouti). Ne journalise rien.
export class SnapchatPublishTransportError extends Error{constructor(readonly kind:'network'|'timeout'|'too_large'|'invalid_path'|'invalid_media'){super(`Snapchat publish transport: ${kind}`);}}
export const SNAPCHAT_API_ORIGIN='https://businessapi.snapchat.com';
export const SNAPCHAT_MEDIA_MAX_BYTES=64*1024*1024;
/** Taille d'un morceau d'envoi (les fichiers de plus de 32 Mo sont envoyés en plusieurs morceaux). */
export const SNAPCHAT_PART_BYTES=32*1024*1024;
const PROFILE=/^[A-Za-z0-9_-]{1,100}$/;
export type SnapchatPublishAction='media'|'stories'|'spotlights';
export type SnapchatPublishRequest={profileId:string;action:SnapchatPublishAction;body:Record<string,unknown>;token:string};
export type SnapchatResponse={status:number;body:unknown;retryAfterSeconds?:number};
export interface SnapchatPublishTransport{
 request(request:SnapchatPublishRequest):Promise<SnapchatResponse>;
 /** Envoi d'un morceau chiffré (multipart/form-data) sur le chemin d'ajout donné par Snap pour ce média. */
 uploadPart(path:string,token:string,part:{bytes:Uint8Array;partNumber:number;fileName:string}):Promise<SnapchatResponse>;
 /** Finalisation de l'envoi sur le chemin donné par Snap. */
 finalizeUpload(path:string,token:string):Promise<SnapchatResponse>;
 /** Lecture du fichier à diffuser (URL signée du stockage du projet uniquement). */
 readMedia(url:string):Promise<Uint8Array>;
}
/** Chemin d'envoi donné par Snap : relatif, sous /v1/public_profiles/<profil>/media/<média>/ (préfixe régional permis). */
export function isSnapchatUploadPath(path:unknown,profileId:string):path is string{
 if(typeof path!=='string'||path.length>400||path.includes('..')||!PROFILE.test(profileId))return false;
 const m=/^\/(?:[a-z]{2}\/)?v1\/public_profiles\/([A-Za-z0-9_-]{1,100})\/media\/[A-Za-z0-9_-]{1,100}\/multipart-upload(?:-v2)?$/.exec(path);
 return Boolean(m&&m[1]===profileId);
}
const MAX_BODY=1_048_576,TIMEOUT_MS=20_000;
async function json(response:Response):Promise<SnapchatResponse>{
 if(Number(response.headers.get('content-length')??'0')>MAX_BODY)throw new SnapchatPublishTransportError('too_large');
 const text=await response.text();if(text.length>MAX_BODY)throw new SnapchatPublishTransportError('too_large');
 let body:unknown=null;if(/json/.test(response.headers.get('content-type')??'')){try{body=JSON.parse(text);}catch{body=null;}}
 const retryAfter=response.status===429?publicationRetryAfterSeconds(response.headers.get('retry-after')):null;
 return {status:response.status,body,...(retryAfter===null?{}:{retryAfterSeconds:retryAfter})};
}
const transportError=(error:unknown)=>new SnapchatPublishTransportError(error instanceof Error&&error.name==='TimeoutError'?'timeout':'network');
export function snapchatPublishTransport(fetchImpl:FetchLike=fetch,options:{mediaOrigin?:string|null}={}):SnapchatPublishTransport{
 const post=async(url:string,token:string,init:{body:BodyInit;headers?:Record<string,string>},timeout=TIMEOUT_MS)=>{
  let response:Response;
  try{response=await fetchImpl(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...init.headers},body:init.body,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(timeout)});}
  catch(error){throw transportError(error);}
  return json(response);};
 return {
  async request(r){
   if(!PROFILE.test(r.profileId)||!['media','stories','spotlights'].includes(r.action)||!r.token)throw new SnapchatPublishTransportError('invalid_path');
   return post(`${SNAPCHAT_API_ORIGIN}/v1/public_profiles/${r.profileId}/${r.action}`,r.token,{body:JSON.stringify(r.body),headers:{'Content-Type':'application/json; charset=UTF-8'}});},
  async uploadPart(path,token,part){
   const profile=/\/public_profiles\/([A-Za-z0-9_-]{1,100})\//.exec(path)?.[1]??'';
   if(!token||!isSnapchatUploadPath(path,profile)||!part.bytes.length||part.bytes.length>SNAPCHAT_PART_BYTES+16||!Number.isInteger(part.partNumber)||part.partNumber<1||part.partNumber>8)
    throw new SnapchatPublishTransportError('invalid_path');
   const form=new FormData();form.set('action','ADD');form.set('part_number',String(part.partNumber));
   form.set('file',new Blob([new Uint8Array(part.bytes)],{type:'application/octet-stream'}),part.fileName.replace(/[^A-Za-z0-9_.-]/g,'').slice(0,80)||'media');
   return post(SNAPCHAT_API_ORIGIN+path,token,{body:form},120_000);},
  async finalizeUpload(path,token){
   const profile=/\/public_profiles\/([A-Za-z0-9_-]{1,100})\//.exec(path)?.[1]??'';
   if(!token||!isSnapchatUploadPath(path,profile))throw new SnapchatPublishTransportError('invalid_path');
   const form=new FormData();form.set('action','FINALIZE');
   return post(SNAPCHAT_API_ORIGIN+path,token,{body:form},60_000);},
  async readMedia(url){
   let origin:string|null=null;try{origin=new URL(url).origin;}catch{origin=null;}
   if(!origin||!options.mediaOrigin||origin!==options.mediaOrigin)throw new SnapchatPublishTransportError('invalid_media');
   let response:Response;
   try{response=await fetchImpl(url,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(60_000)});}
   catch(error){throw transportError(error);}
   if(!response.ok)throw new SnapchatPublishTransportError('invalid_media');
   if(Number(response.headers.get('content-length')??'0')>SNAPCHAT_MEDIA_MAX_BYTES)throw new SnapchatPublishTransportError('too_large');
   const bytes=new Uint8Array(await response.arrayBuffer());
   if(bytes.length>SNAPCHAT_MEDIA_MAX_BYTES)throw new SnapchatPublishTransportError('too_large');
   return bytes;},
 };
}
