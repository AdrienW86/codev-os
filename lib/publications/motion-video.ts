import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {isAuthorizedAdmin} from '@/lib/admin-policy';
import {MOTION_RENDER_TIMEOUT_MS,MotionRenderError,renderMotionVideo,type MotionRenderInput,type MotionRenderResult} from '@/lib/motion/video/render';
import {MOTION_MAX_PHOTOS} from '@/lib/motion/video/storyboard';
import {IMAGE_BUCKET,VIDEO_BUCKET,VIDEO_MIME} from './editor';
import {isPublicationUuid} from './validation';
import {delegatedActor} from './automation/scheduled';

// Vidéo motion design d'une publication TikTok : les photos et le texte de la révision courante deviennent une vidéo
// 9:16, enregistrée dans le stockage privé des vidéos puis rattachée à une NOUVELLE révision (même texte, la vidéo à
// la place des photos), qui repasse « À valider ». Aucune diffusion ici : la validation humaine TikTok (confidentialité,
// consentement) reste obligatoire. Les photos d'origine sont gardées dans les métadonnées de la variante (régénération).
export const MOTION_RENDERER='codev-motion-v1';
export type MotionVideoResult={ok:true;revisionId:string;message:string}|{ok:false;code:string;message:string};
type Db=ReturnType<typeof getSupabaseServerClient>;
export type MotionVideoDeps={db?:Db;render?:(input:MotionRenderInput)=>Promise<MotionRenderResult>;ffmpegPath?:()=>string|null;fontDir?:string;
 /** Durée maximale du rendu (planificateur : bornée par l'échéance du passage). */
 renderTimeoutMs?:number};
const EDITABLE=new Set(['draft','pending_review','approved','rejected']);
const failure=(code:string,message:string):MotionVideoResult=>({ok:false,code,message});
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};

/** Binaire ffmpeg embarqué (paquet ffmpeg-static, exclu du bundle) ; null s'il manque (installation incomplète). */
export function bundledFfmpegPath():string|null{return typeof ffmpegStatic==='string'&&ffmpegStatic?ffmpegStatic:null;}
export const MOTION_FONT_DIR=join(process.cwd(),'lib','motion','video','fonts');

