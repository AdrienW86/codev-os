import 'server-only';
// Agent Avis Google (étape « google_reviews » du planificateur) : toutes les 2 heures, pour chaque client dont la fiche
// Google Business Profile est connectée et l'agent actif, relève les avis, alerte tout de suite sur un avis de 3 étoiles
// ou moins (notification + incident), rédige une réponse dans le ton du client (budget IA du client, cadre de mission),
// publie les réponses validées et, si le client l'a choisi, les réponses aux avis positifs après le délai de relecture.
// Envoie aussi les demandes d'avis après chantier enregistrées par l'administrateur.
// Sans la migration 20261224010000 : rien ne tourne (étape « disabled », écran /avis l'indique).
import type {SupabaseClient} from '@supabase/supabase-js';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {writeAudit} from '@/lib/core/audit';
import type {Actor} from '@/lib/core/actor';
import {openIncident,resolveIncident} from '@/lib/agents/outputs';
import {withCharter} from '@/lib/harness/charter';
import {structuredResponse,withAiScope,isBudgetExceeded} from '@/lib/ai/metered';
import {agentsAiConfigured} from '@/lib/ai/models';
import {addressFromGuidelines,STYLE_GOOD_SCORE,styleFeedback} from '@/lib/copywriter/style';
import {clientBrandContext} from '@/lib/visual-agent/service';
import {googleOAuthConfig} from '@/lib/integrations/publications-oauth/config';
import {googleTransport} from '@/lib/integrations/publications-oauth/http';
import {gbpReviewsTransport,type GbpReviewsTransport} from '@/lib/integrations/gbp-reviews';
import {createGoogleBusinessProfileConnectionProvider} from '@/lib/publications/connections/google-business-profile';
import {productionOAuthDeps} from '@/lib/publications/oauth/service';
import {isCredentialReference,type CredentialVault,type ProviderCredential} from '@/lib/publications/connections/vault';
import {emailSendingStatus,sendEmail} from '@/lib/providers/email';
import {clientSender,senderFromRow} from '@/lib/emailing/sender';
import {isBlockedBy,normalizeEmail} from '@/lib/emailing/policy';
import {
 LOCATION_NAME,MAX_DRAFT_ATTEMPTS,REPLY_SCHEMA,REQUEST_COOLDOWN_DAYS,REQUEST_RETENTION_DAYS,autoPublishAt,isNegative,negativeSeverity,parseRequestForm,parseSettingsForm,planSync,
 readGbpReviews,readNewReviewUri,renderRequest,replyFailureLabels,replyInput,replyInstructions,requestSendAfter,reviewFingerprint,reviewLink,settingsFromRow,syncDue,validateReply,
 type ReplyContext,type ReviewSettings,type ReviewStatus,type StoredReview,
} from './model';

const ACTOR:Actor={kind:'system',worker:'google-reviews'};
const MAX_CLIENTS_PER_TICK=3,MAX_DRAFTS_PER_TICK=3,MAX_PUBLISH_PER_TICK=3,MAX_REQUESTS_PER_TICK=5;
const DRAFT_MS=45_000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const missingTable=(error:unknown)=>{const e=error as {code?:string;message?:string}|null;return e?.code==='42P01'||e?.code==='PGRST205'||/could not find the table|does not exist/i.test(e?.message??'');};
type Row=Record<string,unknown>;
type Outcome={ok:boolean;message:string};

export type ReviewsDeps={db:SupabaseClient;vault:CredentialVault|null;transport:GbpReviewsTransport|null;refresh:((credential:ProviderCredential)=>Promise<ProviderCredential>)|null};
export function productionReviewsDeps():ReviewsDeps{
 const google=googleOAuthConfig();const provider=google?createGoogleBusinessProfileConnectionProvider(googleTransport(google)):null;
 return {db:getSupabaseServerClient() as unknown as SupabaseClient,vault:productionOAuthDeps().vault,transport:google?gbpReviewsTransport():null,refresh:provider?credential=>provider.refresh(credential):null};
}
type Location={client_id:string;external_account_id:string;connection_id:string|null;display_name:string|null};
export type ReviewsSummary={disabled?:'migration'|'google'|'vault';synced:number;newReviews:number;negatives:number;drafted:number;draftFailed:number;published:number;publishFailed:number;requestsSent:number;requestsFailed:number;failed:number};

