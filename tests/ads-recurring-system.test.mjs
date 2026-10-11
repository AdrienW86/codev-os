import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loadTs} from './helpers/load-ts.mjs';
import {createFakeSupabase} from './helpers/fake-supabase.mjs';
const periods=loadTs('lib/integrations/google-ads/periods.ts');
const validation=loadTs('lib/integrations/google-ads/validation.ts',{'./periods':periods});
const queries=loadTs('lib/integrations/google-ads/queries.ts',{'./validation':validation});
const dashboard=loadTs('lib/integrations/google-ads/dashboard.ts',{'./periods':periods});
const scope=loadTs('lib/integrations/google-ads/scope.ts',{'./periods':periods});
const clientId='11111111-1111-4111-8111-111111111111',jobId='77777777-7777-4777-8777-777777777777';
function setup({expired=false,replaceAfterRead=false,replaceAfterOAuth=false}={}){
 const requests=[],logs=[];
 const fake=createFakeSupabase({jobs:[{id:jobId,client_id:clientId,run_type:'ads.report.prepare',worker_id:'worker-A',status:'running',lease_expires_at:new Date(Date.now()+(expired?-60000:300000)).toISOString()}],client_connections:[{id:'connection',client_id:clientId,provider:'google_ads',status:'connected',external_account_id:'1234567890',metadata:{}}]});
 const admin={requireAdmin:async()=>{throw Error('No browser session');}};
 const client=loadTs('lib/integrations/google-ads/client.ts',{'@/lib/require-admin':admin,'./validation':validation,'./queries':queries},{process:{env:{GOOGLE_ADS_CLIENT_ID:'fake',GOOGLE_ADS_CLIENT_SECRET:'fake-secret',GOOGLE_ADS_REFRESH_TOKEN:'fake-refresh'}},console:{error:(...x)=>logs.push(x)},fetch:async(url,init)=>{
  requests.push({url,body:String(init.body)});
  if(url==='https://oauth2.googleapis.com/token'){if(replaceAfterOAuth)fake.tables.jobs[0].worker_id='replacement';return Response.json({access_token:'fake-access'});}
  assert.ok(url.endsWith('/googleAds:search'),'only read endpoint allowed');
  const query=JSON.parse(init.body).query;
  if(query.includes('FROM customer LIMIT 1')){
   if(replaceAfterRead)fake.tables.jobs[0].worker_id='replacement';
   return Response.json({results:[{customer:{id:'1234567890',currencyCode:'EUR',timeZone:'Europe/Paris',descriptiveName:'Synthetic account'}}]});
  }
  if(query.includes('FROM campaign'))return Response.json({results:[{campaign:{id:'123',name:'Synthetic Search',status:'ENABLED',advertisingChannelType:'SEARCH'},metrics:{costMicros:'2000000',clicks:'3',impressions:'40',conversions:0}}]});
  return Response.json({results:[{metrics:{costMicros:'2000000',clicks:'3',impressions:'40',conversions:0}}]});
 }});
 const mocks={'@/lib/require-admin':admin,'@/lib/simulation/server':{},'@/lib/supabase/server':{getSupabaseServerClient:()=>fake.client},'@/lib/clients/data':{},'@/lib/agents/data':{},'@/lib/audit-logs':{},'@/lib/agent-runs/data':{},'@/lib/recommendations/data':{},'@/lib/agents/validation':{isAgentUuid:v=>/^[a-f0-9-]{36}$/.test(v)},'./client':client,'./validation':validation,'./periods':periods,'./scope':scope,'./dashboard':dashboard,'./tracking-store':{readCampaignTracking:async()=>({available:true,revision:0,ids:null})},'./tracking':{},'@/lib/ai/providers':{},'./ai-analysis':{},'./recommendation-core':{},'./context-service':{},'./analysis-state':{}};
 const service=loadTs('lib/integrations/google-ads/service.ts',mocks,{console:{error:(...x)=>logs.push(x)}});
 return {client,service,fake,requests,logs};
}
const filters={...dashboard.DEFAULT_FILTERS,period:{preset:'custom',start:'2026-10-02',end:'2026-10-08'}};
const lease={jobId,worker:'worker-A'};
test('system preparation uses the actual read transport without a browser session, guarded before every query',async()=>{
 const s=setup();const result=await s.service.loadCampaignDashboardForSystem(clientId,filters,new Date(),lease);
 assert.equal(result.ok,true);assert.equal(result.data.account.id,'1234567890');assert.equal(result.data.period.start,'2026-10-02');assert.equal(result.data.period.end,'2026-10-08');
 assert.equal(s.requests.filter(r=>r.url.endsWith('/googleAds:search')).length,4);
 assert.equal(result.data.campaigns[0].metrics.cost,2);
 await assert.rejects(()=>s.client.createGoogleAdsReadClient().getAccountSummary('1234567890'),/No browser session/);
 assert.equal(s.requests.length,8,'admin default cannot bypass browser guard');
});
test('missing, expired, foreign-client, cancelled or replaced leases never read Ads',async()=>{
 for(const mutate of [s=>s.fake.tables.jobs[0].worker_id='other',s=>s.fake.tables.jobs[0].status='cancelled',s=>s.fake.tables.jobs[0].client_id='22222222-2222-4222-8222-222222222222',s=>s.fake.tables.jobs[0].run_type='ads.report.send',s=>s.fake.tables.jobs[0].lease_expires_at=new Date(0).toISOString()]){
  const s=setup();mutate(s);assert.equal((await s.service.loadCampaignDashboardForSystem(clientId,filters,new Date(),lease)).ok,false);assert.equal(s.requests.length,0);
 }
 const s=setup();assert.equal((await s.service.loadCampaignDashboardForSystem(clientId,filters)).ok,false);assert.equal(s.requests.length,0);
});
test('lease replacement between provider queries prevents further OAuth/Ads calls and does not log credentials',async()=>{
 const s=setup({replaceAfterRead:true});assert.equal((await s.service.loadCampaignDashboardForSystem(clientId,filters,new Date(),lease)).ok,false);
 assert.equal(s.requests.length,2);assert.doesNotMatch(JSON.stringify(s.logs),/fake-secret|fake-refresh|fake-access/);
});
test('account timezone change is refused before recommendations or publication',async()=>{
 const service=loadTs('lib/reports/google-ads-service.ts',{'@/lib/supabase/server':{},'@/lib/core/audit':{},'@/lib/integrations/google-ads/service':{loadCampaignDashboard:async()=>({ok:true,data:{account:{id:'1234567890',timezone:'America/New_York'}}})},'@/lib/integrations/google-ads/dashboard':dashboard,'@/lib/integrations/google-ads/scope':scope,'./google-ads':{},'./version-storage':{}});
 const result=await service.googleAdsReportSnapshot(clientId,{start:'2026-10-02',end:'2026-10-08',types:[],campaignIds:['123'],status:'all'},'1234567890',undefined,'Europe/Paris');
 assert.equal(result.ok,false);assert.match(result.message,/fuseau/);
});

test('lease lost during OAuth prevents the following Ads request',async()=>{
 const s=setup({replaceAfterOAuth:true});assert.equal((await s.service.loadCampaignDashboardForSystem(clientId,filters,new Date(),lease)).ok,false);
 assert.equal(s.requests.length,1);assert.equal(s.requests[0].url,'https://oauth2.googleapis.com/token');
});
