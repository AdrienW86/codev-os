import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import vm from "node:vm";
import ts from "typescript";
function load(path,mocks={}){const source=readFileSync(new URL(`../${path}`,import.meta.url),"utf8");const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,console:{error(){}},require(name){if(name==="server-only")return {};if(name in mocks)return mocks[name];throw Error(`Unexpected ${name}`);}});return exports;}
const period=load("lib/reporting/period.ts"),aggregate=load("lib/reporting/aggregate.ts",{"./period":period});
const clientId="11111111-1111-4111-8111-111111111111",otherClient="22222222-2222-4222-8222-222222222222",p1="p1",p2="p2";
function fixture(){return {client:{id:clientId,name:"Jrenov",notes:"Priorité maintenance"},projects:[{id:p1,client_id:clientId,name:"SEO"},{id:p2,client_id:clientId,name:"Social"},{id:"foreign",client_id:otherClient}],runs:[],recommendations:[],actions:[],tasks:[],publications:[],deliveries:[],jobs:[],revisions:[],variants:[],attempts:[]};}
const row=(id,project_id,extra={})=>({id,client_id:clientId,project_id,...extra});
test("monthly boundaries follow Paris midnight including DST and December rollover",()=>{
 assert.equal(period.summaryPeriod("2026-03").start,"2026-02-28T23:00:00.000Z");assert.equal(period.summaryPeriod("2026-03").endExclusive,"2026-03-31T22:00:00.000Z");
 assert.equal(period.summaryPeriod("2026-10").endExclusive,"2026-10-31T23:00:00.000Z");assert.equal(period.summaryPeriod("2026-12").endExclusive,"2026-12-31T23:00:00.000Z");
 assert.equal(period.previousSummaryMonth(new Date("2026-01-15T00:00:00Z")),"2025-12");for(const input of ["2026-13","2026-00","2026-1","2026-09-01","garbage"])assert.throws(()=>period.summaryPeriod(input));
});
test("multi-project aggregation separates scopes, deduplicates and excludes other clients",()=>{
 const input=fixture();const a=row("run1",p1,{started_at:"2026-09-01T08:00:00Z",completed_at:null,status:"completed"});input.runs=[a,a,row("run2",p2,{started_at:"2026-09-15T08:00:00Z"}),row("manager",null,{started_at:"2026-09-02T08:00:00Z"}),{...a,id:"foreign",client_id:otherClient}];
 input.actions=[row("executed",p1,{status:"executed",executed_at:"2026-09-15T00:00:00Z"}),row("approved",p2,{status:"approved",executed_at:null})];
 input.tasks=[row("finished",p2,{status:"Terminé",completed_at:"2026-09-20T00:00:00Z"}),row("undated",p2,{status:"Terminé",completed_at:null}),row("upcoming",p2,{status:"En cours",due_date:"2026-10-05"})];
 input.recommendations=[row("rec",p1,{created_at:"2026-09-12T00:00:00Z",status:"pending",payload:{}})];
 const c=aggregate.aggregateClientMonthlySummary(input,"2026-09");assert.equal(c.projects.length,2);assert.equal(c.totals.runs,3);assert.equal(c.projects[0].activity.runs.length,1);assert.equal(c.projects[1].activity.runs.length,1);assert.equal(c.clientActivity.runs.length,1);assert.equal(c.projects[0].activity.executedActions.length,1);assert.equal(c.projects[1].activity.completedTasks.length,1);assert.equal(c.dataQuality.undatedCompletedTasks[0],"undated");assert.equal(c.projects[1].activity.upcomingTasks.length,1);
});
test("half-open month boundaries never borrow events from the next month",()=>{
 const input=fixture();input.runs=[row("start",p1,{started_at:"2026-08-31T22:00:00Z"}),row("end",p1,{started_at:"2026-09-30T22:00:00Z"}),row("before",p1,{started_at:"2026-08-31T21:59:59Z"})];
 const c=aggregate.aggregateClientMonthlySummary(input,"2026-09");assert.equal(c.totals.runs,1);assert.equal(c.projects[0].activity.runs[0].id,"start");
});
test("delivery history uses the revision project, not the publication's new target",()=>{
 const i=fixture();i.publications=[row("pub",p2,{created_at:"2026-09-01T00:00:00Z"})];i.revisions=[row("rev",p1,{publication_id:"pub"})];i.variants=[row("variant",undefined,{revision_id:"rev",publication_id:"pub"})];const d=row("delivery",undefined,{publication_id:"pub",variant_id:"variant",status:"published",scheduled_for:"2026-09-05T00:00:00Z",published_at:"2026-09-05T01:00:00Z"});i.deliveries=[d,d,{...d,id:"old",published_at:null}];i.jobs=[{id:"job",publication_id:"pub",revision_id:"rev",delivery_id:"delivery",status:"failed",updated_at:"2026-09-06T00:00:00Z"}];i.attempts=[{id:"attempt",job_id:"job",result:"failed",created_at:"2026-09-05T00:00:00Z"}];
 const c=aggregate.aggregateClientMonthlySummary(i,"2026-09");assert.equal(c.projects[0].activity.published.length,1);assert.equal(c.projects[1].activity.published.length,0);assert.equal(c.projects[0].activity.incidents.length,2);assert.equal(c.dataQuality.undatedPublishedDeliveries[0],"old");assert.equal(c.totals.published,1);
});
test("persisted metrics are deduplicated observations, never fabricated monthly results",()=>{
 const i=fixture();const payload={source:"google_ads_read_only",account_id:"ads",currency:"EUR",period:{start:"2026-09-01",end:"2026-09-30"},totals:{cost:200,conversions:4,costPerConversion:50,token:"secret",averageCpc:null}};
 i.recommendations=[row("one",null,{created_at:"2026-09-30T10:00:00Z",payload}),row("two",null,{created_at:"2026-09-30T11:00:00Z",payload}),row("partial",p1,{created_at:"2026-09-20T00:00:00Z",payload:{...payload,period:{start:"2026-09-10",end:"2026-09-19"}}}),row("other-month",p1,{created_at:"2026-09-20T00:00:00Z",payload:{...payload,period:{start:"2026-08-01",end:"2026-08-31"}}})];
 const c=aggregate.aggregateClientMonthlySummary(i,"2026-09");assert.equal(c.clientActivity.metrics.length,1);assert.equal(c.clientActivity.metrics[0].recommendation_id,"two");assert.equal(c.clientActivity.metrics[0].coverage,"full_month");assert.equal(c.projects[0].activity.metrics.length,1);assert.equal(c.projects[0].activity.metrics[0].coverage,"partial_period");assert.equal(c.projects[1].activity.metrics.length,0);assert.equal("token" in c.clientActivity.metrics[0].values,false);assert.equal("averageCpc" in c.clientActivity.metrics[0].values,false);
});
test("summary refuses non-admin before storage and paginates without remote providers",async()=>{
 const validation=load("lib/agents/validation.ts");const calls=[];
 const db={from(table){calls.push(table);let start=0,end=0;const q={select(){return q;},eq(){return q;},order(){return q;},range(s,e){start=s;end=e;return q;},in(){return q;},single:async()=>({data:fixture().client,error:null}),then(resolve){const data=table==="projects"?Array.from({length:205},(_,n)=>row(`p${n}`,undefined)).slice(start,end+1):[];return Promise.resolve({data,error:null}).then(resolve);}};return q;}};
 const mocks={"@/lib/agents/validation":validation,"./period":period,"./aggregate":aggregate,"@/lib/supabase/server":{getSupabaseServerClient:()=>db},"@/lib/require-admin":{requireAdmin:async()=>{throw Error("denied");}}};
 const denied=load("lib/reporting/data.ts",mocks);await assert.rejects(()=>denied.buildClientMonthlySummaryContext(clientId,"2026-09"),/denied/);assert.equal(calls.length,0);
 mocks["@/lib/require-admin"]={requireAdmin:async()=>({userId:"user_admin"})};const repository=load("lib/reporting/data.ts",mocks);const context=await repository.buildClientMonthlySummaryContext(clientId,"2026-09");assert.equal(context.projects.length,205);assert.equal(calls.includes("client_connections"),false);
});
test("summary storage errors fail explicitly instead of producing an empty report",async()=>{
 const validation=load("lib/agents/validation.ts");const repo=load("lib/reporting/data.ts",{"@/lib/agents/validation":validation,"./period":period,"./aggregate":aggregate,"@/lib/require-admin":{requireAdmin:async()=>({userId:"user_admin"})},"@/lib/supabase/server":{getSupabaseServerClient:()=>({from(){return{select(){return this;},eq(){return this;},single:async()=>({data:null,error:{message:"sensitive SQL"}})}}})}});
 await assert.rejects(()=>repo.buildClientMonthlySummaryContext(clientId,"2026-09"),error=>/indisponible/.test(error.message)&&!error.message.includes("sensitive"));
});