async function readSettings(db:SupabaseClient,clientIds:string[]):Promise<Map<string,ReviewSettings>>{
 const map=new Map<string,ReviewSettings>();if(!clientIds.length)return map;
 const {data,error}=await db.from('google_review_settings').select('*').in('client_id',clientIds);
 if(error)throw error;
 for(const row of (data??[]) as Row[])map.set(String(row.client_id),settingsFromRow(row));
 return map;
}
const settingsOf=(map:Map<string,ReviewSettings>,clientId:string)=>map.get(clientId)??settingsFromRow(null);

async function accessToken(db:SupabaseClient,deps:ReviewsDeps,connectionId:string,now:Date):Promise<string|null>{
 const connection=await db.from('client_connections').select('credential_reference,status').eq('id',connectionId).maybeSingle();
 const c=connection.data as {credential_reference?:unknown;status?:unknown}|null;
 if(connection.error||c?.status!=='active'||!isCredentialReference(c.credential_reference)||!deps.vault)return null;
 let credential=await deps.vault.readCredential(c.credential_reference,'google_business_profile');
 const expires=credential.expiresAt?Date.parse(credential.expiresAt):NaN;
 if(!(Number.isFinite(expires)&&expires>now.getTime()+60_000)){if(!deps.refresh||!credential.refreshToken)return null;credential=await deps.refresh(credential);}
 return credential.accessToken;
}

async function activeLocations(db:SupabaseClient,clientId?:string):Promise<Location[]>{
 let query=db.from('publication_accounts').select('client_id,external_account_id,connection_id,display_name').eq('platform','google_business_profile').eq('status','active').limit(500);
 if(clientId)query=query.eq('client_id',clientId);
 const {data,error}=await query;if(error)throw Error('accounts read');
 return ((data??[]) as Location[]).filter(row=>LOCATION_NAME.test(row.external_account_id)&&row.connection_id);
}

/** Notification « avis négatif » (cloche + push) et incident ouvert jusqu'à la réponse. */
async function alertNegative(db:SupabaseClient,clientId:string,review:{name:string;rating:number|null;reviewer:string|null},locationTitle:string|null):Promise<void>{
 const stars=review.rating??0;
 await openIncident(ACTOR,{clientId,source:'seo',severity:negativeSeverity(review.rating),fingerprint:reviewFingerprint(clientId,review.name),
  title:`Avis Google ${stars}★ à traiter${locationTitle?` (${locationTitle.slice(0,60)})`:''}`,details:{code:'negative_review',rating:review.rating,review:review.name,source:'Agent Avis Google',href:`/avis?client=${clientId}`}}).catch(()=>undefined);
 const notified=await db.from('admin_notifications').upsert({event_key:`negative-review:${review.name.split('/').pop()}`.slice(0,200),category:'negative_review',href:`/avis?client=${clientId}`},{onConflict:'event_key',ignoreDuplicates:true});
 if(!notified.error)await db.from('google_reviews').update({notified_at:new Date().toISOString()}).eq('review_name',review.name);
}

async function syncClient(db:SupabaseClient,deps:ReviewsDeps,clientId:string,locations:Location[],settings:ReviewSettings,now:Date,summary:ReviewsSummary):Promise<void>{
 let error:string|null=null;let detected=settings.detectedReviewUrl;
 for(const location of locations){
  try{
   const token=await accessToken(db,deps,location.connection_id!,now);
   if(!token){error='connexion Google expirée ou absente';continue;}
   const listed=await deps.transport!.request({kind:'list',location:location.external_account_id,token});
   const parsed=listed.status===200?readGbpReviews(listed.body):null;
   if(!parsed){error=listed.status===403?'accès refusé par Google (API ou droits de la fiche)':`lecture des avis impossible (${listed.status})`;continue;}
   const names=parsed.reviews.map(r=>r.name);
   const stored=names.length?await db.from('google_reviews').select('id,review_name,status,review_updated_at,rating,comment').in('review_name',names):{data:[],error:null};
   if(stored.error)throw Error('reviews read');
   const known=await db.from('google_reviews').select('id').eq('location_name',location.external_account_id).limit(1);
   if(known.error)throw Error('reviews read');
   const plan=planSync(parsed.reviews,(stored.data??[]) as StoredReview[],now,(known.data??[]).length===0);
   if(plan.inserts.length){
    const rows=plan.inserts.map(({review,status})=>({client_id:clientId,location_name:location.external_account_id,review_name:review.name,reviewer:review.reviewer,rating:review.rating,comment:review.comment,
     review_created_at:review.createdAt,review_updated_at:review.updatedAt,status,existing_reply:review.reply}));
    const inserted=await db.from('google_reviews').upsert(rows,{onConflict:'review_name',ignoreDuplicates:true});
    if(inserted.error)throw Error('reviews write');
    summary.newReviews+=plan.inserts.length;
   }
   for(const update of plan.updates)await db.from('google_reviews').update({...update.patch,updated_at:now.toISOString()}).eq('id',update.id);
   for(const review of plan.negatives){summary.negatives++;await alertNegative(db,clientId,review,location.display_name);}
   for(const name of plan.answered)await resolveIncident(ACTOR,reviewFingerprint(clientId,name)).catch(()=>0);
   if(!detected){const meta=await deps.transport!.request({kind:'metadata',location:location.external_account_id,token}).catch(()=>null);detected=meta?.status===200?readNewReviewUri(meta.body):null;}
  }catch{error='relevé interrompu';}
 }
 await db.from('google_review_settings').upsert({client_id:clientId,last_sync_at:now.toISOString(),last_sync_error:error,...(detected&&detected!==settings.detectedReviewUrl?{detected_review_url:detected}:{})},{onConflict:'client_id'});
 if(error)summary.failed++;else summary.synced++;
}

