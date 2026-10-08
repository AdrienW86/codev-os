import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const native=createRequire(import.meta.url),root=resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'));
function load(file,mocks={}){const cache=new Map();const find=base=>[base+'.ts',base+'.tsx'].find(p=>existsSync(p))??base;
 function read(path){if(cache.has(path))return cache.get(path);const exports={};cache.set(path,exports);
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{exports,Map,Set,Object,JSON,console,require:name=>{if(name in mocks)return mocks[name];if(name==='server-only')return {};
   if(name.startsWith('@/'))return read(find(resolve(root,name.slice(2))));if(name.startsWith('.'))return read(find(resolve(dirname(path),name)));return native(name);}});
  return exports;}
 return read(resolve(root,file));}
const json=value=>JSON.parse(JSON.stringify(value));
const src=file=>readFileSync(resolve(root,file),'utf8');
const uid=(prefix,n)=>`${prefix}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const C=uid(1,1),P=uid(3,1),G=uid(7,1),G2=uid(7,2);
const model=load('lib/publications/editorial-group-model.ts');
const group={id:G,client_id:C,project_id:P,subject:'Entretien de toiture',origin:'manual'};
const pub=(n,platform,extra={})=>({id:uid(4,n),editorial_group_id:G,occurrence_id:uid(5,n),platform,subject:'S'+n,status:'draft',editorial_week:'2026-10-12',client_id:C,project_id:P,...extra});

test('pure model: sisters sorted by platform, mono-platform vs legacy, missing platforms, duplicates',()=>{
 const v=model.buildEditorialGroupView(group,[pub(3,'google_business_profile'),pub(1,'facebook'),pub(9,'instagram',{editorial_group_id:G2}),pub(8,null)],['facebook','instagram','google_business_profile']);
 assert.deepEqual(json(v.sisters.map(s=>[s.platform,s.platformLabel,s.bound])),[['facebook','Facebook',true],['google_business_profile','Google Business Profile',true]],'other groups and platform-less rows ignored');
 assert.deepEqual(json(v.missingPlatforms),['instagram']);assert.equal(v.subject,'Entretien de toiture');
 assert.equal(model.publicationKind({platform:null}),'legacy');assert.equal(model.publicationKind({}),'legacy');assert.equal(model.publicationKind({platform:'facebook'}),'mono_platform');
 assert.deepEqual(json(model.duplicateSisterPlatforms(['facebook','instagram','facebook',null,null])),['facebook']);assert.deepEqual(json(model.duplicateSisterPlatforms(['facebook','instagram','google_business_profile'])),[]);
 assert.deepEqual(json(model.buildEditorialGroupView(group,[]).sisters),[],'empty group');});

function mockDb(tables,{fail=[]}={}){const log=[];
 return {log,from(table){const f=[];const rows=()=>fail.includes(table)?{data:null,error:{message:'down'}}:{data:json((tables[table]??[]).filter(r=>f.every(x=>x(r)))),error:null};
  const q={select:()=>q,order:()=>q,eq(k,v){f.push(r=>r[k]===v);return q;},in(k,vs){log.push(['in',table,vs.length]);f.push(r=>vs.includes(r[k]));return q;},
   maybeSingle:async()=>{const r=rows();return {data:r.data?.[0]??null,error:r.error};},then(ok,ko){log.push(['read',table]);return Promise.resolve(rows()).then(ok,ko);}};return q;}};}
function service(tables,options){const db=mockDb(tables,options),calls=[];
 return {db,calls,m:load('lib/publications/editorial-groups.ts',{'@/lib/require-admin':{requireAdmin:async()=>{calls.push('admin');return {userId:'user_admin'};}},'@/lib/supabase/server':{getSupabaseServerClient:()=>{calls.push('db');return db;}}})};}

test('loaders: admin first, groups then sisters in one batch (no N+1), scope enforced, fail closed',async()=>{
 const groups=Array.from({length:150},(_,i)=>({id:uid(7,i+1),client_id:C,project_id:P,subject:'G'+i,origin:'manual'}));
 const publications=[pub(1,'facebook'),pub(2,'instagram'),pub(3,'google_business_profile',{client_id:uid(1,9)}),pub(4,'facebook',{editorial_group_id:uid(7,2)})];
 const s=service({publication_editorial_groups:groups,publications});const views=await s.m.getProjectEditorialGroups(P);
 assert.equal(s.calls[0],'admin');assert.equal(views.length,150);assert.deepEqual(json(s.db.log.filter(x=>x[0]==='in').map(x=>x[2])),[100,50],'sisters read per 100 groups');
 assert.deepEqual(json(views[0].sisters.map(x=>x.platform)),['facebook','instagram'],'a publication of another client is ignored');assert.equal(views[1].sisters.length,1);
 const one=await service({publication_editorial_groups:groups,publications}).m.getEditorialGroup(G);assert.equal(one.groupId,G);
 assert.equal(await service({publication_editorial_groups:groups,publications}).m.getEditorialGroup('bad'),null);
 for(const table of ['publication_editorial_groups','publications'])await assert.rejects(()=>service({publication_editorial_groups:groups,publications},{fail:[table]}).m.getProjectEditorialGroups(P),/Groupes éditoriaux indisponibles/,table);
 await assert.rejects(()=>service({}).m.getProjectEditorialGroups('bad'),/Groupes éditoriaux indisponibles/);
 const empty=service({publication_editorial_groups:[],publications});assert.deepEqual(json(await empty.m.getProjectEditorialGroups(P)),[]);assert.ok(!empty.db.log.some(x=>x[1]==='publications'),'no publication read without group');});

test('P4-a scope: additive migration, legacy kept, no creation path / agent / publisher yet',()=>{
 const list=readdirSync(resolve(root,'supabase/migrations')).sort();assert.equal(list.length,18);assert.equal(list[12],'20261008010000_publications_editorial_groups.sql');
 const sql=src('supabase/migrations/20261008010000_publications_editorial_groups.sql').replace(/--[^\n]*/g,'');
 assert.doesNotMatch(sql,/drop table|drop column|delete from|truncate (table )?public|security definer|update public\.publications set|insert into public\.publications/i,'no destructive change, no data conversion');
 assert.equal((sql.match(/drop index/gi)??[]).length,1,'only the weekly slot index is redefined');
 assert.match(sql,/create unique index publications_project_week_slot_key on public\.publications\(client_id,project_id,editorial_week,slot\)\s+where project_id is not null and occurrence_id is null;/,'legacy two-slot bound identical for non-occurrence publications');
 assert.match(sql,/add column editorial_group_id uuid,\s+add column occurrence_id uuid,\s+add column platform text/,'nullable additive columns');
 for(const f of ['lib/publications/editorial-groups.ts','lib/publications/editorial-group-model.ts'])assert.doesNotMatch(src(f).replace(/\/\/[^\n]*/g,''),/\.insert\(|\.update\(|\.delete\(|\.rpc\(|openai|drive|publisher|cron/i,f);
 assert.ok(!JSON.stringify(readdirSync(resolve(root,'components'),{recursive:true})).includes('editorial-group'),'no UI yet');});
