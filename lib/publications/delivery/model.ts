// Delivery engine (Lot 4.3 P10): statuses, transitions, retry policy, error classes and display. Pure and
// client-safe. Mirrors the SQL rules of 20261010000000_publications_delivery_engine.sql (kept in sync by tests).
import {platformLabels} from '../editor';
import {PUBLISHABILITY_LABELS,type ChannelPublishability} from '../connections/model';
import type {PublicationPlatform} from '../types';

export const DELIVERY_STATUSES=['scheduled','processing','published','simulated','retryable_error','uncertain','blocked','cancelled','failed'] as const;
export type DeliveryStatus=typeof DELIVERY_STATUSES[number];
// Legal transitions (same table as publications_private.guard_delivery_transition). published / simulated / cancelled are final.
export const DELIVERY_TRANSITIONS:Readonly<Record<DeliveryStatus,readonly DeliveryStatus[]>>={
 scheduled:['processing','blocked','cancelled'],processing:['published','simulated','retryable_error','failed','uncertain','blocked'],
 retryable_error:['processing','scheduled','blocked','cancelled','failed'],blocked:['scheduled','cancelled'],failed:['scheduled','blocked','cancelled'],
 uncertain:['published','failed','cancelled'],published:[],simulated:[],cancelled:[]};
export function canTransition(from:DeliveryStatus,to:DeliveryStatus):boolean{return from===to||DELIVERY_TRANSITIONS[from].includes(to);}
export const DELIVERY_STATUS_LABELS:Record<DeliveryStatus,string>={scheduled:'Planifiée',processing:'En cours',published:'Publiée',simulated:'Diffusion simulée',
 retryable_error:'Nouvelle tentative prévue',uncertain:'Résultat incertain (à vérifier)',blocked:'Bloquée',cancelled:'Annulée',failed:'Échec'};

// Normalized failure classes. Only a class and a short safe code are ever stored — never provider text.
export const ERROR_CLASSES=['retryable','permanent','auth','rate_limit','invalid_payload','provider_unavailable'] as const;
export type DeliveryErrorClass=typeof ERROR_CLASSES[number];
export const RETRYABLE_CLASSES:readonly DeliveryErrorClass[]=['retryable','rate_limit','provider_unavailable'];
export const ERROR_CLASS_LABELS:Record<DeliveryErrorClass,string>={retryable:'Erreur temporaire',permanent:'Erreur définitive',auth:'Autorisation refusée ou révoquée',
 rate_limit:'Limite de débit du fournisseur',invalid_payload:'Contenu refusé par le fournisseur',provider_unavailable:'Fournisseur indisponible'};
export function safeErrorCode(value:unknown):string|null{return typeof value==='string'&&/^[a-z0-9_.-]{1,80}$/.test(value)?value:null;}

// Deterministic backoff after attempt n (no jitter): 1 min, 5 min, 15 min, 1 h, then 6 h. 5 attempts per job.
export const RETRY_SCHEDULE_SECONDS=[60,300,900,3600,21600] as const;
export const MAX_DELIVERY_ATTEMPTS=5;
export function retryDelaySeconds(attempt:number):number{return RETRY_SCHEDULE_SECONDS[Math.min(Math.max(Math.trunc(attempt),1),RETRY_SCHEDULE_SECONDS.length)-1];}
export function nextRetryDelaySeconds(attempt:number,errorClass:DeliveryErrorClass,retryAfterSeconds?:number|null):number|null{
 if(!RETRYABLE_CLASSES.includes(errorClass)||attempt>=MAX_DELIVERY_ATTEMPTS)return null;
 const base=retryDelaySeconds(attempt);
 return errorClass==='rate_limit'&&typeof retryAfterSeconds==='number'&&Number.isFinite(retryAfterSeconds)?Math.max(base,Math.min(Math.max(retryAfterSeconds,0),21600)):base;
}