/** Contexte de rédaction : faits confirmés, ton et interdits du client (mémoire client), réglages de l'agent. */
async function replyContext(clientId:string,settings:ReviewSettings,review:{reviewer:string|null;rating:number|null;comment:string|null}):Promise<ReplyContext>{
 const brand=await clientBrandContext(clientId,'reviews');
 const tone=[settings.toneNotes,brand.guidelines].filter(Boolean).join('\n');
 return {business:{name:brand.client.name,activity:brand.client.activity,zone:brand.client.zone,facts:brand.facts,tone,signature:settings.signature},review,exclusions:brand.exclusions,address:addressFromGuidelines(tone)};
}

type DraftRow={id:string;client_id:string;rating:number|null;comment:string|null;reviewer:string|null;draft_attempts:number};
/** Rédige une réponse (deux essais au plus, le second avec le motif du refus). Aucun envoi. */
async function draftOne(db:SupabaseClient,row:DraftRow,settings:ReviewSettings,now:Date):Promise<'drafted'|'failed'>{
 let ctx:ReplyContext;
 try{ctx=await replyContext(row.client_id,settings,{reviewer:row.reviewer,rating:row.rating,comment:row.comment});}
 catch{return markDraftFailure(db,row,'empty_review_context');}
 let feedback='';let lastReason='ai_unavailable';let best:{reply:string;score:number;issues:unknown[]}|null=null;
 for(let attempt=0;attempt<2;attempt++){
  try{
   const result=await withAiScope({agent:'reviews',clientId:row.client_id},()=>structuredResponse(withCharter('reviews',replyInstructions(ctx.address,isNegative(row.rating))),
    feedback?`${replyInput(ctx)}\n\nPREMIER ESSAI REFUSÉ, à corriger : ${feedback}`:replyInput(ctx),REPLY_SCHEMA,{maxOutputTokens:700,timeoutMs:DRAFT_MS,agent:'reviews',clientId:row.client_id}));
   const verdict=validateReply(result.value as Row,ctx);
   if(!verdict.ok){lastReason=verdict.reason;if(verdict.reason==='refused')break;feedback=`${replyFailureLabels[verdict.reason]??verdict.reason}${verdict.detail?` (${verdict.detail})`:''}`;continue;}
   best={reply:verdict.reply,score:verdict.audit.score,issues:verdict.audit.issues};
   if(verdict.audit.score>=STYLE_GOOD_SCORE)break;
   feedback=styleFeedback(verdict.audit);
  }catch(error){lastReason=isBudgetExceeded(error)?'ai_budget_exceeded':'ai_unavailable';if(lastReason==='ai_budget_exceeded')break;}
 }
 if(!best)return markDraftFailure(db,row,lastReason);
 const draftedAt=now;
 await db.from('google_reviews').update({status:'draft',draft:best.reply,draft_score:best.score,draft_issues:best.issues,draft_at:draftedAt.toISOString(),draft_attempts:(row.draft_attempts??0)+1,
  auto_publish_at:autoPublishAt(settings,row.rating,draftedAt),last_error:null,updated_at:now.toISOString()}).eq('id',row.id).eq('status','to_draft');
 return 'drafted';
}
async function markDraftFailure(db:SupabaseClient,row:DraftRow,reason:string):Promise<'failed'>{
 const attempts=(row.draft_attempts??0)+1;
 // Refus motivé ou essais épuisés : l'avis passe « à traiter » (l'administrateur rédige lui-même ou relance).
 const final=reason==='refused'||attempts>=MAX_DRAFT_ATTEMPTS;
 await db.from('google_reviews').update({status:final?'failed':'to_draft',draft_attempts:attempts,last_error:(replyFailureLabels[reason]??reason).slice(0,200),updated_at:new Date().toISOString()}).eq('id',row.id).eq('status','to_draft');
 return 'failed';
}

