import 'server-only';
import {createCipheriv,randomBytes} from 'node:crypto';
import type {SnapchatPublishTransport,SnapchatResponse} from '@/lib/integrations/publications-snapchat-publish';
import type {ProviderCredential} from '../connections/vault';
import type {PublicationPublisher,PublicationReconciler,PublishInput,PublishResult,ReconcileInput,ReconcileResult} from './publisher';
import type {DeliveryErrorClass} from './model';

// Publication Snapchat (Snap Public Profile API) sur le profil public du client, contrat P10.
// - Une photo (JPEG) → Story du profil public (24 h ; le texte n'est pas affiché par Snapchat sur une Story).
// - Une vidéo MP4 (par exemple issue du Studio vidéo) → Spotlight, avec le texte validé en description.
// Étapes : jeton (celui du coffre s'il vaut encore deux minutes, sinon rafraîchi EN MÉMOIRE) ; lecture du fichier dans le
// stockage du projet ; chiffrement AES-256-CBC exigé par Snap (clé et IV aléatoires, propres à cet envoi, jamais
// conservés) ; création du conteneur média, envoi en morceaux, finalisation (rien n'est encore visible : une erreur ici
// est sans effet public) ; puis création de la Story ou du Spotlight (écriture, au plus une fois : marqueur d'envoi posé
// par le moteur ; une réponse perdue rend la diffusion « à vérifier », jamais renvoyée automatiquement).
type Phase='read'|'write';
type Failure={ok:false;errorClass:DeliveryErrorClass;errorCode:string|null;retryAfterSeconds?:number|null}|{ok:false;uncertain:true;errorCode:string|null};
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const opaque=(v:unknown):v is string=>typeof v==='string'&&v.length>=8&&v.length<=8192&&/^[\x21-\x7e]+$/.test(v);
const fail=(errorClass:DeliveryErrorClass,errorCode:string,retryAfterSeconds:number|null=null):Failure=>({ok:false,errorClass,errorCode,retryAfterSeconds});
const uncertain=(errorCode:string):Failure=>({ok:false,uncertain:true,errorCode});
export const SNAPCHAT_DESCRIPTION_MAX=160;
export const SNAPCHAT_LOCALE='fr_FR';
const REMOTE_ID=/^[A-Za-z0-9_.~:-]{1,200}$/;
const PROFILE=/^[A-Za-z0-9_-]{1,100}$/;

export function classifySnapchatError(status:number,body:unknown,phase:Phase):Failure{
 const b=record(body),reason=String(b.debug_message??b.display_message??b.error??'').toLowerCase();
 if(status===401)return fail('auth','token_invalid');
 if(status===403)return fail('auth','permission_missing');
 if(status===429)return fail('rate_limit','rate_limited');
 if(status===404)return fail('auth','profile_unavailable');
 if(status===400||status===413||status===415||status===422)return fail('invalid_payload',/size|large/.test(reason)?'media_too_large':/format|codec|type|duration|aspect/.test(reason)?'media_rejected':'invalid_parameter');
 if(phase==='write')return uncertain(status>=500?'provider_5xx':'provider_error');
 return status>=500?fail('provider_unavailable','provider_5xx'):fail('permanent','provider_error');
}
export type SnapchatTokenRefresher=(credential:ProviderCredential)=>Promise<ProviderCredential>;
export type SnapchatPublisherOptions={refresh?:SnapchatTokenRefresher|null;now?:()=>number;
 /** Chiffrement injecté (tests) ; par défaut AES-256-CBC, clé et IV aléatoires. */
 encrypt?:(bytes:Uint8Array)=>{bytes:Uint8Array;key:string;iv:string}};