export async function generateTikTokMotionVideo(publicationId:unknown,actorId:string,options:{automatic?:boolean}={},deps:MotionVideoDeps={}):Promise<MotionVideoResult>{
 if(!isPublicationUuid(publicationId))return failure('invalid','Publication invalide.');
 if(!/^user_[a-zA-Z0-9_-]{1,200}$/.test(actorId))return failure('invalid','Administrateur invalide.');
 const db=deps.db??getSupabaseServerClient();
 const pub=await db.from('publications').select('id,client_id,platform,status,current_revision_id,archived_at').eq('id',publicationId).maybeSingle();
 const p=pub.data as {id:string;client_id:string;platform:string|null;status:string;current_revision_id:string|null;archived_at:string|null}|null;
 if(pub.error||!p)return failure('unavailable','Publication introuvable.');
 if(p.platform!=='tiktok')return failure('not_tiktok','La vidéo motion design est réservée aux publications TikTok.');
 if(p.archived_at||!p.current_revision_id||!EDITABLE.has(p.status)||(options.automatic&&p.status!=='pending_review'))return failure('locked','Cette publication ne peut plus être modifiée.');
 const revisionId=p.current_revision_id;
 const variant=await db.from('publication_variants').select('id,text_content,metadata').eq('revision_id',revisionId).eq('platform','tiktok').maybeSingle();
 const v=variant.data as {id:string;text_content:string;metadata:unknown}|null;
 if(variant.error||!v)return failure('unavailable','Texte TikTok introuvable.');
 const links=await db.from('publication_variant_assets').select('asset_id,sort_order').eq('variant_id',v.id).order('sort_order');
 if(links.error)return failure('unavailable','Médias de la publication illisibles.');
 const linked=((links.data??[]) as {asset_id:string}[]).map(l=>l.asset_id);
 // Régénération : la vidéo actuelle est refaite à partir des photos d'origine gardées dans la variante.
 const previous=record(record(v.metadata).motion_video);
 const kept=Array.isArray(previous.source_asset_ids)?previous.source_asset_ids.filter(isPublicationUuid):[];
 const assets=await db.from('publication_assets').select('id,storage_path,mime_type').eq('client_id',p.client_id).in('id',[...new Set([...linked,...kept])]);
 if(assets.error)return failure('unavailable','Médias de la publication illisibles.');
 const byId=new Map(((assets.data??[]) as {id:string;storage_path:string;mime_type:string}[]).map(a=>[a.id,a]));
 const hasVideo=linked.some(id=>byId.get(id)?.mime_type===VIDEO_MIME);
 if(options.automatic&&hasVideo)return failure('already','La vidéo existe déjà.');
 const sourceIds=(hasVideo?kept:linked).filter(id=>byId.get(id)?.mime_type.startsWith('image/')).slice(0,MOTION_MAX_PHOTOS);
 if(!sourceIds.length)return failure('photos','Ajoutez au moins une photo à la publication TikTok avant de générer la vidéo.');
 const client=await db.from('clients').select('name').eq('id',p.client_id).maybeSingle();
 const clientName=(client.data as {name?:unknown}|null)?.name;
 // 1. Photos lues dans le stockage privé (aucun autre hôte).
 const photos:Uint8Array[]=[];
 for(const id of sourceIds){
  const file=await db.storage.from(IMAGE_BUCKET).download(byId.get(id)!.storage_path);
  if(file.error||!file.data)return failure('photos','Une photo de la publication est illisible dans le stockage.');
  photos.push(new Uint8Array(await file.data.arrayBuffer()));
 }
 // 2. Rendu (aucun effet de bord hors du dossier temporaire).
 const ffmpegPath=(deps.ffmpegPath??bundledFfmpegPath)();
 if(!ffmpegPath)return failure('engine','Moteur vidéo indisponible sur le serveur.');
 let video:MotionRenderResult;
 const revisions=await db.from('publication_revisions').select('id',{count:'exact',head:true}).eq('publication_id',p.id);
 try{video=await (deps.render??renderMotionVideo)({photos,text:v.text_content,clientName:typeof clientName==='string'?clientName:'',seed:`${p.id}:${revisions.count??0}`,ffmpegPath,fontDir:deps.fontDir??MOTION_FONT_DIR,...(deps.renderTimeoutMs?{timeoutMs:deps.renderTimeoutMs}:{})});}
 catch(error){
  const code=error instanceof MotionRenderError?error.code:'engine';
  return failure(`render_${code}`,code==='text'?'Le texte TikTok ne contient pas de phrase affichable.':code==='photos'?'Une photo n’a pas pu être lue pour la vidéo.':code==='timeout'?'Le rendu de la vidéo a pris trop de temps. Réessayez.':'Le rendu de la vidéo a échoué. Réessayez.');
 }
 // 3. Vidéo enregistrée sur la révision courante, puis nouvelle révision qui la rattache (même texte).
 const assetId=randomUUID(),path=`${p.client_id}/${p.id}/${assetId}`;
 const upload=await db.storage.from(VIDEO_BUCKET).upload(path,video.bytes,{contentType:VIDEO_MIME,upsert:false});
 if(upload.error)return failure('storage','Stockage vidéo indisponible : vérifiez que la migration des vidéos est appliquée.');
 const registered=await db.rpc('publication_register_image',{p_publication_id:p.id,p_revision_id:revisionId,p_asset_id:assetId,p_path:path,
  p_hash:createHash('sha256').update(video.bytes).digest('hex'),p_mime:VIDEO_MIME,
  p_provenance:`Vidéo motion design générée par CODE-V OS à partir de ${sourceIds.length} photo${sourceIds.length>1?'s':''} et du texte de la publication`,p_actor_id:actorId});
 if(registered.error){await db.storage.from(VIDEO_BUCKET).remove([path]);return failure(registered.error.code==='40001'?'stale':'storage',registered.error.code==='40001'?'La publication a changé pendant le rendu. Rechargez puis réessayez.':'Vidéo non enregistrée. Réessayez.');}
 const metadata={...record(v.metadata),motion_video:{source_asset_ids:sourceIds,renderer:MOTION_RENDERER,duration_seconds:video.storyboard.total,scenes:video.storyboard.scenes.length}};
 const revised=await db.rpc('publication_revise_manual',{p_publication_id:p.id,p_expected_revision_id:revisionId,
  p_variants:[{platform:'tiktok',text_content:v.text_content,asset_ids:[assetId],metadata}],p_actor_id:actorId});
 if(revised.error||!isPublicationUuid(revised.data)){await db.storage.from(VIDEO_BUCKET).remove([path]);
  return failure('stale',revised.error?.code==='55000'?'Un envoi est en cours ou terminé : la publication ne peut plus changer.':'La publication a changé pendant le rendu. Rechargez puis réessayez.');}
 return {ok:true,revisionId:revised.data,message:`Vidéo de ${Math.round(video.storyboard.total)} s prête : vérifiez-la puis validez la publication TikTok.`};
}