/** Publie une réponse sur la fiche Google (après validation ou par la règle des avis positifs). */
async function publishReply(db:SupabaseClient,deps:ReviewsDeps,id:string,text:string,by:string,now:Date):Promise<Outcome>{
 const {data,error}=await db.from('google_reviews').select('id,client_id,review_name,location_name,rating,status').eq('id',id).maybeSingle();
 const row=data as {id:string;client_id:string;review_name:string;location_name:string;rating:number|null;status:ReviewStatus}|null;
 if(error||!row)return {ok:false,message:'Avis introuvable.'};
 if(!['draft','failed','to_draft','skipped'].includes(row.status))return {ok:false,message:'Cet avis a déjà une réponse.'};
 if(by==='auto'&&(row.status!=='draft'||isNegative(row.rating)))return {ok:false,message:'Publication automatique refusée.'};
 if(!deps.transport||!deps.vault)return {ok:false,message:'Connexion Google non configurée.'};
 const reply=text.replace(/\r/g,'').trim().slice(0,4096);
 if(reply.length<2)return {ok:false,message:'Réponse vide.'};
 // Réservation : un seul envoi par avis, même en cas de double clic ou de passage concurrent du planificateur.
 const claimed=await db.from('google_reviews').update({status:'publishing',updated_at:now.toISOString()}).eq('id',id).eq('status',row.status).select('id');
 if(claimed.error||!claimed.data?.length)return {ok:false,message:'Publication déjà en cours.'};
 const account=await db.from('publication_accounts').select('connection_id').eq('platform','google_business_profile').eq('status','active').eq('external_account_id',row.location_name).eq('client_id',row.client_id).limit(1);
 const connectionId=(account.data?.[0] as {connection_id?:string|null}|undefined)?.connection_id??null;
 const fail=async(message:string)=>{await db.from('google_reviews').update({status:'failed',last_error:message.slice(0,200),auto_publish_at:null,updated_at:new Date().toISOString()}).eq('id',id).eq('status','publishing');return {ok:false,message};};
 let token:string|null=null;
 try{token=connectionId?await accessToken(db,deps,connectionId,now):null;}catch{token=null;}
 if(!token)return fail('Fiche Google non connectée ou connexion expirée : reconnectez Google Business Profile.');
 let response:{status:number;body:unknown};
 try{response=await deps.transport.request({kind:'reply',review:row.review_name,comment:reply,token});}
 catch{return fail('Google ne répond pas : la réponse n’a peut-être pas été publiée, vérifiez la fiche avant de réessayer.');}
 if(response.status!==200)return fail(response.status===403?'Google refuse la réponse (droits sur la fiche).':response.status===404?'Avis supprimé sur Google.':`Google a refusé la réponse (${response.status}).`);
 await db.from('google_reviews').update({status:'published',published_reply:reply,published_at:now.toISOString(),published_by:by,auto_publish_at:null,last_error:null,
  ...(by!=='auto'?{decided_by:by,decided_at:now.toISOString()}:{}),updated_at:now.toISOString()}).eq('id',id);
 await resolveIncident(ACTOR,reviewFingerprint(row.client_id,row.review_name)).catch(()=>0);
 await writeAudit(by==='auto'?ACTOR:{kind:'admin',userId:by},{action:'google_reviews.reply_published',resource_type:'client',resource_id:row.client_id,metadata:{review:row.review_name.split('/').pop(),rating:row.rating,automatic:by==='auto'}}).catch(()=>undefined);
 return {ok:true,message:'Réponse publiée sur la fiche Google.'};
}