async function accessTokenOf(credential:ProviderCredential|undefined,refresh:SnapchatTokenRefresher|null,now:()=>number):Promise<{ok:true;token:string}|Failure>{
 if(!credential||!opaque(credential.accessToken)||(credential.provider!==undefined&&credential.provider!=='snapchat'))return fail('auth','credential_invalid');
 const expires=credential.expiresAt?Date.parse(credential.expiresAt):NaN;
 if(Number.isFinite(expires)&&expires>now()+120_000)return {ok:true,token:credential.accessToken};
 if(!refresh||!credential.refreshToken)return fail('auth','token_expired');
 try{const fresh=await refresh(credential);return opaque(fresh?.accessToken)?{ok:true,token:fresh.accessToken}:fail('auth','token_invalid');}
 catch(error){const kind=error&&typeof error==='object'&&'kind' in error?String((error as {kind:unknown}).kind):'unavailable';
  if(kind==='revoked'||kind==='expired')return fail('auth','token_revoked');
  if(kind==='permission')return fail('auth','permission_missing');
  if(kind==='rate_limited')return fail('rate_limit','rate_limited');
  return fail('provider_unavailable','token_refresh_failed');}
}
/** AES-256-CBC (PKCS#7), clé et IV aléatoires encodés en base64 pour Snap. */
export function encryptForSnapchat(bytes:Uint8Array):{bytes:Uint8Array;key:string;iv:string}{
 const key=randomBytes(32),iv=randomBytes(16),cipher=createCipheriv('aes-256-cbc',key,iv);
 return {bytes:new Uint8Array(Buffer.concat([cipher.update(bytes),cipher.final()])),key:key.toString('base64'),iv:iv.toString('base64')};
}
/** Description d'un Spotlight : texte validé, ramené à 160 caractères au plus (coupé proprement). */
export function snapchatDescription(text:string):string{
 const clean=text.replace(/\s+/g,' ').trim();
 return [...clean].length<=SNAPCHAT_DESCRIPTION_MAX?clean:[...clean].slice(0,SNAPCHAT_DESCRIPTION_MAX-1).join('').trimEnd()+'…';
}
const ok200=(r:SnapchatResponse)=>r.status>=200&&r.status<300&&String(record(r.body).request_status??'SUCCESS').toUpperCase()!=='ERROR';
// Réponses Snap : objet direct ou enveloppe { <collection>: [ { <objet>: {...} } ] } ; on cherche le champ attendu sans deviner.
function field(body:unknown,keys:readonly string[],containers:readonly (readonly [string,string])[]):string|null{
 const candidates:Record<string,unknown>[]=[record(body)];
 for(const [collection,item] of containers){const v=record(body)[collection];candidates.push(record(record(body)[item]));
  if(Array.isArray(v)&&v.length)candidates.push(record(record(v[0])[item]),record(v[0]));else candidates.push(record(record(v)[item]),record(v));}
 for(const cand of candidates)for(const k of keys){const v=cand[k];if(typeof v==='string'&&v.length>=1&&v.length<=400)return v;}
 return null;
}
export function createSnapchatPublisher(transport:SnapchatPublishTransport,options:SnapchatPublisherOptions={}):PublicationPublisher{
 const now=options.now??Date.now,refresh=options.refresh??null,encrypt=options.encrypt??encryptForSnapchat;
 return {async publish(input:PublishInput):Promise<PublishResult>{
  if(input.platform!=='snapchat')return fail('permanent','unsupported_platform');
  const profileId=input.account?.externalAccountId;
  if(typeof profileId!=='string'||!PROFILE.test(profileId))return fail('auth','profile_unavailable');
  if(!input.media.length)return fail('invalid_payload','media_required');
  if(input.media.length>1)return fail('invalid_payload','too_many_media');
  const media=input.media[0],video=media.mimeType==='video/mp4';
  if(!(video||media.mimeType==='image/jpeg')||!/^https:\/\//.test(media.url))return fail('invalid_payload','invalid_media');
  const description=snapchatDescription(input.text??'');
  if(video&&!description)return fail('invalid_payload','empty_post');
  const token=await accessTokenOf(input.credential,refresh,now);if(!token.ok)return token;
  // 1. Fichier (stockage du projet), chiffré pour Snap. Aucun effet externe.
  let plain:Uint8Array;
  try{plain=await transport.readMedia(media.url);}
  catch(error){const kind=error&&typeof error==='object'&&'kind' in error?String((error as {kind:unknown}).kind):'network';
   return kind==='too_large'?fail('invalid_payload','media_too_large'):kind==='invalid_media'?fail('invalid_payload','invalid_media'):fail('provider_unavailable','media_read_failed');}
  if(!plain.length)return fail('invalid_payload','invalid_media');
  const sealed=encrypt(plain);
  // 2. Conteneur média, envoi, finalisation : rien de public tant que la Story / le Spotlight n'est pas créé.
  const name=`codev-${input.idempotencyKey.replace(/[^A-Za-z0-9_-]/g,'').slice(0,40)||'media'}.${video?'mp4':'jpg'}`;
  let created:SnapchatResponse;
  try{created=await transport.request({profileId,action:'media',body:{type:video?'VIDEO':'IMAGE',name,key:sealed.key,iv:sealed.iv},token:token.token});}
  catch{return fail('provider_unavailable','network_before_dispatch');}
  if(!ok200(created))return withRetry(classifySnapchatError(created.status,created.body,'read'),created);
  const mediaId=field(created.body,['media_id','id'],[['media','media']]);
  // Réponse documentée : { media_id, add_path, finalize_path } (chemins relatifs, préfixe régional possible, ex. /us/v1/…).
  const addPath=field(created.body,['add_path'],[['media','media']]),finalizePath=field(created.body,['finalize_path'],[['media','media']])??addPath;
  if(!mediaId||!REMOTE_ID.test(mediaId)||!addPath||!finalizePath)return fail('provider_unavailable','media_container_invalid');
  const PART=32*1024*1024;
  for(let offset=0,part=1;offset<sealed.bytes.length;offset+=PART,part++){
   let up:SnapchatResponse;
   try{up=await transport.uploadPart(addPath,token.token,{bytes:sealed.bytes.subarray(offset,offset+PART),partNumber:part,fileName:name});}
   catch(error){const kind=error&&typeof error==='object'&&'kind' in error?String((error as {kind:unknown}).kind):'network';
    return kind==='invalid_path'?fail('provider_unavailable','upload_path_invalid'):fail('provider_unavailable','media_upload_failed');}
   if(!ok200(up))return withRetry(classifySnapchatError(up.status,up.body,'read'),up);
  }
  let done:SnapchatResponse;
  try{done=await transport.finalizeUpload(finalizePath,token.token);}
  catch{return fail('provider_unavailable','media_upload_failed');}
  if(!ok200(done))return withRetry(classifySnapchatError(done.status,done.body,'read'),done);
  // 3. Publication (écriture visible, au plus une fois).
  const action=video?'spotlights':'stories';
  const body:Record<string,unknown>=video?{media_id:mediaId,description,locale:SNAPCHAT_LOCALE}:{media_id:mediaId};
  let r:SnapchatResponse;
  try{r=await transport.request({profileId,action,body,token:token.token});}
  catch(error){const kind=error&&typeof error==='object'&&'kind' in error?String((error as {kind:unknown}).kind):'network';
   if(kind==='invalid_path')return fail('permanent','invalid_request');
   return uncertain(kind==='timeout'?'timeout_after_dispatch':'network_after_dispatch');}
  if(!ok200(r)){
   // Une publication de ce même média est déjà en cours chez Snap : ne jamais renvoyer, l'original aboutira seul.
   if(String(record(r.body).error_code??'').toUpperCase()==='MEDIA_POSTING_ALREADY_IN_PROGRESS')return uncertain('posting_in_progress');
   return withRetry(classifySnapchatError(r.status,r.body,'write'),r);}
  // Spotlight : { spotlight_id }. Story : Snap ne renvoie que { request_id, request_status } ; l'identifiant retenu est
  // alors celui du média publié (propre à cet envoi).
  const remoteId=video?field(r.body,['spotlight_id','id'],[['spotlights','spotlight']]):field(r.body,['story_id','id'],[['stories','story']])??mediaId;
  if(!remoteId||!REMOTE_ID.test(remoteId))return uncertain('remote_id_missing');
  return {ok:true,remoteId,simulated:false};
 }};
}
function withRetry(failure:Failure,r:SnapchatResponse):Failure{
 return 'errorClass' in failure&&failure.errorClass==='rate_limit'&&r.retryAfterSeconds!==undefined?{...failure,retryAfterSeconds:r.retryAfterSeconds}:failure;
}
// Rapprochement : aucune lecture du contenu du profil n'est faite automatiquement ; une diffusion incertaine reste
// « à vérifier » par un humain (comme TikTok).
export function createSnapchatReconciler():PublicationReconciler{
 return {async reconcile(d:ReconcileInput):Promise<ReconcileResult>{void d;return {status:'unknown',remoteId:null};}};
}
