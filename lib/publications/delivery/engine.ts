import 'server-only';
import {IMAGE_BUCKET} from '../editor';
import {isPublicationUuid} from '../validation';
import {isCredentialReference,type CredentialVault,type ProviderCredential} from '../connections/vault';
import {outcomeOf,outcomeOfError,type PublicationPublisher,type PublishInput} from './publisher';
import {outcomePayload,type PublishOutcome} from './model';
import type {PublicationPlatform} from '../types';

// Delivery worker (Lot 4.3 P10). One explicit call = at most one job: no daemon, no loop, no cron. It is not wired
// to any route in P10 and needs every dependency injected (tests / local development with the simulated publisher).
// Flow: claim → context (everything re-checked now) → credential from the vault (memory only) → short-lived signed
// media URLs of the delivery snapshot → dispatch marker → ONE provider call → complete. After the dispatch marker
// the provider is never called again for this attempt, whatever happens (lost lease → uncertain, reconcile later).
type DbError={code?:string;message?:string}|null;
export type EngineDb={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:DbError}>;
 from(table:string):{select(columns:string):{eq(column:string,value:string):{maybeSingle():PromiseLike<{data:unknown;error:unknown}>}}};
 storage:{from(bucket:string):{createSignedUrls(paths:string[],ttl:number):PromiseLike<{data:{path:string|null;signedUrl:string;error?:string|null}[]|null;error:unknown}>}}};
export type EngineDeps={db:EngineDb;vault:CredentialVault;publisher:PublicationPublisher;signedUrlTtlSeconds?:number;clock?:()=>number};
export type Claim={job_id:string;delivery_id:string;attempt:number;platform:string};
export type ExecutionResult={state:'idle'}|{state:'blocked';reason:string}|{state:'stale'}|{state:'aborted';step:'credential'|'media'}
 |{state:'completed';deliveryStatus:string;outcome:PublishOutcome['result']}|{state:'unconfirmed'};
type Context={status:'ready'|'blocked';reason?:string;job_id:string;delivery_id:string;attempt:number;platform:PublicationPlatform;idempotency_key:string;text:string;
 connection_id:string|null;account:{external_account_id:string;parent_external_id:string|null};assets:{storage_path:string;mime_type:string}[]};
const MAX_TTL=600;
// Generic server log: step and kind only. Never a credential, a provider message or a payload.
const log=(step:string)=>console.error('[publications-delivery]',{step});
async function settle<T>(work:()=>PromiseLike<T>,fallback:T):Promise<T>{try{return await work();}catch{return fallback;}}

export async function executeClaimedPublicationJob(claim:Claim,workerId:string,deps:EngineDeps):Promise<ExecutionResult>{
 const {db,vault,publisher}=deps,clock=deps.clock??Date.now;
 if(!isPublicationUuid(claim.job_id)||!Number.isInteger(claim.attempt))return {state:'stale'};
 const held={p_job_id:claim.job_id,p_worker_id:workerId,p_attempt:claim.attempt};
 const ctx=await settle(()=>db.rpc('publication_job_context',held),{data:null,error:{code:'network'}});
 if(ctx.error||!ctx.data)return {state:'stale'};
 const context=ctx.data as Context;
 if(context.status==='blocked')return {state:'blocked',reason:typeof context.reason==='string'?context.reason:'blocked'};
 // Credential: read on the server from the connection's opaque reference, kept in memory for this call only.
 let credential:ProviderCredential;
 try{
  if(!context.connection_id||!isPublicationUuid(context.connection_id))throw Error();
  const row=await db.from('client_connections').select('credential_reference,status').eq('id',context.connection_id).maybeSingle();
  const ref=(row.data as {credential_reference?:unknown;status?:unknown}|null);
  if(row.error||ref?.status!=='active'||!isCredentialReference(ref.credential_reference))throw Error();
  credential=await vault.readCredential(ref.credential_reference);
 }catch{log('credential');return {state:'aborted',step:'credential'};}
 // Media of the delivery snapshot only (never the current revision), signed at the last moment, short TTL.
 let media:PublishInput['media']=[];
 if(context.assets.length){
  const ttl=Math.min(Math.max(deps.signedUrlTtlSeconds??300,60),MAX_TTL);
  const signed=await settle(()=>db.storage.from(IMAGE_BUCKET).createSignedUrls(context.assets.map(a=>a.storage_path),ttl),{data:null,error:'network'});
  const urls=new Map((signed.data??[]).flatMap(s=>s.path&&s.signedUrl&&!s.error?[[s.path,s.signedUrl] as [string,string]]:[]));
  if(signed.error||context.assets.some(a=>!urls.has(a.storage_path))){log('media');return {state:'aborted',step:'media'};}
  media=context.assets.map(a=>({url:urls.get(a.storage_path)!,mimeType:a.mime_type}));
 }
 const dispatched=await settle(()=>db.rpc('publication_job_dispatch',held),{data:null,error:{code:'network'}});
 if(dispatched.error)return {state:'stale'};
 if(dispatched.data!==true)return {state:'blocked',reason:'not_ready'};
 const started=clock();let outcome:PublishOutcome;let requestId:string|null=null;
 try{const result=await publisher.publish({platform:context.platform,account:{externalAccountId:context.account.external_account_id,parentExternalId:context.account.parent_external_id},
   text:context.text,media,idempotencyKey:context.idempotency_key,credential});outcome=outcomeOf(result);requestId=typeof result.requestId==='string'?result.requestId:null;}
 catch(error){outcome=outcomeOfError(error);}
 let payload:Record<string,unknown>;
 try{payload=outcomePayload(outcome,clock()-started,requestId);}catch{outcome={result:'uncertain',errorCode:'invalid_publisher_result'};payload=outcomePayload(outcome,clock()-started);}
 const done=await settle(()=>db.rpc('publication_job_complete',{...held,p_outcome:payload}),{data:null,error:{code:'network'}});
 // Never call the provider again here: the lease expires and the claim marks the delivery uncertain.
 if(done.error||!done.data){log('complete');return {state:'unconfirmed'};}
 return {state:'completed',deliveryStatus:String((done.data as {delivery_status?:unknown}).delivery_status??''),outcome:outcome.result};
}
// Claims and executes at most one due job. Local / test use only (explicit dependencies, no scheduler).
export async function runOnePublicationJob(workerId:string,deps:EngineDeps&{leaseSeconds?:number}):Promise<ExecutionResult>{
 if(!/^[a-zA-Z0-9_.:-]{1,100}$/.test(workerId))throw Error('Invalid worker id');
 const lease=Math.min(Math.max(deps.leaseSeconds??120,30),900);
 const claimed=await settle(()=>deps.db.rpc('publication_job_claim',{p_worker_id:workerId,p_lease_seconds:lease}),{data:null,error:{code:'network'}});
 if(claimed.error){log('claim');return {state:'stale'};}
 if(!claimed.data)return {state:'idle'};
 return executeClaimedPublicationJob(claimed.data as Claim,workerId,deps);
}
