import 'server-only';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {structuredResponse} from '@/lib/integrations/publications-openai';
import {driveReadProvider} from '@/lib/integrations/publications-drive';
import {visionPreview} from '@/lib/publications/media/transform';
import type {Usage} from '@/lib/publications/ai/provider';
import type {MediaProvider} from '@/lib/publications/media/types';
import type {Json} from '@/lib/supabase/database.types';
import type {AssetOrigin} from '@/lib/whatsapp/types';
import {assetOriginal} from '@/lib/whatsapp/originals';
import {importDriveToken,trashDrive} from '@/lib/whatsapp/providers';
import {storeThumbnail,THUMBNAIL_BUCKET} from '@/lib/whatsapp/service';
import {driveFolderBackfill,type DriveBackfill,type DriveSyncFile} from './drive-listing';
import {classificationContext,classificationInstructions,classificationSchema,mediaProfileFromRow,mediaProfilePayload,normalizeAssessment,type MediaProfile} from './model';

// Photothèque intelligente (socle Publications, lot 2). Serveur uniquement ; les appelants ont vérifié requireAdmin()
// ou agissent comme planificateur. Les originaux restent dans Drive ; seule une réduction 640 px part au modèle,
// avec le profil vérifié du client et la légende citée comme donnée. Budget mensuel par client, coûts journalisés.
// Journaux : étape et code connu uniquement, jamais de légende, de nom de fichier ou de réponse du modèle.
const db=()=>getSupabaseServerClient();
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COST_GUARD_EUR=0.003;
// Photo en échec : exclue de la sélection automatique après 3 échecs, ou pendant 6 h après un échec.
const MAX_FAILURES=3,FAILURE_COOLDOWN_MS=6*3600_000;
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

type AssetRow={id:string;client_id:string;drive_folder_id:string;drive_file_id:string;md5:string;origin:AssetOrigin;caption:string|null;library_status:string;media_kind:string;purged_at:string|null;
 classification_failures?:number;classification_failed_at?:string|null;status_changed_by?:string|null};
// Coût déjà engagé : celui de la réponse, ou celui joint à l'erreur du fournisseur (réponse illisible, limite dépassée).
const isUsage=(u:unknown):u is Usage=>{const x=u as Usage;return Boolean(x)&&typeof x.model==='string'&&x.model.length>0&&[x.input_tokens,x.output_tokens].every(n=>Number.isInteger(n)&&n>=0)
 &&typeof x.estimated_cost_eur==='number'&&x.estimated_cost_eur>=0&&x.estimated_cost_eur<=1;};
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
 let query=db().from('whatsapp_assets').select('id,client_id,drive_folder_id,drive_file_id,md5,origin,caption,library_status,status_changed_by,media_kind,purged_at,classification_failures,classification_failed_at').eq('client_id',clientId)
  .eq('media_kind','image').not('imported_at','is',null).is('purged_at',null);
 // Une demande explicite (bouton « Analyser ») peut relancer une photo en échec ; la sélection automatique non.
 // Une décision humaine (statut posé par une personne) n'est jamais réévaluée automatiquement : seule une demande
 // explicite d'un administrateur relance l'analyse, et l'évaluation ne modifie de toute façon jamais un statut humain.
 query=options.assetIds?.length?query.in('id',options.assetIds.filter(id=>UUID.test(id)).slice(0,20)):query.in('library_status',['received','to_review']).lt('classification_failures',MAX_FAILURES);
 const {data:assets,error}=await query.order('imported_at',{ascending:false}).limit(200);
 if(error)throw Error('library_unavailable');
 const versions=new Map((assessed.data??[]).map(a=>[a.asset_id,a.profile_version]));
 const cooled=(a:AssetRow)=>!a.classification_failed_at||Date.parse(a.classification_failed_at)<Date.now()-FAILURE_COOLDOWN_MS;
 const human=(a:AssetRow)=>typeof a.status_changed_by==='string'&&/^user_/.test(a.status_changed_by);
 const todo=((assets??[]) as AssetRow[]).filter(a=>options.assetIds?.length||((versions.get(a.id)??0)<profile.version&&(a.classification_failures??0)<MAX_FAILURES&&cooled(a)&&!human(a)))
  .slice(0,Math.max(0,Math.min(options.limit,20)));
 const vision=deps.vision??structuredResponse,download=deps.download??(asset=>assetOriginal({...asset,media_kind:'image'}));
 for(const asset of todo){
  const spend=await db().rpc('client_media_ai_month_spend',{p_client_id:clientId});
  if(spend.error)throw Error('budget_unavailable');
  if(Number(spend.data)+COST_GUARD_EUR>profile.aiMonthlyBudgetEur){result.stopped='budget';break;}
  let usage:unknown=null;
  try{
   const preview=await visionPreview(await download(asset));
   const response=await vision(classificationInstructions,[{role:'user',content:[{type:'input_text',text:classificationContext(profile,client,asset.caption)},
    {type:'input_image',image_url:`data:image/jpeg;base64,${Buffer.from(preview).toString('base64')}`,detail:'low'}]}],classificationSchema);
   usage=response.usage;
   const assessment=normalizeAssessment(response.value,profile.version);
   const recorded=await db().rpc('whatsapp_asset_assessment_record',{p_asset_id:asset.id,p_client_id:clientId,p_assessment:assessment as unknown as Json,p_usage:response.usage as unknown as Json});
   if(recorded.error)throw Error('Assessment not recorded');
   result.analyzed++;if(recorded.data==='quarantined')result.quarantined++;
  }catch(e){
   result.failed++;log('classify',codeOf(e));
   // Coût engagé toujours journalisé (budget), échec compté (pas de nouvel essai à chaque passage).
   usage??=(e as {usage?:unknown})?.usage??null;
   const failed=await db().rpc('whatsapp_asset_assessment_failed',{p_asset_id:asset.id,p_client_id:clientId,p_usage:(isUsage(usage)?usage:null) as unknown as Json});
   if(failed.error)log('classify_failure',failed.error.code==='PGRST202'?'missing_rpc':'not_recorded');
  }
 }
 return result;
}

