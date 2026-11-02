import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {writeAudit} from '@/lib/core/audit';
import {readOriginal} from '@/lib/whatsapp/library';
import {getPublicationProjectChannels} from '@/lib/publications/project-channels';
import {projectAllowsPlatform} from '@/lib/publications/channels';
import {currentRevision,saveDraft,saveUnscheduledDraft} from '@/lib/publications/workspace';
import {VIDEO_BUCKET,VIDEO_MIME,imageMime} from '@/lib/publications/editor';
import {MotionRenderError,renderMotionVideo,type MotionRenderInput,type MotionRenderResult} from '@/lib/motion/video/render';
import type {MotionScript} from '@/lib/motion/video/storyboard';
import {STUDIO_BUCKET,STUDIO_MAX_UPLOAD_BYTES,STUDIO_UUID,parseStudioForm,type StudioVideo} from './model';

// Studio vidéo (activité distincte des publications) : création de vidéos motion design à partir des photos d'un client
// (photothèque ou fichiers ajoutés) et d'un script saisi, bibliothèque par client. Une vidéo n'est publiée nulle part
// ici : « Créer une publication TikTok » prépare seulement un brouillon, que l'humain valide dans Publications.
type Db=ReturnType<typeof getSupabaseServerClient>;
type Row={id:string;client_id:string;title:string;script:MotionScript;duration_seconds:number|string;size_bytes:number;created_at:string;storage_path:string;last_publication_id:string|null};
export type StudioDeps={db?:Db;render?:(input:MotionRenderInput)=>Promise<MotionRenderResult>;ffmpegPath?:string|null;fontDir?:string;readLibrary?:(clientId:string,assetId:string)=>Promise<{bytes:Uint8Array;mime:string}|null>};
export const STUDIO_URL_TTL=900;
export const MOTION_FONT_DIR=join(process.cwd(),'lib','motion','video','fonts');
const unavailable='Studio vidéo indisponible : vérifiez que la migration des vidéos est appliquée.';

export async function listStudioVideos(clientId:string,deps:StudioDeps={}):Promise<{ok:true;videos:StudioVideo[]}|{ok:false;message:string}>{
 await requireAdmin();if(!STUDIO_UUID.test(clientId))return {ok:true,videos:[]};
 const db=deps.db??getSupabaseServerClient();
 const {data,error}=await db.from('studio_videos').select('id,client_id,title,script,duration_seconds,size_bytes,created_at,storage_path,last_publication_id').eq('client_id',clientId).order('created_at',{ascending:false}).limit(60);
 if(error)return {ok:false,message:unavailable};
 const rows=(data??[]) as Row[];
 const signed=rows.length?await db.storage.from(STUDIO_BUCKET).createSignedUrls(rows.map(r=>r.storage_path),STUDIO_URL_TTL):{data:[],error:null};
 const urls=new Map((signed.data??[]).flatMap(s=>s.path&&s.signedUrl&&!s.error?[[s.path,s.signedUrl] as [string,string]]:[]));
 return {ok:true,videos:rows.map(r=>({id:r.id,clientId:r.client_id,title:r.title,script:r.script,durationSeconds:Number(r.duration_seconds),sizeBytes:r.size_bytes,createdAt:r.created_at,url:urls.get(r.storage_path)??null,lastPublicationId:r.last_publication_id}))};
}
export type LibraryPhoto={id:string;caption:string|null;date:string};
/** Photos utilisables de la photothèque du client (validées ou déjà utilisées), les plus récentes d'abord. */
export async function studioLibraryPhotos(clientId:string,deps:StudioDeps={}):Promise<LibraryPhoto[]>{
 await requireAdmin();if(!STUDIO_UUID.test(clientId))return [];
 const {data,error}=await (deps.db??getSupabaseServerClient()).from('whatsapp_assets').select('id,caption,captured_at,received_at,created_at')
  .eq('client_id',clientId).eq('media_kind','image').in('library_status',['validated','used']).is('purged_at',null).not('imported_at','is',null)
  .order('created_at',{ascending:false}).limit(60);
 if(error)return [];
 return ((data??[]) as {id:string;caption:string|null;captured_at:string|null;received_at:string|null;created_at:string}[]).map(a=>({id:a.id,caption:a.caption,date:(a.captured_at??a.received_at??a.created_at).slice(0,10)}));
}

