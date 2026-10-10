import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";
const recurrence = loadTs("lib/scheduler/recurrence.ts");
const email = loadTs("lib/reports/recipient.ts");
const domain = loadTs("lib/reports/recurring/domain.ts", { "@/lib/scheduler/recurrence": recurrence, "@/lib/reports/recipient": email });
const config = overrides => ({ ...domain.DEFAULT_RECURRING_CONFIG, enabled: true, recipient: "reports@example.invalid", campaignIds: ["123"], transport: "approved_auto", ...overrides });
const plain = value => JSON.parse(JSON.stringify(value));
const tomorrow = day => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+1); return d.toISOString().slice(0,10); };

test("Friday 18h Paris: six-hour preparation, only closed days, next period starts without overlap", () => {
 const first = domain.nextOccurrence(config(), new Date("2026-10-10T12:00:00Z"));
 assert.equal(first.dueAt,"2026-10-16T16:00:00.000Z");
 assert.equal(first.prepareAt,"2026-10-16T10:00:00.000Z");
 assert.equal(first.start,"2026-10-09"); assert.equal(first.end,"2026-10-15");
 const next = domain.nextOccurrence(config(), new Date(first.dueAt));
 assert.equal(next.start,tomorrow(first.end)); assert.match(first.cutoff,/exclusive/);
});
test("weekly schedule keeps 18h through autumn DST and still uses contiguous closed days", () => {
 const before = domain.nextOccurrence(config(),new Date("2026-10-17T00:00:00Z"));
 const after = domain.nextOccurrence(config(),new Date(before.dueAt));
 assert.equal(before.dueAt,"2026-10-23T16:00:00.000Z"); assert.equal(after.dueAt,"2026-10-30T17:00:00.000Z");
 assert.equal(after.start,tomorrow(before.end));
});
test("monthly day31 clamps to February28; next period remains contiguous", () => {
 const c=config({frequency:"monthly",monthDay:31});
 const jan=domain.nextOccurrence(c,new Date("2027-01-01T00:00:00Z"));
 const feb=domain.nextOccurrence(c,new Date(jan.dueAt));
 const march=domain.nextOccurrence(c,new Date(feb.dueAt));
 assert.equal(feb.dueAt,"2027-02-28T17:00:00.000Z");
 assert.equal(feb.start,tomorrow(jan.end)); assert.equal(march.start,tomorrow(feb.end));
});
test("scheduling timezone and Google Ads day timezone are distinct, cutoff uses account days", () => {
 const c=config({timezone:"America/New_York",dataTimezone:"Europe/Paris",time:"23:00",leadHours:0});
 const o=domain.nextOccurrence(c,new Date("2026-10-10T12:00:00Z"));
 assert.equal(o.dueAt,"2026-10-17T03:00:00.000Z"); assert.equal(o.end,"2026-10-16"); assert.equal(o.timezone,"Europe/Paris");
});
test("new configuration or resume never backdates preparation; only last closed day is previewed", () => {
 const o=domain.nextOccurrence(config(),new Date("2026-10-16T11:00:00Z"));
 assert.equal(o.dueAt,"2026-10-23T16:00:00.000Z");
 assert.equal(domain.localClosedDate(new Date("2026-10-10T22:01:00Z"),"Europe/Paris"),"2026-10-10");
});
test("configuration requires explicit single recipient, known timezone, bounded lead and unique campaigns", () => {
 for(const changes of [{recipientConfirmed:false},{recipient:"a@x.example,b@y.example"},{timezone:"bad"},{leadHours:73},{campaignIds:["123","123"]}]) assert.equal(domain.recurringConfigSchema.safeParse(config(changes)).success,false);
 assert.equal(domain.recurringConfigSchema.safeParse(config()).success,true);
});
test("automatic transport does not approve content; late policy, pause and prepare-only are enforced", () => {
 const due="2026-10-16T16:00:00Z",now=new Date(due),approved={status:"approved",version:2,approved_version:2};
 const choose=(c,r=approved,n=now)=>domain.automaticSendDecision(config(c),due,n,r);
 assert.equal(choose({}, {status:"ready_for_review",version:2,approved_version:null}),"approval_required");
 assert.equal(choose({}, {...approved,approved_version:1}),"approval_required");
 assert.equal(choose({}),"send"); assert.equal(choose({enabled:false}),"paused"); assert.equal(choose({transport:"prepare_only"}),"prepare_only");
 assert.equal(choose({},approved,new Date("2026-10-16T16:06:00Z")),"late");
 assert.equal(choose({lateMinutes:0},approved,new Date("2026-10-16T16:00:01Z")),"late");
 assert.equal(choose({},approved,new Date("2026-10-16T15:59:00Z")),"not_due");
});