/**
 * Référence dans la photothèque les photos des dossiers Drive autorisés du client (lecture seule, accès Publications) :
 * dossier configuré pour l'agent (droits confirmés) et dossiers des associations WhatsApp actives avec droits confirmés.
 * Chaque photo n'entre qu'une fois dans la photothèque du client : dédoublonnage par fichier Drive, puis par empreinte
 * SHA-256 à l'échelle du client (toutes origines et tous dossiers, photos purgées comprises). Un doublon ou un échec de
 * lecture est mémorisé (client_media_drive_files) pour ne pas être retéléchargé à chaque passage ; un échec est retenté
 * après 24 h, 3 fois au plus. Les 100 photos les plus récentes sont examinées à chaque passage ; un parcours de reprise
 * (du plus ancien au plus récent, curseur par dossier) couvre les dossiers plus volumineux. Au plus `limit` ajouts.
 */
export type DriveSyncResult={added:number;skipped:number;folders:number;duplicates:number;failed:number};
export async function syncDriveLibrary(clientId:string,limit=15,deps:{provider?:MediaProvider;backfill?:DriveBackfill|null}={}):Promise<DriveSyncResult>{
 if(!UUID.test(clientId))throw Error('Invalid client');
 const [agent,senders]=await Promise.all([db().from('publication_agent_projects').select('project_id,drive_folder_id,rights_confirmed').eq('client_id',clientId).eq('rights_confirmed',true),
  db().from('whatsapp_senders').select('drive_folder_id,enabled,rights_confirmed').eq('client_id',clientId).eq('rights_confirmed',true).eq('enabled',true)]);
 if(agent.error)throw Error('library_unavailable');
 // Dossier de l'agent d'abord (droits confirmés), puis dossiers WhatsApp actifs ; un dossier n'est parcouru qu'une fois.
 const byFolder=new Map<string,string>();
 for(const f of agent.data??[])if(f.drive_folder_id&&!byFolder.has(f.drive_folder_id))byFolder.set(f.drive_folder_id,f.project_id);
 for(const f of senders.error?[]:senders.data??[])if(f.drive_folder_id&&!byFolder.has(f.drive_folder_id))byFolder.set(f.drive_folder_id,'');
 const folders=[...byFolder.entries()];
 const result:DriveSyncResult={added:0,skipped:0,folders:folders.length,duplicates:0,failed:0};
 if(!folders.length)return result;
 const provider=deps.provider??driveReadProvider();
 let backfill:DriveBackfill|null=null;
 if(deps.backfill!==null){try{backfill=deps.backfill??driveFolderBackfill();}catch{log('drive_sync','backfill_not_configured');}}
 for(const [folder,projectId] of folders){
  const state=await db().from('client_media_drive_sync').select('backfill_after').eq('client_id',clientId).eq('drive_folder_id',folder).maybeSingle();
  const after=state.error?null:(state.data?.backfill_after??null);
  let recent:{drive_file_id:string;mime_type:string;modified_at:string}[]=[],older:{files:DriveSyncFile[];complete:boolean;last:string|null}|null=null;
  try{
   recent=(await provider.list(folder,clientId,projectId)).map(f=>({drive_file_id:f.drive_file_id,mime_type:f.mime_type,modified_at:f.modified_at}));
   if(backfill)older=await backfill(folder,after);
  }catch(e){result.failed++;log('drive_sync_list',codeOf(e));continue;}
  const files=[...new Map([...recent,...(older?.files??[])].map(f=>[f.drive_file_id,f])).values()];
  const ids=files.map(f=>f.drive_file_id);
  const [known,seen]=ids.length?await Promise.all([db().from('whatsapp_assets').select('drive_file_id').eq('client_id',clientId).in('drive_file_id',ids),
   db().from('client_media_drive_files').select('drive_file_id,outcome,failures,updated_at').eq('client_id',clientId).in('drive_file_id',ids)]):[{data:[],error:null},{data:[],error:null}];
  if(known.error)throw Error('library_unavailable');
  const retryAfter=Date.now()-SEEN_RETRY_MS;
  const memo=new Map((seen.error?[]:(seen.data??[]) as {drive_file_id:string;outcome:string;failures:number;updated_at:string}[]).map(r=>[r.drive_file_id,r]));
  const skip=new Set([...(known.data??[]).map(r=>r.drive_file_id),...[...memo.values()].filter(r=>r.outcome==='duplicate'||r.failures>=MAX_SEEN_FAILURES||Date.parse(r.updated_at)>retryAfter).map(r=>r.drive_file_id)]);
  const handled=new Set<string>();
  for(const file of files){
   if(skip.has(file.drive_file_id)){handled.add(file.drive_file_id);continue;}
   if(result.added>=limit)break;
   handled.add(file.drive_file_id);
   try{
    const bytes=await provider.download(file.drive_file_id,folder);
    const sha256=createHash('sha256').update(bytes).digest('hex'),md5=createHash('md5').update(bytes).digest('hex');
    // Même photo déjà dans la photothèque du client (WhatsApp, export, autre dossier, purgée) : jamais une seconde entrée.
    const twin=await db().from('whatsapp_assets').select('id').eq('client_id',clientId).eq('sha256',sha256).order('created_at').limit(1);
    if(twin.error)throw Error('Asset not recorded');
    if(twin.data?.length){await remember(clientId,folder,file.drive_file_id,{outcome:'duplicate',asset_id:twin.data[0].id});result.duplicates++;result.skipped++;continue;}
    const meta=await sharp(Buffer.from(bytes),{limitInputPixels:40000000,animated:false}).metadata();
    const {data:asset,error:insertError}=await db().from('whatsapp_assets').insert({client_id:clientId,drive_folder_id:folder,drive_file_id:file.drive_file_id,sha256,md5,
     mime_type:file.mime_type,size:bytes.length,media_kind:'image',width:meta.width??null,height:meta.height??null,origin:'drive',captured_at:file.modified_at,imported_at:new Date().toISOString()} as never).select('id,client_id,thumbnail_path').single();
    if(insertError){if(insertError.code==='23505'){result.skipped++;continue;}throw Error('Asset not recorded');}
    await storeThumbnail(db(),asset as {id:string;client_id:string;thumbnail_path:string|null},bytes);result.added++;
   }catch(e){
    result.skipped++;result.failed++;log('drive_sync',codeOf(e));
    await remember(clientId,folder,file.drive_file_id,{outcome:'failed',failures:(memo.get(file.drive_file_id)?.failures??0)+1,error_code:codeOf(e)});
   }
  }
  // Curseur de reprise : avance jusqu'au dernier fichier examiné sans trou du parcours ; recommence à la fin du dossier.
  let next=after,completed=false;
  if(older){
   const first=older.files.findIndex(f=>!handled.has(f.drive_file_id));
   if(first===-1){next=older.complete?null:(older.last??after);completed=older.complete;}
   else{const p=older.files[first].modified_at;next=older.files.slice(0,first).map(f=>f.modified_at).filter(m=>m<p).pop()??after;}
  }
  const saved=await db().from('client_media_drive_sync').upsert({client_id:clientId,drive_folder_id:folder,backfill_after:next,last_synced_at:new Date().toISOString(),
   ...(completed?{backfill_completed_at:new Date().toISOString()}:{})},{onConflict:'client_id,drive_folder_id'});
  if(saved.error)log('drive_sync_state','not_recorded');
 }
 return result;
}
const SEEN_RETRY_MS=24*3600_000,MAX_SEEN_FAILURES=3;
// Mémoire d'un fichier Drive sans entrée propre dans la photothèque (doublon d'une photo connue, échec de lecture).
async function remember(clientId:string,folder:string,fileId:string,row:{outcome:'duplicate'|'failed';asset_id?:string;failures?:number;error_code?:string}){
 const {error}=await db().from('client_media_drive_files').upsert({client_id:clientId,drive_file_id:fileId,drive_folder_id:folder,outcome:row.outcome,asset_id:row.asset_id??null,
  failures:Math.min(row.failures??0,100),error_code:row.error_code??null,updated_at:new Date().toISOString()},{onConflict:'client_id,drive_file_id'});
 if(error)log('drive_sync_memo',error.code==='42P01'||error.code==='PGRST205'?'missing_table':'not_recorded');
}

