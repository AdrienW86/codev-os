import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {isPublicationUuid} from '../validation';
import {blockedReasonLabel,deliveryView,type DeliveryRow,type DeliveryView} from './model';

// Admin side of the delivery engine (Lot 4.3 P10): read the deliveries of one publication, prepare one, retry one.
// Every write is one RPC (re-checked in SQL). Nothing here ever executes a job or calls a provider.
type Result={ok:boolean;message:string};
const unavailable='Diffusion indisponible.';
export const DELIVERY_COLUMNS='id,variant_id,platform,status,remote_id,blocked_reason,last_error_class,last_error_code,publication_account_id,created_at';
export async function getPublicationDeliveries(publicationId:string):Promise<DeliveryView[]>{
 await requireAdmin();if(!isPublicationUuid(publicationId))return [];
 const db=getSupabaseServerClient();
 const rows=await db.from('publication_deliveries').select(DELIVERY_COLUMNS).eq('publication_id',publicationId).order('created_at',{ascending:false});
 if(rows.error||!rows.data)throw Error(unavailable);
 return describeDeliveries(rows.data as (DeliveryRow&{publication_account_id:string})[]);
}
// Views of already-read delivery rows (callers are admin-guarded): account names, attempt counts, next retry.
export async function describeDeliveries(data:(DeliveryRow&{publication_account_id:string})[]):Promise<DeliveryView[]>{
 if(!data.length)return [];const db=getSupabaseServerClient();
 const ids=data.map(d=>d.id),accountIds=[...new Set(data.map(d=>d.publication_account_id))];
 const [accounts,attempts,jobs]=await Promise.all([db.from('publication_accounts').select('id,display_name').in('id',accountIds),
  db.from('publication_attempts').select('delivery_id').in('delivery_id',ids),
  db.from('publication_jobs').select('delivery_id,run_at,status').in('delivery_id',ids).eq('type','deliver').eq('status','pending')]);
 if(accounts.error||attempts.error||jobs.error)throw Error(unavailable);
 return data.flatMap(d=>{const v=deliveryView(d,{accountName:(accounts.data??[]).find(a=>a.id===d.publication_account_id)?.display_name??null,
  attempts:(attempts.data??[]).filter(a=>a.delivery_id===d.id).length,nextRetryAt:(jobs.data??[]).find(j=>j.delivery_id===d.id)?.run_at??null});return v?[v]:[];});
}
function refusal(message:string|undefined):string{
 const reason=/Not publishable: ([a-z_]+)/.exec(message??'')?.[1]??null;
 if(reason)return `Diffusion impossible : ${blockedReasonLabel(reason)?.toLowerCase()}.`;
 if(/not approved/i.test(message??''))return 'Diffusion impossible : la publication doit être validée.';
 if(/archived/i.test(message??''))return 'Diffusion impossible : publication archivée.';
 if(/resolve deliveries/i.test(message??''))return 'Une diffusion est déjà en cours ou terminée pour cette publication.';
 if(/cannot be retried|cannot be cancelled/i.test(message??''))return 'Cette diffusion ne peut pas être relancée dans son état actuel.';
 return unavailable;
}
export async function preparePublicationDelivery(publicationId:unknown):Promise<Result>{
 const {userId}=await requireAdmin();if(!isPublicationUuid(publicationId))return {ok:false,message:'Publication invalide.'};
 const {data,error}=await getSupabaseServerClient().rpc('publication_prepare_delivery',{p_publication_id:publicationId,p_actor_id:userId});
 if(error||!data)return {ok:false,message:refusal(error?.message)};
 return {ok:true,message:(data as {created?:boolean}).created?'Diffusion préparée : envoi à l’heure prévue, via « Envoyer les publications dues ».':'Diffusion déjà préparée.'};
}
// Retry of one delivery of THIS publication (the server checks the delivery belongs to it before the RPC).
export async function retryPublicationDelivery(publicationId:unknown,deliveryId:unknown):Promise<Result>{
 const {userId}=await requireAdmin();if(!isPublicationUuid(publicationId)||!isPublicationUuid(deliveryId))return {ok:false,message:'Diffusion invalide.'};
 const db=getSupabaseServerClient();
 const own=await db.from('publication_deliveries').select('id').eq('id',deliveryId).eq('publication_id',publicationId).maybeSingle();
 if(own.error||!own.data)return {ok:false,message:'Diffusion invalide.'};
 const {error}=await db.rpc('publication_delivery_retry',{p_delivery_id:deliveryId,p_actor_id:userId});
 if(error)return {ok:false,message:refusal(error.message)};
 return {ok:true,message:'Nouvelle tentative planifiée.'};
}
