import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {tiktokOAuthConfig} from '@/lib/integrations/publications-oauth/config';
import {tiktokTransport} from '@/lib/integrations/publications-oauth/http';
import {tiktokPublishTransport} from '@/lib/integrations/publications-tiktok-publish';
import {createTikTokConnectionProvider} from './connections/tiktok';
import {isCredentialReference} from './connections/vault';
import {productionOAuthDeps} from './oauth/service';
import {isPublicationUuid} from './validation';
import {isTikTokPrivacy,type TikTokCreatorInfo,type TikTokSettings} from './tiktok-settings';

// Informations du créateur TikTok lues au moment où l'écran de validation s'affiche (exigence TikTok) : nom du compte
// qui publiera, niveaux de confidentialité autorisés, commentaires désactivés par le créateur. Lecture seule ; le
// jeton est lu dans le coffre et, s'il expire, rafraîchi en mémoire (jamais réécrit ici). Messages génériques.
const unavailable='Compte TikTok indisponible : vérifiez la connexion TikTok du client.';
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const text=(v:unknown,max=200):string|null=>typeof v==='string'&&v.trim().length>=1&&v.length<=max?v.trim():null;
export async function loadTikTokCreatorInfo(publicationId:unknown):Promise<{ok:true;info:TikTokCreatorInfo}|{ok:false;message:string}>{
 await requireAdmin();if(!isPublicationUuid(publicationId))return {ok:false,message:'Publication invalide.'};
 const config=tiktokOAuthConfig();if(!config)return {ok:false,message:'TikTok n’est pas configuré sur le serveur.'};
 const db=getSupabaseServerClient();
 try{
  const pub=await db.from('publications').select('project_id,platform').eq('id',publicationId).maybeSingle();
  const p=pub.data as {project_id:string|null;platform:string|null}|null;
  if(pub.error||!p?.project_id||p.platform!=='tiktok')return {ok:false,message:'Cette publication n’est pas une publication TikTok.'};
  const ch=await db.from('publication_project_channels').select('publication_account_id').eq('project_id',p.project_id).eq('platform','tiktok').maybeSingle();
  const accountId=(ch.data as {publication_account_id:string|null}|null)?.publication_account_id;
  if(ch.error||!accountId)return {ok:false,message:'Aucun compte TikTok affecté au canal : connectez TikTok puis choisissez le compte.'};
  const acc=await db.from('publication_accounts').select('connection_id,status,enabled').eq('id',accountId).maybeSingle();
  const a=acc.data as {connection_id:string|null;status:string;enabled:boolean}|null;
  if(acc.error||!a?.connection_id||a.status!=='active'||!a.enabled)return {ok:false,message:unavailable};
  const conn=await db.from('client_connections').select('credential_reference,status').eq('id',a.connection_id).maybeSingle();
  const c=conn.data as {credential_reference:string|null;status:string}|null;
  if(conn.error||c?.status!=='active'||!isCredentialReference(c.credential_reference))return {ok:false,message:unavailable};
  const vault=productionOAuthDeps().vault;if(!vault)return {ok:false,message:unavailable};
  let credential=await vault.readCredential(c.credential_reference,'tiktok');
  const expires=credential.expiresAt?Date.parse(credential.expiresAt):NaN;
  if(!(Number.isFinite(expires)&&expires>Date.now()+120_000))credential=await createTikTokConnectionProvider(tiktokTransport(config)).refresh(credential);
  const r=await tiktokPublishTransport().request({path:'post/publish/creator_info/query',body:{},token:credential.accessToken});
  const body=record(r.body),code=String(record(body.error).code??'ok');
  if(code.startsWith('spam_risk')||code==='reached_active_user_cap')return {ok:false,message:'TikTok n’autorise pas ce compte à publier pour le moment. Réessayez plus tard.'};
  if(r.status!==200||code!=='ok')return {ok:false,message:unavailable};
  const data=record(body.data);
  const options=(Array.isArray(data.privacy_level_options)?data.privacy_level_options:[]).filter(isTikTokPrivacy);
  if(!options.length)return {ok:false,message:unavailable};
  return {ok:true,info:{nickname:text(data.creator_nickname)??text(data.creator_username)??'Compte TikTok',username:text(data.creator_username),
   avatarUrl:typeof data.creator_avatar_url==='string'&&/^https:\/\//.test(data.creator_avatar_url)?data.creator_avatar_url:null,privacyOptions:options,commentDisabled:data.comment_disabled===true}};
 }catch{console.error('[publications-tiktok]',{step:'creator_info'});return {ok:false,message:unavailable};}
}
/** Enregistre les réglages TikTok de la révision validée (avant l'approbation, même humain). */
export async function saveTikTokSettings(publicationId:string,revisionId:string,settings:TikTokSettings,userId:string):Promise<string|null>{
 const {error}=await getSupabaseServerClient().rpc('publication_tiktok_settings_save',{p_publication_id:publicationId,p_revision_id:revisionId,p_privacy_level:settings.privacyLevel,
  p_allow_comment:settings.allowComment,p_brand_organic:settings.brandOrganic,p_brand_content:settings.brandContent,p_actor_id:userId});
 if(!error)return null;
 return error.code==='55000'?'Révision périmée. Rechargez la publication.':'Réglages TikTok non enregistrés. Réessayez.';
}
