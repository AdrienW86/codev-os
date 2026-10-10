import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loadTs} from './helpers/load-ts.mjs';
import {createFakeSupabase} from './helpers/fake-supabase.mjs';
const recurrence=loadTs('lib/scheduler/recurrence.ts'),email=loadTs('lib/reports/recipient.ts');
const domain=loadTs('lib/reports/recurring/domain.ts',{'@/lib/scheduler/recurrence':recurrence,'@/lib/reports/recipient':email});
const runTypes=loadTs('lib/runs/types.ts');
const clientId='11111111-1111-4111-8111-111111111111',occurrenceId='66666666-6666-4666-8666-666666666666';
function setup({approved=true,active=true,alreadySent=false,accepted=true,uncertain=false,publish=true}={}){
 const config={...domain.DEFAULT_RECURRING_CONFIG,enabled:true,recipient:'reports@example.invalid',campaignIds:['123'],transport:'approved_auto'};
 const due='2026-10-16T16:00:00Z';
 const row={id:occurrenceId,client_id:clientId,report_id:'report',revision:1,config,period_window:{start:'2026-10-09',end:'2026-10-15',cutoff:'2026-10-16 00:00 Europe/Paris, exclusive'},due_at:due,preparation:'queued',transport:'pending'};
 let sends=0,reads=0,published=0;
 const fake=createFakeSupabase({ads_report_occurrences:[row],client_ads_report_settings:[{client_id:clientId,revision:active?1:2,config}],report_deliveries:uncertain?[{report_id:'report',version:1,state:'uncertain'}]:[]},{rpc:{codev_store_ads_report:()=>{published++;return publish;}}});
 const report={id:'report',version:1,status:alreadySent?'sent':approved?'approved':'ready_for_review',approved_version:approved?1:null};
 const handlers=loadTs('lib/reports/recurring/run.ts',{'@/lib/supabase/server':{getSupabaseServerClient:()=>fake.client},'@/lib/runs/types':runTypes,'./domain':domain,
  '@/lib/reports/google-ads-service':{googleAdsReportSnapshot:async()=>{reads++;return{ok:true,stored:{},built:{title:'Fixture',client:{summary:'Safe',sections:[]},internal:{sections:[]}}};}},
  '@/lib/reports/service':{getReport:async()=>report,transportApprovedReport:async(actor,id,mode,preview,occurrence,lease)=>{sends++;assert.equal(actor.kind,'system');assert.equal(occurrence,occurrenceId);assert.equal(preview.recipient,config.recipient);assert.equal(lease.worker,'worker-A');return {ok:accepted};}},
  '@/lib/reports/email-preview':{reportEmailPreview:()=>({digest:'checked-digest'})},
 });
 const context={job:{id:'job',client_id:clientId,payload:{occurrenceId},worker_id:'worker-A'},actor:{kind:'system',worker:'worker-A'},now:new Date(due)};
 return{handlers,context,fake,row:fake.tables.ads_report_occurrences[0],count:()=>({sends,reads,published})};
}
test('unapproved scheduled report is blocked, not approved or sent; later approval does not replay this job',async()=>{
 const s=setup({approved:false});const result=await s.handlers.sendRecurringReportRun(s.context);
 assert.equal(result.status,'skipped');assert.equal(s.count().sends,0);assert.equal(s.row.transport,'blocked');
});
test('pause/replaced configuration prevents reads and sends, including a running prepare job',async()=>{
 const s=setup({active:false});await s.handlers.prepareRecurringReportRun(s.context);await s.handlers.sendRecurringReportRun(s.context);
 assert.deepEqual(s.count(),{sends:0,reads:0,published:0});assert.equal(s.row.transport,'paused');
});
test('uncertain transport persists without automatic retry; manually sent report is never sent twice',async()=>{
 const s=setup({accepted:false,uncertain:true});await s.handlers.sendRecurringReportRun(s.context);assert.equal(s.row.transport,'uncertain');
 await s.handlers.sendRecurringReportRun(s.context);assert.equal(s.count().sends,1);
 const sent=setup({alreadySent:true});await sent.handlers.sendRecurringReportRun(sent.context);assert.equal(sent.count().sends,0);
});
test('publication losing its job lease does not announce a ready report; finalized preparation does not evolve',async()=>{
 const s=setup({publish:false});const result=await s.handlers.prepareRecurringReportRun(s.context);assert.equal(result.status,'skipped');assert.match(result.summary,/Bail perdu/);
 s.row.preparation='ready';await s.handlers.prepareRecurringReportRun(s.context);assert.equal(s.count().reads,1);
});
