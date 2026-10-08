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
  vm.runInNewContext(code,{exports,Map,Set,Object,JSON,Number,Date,Intl,FormData,URLSearchParams,console,require:name=>{if(name in mocks)return mocks[name];if(name==='server-only')return {};
   if(name.startsWith('@/'))return read(find(resolve(root,name.slice(2))));if(name.startsWith('.'))return read(find(resolve(dirname(path),name)));return native(name);}});
  return exports;}
 return read(resolve(root,file));}
const json=value=>JSON.parse(JSON.stringify(value));
const src=file=>readFileSync(resolve(root,file),'utf8');
const uid=(prefix,n)=>`${prefix}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const PUB=uid(4,1),P=uid(3,1);
const bq=load('lib/publications/board-query.ts');
const record=(n,extra={})=>({id:uid(4,n),clientId:'c',clientName:'C',projectId:P,projectName:'P',date:'2026-10-12',dateIsWeek:false,status:'draft',rawStatus:'draft',subject:'S'+n,preview:'',search:'s'+n,
 platforms:['facebook'],origin:'manual',edited:false,updatedAt:'x',revisionId:null,revisionNumber:null,creationOrigin:'manual',imagePath:null,hasMedia:false,missingMedia:[],hidden:false,archived:false,deliveries:{published:0,total:0},...extra});

test('board: archived publications leave the active view and appear only in « Archivées »; canonical URL',()=>{
 assert.equal(bq.parseBoardQuery({}).archived,false);assert.equal(bq.parseBoardQuery({archived:'1'}).archived,true);assert.equal(bq.parseBoardQuery({archived:'yes'}).archived,false);
 assert.match(bq.boardHref(bq.parseBoardQuery({archived:'1'})),/archived=1/);assert.doesNotMatch(bq.boardHref(bq.parseBoardQuery({})),/archived/);
 const rows=[record(1),record(2,{archived:true}),record(3,{archived:true,hidden:true})];
 assert.deepEqual(json(bq.selectBoardRows(rows,bq.parseBoardQuery({})).rows.map(r=>r.subject)),['S1'],'active view excludes archives');
 assert.deepEqual(json(bq.selectBoardRows(rows,bq.parseBoardQuery({archived:'1'})).rows.map(r=>r.subject)),['S2'],'archived view: archives only (removed ones still need hidden=1)');
 assert.deepEqual(json(bq.selectBoardRows(rows,bq.parseBoardQuery({archived:'1',hidden:'1'})).rows.map(r=>r.subject)).sort(),['S2','S3']);
 const legacy={...record(4)};delete legacy.archived;assert.equal(bq.selectBoardRows([legacy],bq.parseBoardQuery({})).rows.length,1,'record without the flag stays active');
 assert.match(src('lib/publications/board.ts'),/const publicationColumns='id,client_id,project_id,platform,archived_at,/);assert.match(src('lib/publications/board.ts'),/archived:Boolean\(p\.archived_at\)/);
 assert.match(src('components/publications/board-filter-bar.tsx'),/name="archived"[^>]*><option value="">Actives<\/option><option value="1">Archivées<\/option>/);});

test('drawer: an archived publication is read-only and shows « Archivée »; the archive action needs a confirmation',()=>{
 const detail=load('lib/publications/publication-detail.ts');const w={variants:[{id:'v',revision_id:'r',platform:'facebook',text_content:'T',metadata:{}}],links:[],assets:[],revisions:[{id:'r',revision_number:1,origin:'manual',created_at:'x'}],reviews:[],events:[]};
 const base={id:PUB,client_id:'c',project_id:P,current_revision_id:'r',status:'draft',subject:'S',target_date:'2026-10-12',editorial_week:'2026-10-12',creation_origin:'manual',updated_at:'x'};
 const archived=detail.buildPublicationDetail({publication:{...base,archived_at:'2026-10-08T00:00:00Z'},clientName:'C',projectName:'P',workspace:w,slot:null,deliveries:[],debug:null});
 assert.equal(archived.archived,true);assert.equal(archived.readOnly,true);assert.equal(archived.readOnlyReason,'Publication archivée : lecture seule.');assert.equal(archived.versions.length,1,'history kept');
 const active=detail.buildPublicationDetail({publication:base,clientName:'C',projectName:'P',workspace:w,slot:null,deliveries:[],debug:null});assert.equal(active.archived,false);assert.equal(active.readOnly,false);
 const drawer=src('components/publications/publication-drawer.tsx');assert.match(drawer,/\{!detail\.archived&&<ArchiveSection detail=\{detail\}\/>\}/);assert.match(drawer,/data-archived="true"[^>]*>Archivée</);
 assert.match(drawer,/name="confirm" required\/> Je confirme l’archivage définitif/);assert.doesNotMatch(drawer,/supprimer|delete/i);});

function mockDb(rpc){const log=[];return {log,rpc:async(name,args)=>{log.push([name,json(args)]);return rpc?rpc():{data:'2026-10-08T00:00:00Z',error:null};}};}
test('archive service and action: admin first, one RPC, errors mapped, confirmation required, no delete',async()=>{
 const make=rpc=>{const db=mockDb(rpc),calls=[];return {db,calls,m:load('lib/publications/archive.ts',{'@/lib/require-admin':{requireAdmin:async()=>{calls.push('admin');return {userId:'user_admin'};}},'@/lib/supabase/server':{getSupabaseServerClient:()=>db}})};};
 const ok=make();assert.equal((await ok.m.archivePublication(PUB)).ok,true);assert.equal(ok.calls[0],'admin');assert.deepEqual(ok.db.log,[['publication_archive',{p_publication_id:PUB,p_actor_id:'user_admin'}]]);
 const bad=make();assert.equal((await bad.m.archivePublication('nope')).ok,false);assert.deepEqual(bad.db.log,[],'invalid id: no RPC');
 assert.match((await make(()=>({data:null,error:{code:'55000',message:'Publication already archived'}})).m.archivePublication(PUB)).message,/déjà archivée/);
 assert.match((await make(()=>({data:null,error:{code:'55000',message:'Resolve deliveries first'}})).m.archivePublication(PUB)).message,/envoi est encore actif/);
 const calls=[];const actions=load('app/(cockpit)/publications/drawer-actions.ts',{'next/cache':{revalidatePath:p=>calls.push(['revalidate',p])},'@/lib/require-admin':{requireAdmin:async()=>{calls.push('admin');}},
  '@/lib/publications/workspace':{},'@/lib/publications/drawer':{deliveryLock:async()=>null},'@/lib/publications/archive':{archivePublication:async id=>{calls.push(['archive',id]);return {ok:true,message:'ok'};}}});
 const form=entries=>{const f=new FormData();for(const [k,v] of Object.entries(entries))f.set(k,v);return f;};
 assert.match((await actions.archiveFromDrawerAction({},form({publication_id:PUB,project_id:P}))).message,/Cochez la confirmation/);assert.ok(!calls.some(c=>c[0]==='archive'));
 calls.length=0;assert.equal((await actions.archiveFromDrawerAction({},form({publication_id:PUB,project_id:P,confirm:'on'}))).ok,true);assert.deepEqual(json(calls.slice(0,2)),['admin',['archive',PUB]]);assert.ok(calls.some(c=>c[1]==='/publications'));});

test('write lock: every guarded write path refuses an archived publication (save, media, approval, agent)',async()=>{
 const db={from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{project_id:P,client_id:'c',current_revision_id:'r',archived_at:'2026-10-08T00:00:00Z'},error:null})};return q;}};
 const m=load('lib/publications/project-channels.ts',{'@/lib/require-admin':{requireAdmin:async()=>({userId:'user_admin'})},'@/lib/supabase/server':{getSupabaseServerClient:()=>db}});
 assert.equal(await m.publicationChannelLock(PUB),'Publication archivée : lecture seule.');
 for(const [file,needle] of [['lib/publications/workspace.ts','publicationChannelLock(input.publication_id)'],['lib/publications/workspace.ts','publicationChannelLock(id)'],['lib/publications/agent-service.ts','publicationChannelLock(publicationId)']])assert.ok(src(file).includes(needle),`${file}: ${needle}`);});

test('P5 scope: one additive migration, one-way archive, no delete / restore / group or occurrence archive',()=>{
 const list=readdirSync(resolve(root,'supabase/migrations')).sort();assert.equal(list.length,15);assert.equal(list[14],'20261008030000_publications_archiving.sql');
 const sql=src('supabase/migrations/20261008030000_publications_archiving.sql').replace(/--[^\n]*/g,'');
 assert.doesNotMatch(sql,/\bdrop |delete from|truncate (table )?public|security definer|publication_editorial_groups|publication_channel_occurrences|unarchive|restore/i);
 assert.match(sql,/add column archived_at timestamptz,\s+add column archived_by text/);
 for(const f of ['lib/publications/archive.ts','app/(cockpit)/publications/drawer-actions.ts'])assert.doesNotMatch(src(f).replace(/\/\/[^\n]*/g,''),/\.delete\(|openai|drive|publisher|cron/i,f);});
