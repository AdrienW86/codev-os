import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import vm from "node:vm";
import ts from "typescript";
function load(path,mocks={}){const exports={};const source=readFileSync(new URL(`../${path}`,import.meta.url),"utf8");vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,console:{error(){}},require(name){if(name==="server-only")return {};if(name in mocks)return mocks[name];throw Error(`Unexpected ${name}`);}});return exports;}
const agent="11111111-1111-4111-8111-111111111111",project="22222222-2222-4222-8222-222222222222",client="33333333-3333-4333-8333-333333333333";
const validation=load("lib/agents/validation.ts");
test('inactive, disabled or partially loaded agents cannot obtain an execution context',async()=>{let reads=0;const {validateAgentContext}=load('lib/agents/scope.ts',{'@/lib/require-admin':{requireAdmin:async()=>({userId:'user_local'})}});const db={from:()=>{reads++;throw Error('No storage read allowed');}};for(const fields of [{enabled:false,status:'Actif'},{enabled:true,status:'Inactif'},{enabled:true},{status:'Actif'}])assert.equal(await validateAgentContext(db,{id:agent,agent_scope:'client',...fields},client,null),false);assert.equal(reads,0);});
test("scope matching fails closed for missing or unconfirmed project scopes",()=>{
 const {scopeMatches}=load("lib/agents/scope.ts",{"@/lib/require-admin":{requireAdmin:async()=>({userId:"user_admin"})}});
 assert.equal(scopeMatches({id:agent,agent_scope:"client"},null),true);assert.equal(scopeMatches({id:agent,agent_scope:"client"},project),false);
 assert.equal(scopeMatches({id:agent,agent_scope:"project",scope_review_required:false},project),true);assert.equal(scopeMatches({id:agent,agent_scope:"project",scope_review_required:false},null),false);
 for(const value of [{id:agent},{id:agent,agent_scope:"unknown"},{id:agent,agent_scope:"project"},{id:agent,agent_scope:"project",scope_review_required:true}])assert.equal(scopeMatches(value,project),false);
});
test("scope and assignment mutations use atomic RPCs with the session actor",async()=>{
 const calls=[];const repo=load("lib/agents/project-assignments.ts",{"./validation":validation,"@/lib/require-admin":{requireAdmin:async()=>({userId:"user_admin"})},"@/lib/supabase/server":{getSupabaseServerClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return{error:null};}})}});
 assert.equal((await repo.setAgentScope(agent,"project")).ok,true);assert.equal(calls[0].name,"agent_set_scope");assert.equal(calls[0].args.p_actor_id,"user_admin");
 assert.equal((await repo.setAgentProjectAssignment(agent,project,false)).ok,true);assert.equal(calls[1].name,"agent_project_assignment_set");assert.equal(calls[1].args.p_enabled,false);assert.equal("p_client_id" in calls[1].args,false);
 assert.equal((await repo.setAgentScope(agent,"specialist")).ok,false);assert.equal((await repo.setAgentProjectAssignment(agent,project,"true")).ok,false);assert.equal(calls.length,2);
});
test("scope and assignment services deny non-admin before any RPC",async()=>{
 let accessed=false;const repo=load("lib/agents/project-assignments.ts",{"./validation":validation,"@/lib/require-admin":{requireAdmin:async()=>{throw Error("denied");}},"@/lib/supabase/server":{getSupabaseServerClient:()=>{accessed=true;throw Error("storage");}}});
 await assert.rejects(()=>repo.setAgentScope(agent,"client"),/denied/);await assert.rejects(()=>repo.setAgentProjectAssignment(agent,project,true),/denied/);await assert.rejects(()=>repo.listAgentProjectAssignments({agentId:agent}),/denied/);assert.equal(accessed,false);
});
test("specialist test action derives client from the server project and rejects duplicate fields",async()=>{
 const calls=[];const action=load("app/(cockpit)/agents/[id]/scope-actions.ts",{"next/cache":{revalidatePath(){}},"@/lib/require-admin":{requireAdmin:async()=>({userId:"user_admin"})},"@/lib/agents/project-assignments":{},"@/lib/projects/data":{getProjectById:async id=>id===project?{id:project,client_id:client}:null},"@/lib/agent-runs/data":{createInternalTestRun:async(...args)=>{calls.push(args);return{ok:true,recommendationId:agent};}}});
 const form=new FormData();form.set("agent_id",agent);form.set("project_id",project);form.set("client_id","forged");form.set("actor_id","forged");await action.createProjectTestRunAction({},form);assert.deepEqual(Array.from(calls[0]),[agent,client,project]);
 form.append("project_id",project);assert.match((await action.createProjectTestRunAction({},form)).message,/indisponible/);assert.equal(calls.length,1);
});
