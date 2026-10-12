import 'server-only';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {structuredResponse} from '@/lib/integrations/publications-openai';
import {driveReadProvider} from '@/lib/integrations/publications-drive';
import {visionPreview} from '@/lib/publications/media/transform';
import type {Usage} from '@/lib/publications/ai/provider';
import type {Json} from '@/lib/supabase/database.types';
import type {AssetOrigin} from '@/lib/whatsapp/types';
import {assetOriginal} from '@/lib/whatsapp/library';
import {importDriveToken,trashDrive} from '@/lib/whatsapp/providers';
import {storeThumbnail,THUMBNAIL_BUCKET} from '@/lib/whatsapp/service';
import {classificationContext,classificationInstructions,classificationSchema,mediaProfileFromRow,mediaProfilePayload,normalizeAssessment,type MediaProfile} from './model';

// Photothèque intelligente (socle Publications, lot 2). Serveur uniquement ; les appelants ont vérifié requireAdmin()
// ou agissent comme planificateur. Les originaux restent dans Drive ; seule une réduction 640 px part au modèle,
// avec le profil vérifié du client et la légende citée comme donnée. Budget mensuel par client, coûts journalisés.
// Journaux : étape et code connu uniquement, jamais de légende, de nom de fichier ou de réponse du modèle.
const db=()=>getSupabaseServerClient();
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COST_GUARD_EUR=0.003;
const log=(step:string,code:string)=>console.error('[media-intelligence]',{step,code});
const codeOf=(e:unknown)=>{const m=(e as {message?:unknown})?.message;return typeof m==='string'&&/^[A-Za-z_ ]{3,60}$/.test(m)?m:'unexpected';};

export async function getMediaProfile(clientId:string):Promise<MediaProfile>{
 const {data,error}=await db().from('client_media_profiles').select('*').eq('client_id',clientId).maybeSingle();
 if(error)throw Error('profile_unavailable');return mediaProfileFromRow(data as Record<string,unknown>|null);
}
export async function saveMediaProfile(userId:string,clientId:string,form:FormData):Promise<{ok:boolean;message:string}>{
 const parsed=mediaProfilePayload(form);if('error' in parsed)return {ok:false,message:parsed.error};
 const {error}=await db().rpc('client_media_profile_save',{p_client_id:clientId,p_profile:parsed.payload as Json,p_actor_id:userId});
 if(error)return {ok:false,message:error.code==='23514'?'Valeur refusée par le profil (liste, budget ou conservation).':'Profil non enregistré. Vérifiez que la migration de la photothèque intelligente est appliquée.'};
 return {ok:true,message:'Profil de la photothèque enregistré.'};
}

type AssetRow={id:string;client_id:string;drive_folder_id:string;drive_file_id:string;md5:string;origin:AssetOrigin;caption:string|null;library_status:string;media_kind:string;purged_at:string|null};
export type VisionCall=(instructions:string,input:unknown,schema:unknown)=>Promise<{value:unknown;usage:Usage}>;
export type ClassifyDeps={vision?:VisionCall;download?:(asset:AssetRow)=>Promise<Uint8Array>};
export type ClassifyResult={analyzed:number;quarantined:number;failed:number;stopped:null|'budget'|'disabled'|'no_profile'|'no_key'};

/**
 * Classe des médias du client. Sans liste explicite : les photos reçues ou à examiner jamais évaluées, ou évaluées
 * avec une version antérieure du profil. S'arrête avant de dépasser le budget mensuel du client.
 */
