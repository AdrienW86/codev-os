import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

// Lot 4.3 P12 — real Google Business Profile publisher. Every provider answer is a mock: no request leaves the machine.
const native=createRequire(import.meta.url),root=resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'));
function load(file,mocks={}){const cache=new Map();const find=base=>[base+'.ts',base+'.tsx'].find(p=>existsSync(p))??base;
 function read(path){if(cache.has(path))return cache.get(path);const exports={};cache.set(path,exports);
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{exports,Map,Set,Object,JSON,Number,Date,Intl,Error,URL,URLSearchParams,console,Promise,Array,String,Math,Buffer,Uint8Array,TextEncoder,AbortSignal,Symbol,RegExp,process:{env:{}},
   require:name=>{if(name in mocks)return mocks[name];if(name==='server-only')return {};
    if(name.startsWith('@/'))return read(find(resolve(root,name.slice(2))));if(name.startsWith('.'))return read(find(resolve(dirname(path),name)));return native(name);}});
  return exports;}
 return read(resolve(root,file));}
const json=value=>JSON.parse(JSON.stringify(value));
const src=file=>readFileSync(resolve(root,file),'utf8');

// Vérification automatique des posts Google en relecture : lecture seule, au nom de l'approbateur, seul « retrouvé » est écrit.
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const reg=load('lib/publications/delivery/registry.ts',{'@/lib/require-admin':{requireAdmin:async()=>({userId:'user_admin'})},'@/lib/admin-policy':{isAuthorizedAdmin:u=>u==='user_admin'},
 '@/lib/supabase/server':{getSupabaseServerClient:()=>({})},'@/lib/integrations/publications-oauth/config':{},'@/lib/integrations/publications-oauth/http':{},'@/lib/integrations/publications-meta-publish':{},
 '@/lib/integrations/publications-gbp-publish':{},'../oauth/service':{},'../connections/google-business-profile':{},'./meta-publisher':{},'./gbp-publisher':{},'./engine':{},
 '../connections/vault':{isCredentialReference:r=>r==='vault:ref'}});
const LOC='accounts/1/locations/2';
function deps({rows,found={},approver='user_admin'}){
 const rpcs=[],reads=[];
 return {rpcs,reads,deps:{
  list:async(since,limit)=>{reads.push(['list',since,limit]);return {data:rows,error:null};},
  approver:async()=>approver,isAdmin:u=>u==='user_admin',now:()=>Date.parse('2026-10-23T15:00:00Z'),
  vault:{readCredential:async()=>({accessToken:'t'})},
  reconcilers:{google_business_profile:{reconcile:async d=>{reads.push(['reconcile',d.text]);const id=found[d.text];return id?{status:'exists',remoteId:id}:{status:'unknown',remoteId:null};}}},
  db:{rpc:async(name,args)=>{rpcs.push([name,args]);
    if(name==='publication_delivery_reconcile_context_checked')return {data:{attempt_id:uid(9),platform:'google_business_profile',remote_id:null,connection_id:uid(8),account:{external_account_id:LOC,parent_external_id:null},text:'texte '+args.p_delivery_id.slice(-1),since:null},error:null};
    return {data:{status:'published'},error:null};},
   from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{credential_reference:'vault:ref',status:'active'},error:null})})})})}}};
}

test('auto reconcile: a post now LIVE is marked published as the approving admin; a pending one writes nothing',async()=>{
 const t=deps({rows:[{id:uid(1),publication_id:uid(11),revision_id:uid(21)},{id:uid(2),publication_id:uid(12),revision_id:uid(22)}],found:{'texte 1':LOC+'/localPosts/5'}});
 assert.deepEqual(json(await reg.reconcilePendingGoogleDeliveries(t.deps)),{checked:2,published:1,pending:1,skipped:0});
 const saved=t.rpcs.filter(([n])=>n==='publication_delivery_reconcile_checked');
 assert.equal(saved.length,1,'only the found post is recorded');
 assert.deepEqual(json(saved[0][1]),{p_delivery_id:uid(1),p_attempt_id:uid(9),p_status:'exists',p_remote_id:LOC+'/localPosts/5',p_actor_id:'user_admin'});
 assert.deepEqual(t.reads[0],['list','2026-10-16T15:00:00.000Z',5],'bounded: 5 deliveries of the last 7 days');
});

test('auto reconcile: no authorised approver → nothing is read nor written',async()=>{
 const t=deps({rows:[{id:uid(1),publication_id:uid(11),revision_id:uid(21)},{id:'bad',publication_id:uid(12),revision_id:uid(22)}],approver:'user_someone_else'});
 assert.deepEqual(json(await reg.reconcilePendingGoogleDeliveries(t.deps)),{checked:0,published:0,pending:0,skipped:2});
 assert.equal(t.rpcs.length,0);
});

test('scheduled due: reconciliation runs after the sends, only with time left, and never breaks the summary',async()=>{
 const on={emergency_stop:false,publishing_enabled:true},env={PUBLICATIONS_SCHEDULED_DELIVERY:'enabled'};
 const settings={from:()=>({select:()=>({limit:()=>({maybeSingle:async()=>({data:on,error:null})})})})};
 const run=async()=>({state:'idle'});let calls=0;
 const reconcile=async()=>{calls++;return {checked:1,published:1,pending:0,skipped:0};};
 const r=await reg.processScheduledDuePublications(env,{db:settings,run},{deadline:200_000,clock:()=>0,reconcile});
 assert.equal(calls,1);assert.deepEqual(json(r.reconciled),{checked:1,published:1,pending:0,skipped:0});
 await reg.processScheduledDuePublications(env,{db:settings,run},{deadline:30_000,clock:()=>0,reconcile});
 assert.equal(calls,1,'skipped when less than its budget remains');
 const broken=await reg.processScheduledDuePublications(env,{db:settings,run},{reconcile:async()=>{throw Error('x');}});
 assert.equal(broken.ok,true);assert.equal(broken.reconciled,undefined);
 assert.deepEqual(json(await reg.processScheduledDuePublications({},{db:settings,run},{reconcile})),{disabled:true});assert.equal(calls,1);
 // Tests et bouton : sans reconcile explicite, des deps fournies n'appellent jamais Google.
 assert.equal((await reg.processScheduledDuePublications(env,{db:settings,run})).reconciled,undefined);
});
