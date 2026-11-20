import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {submitOrReview} from './workspace';
import {workflowSucceeded} from './workflow-result';
import {isPublicationUuid} from './validation';
import {parisToday} from './calendar';
import {currentBatch,type MonthlyBatch} from './monthly-cycle';

// Validation par lot (cycle mensuel) : toutes les publications « À valider » de Google Business Profile, Facebook et
// Instagram, par client. « Tout valider » répète la décision humaine « Valider » pour chacune, sur SA version courante et
// avec SES contrôles (photo, verrou de canal) : rien n'est contourné. TikTok et Snapchat gardent leur validation unitaire.
export const BATCH_PLATFORMS=['google_business_profile','facebook','instagram'] as const;
/** Au plus ce nombre de validations par clic (durée de la requête) ; le reste est validé au clic suivant. */
export const MAX_BATCH_APPROVALS=60;
export type MonthlyReviewClient={clientId:string;clientName:string;pending:number;first:string|null;last:string|null};
export type MonthlyReview={batch:MonthlyBatch;today:string;clients:MonthlyReviewClient[];pending:number};
type Row={id:string;client_id:string;target_date:string|null;current_revision_id:string|null};
const db=()=>getSupabaseServerClient();

async function pendingRows(clientId?:string):Promise<Row[]>{
 let query=db().from('publications').select('id,client_id,target_date,current_revision_id').eq('status','pending_review').is('archived_at',null).in('platform',[...BATCH_PLATFORMS]);
 if(clientId)query=query.eq('client_id',clientId);
 const {data,error}=await query.order('target_date',{ascending:true}).limit(1000);
 if(error)throw Error('Publications indisponibles.');
 return (data??[]) as Row[];
}

export async function monthlyReview(now=new Date()):Promise<MonthlyReview>{
 await requireAdmin();
 const today=parisToday(now),rows=await pendingRows();
 const ids=[...new Set(rows.map(r=>r.client_id))];
 const clients=ids.length?await db().from('clients').select('id,name').in('id',ids):{data:[],error:null};
 const names=new Map(((clients.data??[]) as {id:string;name:string}[]).map(c=>[c.id,c.name]));
 const byClient=new Map<string,MonthlyReviewClient>();
 for(const r of rows){
  const c=byClient.get(r.client_id)??{clientId:r.client_id,clientName:names.get(r.client_id)??'Client',pending:0,first:null,last:null};
  c.pending++;
  if(r.target_date){if(!c.first||r.target_date<c.first)c.first=r.target_date;if(!c.last||r.target_date>c.last)c.last=r.target_date;}
  byClient.set(r.client_id,c);
 }
 const list=[...byClient.values()].sort((a,b)=>a.clientName.localeCompare(b.clientName,'fr'));
 return {batch:currentBatch(today),today,clients:list,pending:rows.length};
}

/** « Tout valider » : un client, ou tous (clientId absent). Renvoie un message lisible. */
export async function approveMonthlyBatch(clientId:string|null):Promise<{ok:boolean;message:string}>{
 await requireAdmin();
 if(clientId!==null&&!isPublicationUuid(clientId))return {ok:false,message:'Client invalide.'};
 const rows=(await pendingRows(clientId??undefined)).filter(r=>r.current_revision_id);
 if(!rows.length)return {ok:true,message:'Aucune publication à valider.'};
 let approved=0,failed=0;
 for(const r of rows.slice(0,MAX_BATCH_APPROVALS)){
  const form=new FormData();form.set('publication_id',r.id);form.set('revision_id',r.current_revision_id!);form.set('decision','approved');
  const result=await submitOrReview(form).catch(()=>({message:'échec'}));
  if(workflowSucceeded(result.message))approved++;else failed++;
 }
 const left=Math.max(rows.length-MAX_BATCH_APPROVALS,0);
 const parts=[`${approved} publication(s) validée(s).`];
 if(failed)parts.push(`${failed} à vérifier une par une (photo manquante ou version modifiée).`);
 if(left)parts.push(`Il en reste ${left} : cliquez à nouveau.`);
 return {ok:!failed,message:parts.join(' ')};
}