type RequestRow={id:string;client_id:string;customer_name:string;email:string|null;service:string|null};
async function sendRequest(db:SupabaseClient,row:RequestRow,settings:ReviewSettings):Promise<'sent'|'failed'|'suppressed'>{
 const at=new Date().toISOString();
 const fail=async(reason:string,status:'failed'|'suppressed'='failed')=>{await db.from('google_review_requests').update({status,last_error:reason.slice(0,200)}).eq('id',row.id).eq('status','scheduled');return status;};
 const email=normalizeEmail(row.email);const link=reviewLink(settings);
 if(!email)return fail('Adresse absente.');
 if(!link)return fail('Lien vers la fiche Google inconnu : renseignez-le dans les réglages de l’Agent Avis.');
 const blocked=await db.from('email_suppressions').select('scope,client_id').eq('email_normalized',email).limit(20);
 if(blocked.error)return fail('Liste d’exclusion illisible.');
 if(isBlockedBy((blocked.data??[]) as {scope:string;client_id:string|null}[],{scope:'client',clientId:row.client_id}))return fail('Adresse exclue (désinscription ou rebond).','suppressed');
 const [client,senderRow]=await Promise.all([db.from('clients').select('name,company_name').eq('id',row.client_id).maybeSingle(),
  db.from('client_email_settings').select('sending_domain,from_name,from_local_part,reply_to,domain_status').eq('client_id',row.client_id).maybeSingle()]);
 const c=client.data as {name?:string;company_name?:string|null}|null;
 const sender=clientSender(senderRow.error?null:senderFromRow(senderRow.data as Row|null));
 const message=renderRequest(settings,{prenom:row.customer_name,prestation:row.service,entreprise:c?.company_name||c?.name||'',lien:link});
 try{
  const result=await sendEmail({to:email,subject:message.subject,text:message.text,idempotencyKey:`review-request:${row.id}`,...(sender?{from:sender.from,replyTo:sender.replyTo}:{})});
  await db.from('google_review_requests').update({status:'sent',sent_at:at,provider_message_id:String(result.id??'').slice(0,200)||null,last_error:null}).eq('id',row.id);
  return 'sent';
 }catch{return fail('Envoi refusé par le fournisseur d’e-mail.');}
}

// options.clientId : lancement manuel pour ce client, relevé immédiat sans attendre l'échéance de 2 heures.
export async function runGoogleReviewsTick(now=new Date(),deps:ReviewsDeps=productionReviewsDeps(),options:{clientId?:string;deadline?:number}={}):Promise<ReviewsSummary>{
 const summary:ReviewsSummary={synced:0,newReviews:0,negatives:0,drafted:0,draftFailed:0,published:0,publishFailed:0,requestsSent:0,requestsFailed:0,failed:0};
 const deadline=options.deadline??Date.now()+120_000;
 const probe=await deps.db.from('google_review_settings').select('client_id').limit(1);
 if(probe.error){if(missingTable(probe.error))return {...summary,disabled:'migration'};throw Error('reviews settings read');}
 const locations=options.clientId&&!UUID.test(options.clientId)?[]:await activeLocations(deps.db,options.clientId);
 const byClient=new Map<string,Location[]>();for(const l of locations)byClient.set(l.client_id,[...(byClient.get(l.client_id)??[]),l]);
 const settings=await readSettings(deps.db,[...new Set([...byClient.keys(),...(options.clientId?[options.clientId]:[])])]);

 // 1. Relevé des avis (fiches connectées, agent actif pour le client, échéance de 2 heures sauf lancement manuel).
 if(deps.transport&&deps.vault){
  const due=[...byClient.keys()].filter(id=>settingsOf(settings,id).enabled&&(options.clientId||syncDue(settingsOf(settings,id),now)))
   .sort((a,b)=>(settingsOf(settings,a).lastSyncAt??'').localeCompare(settingsOf(settings,b).lastSyncAt??''));
  for(const clientId of due.slice(0,MAX_CLIENTS_PER_TICK)){if(deadline-Date.now()<30_000)break;await syncClient(deps.db,deps,clientId,byClient.get(clientId)!,settingsOf(settings,clientId),now,summary);}
 }

 // 2. Brouillons de réponse (les avis négatifs d'abord, puis les plus anciens).
 if(agentsAiConfigured()){
  let query=deps.db.from('google_reviews').select('id,client_id,rating,comment,reviewer,draft_attempts').eq('status','to_draft').order('rating',{ascending:true,nullsFirst:false}).order('first_seen_at',{ascending:true}).limit(MAX_DRAFTS_PER_TICK*3);
  if(options.clientId)query=query.eq('client_id',options.clientId);
  const pending=await query;
  if(!pending.error){
   const rows=(pending.data??[]) as DraftRow[];
   const draftSettings=await readSettings(deps.db,[...new Set(rows.map(r=>r.client_id))]);
   for(const row of rows.filter(r=>settingsOf(draftSettings,r.client_id).enabled).slice(0,MAX_DRAFTS_PER_TICK)){
    if(deadline-Date.now()<DRAFT_MS*2+5_000)break;
    if(await draftOne(deps.db,row,settingsOf(draftSettings,row.client_id),now)==='drafted')summary.drafted++;else summary.draftFailed++;
   }
  }
 }

 // 3. Publication automatique des réponses aux avis positifs (règle du client, après le délai de relecture).
 const autoRows=await deps.db.from('google_reviews').select('id,client_id,draft,rating').eq('status','draft').not('auto_publish_at','is',null).lte('auto_publish_at',now.toISOString()).limit(MAX_PUBLISH_PER_TICK);
 if(!autoRows.error){
  const rows=(autoRows.data??[]) as {id:string;client_id:string;draft:string|null;rating:number|null}[];
  const autoSettings=await readSettings(deps.db,[...new Set(rows.map(r=>r.client_id))]);
  for(const row of rows){
   const s=settingsOf(autoSettings,row.client_id);
   // Règle retirée depuis la rédaction, ou seuil relevé : la réponse reste à valider.
   if(!s.enabled||!row.draft||!autoPublishAt(s,row.rating,now)){await deps.db.from('google_reviews').update({auto_publish_at:null}).eq('id',row.id).eq('status','draft');continue;}
   const r=await publishReply(deps.db,deps,row.id,row.draft,'auto',now);
   if(r.ok)summary.published++;else summary.publishFailed++;
  }
 }

 // 4. Demandes d'avis arrivées à échéance (heures de bureau : 9 h - 19 h, Paris).
 const hour=Number(new Intl.DateTimeFormat('en-GB',{hour:'numeric',hourCycle:'h23',timeZone:'Europe/Paris'}).formatToParts(now).find(p=>p.type==='hour')?.value);
 if(emailSendingStatus().enabled&&hour>=9&&hour<19){
  let query=deps.db.from('google_review_requests').select('id,client_id,customer_name,email,service').eq('status','scheduled').lte('send_after',now.toISOString()).order('send_after',{ascending:true}).limit(MAX_REQUESTS_PER_TICK);
  if(options.clientId)query=query.eq('client_id',options.clientId);
  const due=await query;
  if(!due.error){
   const rows=(due.data??[]) as RequestRow[];
   const requestSettings=await readSettings(deps.db,[...new Set(rows.map(r=>r.client_id))]);
   for(const row of rows){if(deadline-Date.now()<10_000)break;const r=await sendRequest(deps.db,row,settingsOf(requestSettings,row.client_id));if(r==='sent')summary.requestsSent++;else summary.requestsFailed++;}
  }
 }

 // 5. Conservation : coordonnées des demandes effacées 90 jours après envoi, échec ou annulation.
 const cutoff=new Date(now.getTime()-REQUEST_RETENTION_DAYS*86_400_000).toISOString();
 await deps.db.from('google_review_requests').update({email:null,customer_name:'Client',purged_at:now.toISOString()}).in('status',['sent','failed','cancelled','suppressed']).is('purged_at',null).lt('created_at',cutoff);
 return summary;
}