/**
 * Synchronisation planifiée des dossiers Drive, indépendante de l'analyse IA : tous les clients dont un dossier est
 * autorisé (agent avec droits confirmés, association WhatsApp active avec droits confirmés), à tour de rôle (le moins récemment synchronisé d'abord), au plus
 * `perClient` nouvelles photos par client. Sans accès Drive Publications configuré, rien n'est fait.
 */
export async function runDriveSyncTick(maxClients=5,perClient=5,deps:{drive?:()=>MediaProvider;sync?:typeof syncDriveLibrary}={}):Promise<{clients:number;added:number}>{
 const [agents,senders]=await Promise.all([db().from('publication_agent_projects').select('client_id').eq('rights_confirmed',true).limit(500),
  db().from('whatsapp_senders').select('client_id').eq('rights_confirmed',true).eq('enabled',true).limit(500)]);
 if(agents.error)throw Error('library_unavailable');
 const clients=[...new Set([...(agents.data??[]),...(senders.error?[]:senders.data??[])].map(r=>r.client_id as string))];
 if(!clients.length)return {clients:0,added:0};
 let drive:MediaProvider;try{drive=(deps.drive??driveReadProvider)();}catch{log('tick_drive','drive_not_configured');return {clients:0,added:0};}
 const states=await db().from('client_media_drive_sync').select('client_id,last_synced_at').in('client_id',clients);
 const last=new Map<string,string>();for(const s of (states.error?[]:states.data??[]) as {client_id:string;last_synced_at:string|null}[])if(s.last_synced_at&&(!last.has(s.client_id)||s.last_synced_at>last.get(s.client_id)!))last.set(s.client_id,s.last_synced_at);
 // Dernière synchronisation du client (tous dossiers) : un ancien dossier retiré ne le garde pas éternellement en tête.
 const order=clients.sort((a,b)=>(last.get(a)??'').localeCompare(last.get(b)??'')||a.localeCompare(b)).slice(0,maxClients);
 const sync=deps.sync??syncDriveLibrary;let added=0;
 for(const clientId of order){try{added+=(await sync(clientId,perClient,{provider:drive})).added;}catch(e){log('tick_drive',codeOf(e));}}
 return {clients:order.length,added};
}