export async function classifyClientMedia(clientId:string,options:{assetIds?:string[];limit:number;scheduled?:boolean},deps:ClassifyDeps={}):Promise<ClassifyResult>{
 const result:ClassifyResult={analyzed:0,quarantined:0,failed:0,stopped:null};
 if(!UUID.test(clientId))throw Error('Invalid client');
 const profile=await getMediaProfile(clientId);
 if(!profile.saved){result.stopped='no_profile';return result;}
 if(options.scheduled&&!profile.aiClassificationEnabled){result.stopped='disabled';return result;}
 if(!deps.vision&&!process.env.OPENAI_API_KEY){result.stopped='no_key';return result;}
 const [{data:client,error:clientError},assessed]=await Promise.all([db().from('clients').select('name,activity').eq('id',clientId).single(),
  db().from('whatsapp_asset_assessments').select('asset_id,profile_version').eq('client_id',clientId)]);
 if(clientError||!client||assessed.error)throw Error('library_unavailable');
 let query=db().from('whatsapp_assets').select('id,client_id,drive_folder_id,drive_file_id,md5,origin,caption,library_status,media_kind,purged_at').eq('client_id',clientId)
  .eq('media_kind','image').not('imported_at','is',null).is('purged_at',null);
 query=options.assetIds?.length?query.in('id',options.assetIds.filter(id=>UUID.test(id)).slice(0,20)):query.in('library_status',['received','to_review']);
 const {data:assets,error}=await query.order('imported_at',{ascending:false}).limit(200);
 if(error)throw Error('library_unavailable');
 const versions=new Map((assessed.data??[]).map(a=>[a.asset_id,a.profile_version]));
 const todo=((assets??[]) as AssetRow[]).filter(a=>options.assetIds?.length||(versions.get(a.id)??0)<profile.version).slice(0,Math.max(0,Math.min(options.limit,20)));
 const vision=deps.vision??structuredResponse,download=deps.download??(asset=>assetOriginal({...asset,media_kind:'image'}));
 for(const asset of todo){
  const spend=await db().rpc('client_media_ai_month_spend',{p_client_id:clientId});
  if(spend.error)throw Error('budget_unavailable');
  if(Number(spend.data)+COST_GUARD_EUR>profile.aiMonthlyBudgetEur){result.stopped='budget';break;}
  try{
   const preview=await visionPreview(await download(asset));
   const response=await vision(classificationInstructions,[{role:'user',content:[{type:'input_text',text:classificationContext(profile,client,asset.caption)},
    {type:'input_image',image_url:`data:image/jpeg;base64,${Buffer.from(preview).toString('base64')}`,detail:'low'}]}],classificationSchema);
   const assessment=normalizeAssessment(response.value,profile.version);
   const recorded=await db().rpc('whatsapp_asset_assessment_record',{p_asset_id:asset.id,p_client_id:clientId,p_assessment:assessment as unknown as Json,p_usage:response.usage as unknown as Json});
   if(recorded.error)throw Error('Assessment not recorded');
   result.analyzed++;if(recorded.data==='quarantined')result.quarantined++;
  }catch(e){result.failed++;log('classify',codeOf(e));}
 }
 return result;
}

/**
 * Référence dans la photothèque les photos ajoutées à la main dans le dossier Drive configuré pour l'agent du client
 * (lecture seule). Dédoublonnage par fichier Drive puis par empreinte SHA-256 ; au plus `limit` nouvelles photos.
 */