// --- Écran /avis (administrateur) --------------------------------------------------------------------------------
export type ReviewRow={id:string;location_name:string;reviewer:string|null;rating:number|null;comment:string|null;review_created_at:string;status:ReviewStatus;draft:string|null;draft_score:number|null;
 auto_publish_at:string|null;existing_reply:string|null;published_reply:string|null;published_at:string|null;published_by:string|null;last_error:string|null};
export type RequestView={id:string;customer_name:string;email:string|null;service:string|null;job_date:string;send_after:string;status:string;sent_at:string|null;last_error:string|null};
export type ReviewsView={ready:boolean;settings:ReviewSettings;locations:{name:string;title:string|null}[];reviews:ReviewRow[];requests:RequestView[];stats:{total:number;average:number|null;toValidate:number;negativeOpen:number};sending:{enabled:boolean;reason:string|null};ai:boolean};

export async function getReviewsView(clientId:string):Promise<ReviewsView>{
 if(!UUID.test(clientId))throw Error('invalid client');
 const db=getSupabaseServerClient() as unknown as SupabaseClient;
 const sending=emailSendingStatus();
 const [settingsRow,reviews,requests,locations]=await Promise.all([
  db.from('google_review_settings').select('*').eq('client_id',clientId).maybeSingle(),
  db.from('google_reviews').select('id,location_name,reviewer,rating,comment,review_created_at,status,draft,draft_score,auto_publish_at,existing_reply,published_reply,published_at,published_by,last_error').eq('client_id',clientId).order('review_created_at',{ascending:false}).limit(200),
  db.from('google_review_requests').select('id,customer_name,email,service,job_date,send_after,status,sent_at,last_error').eq('client_id',clientId).order('created_at',{ascending:false}).limit(50),
  activeLocations(db,clientId).catch(()=>[] as Location[]),
 ]);
 const base={settings:settingsFromRow(null),locations:locations.map(l=>({name:l.external_account_id,title:l.display_name})),reviews:[],requests:[],stats:{total:0,average:null,toValidate:0,negativeOpen:0},sending:{enabled:sending.enabled,reason:sending.enabled?null:sending.reason},ai:agentsAiConfigured()};
 if(settingsRow.error||reviews.error||requests.error){if([settingsRow.error,reviews.error,requests.error].some(missingTable))return {...base,ready:false};throw Error('reviews read');}
 const rows=(reviews.data??[]) as ReviewRow[];
 const rated=rows.filter(r=>r.rating!==null);
 const open=(r:ReviewRow)=>['to_draft','draft','failed','publishing'].includes(r.status);
 return {...base,ready:true,settings:settingsFromRow(settingsRow.data as Row|null),reviews:rows,requests:(requests.data??[]) as RequestView[],
  stats:{total:rows.length,average:rated.length?Math.round(rated.reduce((s,r)=>s+(r.rating??0),0)/rated.length*10)/10:null,toValidate:rows.filter(r=>r.status==='draft').length,negativeOpen:rows.filter(r=>open(r)&&isNegative(r.rating)).length}};
}

