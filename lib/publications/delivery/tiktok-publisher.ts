import 'server-only';
import type {TikTokPublishTransport} from '@/lib/integrations/publications-tiktok-publish';
import type {ProviderCredential} from '../connections/vault';
import type {PublicationPublisher,PublicationReconciler,PublishInput,PublishResult,ReconcileInput,ReconcileResult} from './publisher';
import type {DeliveryErrorClass} from './model';

// Publication TikTok (Content Posting API v2, post photo ou vidéo en publication directe), contrat P10.
// Vidéo (motion design générée par CODE-V OS) : un seul fichier MP4, lu dans le stockage du projet AVANT toute écriture,
// puis video/init (FILE_UPLOAD, un morceau) et envoi PUT vers l'URL TikTok ; le statut est ensuite suivi comme une photo.
// 1. Jeton : celui du coffre s'il vaut encore deux minutes, sinon rafraîchi EN MÉMOIRE (jamais réécrit ici).
// 2. creator_info : niveaux de confidentialité permis pour ce compte ; le niveau CHOISI à la validation humaine doit y
//    figurer, sinon refus explicite avant toute écriture. Commentaires et divulgation commerciale : choix de l'humain.
// 3. content/init (écriture, au plus une fois : marqueur d'envoi posé par le moteur) → publish_id.
// 4. status/fetch, quelques lectures bornées : PUBLISH_COMPLETE → publié ; FAILED → refusé ; sinon incertain
//    (jamais renvoyé automatiquement). Les images sont servies par CODE-V OS (domaine vérifié chez TikTok).
type Phase='read'|'write';
type Failure={ok:false;errorClass:DeliveryErrorClass;errorCode:string|null;retryAfterSeconds?:number|null}|{ok:false;uncertain:true;errorCode:string|null};
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const opaque=(v:unknown):v is string=>typeof v==='string'&&v.length>=8&&v.length<=8192&&/^[\x21-\x7e]+$/.test(v);
const fail=(errorClass:DeliveryErrorClass,errorCode:string,retryAfterSeconds:number|null=null):Failure=>({ok:false,errorClass,errorCode,retryAfterSeconds});
const uncertain=(errorCode:string):Failure=>({ok:false,uncertain:true,errorCode});
export const TIKTOK_TITLE_MAX=90,TIKTOK_DESCRIPTION_MAX=4000,TIKTOK_MAX_PHOTOS=35,TIKTOK_VIDEO_CAPTION_MAX=2200;
export const TIKTOK_PRIVACY_LEVELS=['PUBLIC_TO_EVERYONE','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR','SELF_ONLY'] as const;
const PUBLISH_ID=/^[A-Za-z0-9_.~:-]{1,200}$/;

export function classifyTikTokError(status:number,body:unknown,phase:Phase):Failure{
 const code=String(record(record(body).error).code??'');
 if(status===401||code==='access_token_invalid')return fail('auth','token_invalid');
 if(code==='scope_not_authorized')return fail('auth','permission_missing');
 if(status===429||code==='rate_limit_exceeded')return fail('rate_limit','rate_limited');
 if(code==='unaudited_client_can_only_post_to_private_accounts')return fail('invalid_payload','app_not_audited');
 if(code==='url_ownership_unverified')return fail('invalid_payload','media_domain_unverified');
 if(code==='privacy_level_option_mismatch')return fail('invalid_payload','privacy_level_unavailable');
 if(code==='spam_risk_too_many_posts'||code==='spam_risk_too_many_pending_share'||code==='reached_active_user_cap')return fail('rate_limit','daily_cap_reached');
 if(code==='spam_risk_user_banned_from_posting')return fail('auth','account_restricted');
 if(status===400||code==='invalid_param')return fail('invalid_payload','invalid_parameter');
 if(status===403)return fail('auth','permission_missing');
 if(phase==='write')return uncertain(status>=500?'provider_5xx':'provider_error');
 return status>=500?fail('provider_unavailable','provider_5xx'):fail('permanent','provider_error');
}
export type TikTokTokenRefresher=(credential:ProviderCredential)=>Promise<ProviderCredential>;
export type TikTokPublisherOptions={refresh?:TikTokTokenRefresher|null;now?:()=>number;sleep?:(ms:number)=>Promise<void>;
 /** Lien public (domaine vérifié) d'une image de diffusion ; null si la configuration manque. */
 mediaLink:(signedUrl:string)=>string|null;statusChecks?:number;statusIntervalMs?:number;
 /** Vidéo : TikTok traite plus longtemps une vidéo qu'une photo (lectures du statut plus nombreuses). */
 videoStatusChecks?:number};
