import 'server-only';
import type {ProviderCredential} from '../connections/vault';
import type {PublicationPlatform} from '../types';
import {ERROR_CLASSES,safeErrorCode,type DeliveryErrorClass,type PublishOutcome} from './model';

// Publisher contract (Lot 4.3 P10). The input carries only what a provider needs: platform, external account ids,
// text, short-lived media URLs and the idempotency key. The credential is resolved by the engine from the vault and
// handed over in memory only (never stored in a job, a delivery or a log). No real publisher exists in P10.
export type PublishInput={platform:PublicationPlatform;account:{externalAccountId:string;parentExternalId:string|null};text:string;
 media:{url:string;mimeType:string}[];idempotencyKey:string;credential:ProviderCredential};
export type PublishResult={ok:true;remoteId:string;simulated:boolean;requestId?:string|null}
 |{ok:false;errorClass:DeliveryErrorClass;errorCode:string|null;retryAfterSeconds?:number|null;requestId?:string|null};
export interface PublicationPublisher{publish(input:PublishInput):Promise<PublishResult>}
// Future reconciliation of uncertain / published deliveries (contract only in P10).
export type ReconcileResult={status:'exists'|'missing'|'unknown';remoteId:string|null};
export interface PublicationReconciler{reconcile(delivery:{platform:PublicationPlatform;remoteId:string|null;idempotencyKey:string;credential:ProviderCredential}):Promise<ReconcileResult>}

// Typed failure a publisher may throw; anything else thrown after the dispatch is treated as UNCERTAIN (never
// retried blindly: the provider may have received the request).
export class PublisherError extends Error{constructor(readonly errorClass:DeliveryErrorClass,readonly errorCode:string|null=null,readonly retryAfterSeconds:number|null=null){super(`Publisher: ${errorClass}`);}}
export function outcomeOf(result:unknown):PublishOutcome{
 const r=result&&typeof result==='object'?result as Record<string,unknown>:{};
 if(r.ok===true&&typeof r.remoteId==='string')return {result:r.simulated===true?'simulated':'published',remoteId:r.remoteId};
 if(r.ok===false&&(ERROR_CLASSES as readonly unknown[]).includes(r.errorClass))
  return {result:r.errorClass as DeliveryErrorClass,errorCode:safeErrorCode(r.errorCode),retryAfterSeconds:typeof r.retryAfterSeconds==='number'?r.retryAfterSeconds:null};
 return {result:'uncertain',errorCode:'invalid_publisher_result'};
}
export function outcomeOfError(error:unknown):PublishOutcome{
 if(error instanceof PublisherError)return {result:error.errorClass,errorCode:safeErrorCode(error.errorCode),retryAfterSeconds:error.retryAfterSeconds};
 return {result:'uncertain',errorCode:'publisher_exception'};
}