const periods=loadTs("lib/integrations/google-ads/periods.ts");
const scopeModule=loadTs("lib/integrations/google-ads/scope.ts",{"./periods":periods});
const ids=["aaaaaaaa-0000-4000-8000-000000000001","aaaaaaaa-0000-4000-8000-000000000002"];
const scope={start:"2026-10-01",end:"2026-10-07",status:"enabled",types:["SEARCH"],campaignIds:["123"]};
function recommendationSetup({simulation=false,fallback=false}={}) {
 const fake=createFakeSupabase({client_connections:ids.map((id,i)=>({client_id:id,provider:"google_ads",status:"connected",external_account_id:`123456789${i}`,updated_at:"2026-10-10"})),agent_runs:[]});
 let calls=0,contextRevision=1;
 const service=loadTs("lib/integrations/google-ads/recommendations-service.ts",{
  "@/lib/supabase/server":{getSupabaseServerClient:()=>fake.client},"@/lib/require-admin":{requireAdmin:async()=>({userId:"admin"})},"@/lib/simulation/server":{getActiveScenario:async()=>simulation},
  "@/lib/agents/data":{listAgentsForClient:async()=>[{enabled:true,agent_id:"agent",client_instructions:"Client instructions",agent:{agent_type:"google-ads",enabled:true,status:"Actif",instructions:"Global instructions"}}]},
  "./context-service":{getAdsBusinessContext:async()=>({available:true,revision:contextRevision,context:null})},"./scope":scopeModule,
  "@/lib/ai/providers":{selectAIProvider:()=>({id:"openai",model:"test-model"})},"@/lib/core/audit":{writeAudit:async()=>{}},
  "./service":{runGoogleAdsAnalysis:async(_agent,client)=>{calls++;const id=`run-${calls}`;fake.tables.agent_runs.push({id,client_id:client,agent_id:"agent",status:"completed",started_at:new Date().toISOString(),summary:"Short summary",metadata:{analysis_text:"Evidence-backed content",engine:fallback?"deterministic_fallback":"ai",ai_ms:10}});return {ok:true,runId:id,message:"Short summary"};}},
 },{performance});
 return {service,fake,count:()=>calls,changeContext:()=>contextRevision++};
}
test("five-minute persisted cache is isolated by client, scope and context; refresh is explicit", async()=>{
 const s=recommendationSetup(); const first=await s.service.getAdsRecommendation(ids[0],scope);
 assert.equal(first.reused,false); assert.equal((await s.service.getAdsRecommendation(ids[0],scope)).reused,true); assert.equal(s.count(),1);
 await s.service.getAdsRecommendation(ids[1],scope); assert.equal(s.count(),2);
 await s.service.getAdsRecommendation(ids[0],{...scope,campaignIds:["456"]});assert.equal(s.count(),3);
 s.changeContext(); await s.service.getAdsRecommendation(ids[0],scope);assert.equal(s.count(),4);
 await s.service.getAdsRecommendation(ids[0],scope,"ai",true);assert.equal(s.count(),5);
 s.fake.tables.agent_runs.forEach(r=>r.started_at="2000-01-01T00:00:00Z"); await s.service.getAdsRecommendation(ids[0],scope);assert.equal(s.count(),6);
 s.fake.tables.client_connections[0].status="error";assert.equal((await s.service.getAdsRecommendation(ids[0],scope)).ok,false);assert.equal(s.count(),6);
});
test("AI fallback is labelled, not cached as personalized AI; simulation never runs the engine",async()=>{
 const fallback=recommendationSetup({fallback:true});const result=await fallback.service.getAdsRecommendation(ids[0],scope);assert.equal(result.engine,"deterministic_fallback");
 await fallback.service.getAdsRecommendation(ids[0],scope);assert.equal(fallback.count(),2);
 const simulation=recommendationSetup({simulation:true});assert.equal((await simulation.service.getAdsRecommendation(ids[0],scope)).ok,false);assert.equal(simulation.count(),0);
});
const text=loadTs("lib/assistant/text.ts");const adsIntents=loadTs("lib/assistant/ads-intents.ts",{"@/lib/assistant/text":text});
const intents=loadTs("lib/assistant/intents.ts",{"@/lib/assistant/text":text,"@/lib/assistant/ads-intents":adsIntents});
const tools=loadTs("lib/assistant/tools.ts",{"@/lib/integrations/google-ads/periods":periods});
const orchestrator=loadTs("lib/assistant/orchestrator.ts",{"@/lib/assistant/tools":tools,"@/lib/assistant/intents":intents,"@/lib/assistant/ads-intents":adsIntents});
test("exact French voice/text recommendation request resolves named client and executes without proposal",async()=>{
 const question="Que me recommandes-tu pour les campagnes de Protection Nuisibles ?";
 assert.deepEqual(plain(intents.parseIntent(question,"2026-10-10")),{tool:"ads_recommendations",input:{client:"Protection Nuisibles"}});
 const executed=[];
 const reply=await orchestrator.respond([{role:"user",content:question}],{provider:null,today:"2026-10-10",execute:async(name,input)=>{executed.push([name,plain(input)]);return {ok:true,text:"Résumé court",view:{type:"table",title:"Preuves",columns:[],rows:[],empty:""}};}});
 assert.equal(reply.proposal,undefined); assert.equal(executed[0][0],"ads_recommendations"); assert.equal(reply.view.title,"Preuves");
 assert.equal(tools.toolDefinitions.ads_run_analysis.kind,"read");
});
test("ambiguous client remains a clarification, never an email or approval",async()=>{
 const reply=await orchestrator.respond([{role:"user",content:"Tes recommandations Ads ?"}],{provider:null,today:"2026-10-10",execute:async()=>({ok:false,text:"Pour quel client ?"})});
 assert.equal(reply.reply,"Pour quel client ?");assert.equal(reply.proposal,undefined);
 const yes=await orchestrator.respond([{role:"user",content:"oui"}],{provider:null,today:"2026-10-10",execute:async()=>{throw Error("must not execute");}});
 assert.equal(yes.proposal,undefined);
});

 test("changed frequency and pause/resume continue after the last finalized day; covered window is skipped", () => {
 const window=domain.nextOccurrence(config({frequency:"monthly",monthDay:31}),new Date("2026-10-10T12:00:00Z"));
 assert.equal(domain.continueOccurrenceWindow(window,"2026-10-15").start,"2026-10-16");
 assert.equal(domain.continueOccurrenceWindow(window,"2026-08-31").start,"2026-09-01");
 assert.equal(domain.continueOccurrenceWindow(window,window.end),null);
 });