async function accessTokenOf(credential:ProviderCredential|undefined,refresh:TikTokTokenRefresher|null,now:()=>number):Promise<{ok:true;token:string}|Failure>{
 if(!credential||!opaque(credential.accessToken)||(credential.provider!==undefined&&credential.provider!=='tiktok'))return fail('auth','credential_invalid');
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
// Titre (90 caractères au plus) : première phrase du texte ; la description porte le texte complet.
export function tiktokTitle(text:string):string{
 const first=text.split(/\n/)[0].split(/(?<=[.!?…])\s/)[0].trim();
 const title=[...first].length<=TIKTOK_TITLE_MAX?first:[...first].slice(0,TIKTOK_TITLE_MAX-1).join('').trimEnd()+'…';
 return title.replace(/#[\p{L}\p{N}_]+/gu,'').trim();
}
export function createTikTokPublisher(transport:TikTokPublishTransport,options:TikTokPublisherOptions):PublicationPublisher{
 const now=options.now??Date.now,refresh=options.refresh??null,sleep=options.sleep??transport.wait?.bind(transport)??(async()=>{});
 const checks=options.statusChecks??8,interval=options.statusIntervalMs??5000;
 return {async publish(input:PublishInput):Promise<PublishResult>{
  if(input.platform!=='tiktok')return fail('permanent','unsupported_platform');
  const description=input.text.trim();
  if(!description)return fail('invalid_payload','empty_post');
  if([...description].length>TIKTOK_DESCRIPTION_MAX)return fail('invalid_payload','text_too_long');
  if(!input.media.length)return fail('invalid_payload','media_required');
  if(input.media.some(m=>m.mimeType==='video/mp4'))return publishVideo(input,description);
  if(input.media.length>TIKTOK_MAX_PHOTOS)return fail('invalid_payload','too_many_media');
  if(input.media.some(m=>!['image/jpeg','image/webp'].includes(m.mimeType)||!/^https:\/\//.test(m.url)))return fail('invalid_payload','invalid_media');
  const settings=input.tiktok;if(!settings)return fail('invalid_payload','tiktok_settings_missing');
  const photos=input.media.map(m=>options.mediaLink(m.url));
  if(photos.some(p=>!p))return fail('auth','media_link_not_configured');
  const token=await accessTokenOf(input.credential,refresh,now);if(!token.ok)return token;
  const allowed=await creatorAllows(token.token,settings);if(allowed)return allowed;
  const body={media_type:'PHOTO',post_mode:'DIRECT_POST',
   post_info:{title:tiktokTitle(description),description,privacy_level:settings.privacyLevel,disable_comment:!settings.allowComment,auto_add_music:true,brand_content_toggle:settings.brandContent,brand_organic_toggle:settings.brandOrganic},
   source_info:{source:'PULL_FROM_URL',photo_images:photos,photo_cover_index:0}};
  let r;
  try{r=await transport.request({path:'post/publish/content/init',body,token:token.token});}
  catch(error){const kind=error&&typeof error==='object'&&'kind' in error?String((error as {kind:unknown}).kind):'network';
   if(kind==='invalid_path')return fail('permanent','invalid_request');
   return uncertain(kind==='timeout'?'timeout_after_dispatch':'network_after_dispatch');}
  if(r.status!==200||String(record(record(r.body).error).code??'ok')!=='ok'){const failure=classifyTikTokError(r.status,r.body,'write');
   return 'errorClass' in failure&&failure.errorClass==='rate_limit'&&r.retryAfterSeconds!==undefined?{...failure,retryAfterSeconds:r.retryAfterSeconds}:failure;}
  const publishId=record(record(r.body).data).publish_id;
  if(typeof publishId!=='string'||!PUBLISH_ID.test(publishId))return uncertain('remote_id_missing');
  // Statut : TikTok télécharge les images puis publie (quelques secondes en général).
  return followStatus(publishId,token.token,checks);
 }};
 // Lecture : niveaux de confidentialité autorisés (aucun effet de bord). null = réglages compatibles avec le compte.
 async function creatorAllows(token:string,settings:NonNullable<PublishInput['tiktok']>):Promise<Failure|null>{
  let info;
  try{info=await transport.request({path:'post/publish/creator_info/query',body:{},token});}
  catch{return fail('provider_unavailable','network_before_dispatch');}
  if(info.status!==200||String(record(record(info.body).error).code??'ok')!=='ok')return classifyTikTokError(info.status,info.body,'read');
  const options_=record(record(info.body).data).privacy_level_options;
  if(!Array.isArray(options_)||!options_.includes(settings.privacyLevel))return fail('invalid_payload',Array.isArray(options_)&&options_.length===1&&options_[0]==='SELF_ONLY'?'app_not_audited':'privacy_level_unavailable');
  if(settings.allowComment&&record(record(info.body).data).comment_disabled===true)return fail('invalid_payload','comments_disabled_by_creator');
  return null;
 }
 async function followStatus(publishId:string,token:string,count:number):Promise<PublishResult>{
  for(let i=0;i<count;i++){
   await sleep(interval);
   let s;try{s=await transport.request({path:'post/publish/status/fetch',body:{publish_id:publishId},token});}catch{continue;}
   if(s.status!==200)continue;
   const data=record(record(s.body).data),status=data.status;
   if(status==='PUBLISH_COMPLETE'){const ids=Array.isArray(data.publicaly_available_post_id)?data.publicaly_available_post_id:[];
    const postId=ids.map(String).find(id=>/^[0-9]{1,30}$/.test(id));return {ok:true,remoteId:postId??publishId,simulated:false};}
   if(status==='FAILED')return fail('invalid_payload',/^[a-z_]{1,60}$/.test(String(data.fail_reason??''))?`post_failed_${String(data.fail_reason)}`.slice(0,80):'post_failed');
  }
  return uncertain('post_processing');
 }
 // Vidéo : légende = texte complet (title côté API, 2 200 caractères au plus). Duo et Collage désactivés (aucun choix
 // humain ne les autorise aujourd'hui) ; commentaires et divulgation commerciale : choix de l'humain, comme la photo.
 async function publishVideo(input:PublishInput,caption:string):Promise<PublishResult>{
  if(input.media.length!==1||input.media[0].mimeType!=='video/mp4'||!/^https:\/\//.test(input.media[0].url))return fail('invalid_payload','invalid_media');
  if(caption.length>TIKTOK_VIDEO_CAPTION_MAX)return fail('invalid_payload','text_too_long');
  const settings=input.tiktok;if(!settings)return fail('invalid_payload','tiktok_settings_missing');
  if(!transport.readMedia||!transport.uploadVideo)return fail('auth','media_link_not_configured');
  const token=await accessTokenOf(input.credential,refresh,now);if(!token.ok)return token;
  const allowed=await creatorAllows(token.token,settings);if(allowed)return allowed;
  // Lecture du fichier AVANT toute écriture chez TikTok : un échec ici n'a aucun effet de bord.
  let bytes:Uint8Array;
  try{bytes=await transport.readMedia(input.media[0].url);}
  catch(error){const kind=error&&typeof error==='object'&&'kind' in error?String((error as {kind:unknown}).kind):'network';
   return kind==='too_large'?fail('invalid_payload','video_too_large'):kind==='invalid_media'?fail('invalid_payload','invalid_media'):fail('provider_unavailable','media_unavailable');}
  if(bytes.length<2048||new TextDecoder('latin1').decode(bytes.subarray(4,8))!=='ftyp')return fail('invalid_payload','invalid_media');
  const body={post_info:{title:caption,privacy_level:settings.privacyLevel,disable_comment:!settings.allowComment,disable_duet:true,disable_stitch:true,
    video_cover_timestamp_ms:1000,brand_content_toggle:settings.brandContent,brand_organic_toggle:settings.brandOrganic},
   source_info:{source:'FILE_UPLOAD',video_size:bytes.length,chunk_size:bytes.length,total_chunk_count:1}};
  let r;
  try{r=await transport.request({path:'post/publish/video/init',body,token:token.token});}
  catch(error){const kind=error&&typeof error==='object'&&'kind' in error?String((error as {kind:unknown}).kind):'network';
   if(kind==='invalid_path')return fail('permanent','invalid_request');
   return uncertain(kind==='timeout'?'timeout_after_dispatch':'network_after_dispatch');}
  if(r.status!==200||String(record(record(r.body).error).code??'ok')!=='ok'){const failure=classifyTikTokError(r.status,r.body,'write');
   return 'errorClass' in failure&&failure.errorClass==='rate_limit'&&r.retryAfterSeconds!==undefined?{...failure,retryAfterSeconds:r.retryAfterSeconds}:failure;}
  const data=record(record(r.body).data),publishId=data.publish_id,uploadUrl=data.upload_url;
  if(typeof publishId!=='string'||!PUBLISH_ID.test(publishId))return uncertain('remote_id_missing');
  if(typeof uploadUrl!=='string'||!/^https:\/\/[^/]*tiktokapis\.com\//.test(uploadUrl))return fail('invalid_payload','upload_url_invalid');
  // Envoi du fichier : sans envoi complet, TikTok ne publie rien ; une réponse perdue reste « incertaine ».
  let up;
  try{up=await transport.uploadVideo(uploadUrl,bytes,'video/mp4');}
  catch(error){const kind=error&&typeof error==='object'&&'kind' in error?String((error as {kind:unknown}).kind):'network';
   if(kind==='invalid_path')return fail('invalid_payload','upload_url_invalid');
   return uncertain(kind==='timeout'?'upload_timeout':'upload_network');}
  if(up.status!==201&&up.status!==200)return up.status>=500?uncertain('upload_5xx'):fail('invalid_payload','upload_failed');
  return followStatus(publishId,token.token,options.videoStatusChecks??18);
 }
}
// Rapprochement : TikTok ne permet pas de retrouver un post sans son identifiant de publication (aucune lecture des
// vidéos n'est demandée au compte) ; un post connu par son identifiant reste « à vérifier » par un humain.
export function createTikTokReconciler():PublicationReconciler{
 return {async reconcile(d:ReconcileInput):Promise<ReconcileResult>{void d;return {status:'unknown',remoteId:null};}};
}