async function ownedReview(db:SupabaseClient,clientId:string,id:string){
 if(!UUID.test(clientId)||!UUID.test(id))return null;
 const {data}=await db.from('google_reviews').select('id,client_id,status,review_name').eq('id',id).eq('client_id',clientId).maybeSingle();
 return data as {id:string;client_id:string;status:ReviewStatus;review_name:string}|null;
}

/** « Publier » : la réponse affichée (éventuellement modifiée par l'administrateur) part sur la fiche Google. */
export async function publishReviewReply(actor:Actor&{kind:'admin'},clientId:string,id:string,text:string):Promise<Outcome>{
 const deps=productionReviewsDeps();
 const row=await ownedReview(deps.db,clientId,id);if(!row)return {ok:false,message:'Avis introuvable.'};
 return publishReply(deps.db,deps,id,text,actor.userId,new Date());
}
export async function saveReviewDraft(actor:Actor&{kind:'admin'},clientId:string,id:string,text:string):Promise<Outcome>{
 const db=getSupabaseServerClient() as unknown as SupabaseClient;
 const row=await ownedReview(db,clientId,id);if(!row)return {ok:false,message:'Avis introuvable.'};
 const draft=text.replace(/\r/g,'').trim().slice(0,4096);if(!draft)return {ok:false,message:'Réponse vide.'};
 // Une réponse modifiée à la main n'est jamais publiée automatiquement : elle attend « Publier ».
 const {error}=await db.from('google_reviews').update({draft,status:'draft',auto_publish_at:null,last_error:null,updated_at:new Date().toISOString()}).eq('id',id).in('status',['draft','failed','to_draft','skipped']);
 return error?{ok:false,message:'Enregistrement impossible.'}:{ok:true,message:'Réponse enregistrée (publication automatique annulée pour cet avis).'};
}
export async function skipReview(actor:Actor&{kind:'admin'},clientId:string,id:string):Promise<Outcome>{
 const db=getSupabaseServerClient() as unknown as SupabaseClient;
 const row=await ownedReview(db,clientId,id);if(!row)return {ok:false,message:'Avis introuvable.'};
 const {error}=await db.from('google_reviews').update({status:'skipped',auto_publish_at:null,decided_by:actor.userId,decided_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',id).in('status',['draft','failed','to_draft']);
 if(!error)await resolveIncident(actor,reviewFingerprint(clientId,row.review_name)).catch(()=>0);
 return error?{ok:false,message:'Action impossible.'}:{ok:true,message:'Avis laissé sans réponse.'};
}
/** Nouveau brouillon (avis ignoré, ancien, en échec ou brouillon à refaire) : rédigé au prochain passage ou tout de suite. */
export async function redraftReview(actor:Actor&{kind:'admin'},clientId:string,id:string):Promise<Outcome>{
 const db=getSupabaseServerClient() as unknown as SupabaseClient;
 const row=await ownedReview(db,clientId,id);if(!row)return {ok:false,message:'Avis introuvable.'};
 const {error}=await db.from('google_reviews').update({status:'to_draft',draft:null,draft_attempts:0,auto_publish_at:null,last_error:null,updated_at:new Date().toISOString()}).eq('id',id).in('status',['draft','failed','skipped']);
 if(error)return {ok:false,message:'Action impossible.'};
 const r=await runGoogleReviewsTick(new Date(),productionReviewsDeps(),{clientId,deadline:Date.now()+100_000}).catch(()=>null);
 return {ok:true,message:r&&r.drafted?'Nouvelle réponse rédigée.':'Nouvelle réponse demandée : elle sera rédigée au prochain passage.'};
}
export async function saveReviewSettings(actor:Actor&{kind:'admin'},clientId:string,form:FormData):Promise<Outcome>{
 if(!UUID.test(clientId))return {ok:false,message:'Client invalide.'};
 const parsed=parseSettingsForm(form);if(!parsed.ok)return parsed;
 const db=getSupabaseServerClient() as unknown as SupabaseClient;
 const {error}=await db.from('google_review_settings').upsert({client_id:clientId,...parsed.payload,updated_by:actor.userId,updated_at:new Date().toISOString()},{onConflict:'client_id'});
 if(error)return {ok:false,message:'Enregistrement impossible.'};
 // Seuil retiré ou relevé : les publications automatiques en attente qui ne le respectent plus sont annulées au prochain passage.
 await writeAudit(actor,{action:'google_reviews.settings_saved',resource_type:'client',resource_id:clientId,metadata:{auto_publish_min_rating:parsed.payload.auto_publish_min_rating,enabled:parsed.payload.enabled}}).catch(()=>undefined);
 return {ok:true,message:'Réglages de l’Agent Avis enregistrés.'};
}
/** Chantier terminé : la demande d'avis part par e-mail à l'échéance (jour du chantier + délai réglé, heures de bureau). */
export async function createReviewRequest(actor:Actor&{kind:'admin'},clientId:string,form:FormData):Promise<Outcome>{
 if(!UUID.test(clientId))return {ok:false,message:'Client invalide.'};
 const now=new Date();const parsed=parseRequestForm(form,now);if(!parsed.ok)return parsed;
 const db=getSupabaseServerClient() as unknown as SupabaseClient;
 const settingsRow=await db.from('google_review_settings').select('*').eq('client_id',clientId).maybeSingle();
 if(settingsRow.error)return {ok:false,message:missingTable(settingsRow.error)?'Migration 20261224010000 à appliquer.':'Lecture impossible.'};
 const settings=settingsFromRow(settingsRow.data as Row|null);
 if(!reviewLink(settings))return {ok:false,message:'Renseignez d’abord le lien vers la fiche Google (réglages ci-dessous) ou lancez un relevé pour le détecter.'};
 const since=new Date(now.getTime()-REQUEST_COOLDOWN_DAYS*86_400_000).toISOString();
 const recent=await db.from('google_review_requests').select('id').eq('client_id',clientId).eq('email',parsed.value.email).neq('status','cancelled').gte('created_at',since).limit(1);
 if(recent.error)return {ok:false,message:'Lecture impossible.'};
 if(recent.data?.length)return {ok:false,message:`Une demande a déjà été faite à cette adresse ces ${REQUEST_COOLDOWN_DAYS} derniers jours.`};
 const sendAfter=requestSendAfter(parsed.value.jobDate,settings.requestDelayDays,now);
 const {error}=await db.from('google_review_requests').insert({client_id:clientId,customer_name:parsed.value.customerName,email:parsed.value.email,service:parsed.value.service,job_date:parsed.value.jobDate,send_after:sendAfter,created_by:actor.userId});
 if(error)return {ok:false,message:'Enregistrement impossible.'};
 await writeAudit(actor,{action:'google_reviews.request_scheduled',resource_type:'client',resource_id:clientId,metadata:{send_after:sendAfter}}).catch(()=>undefined);
 return {ok:true,message:`Demande d’avis programmée le ${new Date(sendAfter).toLocaleString('fr-FR',{timeZone:'Europe/Paris',dateStyle:'short',timeStyle:'short'})}.`};
}
export async function cancelReviewRequest(actor:Actor&{kind:'admin'},clientId:string,id:string):Promise<Outcome>{
 if(!UUID.test(clientId)||!UUID.test(id))return {ok:false,message:'Demande introuvable.'};
 const db=getSupabaseServerClient() as unknown as SupabaseClient;
 const {data,error}=await db.from('google_review_requests').update({status:'cancelled'}).eq('id',id).eq('client_id',clientId).eq('status','scheduled').select('id');
 return error||!data?.length?{ok:false,message:'Demande déjà envoyée ou introuvable.'}:{ok:true,message:'Demande annulée.'};
}
