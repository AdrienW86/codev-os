import 'server-only';
import {createHash} from 'node:crypto';
import {PublisherError,type PublicationPublisher,type PublicationReconciler,type PublishInput,type PublishResult} from './publisher';

// TEST / LOCAL DEVELOPMENT ONLY (Lot 4.3 P10). Deterministic simulated publisher and reconciler: no network, no
// provider. Successes are always 'simulated' with a simulated-<hash> id, so nothing can be mistaken for a real post.
export type FakeStep='success'|'retryable'|'permanent'|'rate_limit'|'auth'|'invalid_payload'|'provider_unavailable'|'throw';
export function createFakePublisher(steps:FakeStep[]=['success']):PublicationPublisher&{calls:Omit<PublishInput,'credential'>[];credentialsSeen:number}{
 const calls:Omit<PublishInput,'credential'>[]=[];let i=0;const state={credentialsSeen:0};
 return {calls,get credentialsSeen(){return state.credentialsSeen;},
  async publish(input):Promise<PublishResult>{
   const {credential,...rest}=input;if(credential?.accessToken)state.credentialsSeen++;calls.push(JSON.parse(JSON.stringify(rest)));
   const step=steps[Math.min(i++,steps.length-1)];
   if(step==='success')return {ok:true,simulated:true,remoteId:`simulated-${createHash('sha256').update(input.idempotencyKey).digest('hex').slice(0,24)}`,requestId:`fake-${i}`};
   if(step==='throw')throw new Error(`socket closed while sending ${credential?.accessToken??''}`);
   if(step==='rate_limit')throw new PublisherError('rate_limit','rate_limited',7200);
   return {ok:false,errorClass:step,errorCode:`fake_${step}`};}};
}
export function createFakeReconciler(known:Record<string,string>={}):PublicationReconciler{
 return {async reconcile(d){const remote=known[d.idempotencyKey]??null;return {status:remote?'exists':d.remoteId?'missing':'unknown',remoteId:remote};}};
}
