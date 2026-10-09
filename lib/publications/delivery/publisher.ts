import 'server-only';
import type {ProviderCredential} from '../connections/vault';
import type {PublicationPlatform} from '../types';
import {ERROR_CLASSES,safeErrorCode,type DeliveryErrorClass,type PublishOutcome} from './model';

// Publisher contract (Lot 4.3 P10). The input carries only what a provider needs: platform, external account ids,
// text, short-lived media URLs and the idempotency key. The credential is resolved by the engine from the vault and
// handed over in memory only (never stored in a job, a delivery or a log). No real publisher exists in P10.
export type PublishInput={platform:PublicationPlatform;account:{externalAccountId:string;parentExternalId:string|null};text:string;
 media:{url:string;mimeType:string}[];idempotencyKey:string;credential:ProviderCredential};
// ok:false + uncertain:true: the provider may have performed the side effect (timeout / lost answer after a write):
// never retried automatically, the delivery becomes uncertain and is reconciled (P11-b).
export type PublishResult={ok:true;remoteId:string;simulated:boolean;requestId?:string|null}
 |{ok:false;errorClass:DeliveryErrorClass;errorCode:string|null;retryAfterSeconds?:number|null;requestId?:string|null}
 |{ok:false;uncertain:true;errorCode:string|null;requestId?:string|null};
export interface PublicationPublisher{publish(input:PublishInput):Promise<PublishResult>}
// Reconciliation of an uncertain delivery (P10 contract, real Meta implementation in P11-b): does the post exist?
// account / text / since (dispatch time) let a provider without idempotency look the post up; never invent an id.
export type ReconcileResult={status:'exists'|'missing'|'unknown';remoteId:string|null};
export type ReconcileInput={platform:PublicationPlatform;remoteId:string|null;idempotencyKey:string;credential:ProviderCredential;
 account?:{externalAccountId:string;parentExternalId:string|null};text?:string;since?:string|null};
export interface PublicationReconciler{reconcile(delivery:ReconcileInput):Promise<ReconcileResult>}

// Typed failure a publisher may throw; anything else thrown after the dispatch is treated as UNCERTAIN (never
// retried blindly: the provider may have received the request).
export class PublisherError extends Error{constructor(readonly errorClass:DeliveryErrorClass,readonly errorCode:string|null=null,readonly retryAfterSeconds:number|null=null){super(`Publisher: ${errorClass}`);}}
export function outcomeOf(result:unknown):PublishOutcome{
 const r=result&&typeof result==='object'?result as Record<string,unknown>:{};
 if(r.ok===true&&typeof r.remoteId==='string')return {result:r.simulated===true?'simulated':'published',remoteId:r.remoteId};
 if(r.ok===false&&r.uncertain===true)return {result:'uncertain',errorCode:safeErrorCode(r.errorCode)};
 if(r.ok===false&&(ERROR_CLASSES as readonly unknown[]).includes(r.errorClass))
  return {result:r.errorClass as DeliveryErrorClass,errorCode:safeErrorCode(r.errorCode),retryAfterSeconds:typeof r.retryAfterSeconds==='number'?r.retryAfterSeconds:null};
 return {result:'uncertain',errorCode:'invalid_publisher_result'};
}
export function outcomeOfError(error:unknown):PublishOutcome{
 if(error instanceof PublisherError)return {result:error.errorClass,errorCode:safeErrorCode(error.errorCode),retryAfterSeconds:error.retryAfterSeconds};
 return {result:'uncertain',errorCode:'publisher_exception'};
}