// Outcome of one provider call, as accepted by publication_job_complete.
export type PublishOutcome={result:'published'|'simulated';remoteId:string}|{result:DeliveryErrorClass;errorCode:string|null;retryAfterSeconds?:number|null}|{result:'uncertain';errorCode:string|null};
export function outcomePayload(outcome:PublishOutcome,durationMs:number,requestId?:string|null):Record<string,unknown>{
 const duration=Number.isFinite(durationMs)&&durationMs>=0?Math.round(durationMs):0;
 const request=typeof requestId==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)?{request_id:requestId}:{};
 if(outcome.result==='published'||outcome.result==='simulated'){
  if(typeof outcome.remoteId!=='string'||outcome.remoteId.length<1||outcome.remoteId.length>500)throw Error('Invalid remote id');
  if(outcome.result==='simulated'!==/^simulated-[a-zA-Z0-9_-]{1,100}$/.test(outcome.remoteId))throw Error('Invalid remote id');
  return {result:outcome.result,remote_id:outcome.remoteId,duration_ms:duration,...request};}
 const failure=outcome as Exclude<PublishOutcome,{remoteId:string}>;const code=safeErrorCode(failure.errorCode);
 const after='retryAfterSeconds' in failure?failure.retryAfterSeconds:null;
 const retry=typeof after==='number'&&Number.isFinite(after)?{retry_after_seconds:Math.max(0,Math.round(after))}:{};
 return {result:failure.result,...(code?{error_code:code}:{}),...retry,duration_ms:duration,...request};
}

// Display (drawer "Diffusion"): statuses, safe reasons, next retry. Never a credential or a provider message.
const REASON_LABELS:Record<string,string>={...PUBLISHABILITY_LABELS,archived:'Publication archivée',publication_changed:'Publication modifiée depuis la préparation',
 content_changed:'Contenu modifié depuis la préparation',account_changed:'Compte du canal modifié',auth:'Autorisation refusée ou révoquée'};
export function blockedReasonLabel(reason:string|null):string|null{return reason?REASON_LABELS[reason as ChannelPublishability]??'Diffusion bloquée':null;}
export const DELIVERY_ENGINE_NOTICE='Le moteur de diffusion est en mode local / provider simulé.';
export type DeliveryView={id:string;platform:PublicationPlatform;platformLabel:string;accountLabel:string;status:DeliveryStatus;statusLabel:string;attempts:number;
 lastError:string|null;blockedReason:string|null;nextRetryAt:string|null;remoteLabel:string|null;canRetry:boolean;canReconcile:boolean};
// Drawer « Diffusion »: deliveries of the publication and whether a preparation can be requested.
export type DiffusionView={deliveries:DeliveryView[];canPrepare:boolean};
export type DeliveryRow={id:string;platform:PublicationPlatform;status:string;remote_id:string|null;blocked_reason:string|null;last_error_class:string|null;last_error_code:string|null};
export function deliveryView(row:DeliveryRow,input:{accountName:string|null;attempts:number;nextRetryAt:string|null}):DeliveryView|null{
 if(!(DELIVERY_STATUSES as readonly string[]).includes(row.status))return null;const status=row.status as DeliveryStatus;
 const klass=(ERROR_CLASSES as readonly string[]).includes(row.last_error_class??'')?row.last_error_class as DeliveryErrorClass:null;
 const code=safeErrorCode(row.last_error_code);
 return {id:row.id,platform:row.platform,platformLabel:platformLabels[row.platform],accountLabel:input.accountName??'Compte',status,statusLabel:DELIVERY_STATUS_LABELS[status],
  attempts:Math.max(0,input.attempts),lastError:klass?`${ERROR_CLASS_LABELS[klass]}${code?` (${code})`:''}`:null,blockedReason:status==='blocked'?blockedReasonLabel(row.blocked_reason):null,
  nextRetryAt:status==='retryable_error'?input.nextRetryAt:null,
  // A simulated identifier is labelled as such; a real remote id is shown only once a real publisher exists.
  remoteLabel:status==='simulated'?'Identifiant simulé (aucune publication réelle)':status==='published'&&row.remote_id?'Publiée chez le fournisseur':null,
  canRetry:status==='failed'||status==='retryable_error'||status==='blocked',
  // Uncertain (outcome unknown after a dispatch): only a provider check or an explicit admin decision moves it.
  canReconcile:status==='uncertain'};
}
