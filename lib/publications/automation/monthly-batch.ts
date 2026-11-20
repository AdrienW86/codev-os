import 'server-only';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {isAuthorizedAdmin} from '@/lib/admin-policy';
import {parisToday} from '../calendar';
import {delegatedActor} from './scheduled';
import {autoValidateGeneratedImage} from '../photo-agent/service';
import {imageAutoValidationDue,monthlyNoticeDue,monthlyNoticeKey,parisHour} from '../monthly-cycle';

// Cycle mensuel (lib/publications/monthly-cycle.ts), passage du planificateur juste après la validation automatique :
// 1. L'avis mensuel : UNE notification (clé monthly-review:AAAA-MM) le 1er au soir, s'il y a des publications du lot à
//    valider. Idempotent : la clé ne peut être écrite qu'une fois.
// 2. Les images IA encore en attente après la date limite du lot (ou à 2 jours de leur créneau) sont validées avec le lot.
export const MAX_AUTO_IMAGES_PER_TICK=3;
export type MonthlyBatchSummary={notice:'sent'|'already'|'not_due'|'nothing_pending'|'failed';images:{approved:number;failed:number;noActor:number}};
export type MonthlyBatchDeps={isAdmin:(userId:string)=>boolean;validateImage?:(id:string,actorId:string)=>Promise<'approved'|'attach_failed'|'skipped'>};
const db=()=>getSupabaseServerClient();

export async function runMonthlyBatch(now=new Date(),deps:MonthlyBatchDeps={isAdmin:userId=>isAuthorizedAdmin(userId)}):Promise<MonthlyBatchSummary>{
 const today=parisToday(now);
 const summary:MonthlyBatchSummary={notice:'not_due',images:{approved:0,failed:0,noActor:0}};
 const batch=monthlyNoticeDue(today,parisHour(now));
 if(batch){
  const pending=await db().from('publications').select('id',{count:'exact',head:true}).eq('status','pending_review').is('archived_at',null).gte('target_date',batch.from).lte('target_date',batch.to);
  if(pending.error)summary.notice='failed';
  else if(!pending.count)summary.notice='nothing_pending';
  else{
   const r=await db().from('admin_notifications').upsert({event_key:monthlyNoticeKey(batch),category:'publication_review',href:'/publications/review'},{onConflict:'event_key',ignoreDuplicates:true}).select('id');
   summary.notice=r.error?'failed':r.data?.length?'sent':'already';
  }
 }
 const images=await db().from('publication_generated_images').select('id,client_id,publication_ids').eq('status','pending_review').order('created_at',{ascending:true}).limit(30);
 if(images.error||!images.data?.length)return summary;
 const rows=images.data as {id:string;client_id:string;publication_ids:string[]}[];
 const pubIds=[...new Set(rows.flatMap(row=>row.publication_ids??[]))];
 const pubs=pubIds.length?await db().from('publications').select('id,target_date').in('id',pubIds):{data:[],error:null};
 if(pubs.error)return summary;
 const dates=new Map(((pubs.data??[]) as {id:string;target_date:string|null}[]).map(p=>[p.id,p.target_date]));
 const actors=new Map<string,string|null>();
 let done=0;
 for(const row of rows){
  if(done>=MAX_AUTO_IMAGES_PER_TICK)break;
  const targets=(row.publication_ids??[]).map(id=>dates.get(id)).filter((d):d is string=>typeof d==='string').sort();
  if(!targets.length||!imageAutoValidationDue(targets[0],today))continue;
  if(!actors.has(row.client_id))actors.set(row.client_id,await delegatedActor(row.client_id,deps.isAdmin).catch(()=>null));
  const actor=actors.get(row.client_id);
  if(!actor){summary.images.noActor++;continue;}
  done++;
  const outcome=await (deps.validateImage??autoValidateGeneratedImage)(row.id,actor).catch(()=>'attach_failed' as const);
  if(outcome==='approved')summary.images.approved++;else if(outcome==='attach_failed')summary.images.failed++;
 }
 return summary;
}