/**
 * Purge des médias rejetés par un humain après la conservation du client, si sa politique est « corbeille Drive » :
 * fichier importé par l'application mis à la corbeille (récupérable), miniature supprimée, légende effacée.
 * Une photo du dossier Drive du client (non créée par l'application) n'est jamais supprimée : seule sa référence l'est.
 */
export async function purgeRejectedMedia(limit=10):Promise<{purged:number;failed:number;skipped:number;trashFailed:number}>{
 const {data,error}=await db().rpc('whatsapp_rejected_purge_candidates',{p_limit:limit});
 if(error)throw Error('purge_unavailable');
 let purged=0,failed=0,skipped=0,trashFailed=0;let token:string|null=null;
 for(const c of (data??[]) as {asset_id:string;client_id:string;drive_file_id:string;drive_folder_id:string;origin:string;thumbnail_path:string|null}[]){
  try{
   // Marquage d'abord, sous le contrôle de la base (toujours rejeté par un humain) : un média repêché entre la
   // sélection et ce point n'est ni marqué ni mis à la corbeille.
   const appFile=c.origin!=='drive';
   const marked=await db().rpc('whatsapp_asset_mark_purged',{p_asset_id:c.asset_id,p_client_id:c.client_id,p_drive_trash_planned:appFile});
   if(marked.error)throw Error('Purge not recorded');
   if(marked.data!==true){skipped++;continue;}
   purged++;
   if(c.thumbnail_path?.startsWith(`${c.client_id}/`))await db().storage.from(THUMBNAIL_BUCKET).remove([c.thumbnail_path]);
   if(!appFile)continue;
   let outcome:'trashed'|'missing'|'failed'='failed';
   try{
    const {data:asset}=await db().from('whatsapp_assets').select('md5').eq('id',c.asset_id).eq('client_id',c.client_id).single();
    token??=await importDriveToken();
    outcome=asset?await trashDrive(token,c.drive_file_id,c.drive_folder_id,asset.md5):'missing';
   }catch(e){log('purge_trash',codeOf(e));}
   if(outcome==='failed')trashFailed++;
   const logged=await db().rpc('whatsapp_asset_purge_trash_logged',{p_asset_id:c.asset_id,p_client_id:c.client_id,p_outcome:outcome});
   if(logged.error)log('purge_trash','not_logged');
  }catch(e){failed++;log('purge',codeOf(e));}
 }
 return {purged,failed,skipped,trashFailed};
}