// Génération automatique (étape du planificateur central) pour les clients qui l'ont activée : une publication par
// passage, au nom de l'administrateur délégué, seulement s'il reste le temps d'un rendu avant l'échéance du passage.
// Un échec est journalisé et la révision n'est plus reprise automatiquement (un humain peut relancer).
export type MotionTickSummary={rendered:number;failed:number;noActor:number;candidates:number;disabled?:'global'|'not_installed';skipped?:'deadline'};
export const MOTION_TICK_MIN_RENDER_MS=60_000;
export async function runMotionVideoTick(now=new Date(),deps:MotionVideoDeps&{isAdmin?:(userId:string)=>boolean;max?:number;deadline?:number;clock?:()=>number}={}):Promise<MotionTickSummary>{
 const db=deps.db??getSupabaseServerClient(),summary:MotionTickSummary={rendered:0,failed:0,noActor:0,candidates:0};
 // Arrêt d'urgence ou génération coupée : rien n'est produit (même règle que la préparation IA).
 const settings=await db.from('publication_settings').select('emergency_stop,generation_enabled').limit(1).maybeSingle();
 const sw=settings.data as {emergency_stop?:unknown;generation_enabled?:unknown}|null;
 if(settings.error||!sw||sw.emergency_stop!==false||sw.generation_enabled===false)return {...summary,disabled:'global'};
 const candidates=await db.rpc('publication_motion_video_candidates',{p_now:now.toISOString(),p_limit:5});
 // Migration 20261120000000 pas encore appliquée (fonction absente) : étape « désactivée », pas en échec.
 if(candidates.error&&(candidates.error as {code?:string}).code==='PGRST202')return {...summary,disabled:'not_installed'};
 if(candidates.error||!Array.isArray(candidates.data))throw new Error('motion_candidates_unavailable');
 const rows=candidates.data as {publication_id:string;revision_id:string;client_id:string}[];summary.candidates=rows.length;
 for(const c of rows.slice(0,deps.max??1)){
  const left=deps.deadline===undefined?MOTION_RENDER_TIMEOUT_MS:deps.deadline-(deps.clock??Date.now)()-15_000;
  if(left<MOTION_TICK_MIN_RENDER_MS)return {...summary,skipped:'deadline'};
  const actor=await delegatedActor(c.client_id,deps.isAdmin??(userId=>isAuthorizedAdmin(userId))).catch(()=>null);
  if(!actor){summary.noActor++;continue;}
  const result=await generateTikTokMotionVideo(c.publication_id,actor,{automatic:true},{...deps,renderTimeoutMs:Math.min(left,MOTION_RENDER_TIMEOUT_MS)});
  if(result.ok){summary.rendered++;continue;}
  summary.failed++;
  if(result.code!=='stale'&&result.code!=='already')await db.rpc('publication_motion_video_failed',{p_publication_id:c.publication_id,p_revision_id:c.revision_id,p_code:result.code.slice(0,40),p_actor_id:null});
 }
 return summary;
}