export async function syncDriveLibrary(clientId:string,limit=15):Promise<{added:number;skipped:number;folders:number}>{
 if(!UUID.test(clientId))throw Error('Invalid client');
 const {data:folders,error}=await db().from('publication_agent_projects').select('project_id,drive_folder_id,rights_confirmed').eq('client_id',clientId).eq('rights_confirmed',true);
 if(error)throw Error('library_unavailable');
 const provider=driveReadProvider();let added=0,skipped=0;
 for(const folder of [...new Map((folders??[]).map(f=>[f.drive_folder_id,f])).values()]){
  const files=await provider.list(folder.drive_folder_id,clientId,folder.project_id);
  const known=files.length?await db().from('whatsapp_assets').select('drive_file_id').in('drive_file_id',files.map(f=>f.drive_file_id)):{data:[],error:null};
  if(known.error)throw Error('library_unavailable');
  const existing=new Set((known.data??[]).map(r=>r.drive_file_id));
  for(const file of files.filter(f=>!existing.has(f.drive_file_id))){
   if(added>=limit)break;
   try{
    const bytes=await provider.download(file.drive_file_id,folder.drive_folder_id);
    const meta=await sharp(Buffer.from(bytes),{limitInputPixels:40000000,animated:false}).metadata();
    const sha256=createHash('sha256').update(bytes).digest('hex'),md5=createHash('md5').update(bytes).digest('hex');
    const {data:asset,error:insertError}=await db().from('whatsapp_assets').insert({client_id:clientId,drive_folder_id:folder.drive_folder_id,drive_file_id:file.drive_file_id,sha256,md5,
     mime_type:file.mime_type,size:bytes.length,media_kind:'image',width:meta.width??null,height:meta.height??null,origin:'drive',captured_at:file.modified_at,imported_at:new Date().toISOString()} as never).select('id,client_id,thumbnail_path').single();
    if(insertError){if(insertError.code==='23505'){skipped++;continue;}throw Error('Asset not recorded');}
    await storeThumbnail(db(),asset as {id:string;client_id:string;thumbnail_path:string|null},bytes);added++;
   }catch(e){skipped++;log('drive_sync',codeOf(e));}
  }
 }
 return {added,skipped,folders:folders?.length??0};
}

/**
 * Purge des médias rejetés par un humain après la conservation du client, si sa politique est « corbeille Drive » :
 * fichier importé par l'application mis à la corbeille (récupérable), miniature supprimée, légende effacée.
 * Une photo du dossier Drive du client (non créée par l'application) n'est jamais supprimée : seule sa référence l'est.
 */
export async function purgeRejectedMedia(limit=10):Promise<{purged:number;failed:number}>{
 const {data,error}=await db().rpc('whatsapp_rejected_purge_candidates',{p_limit:limit});
 if(error)throw Error('purge_unavailable');
 let purged=0,failed=0;let token:string|null=null;
 for(const c of (data??[]) as {asset_id:string;client_id:string;drive_file_id:string;drive_folder_id:string;origin:string;thumbnail_path:string|null}[]){
  try{
   let trashed=false;
   if(c.origin!=='drive'){
    const {data:asset}=await db().from('whatsapp_assets').select('md5').eq('id',c.asset_id).eq('client_id',c.client_id).single();
    token??=await importDriveToken();
    trashed=asset?(await trashDrive(token,c.drive_file_id,c.drive_folder_id,asset.md5))==='trashed':false;
   }
   if(c.thumbnail_path?.startsWith(`${c.client_id}/`))await db().storage.from(THUMBNAIL_BUCKET).remove([c.thumbnail_path]);
   const marked=await db().rpc('whatsapp_asset_mark_purged',{p_asset_id:c.asset_id,p_client_id:c.client_id,p_drive_trashed:trashed});
   if(marked.error)throw Error('Purge not recorded');purged++;
  }catch(e){failed++;log('purge',codeOf(e));}
 }
 return {purged,failed};
}

// Planificateur : classement borné des clients qui l'ont activé, puis purge éventuelle. Jamais de publication.
export async function runMediaIntelligenceTick(maxClients=5,perClient=8){
 const {data,error}=await db().from('client_media_profiles').select('client_id').eq('ai_classification_enabled',true).order('updated_at').limit(maxClients);
 if(error)throw Error('profile_unavailable');
 const classified=[];
 for(const row of data??[]){try{classified.push(await classifyClientMedia(row.client_id,{limit:perClient,scheduled:true}));}catch(e){log('tick',codeOf(e));}}
 let purge;try{purge=await purgeRejectedMedia();}catch(e){log('tick_purge',codeOf(e));purge={unavailable:true};}
 return {clients:classified.length,analyzed:classified.reduce((n,r)=>n+r.analyzed,0),quarantined:classified.reduce((n,r)=>n+r.quarantined,0),purge};
}