// Planificateur : synchronisation Drive de tous les clients autorisés (indépendante de l'analyse IA), puis, pour les
// clients qui ont activé le classement, à tour de rôle (le moins récemment traité d'abord), classement borné ; enfin
// purge éventuelle. Jamais de publication. Sans accès Drive configuré, seule la synchro est sautée.
export async function runMediaIntelligenceTick(maxClients=5,perClient=8,deps:{drive?:()=>MediaProvider;classify?:typeof classifyClientMedia;sync?:typeof syncDriveLibrary}={}){
 let synced=0;
 try{synced=(await runDriveSyncTick(maxClients,5,{drive:deps.drive,sync:deps.sync})).added;}catch(e){log('tick_drive',codeOf(e));}
 const {data,error}=await db().from('client_media_profiles').select('client_id').eq('ai_classification_enabled',true)
  .order('last_classified_at',{ascending:true,nullsFirst:true}).order('updated_at').limit(maxClients);
 if(error)throw Error('profile_unavailable');
 const classify=deps.classify??classifyClientMedia;
 const classified=[];
 for(const row of data??[]){
  try{classified.push(await classify(row.client_id,{limit:perClient,scheduled:true}));}
  catch(e){log('tick',codeOf(e));}
  finally{
   // Le client passe en fin de file même en cas d'erreur : un client en échec ne bloque jamais les suivants.
   const rotated=await db().from('client_media_profiles').update({last_classified_at:new Date().toISOString()}).eq('client_id',row.client_id);
   if(rotated.error)log('tick_rotation','not_recorded');
  }
 }
 let purge;try{purge=await purgeRejectedMedia();}catch(e){log('tick_purge',codeOf(e));purge={unavailable:true};}
 return {clients:classified.length,driveAdded:synced,analyzed:classified.reduce((n,r)=>n+r.analyzed,0),quarantined:classified.reduce((n,r)=>n+r.quarantined,0),purge};
}