export async function createStudioVideo(form:FormData,deps:StudioDeps={}):Promise<{ok:true;id:string;message:string}|{ok:false;message:string}>{
 const {userId}=await requireAdmin();
 const files=form.getAll('photos').filter((f):f is File=>f instanceof File&&f.size>0);
 const parsed=parseStudioForm(form,files.length);if(!parsed.ok)return parsed;
 const {draft}=parsed,db=deps.db??getSupabaseServerClient();
 const client=await db.from('clients').select('id,name').eq('id',draft.clientId).maybeSingle();
 const name=(client.data as {name?:unknown}|null)?.name;
 if(client.error||typeof name!=='string')return {ok:false,message:'Client introuvable.'};
 const script:MotionScript={...draft.script,brand:draft.script.brand||name};
 // Photos : photothèque du client (originaux Drive, client vérifié) puis fichiers ajoutés (types vérifiés au contenu).
 const photos:Uint8Array[]=[];
 for(const id of draft.libraryAssetIds){
  const original=await (deps.readLibrary??readOriginal)(draft.clientId,id).catch(()=>null);
  if(!original||!/^image\//.test(original.mime))return {ok:false,message:'Une photo de la photothèque est illisible : retirez-la ou réessayez.'};
  photos.push(original.bytes);
 }
 for(const file of files){
  if(file.size>STUDIO_MAX_UPLOAD_BYTES)return {ok:false,message:'Photo trop lourde (8 Mo au plus).'};
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(!imageMime(bytes))return {ok:false,message:'Photos acceptées : JPEG, PNG ou WebP.'};
  photos.push(bytes);
 }
 const ffmpegPath=deps.ffmpegPath===undefined?(typeof ffmpegStatic==='string'?ffmpegStatic:null):deps.ffmpegPath;
 if(!ffmpegPath)return {ok:false,message:'Moteur vidéo indisponible sur le serveur.'};
 const id=randomUUID();
 let video:MotionRenderResult;
 try{video=await (deps.render??renderMotionVideo)({photos,script,seed:id,ffmpegPath,fontDir:deps.fontDir??MOTION_FONT_DIR});}
 catch(error){const code=error instanceof MotionRenderError?error.code:'engine';
  return {ok:false,message:code==='text'?'L’accroche doit contenir au moins un mot.':code==='photos'?'Une photo n’a pas pu être lue pour la vidéo.':code==='timeout'?'Le rendu a pris trop de temps : essayez avec moins de photos.':'Le rendu de la vidéo a échoué. Réessayez.'};}
 const path=`${draft.clientId}/${id}.mp4`;
 const upload=await db.storage.from(STUDIO_BUCKET).upload(path,video.bytes,{contentType:VIDEO_MIME,upsert:false});
 if(upload.error)return {ok:false,message:unavailable};
 const inserted=await db.from('studio_videos').insert({id,client_id:draft.clientId,title:draft.title,script,storage_path:path,duration_seconds:video.storyboard.total,size_bytes:video.bytes.length,
  width:video.width,height:video.height,created_by:userId,sources:{library_asset_ids:draft.libraryAssetIds,uploaded_photos:files.length}});
 if(inserted.error){await db.storage.from(STUDIO_BUCKET).remove([path]);return {ok:false,message:unavailable};}
 await writeAudit({kind:'admin',userId},{action:'studio.video_created',resource_type:'studio_video',resource_id:id,metadata:{client_id:draft.clientId,photos:photos.length,duration_seconds:video.storyboard.total}}).catch(()=>{});
 return {ok:true,id,message:`Vidéo de ${Math.round(video.storyboard.total)} s créée.`};
}

export async function deleteStudioVideo(id:unknown,deps:StudioDeps={}):Promise<{ok:boolean;message:string}>{
 const {userId}=await requireAdmin();if(typeof id!=='string'||!STUDIO_UUID.test(id))return {ok:false,message:'Vidéo invalide.'};
 const db=deps.db??getSupabaseServerClient();
 const row=await db.from('studio_videos').select('id,client_id,storage_path').eq('id',id).maybeSingle();
 const r=row.data as {client_id:string;storage_path:string}|null;
 if(row.error||!r)return {ok:false,message:'Vidéo introuvable.'};
 const removed=await db.from('studio_videos').delete().eq('id',id);
 if(removed.error)return {ok:false,message:'Suppression impossible. Réessayez.'};
 await db.storage.from(STUDIO_BUCKET).remove([r.storage_path]);
 await writeAudit({kind:'admin',userId},{action:'studio.video_deleted',resource_type:'studio_video',resource_id:id,metadata:{client_id:r.client_id}}).catch(()=>{});
 return {ok:true,message:'Vidéo supprimée.'};
}

/**
 * Prépare une publication TikTok (brouillon non planifié) avec une vidéo du Studio : copie privée de la vidéo dans le
 * stockage des publications, rattachée à la variante TikTok. Aucune soumission, approbation ni diffusion ici.
 */
export async function createTikTokDraftFromVideo(videoId:unknown,caption:unknown,deps:StudioDeps={}):Promise<{ok:true;publicationId:string;message:string}|{ok:false;message:string}>{
 const {userId}=await requireAdmin();
 if(typeof videoId!=='string'||!STUDIO_UUID.test(videoId))return {ok:false,message:'Vidéo invalide.'};
 const text=typeof caption==='string'?caption.replace(/\r/g,'').trim():'';
 if(!text||text.length>2200)return {ok:false,message:'Texte TikTok requis (2 200 caractères au plus).'};
 const db=deps.db??getSupabaseServerClient();
 const row=await db.from('studio_videos').select('id,client_id,title,storage_path').eq('id',videoId).maybeSingle();
 const v=row.data as {id:string;client_id:string;title:string;storage_path:string}|null;
 if(row.error||!v)return {ok:false,message:'Vidéo introuvable.'};
 const projects=await db.from('projects').select('id,client_id,type').eq('client_id',v.client_id);
 let projectId:string|null=null;
 for(const p of (projects.data??[]) as {id:string;client_id:string;type:string}[]){
  const capabilities=await getPublicationProjectChannels(p).catch(()=>null);
  if(capabilities&&projectAllowsPlatform(capabilities,'tiktok')){projectId=p.id;break;}
 }
 if(projects.error||!projectId)return {ok:false,message:'Aucun projet de ce client n’autorise TikTok : activez TikTok dans ses réglages Publications.'};
 const file=await db.storage.from(STUDIO_BUCKET).download(v.storage_path);
 if(file.error||!file.data)return {ok:false,message:'Vidéo illisible dans le stockage.'};
 const bytes=new Uint8Array(await file.data.arrayBuffer());
 const form=(extra:(f:FormData)=>void)=>{const f=new FormData();
  for(const [k,val] of Object.entries({client_id:v.client_id,project_id:projectId!,title:v.title,angle:'Vidéo motion design du Studio vidéo',source:text}))f.set(k,val);
  f.set('tiktok_enabled','on');f.set('tiktok_text',text);extra(f);return f;};
 const created=await saveUnscheduledDraft(form(()=>{}));
 if(!created.id)return {ok:false,message:created.message??'Brouillon TikTok non créé.'};
 const publicationId=created.id,incomplete='La vidéo n’a pas pu être attachée : le brouillon a été archivé. Réessayez.';
 const abandon=async()=>{await db.rpc('publication_archive',{p_publication_id:publicationId,p_actor_id:userId});return {ok:false as const,message:incomplete};};
 let revisionId:string|null|undefined;try{revisionId=(await currentRevision(publicationId))?.revision_id;}catch{revisionId=null;}
 if(!revisionId)return abandon();
 const assetId=randomUUID(),path=`${v.client_id}/${publicationId}/${assetId}`;
 const upload=await db.storage.from(VIDEO_BUCKET).upload(path,bytes,{contentType:VIDEO_MIME,upsert:false});
 if(upload.error)return abandon();
 const registered=await db.rpc('publication_register_image',{p_publication_id:publicationId,p_revision_id:revisionId,p_asset_id:assetId,p_path:path,
  p_hash:createHash('sha256').update(bytes).digest('hex'),p_mime:VIDEO_MIME,p_provenance:`Vidéo motion design du Studio vidéo (« ${v.title.slice(0,120)} »), photos du client`,p_actor_id:userId});
 if(registered.error){await db.storage.from(VIDEO_BUCKET).remove([path]);return abandon();}
 const revised=await saveDraft(form(f=>{f.set('publication_id',publicationId);f.set('revision_id',revisionId!);f.append('tiktok_assets',assetId);}));
 if(!revised.id)return abandon();
 await db.from('studio_videos').update({last_publication_id:publicationId}).eq('id',v.id);
 await writeAudit({kind:'admin',userId},{action:'studio.tiktok_draft_created',resource_type:'studio_video',resource_id:v.id,metadata:{client_id:v.client_id,publication_id:publicationId}}).catch(()=>{});
 return {ok:true,publicationId,message:'Brouillon TikTok prêt : planifiez-le puis validez-le dans Publications.'};
}
