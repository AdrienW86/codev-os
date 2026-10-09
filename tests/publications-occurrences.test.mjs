import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const native=createRequire(import.meta.url),root=resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'));
function load(file,mocks={}){const cache=new Map();const find=base=>[base+'.ts',base+'.tsx'].find(p=>existsSync(p))??base;
 function read(path){if(cache.has(path))return cache.get(path);const exports={};cache.set(path,exports);
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{exports,Map,Set,Object,JSON,Number,Date,Intl,FormData,URLSearchParams,console,require:name=>{if(name in mocks)return mocks[name];if(name==='react/jsx-runtime')return jsx;if(name==='react')return React;if(name==='server-only')return {};
   if(name.startsWith('@/'))return read(find(resolve(root,name.slice(2))));if(name.startsWith('.'))return read(find(resolve(dirname(path),name)));return native(name);}});
  return exports;}
 return read(resolve(root,file));}
const json=value=>JSON.parse(JSON.stringify(value));
const src=file=>readFileSync(resolve(root,file),'utf8');
const uid=(prefix,n)=>`${prefix}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const C=uid(1,1),P=uid(3,1),PUB=uid(4,1);
const model=load('lib/publications/occurrence-model.ts');
const now=new Date('2026-10-14T08:00:00Z');
const row=(n,platform,date,time,extra={})=>({id:uid(5,n),client_id:C,platform,local_date:date,local_time:time+':00',timezone:'Europe/Paris',scheduled_for:`${date}T10:00:00Z`,publication_id:null,skipped_at:null,skipped_reason:null,...extra});

test('pure model: state, sort by date / time / platform, labels, linked publication',()=>{
 const rows=[row(1,'instagram','2026-10-17','11:00'),row(2,'facebook','2026-10-12','12:00'),row(3,'google_business_profile','2026-10-14','12:00'),row(4,'facebook','2026-10-14','12:00'),
  row(5,'instagram','2026-10-13','18:00',{skipped_at:'2026-10-10T00:00:00Z',skipped_reason:'Jour férié'}),row(6,'facebook','2026-10-16','12:00',{publication_id:PUB})];
 const e=model.buildOccurrenceEntries(rows,[{id:PUB,subject:'Conseils',status:'pending_review'}],now);
 assert.deepEqual(json(e.map(x=>[x.date,x.time,x.platform,x.state])),[['2026-10-12','12:00','facebook','missed'],['2026-10-13','18:00','instagram','skipped'],['2026-10-14','12:00','facebook','open'],
  ['2026-10-14','12:00','google_business_profile','open'],['2026-10-16','12:00','facebook','linked'],['2026-10-17','11:00','instagram','open']],'date, then time, then platform');
 assert.deepEqual(json(e[4].publication),{id:PUB,subject:'Conseils',status:'pending_review'});assert.equal(e[1].skippedReason,'Jour férié');assert.equal(e[3].platformLabel,'Google Business Profile');
 assert.deepEqual(json(model.occurrenceStateLabels),{open:'À préparer',missed:'Passée sans publication',linked:'Publication liée',skipped:'Ignorée'});
 assert.deepEqual(json(model.buildOccurrenceEntries([],[],now)),[],'0 occurrence');});

test('preparation period: 1, 2 or 4 weeks from today inclusive, default 4; anything else refused',()=>{
 assert.deepEqual(json(model.PREPARE_WEEK_OPTIONS),[1,2,4]);assert.equal(model.DEFAULT_PREPARE_WEEKS,4);
 assert.deepEqual(json(model.preparationPeriod('2026-10-14',1)),{start:'2026-10-14',end:'2026-10-20'});
 assert.deepEqual(json(model.preparationPeriod('2026-10-14',4)),{start:'2026-10-14',end:'2026-11-10'});
 for(const w of [0,3,5,12,-1,1.5,NaN])assert.equal(model.preparationPeriod('2026-10-14',w),null,String(w));assert.equal(model.preparationPeriod('bad',1),null);});

test('result messages: success counts and explicit DST conflict; strict result parsing',()=>{
 assert.equal(model.ensureResultMessage({created:12,existing:0,dst_conflicts:0,channels:3,conflicts:[]}),'12 occurrences préparées. Aucune publication n’est créée ni diffusée.');
 assert.equal(model.ensureResultMessage({created:1,existing:4,dst_conflicts:0,channels:1,conflicts:[]}),'1 occurrence préparée · 4 déjà présentes. Aucune publication n’est créée ni diffusée.');
 assert.equal(model.ensureResultMessage({created:0,existing:0,dst_conflicts:1,channels:1,conflicts:[{platform:'google_business_profile',local_date:'2026-03-29',local_time:'02:30',timezone:'Europe/Paris'}]}),
  '0 occurrence préparée. 1 créneau non créé : heure inexistante lors du passage à l’heure d’été (Google Business Profile le 29/03/2026 à 02:30). Ajustez l’horaire de ces créneaux si nécessaire.');
 assert.deepEqual(json(model.parseEnsureResult({created:2,existing:1,dst_conflicts:0,channels:2,conflicts:[]})),{created:2,existing:1,dst_conflicts:0,channels:2,conflicts:[]});
 for(const bad of [null,[],{created:-1,existing:0,dst_conflicts:0,channels:0,conflicts:[]},{created:1,existing:0,dst_conflicts:0,channels:0},{created:'1',existing:0,dst_conflicts:0,channels:0,conflicts:[]}])assert.equal(model.parseEnsureResult(bad),null);});

// In-memory Supabase double with filters, ranges, thenable queries and an RPC log.
function mockDb(tables,{fail=[],rpc}={}){const log=[];
 return {log,from(table){const f=[];const rows=()=>fail.includes(table)?{data:null,error:{message:'down'}}:{data:json((tables[table]??[]).filter(r=>f.every(x=>x(r)))),error:null};
   const q={select:()=>q,order:()=>q,eq(k,v){f.push(r=>r[k]===v);return q;},gte(k,v){f.push(r=>r[k]>=v);return q;},lte(k,v){f.push(r=>r[k]<=v);return q;},in(k,vs){log.push(['in',table,vs.length]);f.push(r=>vs.includes(r[k]));return q;},
    range:async(a,z)=>{log.push(['range',table,a]);const r=rows();return {data:r.data?.slice(a,z+1)??null,error:r.error};},then(ok,ko){return Promise.resolve(rows()).then(ok,ko);}};return q;},
  rpc:async(name,args)=>{log.push(['rpc',name,json(args)]);return rpc?rpc(name,args):{data:{created:5,existing:0,dst_conflicts:0,channels:3,conflicts:[]},error:null};}};}
function service(tables,options){const db=mockDb(tables,options),calls=[];
 return {db,calls,m:load('lib/publications/occurrences.ts',{'@/lib/require-admin':{requireAdmin:async()=>{calls.push('admin');return {userId:'user_admin'};}},'@/lib/supabase/server':{getSupabaseServerClient:()=>{calls.push('db');return db;}}})};}

test('server reads: admin first, paginated occurrences, one batched publication read (no N+1), fail closed',async()=>{
 const many=Array.from({length:130},(_,i)=>({...row(i+1,'facebook',`2026-10-${String(12+Math.floor(i/10)).padStart(2,'0')}`,'12:00'),project_id:P,publication_id:i<3?uid(4,i+1):null}));
 const pubs=[1,2,3].map(i=>({id:uid(4,i),client_id:C,subject:'S'+i,status:'draft'}));
 const s=service({publication_channel_occurrences:many,publications:pubs});const entries=await s.m.getProjectOccurrences(P,'2026-10-01','2026-10-31',now);
 assert.equal(s.calls[0],'admin');assert.equal(entries.length,130);assert.deepEqual(json(s.db.log.filter(x=>x[0]==='range').map(x=>x[2])),[0,100],'paginated by 100');
 assert.deepEqual(json(s.db.log.filter(x=>x[0]==='in'&&x[1]==='publications').map(x=>x[2])),[3,1],'linked publications: one query (3 ids, scoped to the client)');
 assert.equal(entries.filter(e=>e.publication).length,3);
 for(const table of ['publication_channel_occurrences','publications'])await assert.rejects(()=>service({publication_channel_occurrences:many,publications:pubs},{fail:[table]}).m.getProjectOccurrences(P,'2026-10-01','2026-10-31',now),/Occurrences indisponibles/,table);
 await assert.rejects(()=>service({}).m.getProjectOccurrences('bad','2026-10-01','2026-10-31'),/Occurrences indisponibles/);
 await assert.rejects(()=>service({}).m.getProjectOccurrences(P,'2026-10-31','2026-10-01'),/Occurrences indisponibles/);
 const upcoming=await service({publication_channel_occurrences:[{...row(1,'facebook','2026-10-15','12:00'),project_id:P,scheduled_for:'2026-10-15T10:00:00Z'},{...row(2,'instagram','2026-10-16','12:00'),project_id:P,skipped_at:'x',skipped_reason:'y',scheduled_for:'2026-10-16T10:00:00Z'}],publications:[]}).m.getUpcomingProjectOccurrences(P,10,now);
 assert.deepEqual(json(upcoming.map(e=>e.platform)),['facebook'],'skipped excluded from upcoming');});

test('ensure: explicit period from today (Paris), actor from the admin session, invalid weeks never call the RPC, errors mapped',async()=>{
 const s=service({});const r=await s.m.ensureProjectOccurrences(P,4,now);
 assert.deepEqual(json(r),{ok:true,message:'5 occurrences préparées. Aucune publication n’est créée ni diffusée.',result:{created:5,existing:0,dst_conflicts:0,channels:3,conflicts:[]}});
 assert.deepEqual(s.db.log.find(x=>x[0]==='rpc'),['rpc','publication_channel_occurrences_ensure',{p_project_id:P,p_start_date:'2026-10-14',p_end_date:'2026-11-10',p_actor_id:'user_admin'}]);
 for(const [project,weeks] of [[P,3],[P,0],[P,'4'],['bad',4],[P,null]]){const x=service({});assert.equal((await x.m.ensureProjectOccurrences(project,weeks,now)).ok,false);assert.ok(!x.db.log.some(l=>l[0]==='rpc'),'no RPC');}
 const legacy=service({},{rpc:()=>({data:null,error:{code:'23514'}})});assert.equal((await legacy.m.ensureProjectOccurrences(P,1,now)).message,'Configurez d’abord les canaux de ce projet (onglet Configuration).');
 const odd=service({},{rpc:()=>({data:{created:'x'},error:null})});assert.equal((await odd.m.ensureProjectOccurrences(P,1,now)).ok,false,'unreadable result fails closed');
 const dst=service({},{rpc:()=>({data:{created:3,existing:0,dst_conflicts:1,channels:1,conflicts:[{platform:'facebook',local_date:'2026-03-29',local_time:'02:30',timezone:'Europe/Paris'}]},error:null})});
 assert.match((await dst.m.ensureProjectOccurrences(P,2,now)).message,/heure inexistante lors du passage à l’heure d’été \(Facebook le 29\/03\/2026 à 02:30\)/);});

test('server action: admin first, weeks parsed, revalidation only on success, no navigation',async()=>{
 const calls=[];const a=load('app/(cockpit)/publications/occurrence-actions.ts',{'next/cache':{revalidatePath:p=>calls.push(['revalidate',p])},'next/navigation':{redirect:()=>{throw Error('unexpected redirect');}},'@/lib/publications/occurrence-publications':{},'@/lib/require-admin':{requireAdmin:async()=>{calls.push('admin');}},
  '@/lib/publications/occurrences':{ensureProjectOccurrences:async(p,w)=>{calls.push(['ensure',p,w]);return w===4?{ok:true,message:'ok'}:{ok:false,message:'Choisissez une période de 1, 2 ou 4 semaines.'};}}});
 const form=w=>{const f=new FormData();f.set('project_id',P);f.set('weeks',w);return f;};
 assert.deepEqual(json(await a.prepareOccurrencesAction({},form('4'))),{ok:true,message:'ok'});assert.deepEqual(json(calls.slice(0,2)),['admin',['ensure',P,4]]);assert.ok(calls.some(c=>c[1]===`/projects/${P}/calendar`));
 calls.length=0;await a.prepareOccurrencesAction({},form('abc'));assert.deepEqual(json(calls),['admin',['ensure',P,null]],'failure: no revalidation');
 const source=src('app/(cockpit)/publications/occurrence-actions.ts');assert.match(source,/^"use server";/);assert.doesNotMatch(source,/getSupabaseServerClient|\.rpc\(/);
 const prepare=source.slice(source.indexOf('export async function prepareOccurrencesAction'),source.indexOf('export type OccurrencePublicationState'));assert.doesNotMatch(prepare,/redirect\(/,'preparation never navigates');});

const formStub={prepareOccurrencesAction:async()=>({}),skipOccurrenceAction:async()=>({}),createFromOccurrenceAction:async()=>({})};
test('components: occurrence calendar (independent platforms, states, linked, skipped, empty) and the 1/2/4 weeks form',()=>{
 const {OccurrenceCalendar}=load('components/publications/occurrence-calendar.tsx',{'next/link':{__esModule:true,default:({href,children,...p})=>jsx.jsx('a',{href,...p,children})},'@/app/(cockpit)/publications/occurrence-actions':formStub});
 const entries=model.buildOccurrenceEntries([row(1,'facebook','2026-10-12','12:00'),row(2,'instagram','2026-10-13','18:00'),row(3,'google_business_profile','2026-10-14','12:00'),
  row(4,'facebook','2026-10-16','12:00',{publication_id:PUB}),row(5,'instagram','2026-10-17','11:00',{skipped_at:'x',skipped_reason:'Jour férié'})],[{id:PUB,subject:'Conseils toiture',status:'approved'}],now);
 const html=renderToStaticMarkup(jsx.jsx(OccurrenceCalendar,{projectId:P,mode:'week',from:'2026-10-12',to:'2026-10-18',previous:'2026-10-05',next:'2026-10-19',entries,error:false,legacy:[]}));
 assert.deepEqual([...html.matchAll(/data-platform="([a-z_]+)"/g)].map(m=>m[1]),['facebook','instagram','google_business_profile','facebook','instagram'],'independent platforms in date order');
 assert.match(html,/12:00 · Facebook/);assert.match(html,/18:00 · Instagram/);assert.match(html,/12:00 · Google Business Profile/);
 assert.match(html,new RegExp(`href="/publications/${PUB}"[^>]*>Conseils toiture`));assert.match(html,/Validée/);assert.match(html,/Ignorée : Jour férié/);assert.match(html,/Aucune publication liée/);
 assert.match(html,/Préparer les prochaines semaines/);assert.match(html,/<option value="1">1 semaine<\/option><option value="2">2 semaines<\/option><option value="4" selected="">4 semaines<\/option>/,'1 / 2 / 4 weeks, 4 by default');
 assert.doesNotMatch(html,/Ancien calendrier/,'no legacy history block when empty');
 // P4-b: open occurrences carry their id only in the creation link and the skip form; linked / skipped ones never do.
 for(const n of [4,5])assert.ok(!html.includes(uid(5,n)),'linked and skipped occurrence ids are not rendered');
 assert.ok(html.includes(`/projects/${P}/calendar/occurrences/${uid(5,2)}`),'open occurrence: create link');assert.match(html,/Ignorer ce créneau/);
 const empty=renderToStaticMarkup(jsx.jsx(OccurrenceCalendar,{projectId:P,mode:'week',from:'2026-10-12',to:'2026-10-18',previous:'2026-10-05',next:'2026-10-19',entries:[],error:false,
  legacy:[{key:'l1',date:'2026-10-13',time:'12:00',subject:'Ancien contenu',platforms:'Facebook · Instagram',status:'Validé'}]}));
 assert.match(empty,/Aucune occurrence sur cette période/);assert.match(empty,/Ancien calendrier \(historique\)/);assert.match(empty,/Ancien contenu/);
 assert.match(renderToStaticMarkup(jsx.jsx(OccurrenceCalendar,{projectId:P,mode:'week',from:'2026-10-12',to:'2026-10-18',previous:'2026-10-05',next:'2026-10-19',entries:[],error:true,legacy:[]})),/Calendrier indisponible/);
 const client=src('components/publications/occurrence-prepare-form.tsx');assert.match(client,/^'use client';/);
 for(const f of ['components/publications/occurrence-prepare-form.tsx','components/publications/occurrence-calendar.tsx'])assert.doesNotMatch(src(f),/@\/lib\/supabase|getSupabaseServerClient|\.rpc\(|\.from\(|process\.env|server-only|@\/lib\/publications\/occurrences'/,f);});

test('calendar page: configured project shows occurrences (display never writes), legacy project keeps the historical calendar',async()=>{
 const calls=[];const configured={source:'configured',channels:[],platforms:['facebook'],legacyAligned:true},legacy={source:'legacy',channels:[],platforms:['facebook','instagram'],legacyAligned:true};
 const page=caps=>load('app/(cockpit)/projects/[id]/(tabs)/calendar/page.tsx',{'next/navigation':{notFound:()=>{throw Error('NEXT_NOT_FOUND');}},'@/lib/projects/data':{getProjectById:async()=>({id:P,client_id:C,type:'Réseaux sociaux'})},
  '@/lib/publications/project-channels':{getPublicationProjectChannels:async()=>caps},'@/lib/publications/occurrences':{getProjectOccurrences:async(...a)=>{calls.push(['occurrences',...a]);return [];}},
  '@/lib/publications/planning':{getCalendar:async()=>{calls.push(['legacy-calendar']);return [];},getProjectCadence:async()=>{calls.push(['cadence']);return null;}},
  '@/components/publications/occurrence-calendar':{OccurrenceCalendar:()=>jsx.jsx('section',{'data-view':'occurrences'})},'@/components/publications/project-calendar':{ProjectCalendar:()=>jsx.jsx('section',{'data-view':'legacy'})},
  '@/components/publications/planning-section':{PlanningSettings:()=>jsx.jsx('details',{'data-view':'cadence'})}}).default;
 const props={params:Promise.resolve({id:P}),searchParams:Promise.resolve({date:'2026-10-14'})};
 const html=renderToStaticMarkup(await page(configured)(props));assert.match(html,/data-view="occurrences"/);assert.doesNotMatch(html,/data-view="(legacy|cadence)"/,'no legacy cadence form for a configured project');
 assert.deepEqual(json(calls.find(c=>c[0]==='occurrences')),['occurrences',P,'2026-10-12','2026-10-18']);
 calls.length=0;const old=renderToStaticMarkup(await page(legacy)(props));assert.match(old,/data-view="legacy"/);assert.match(old,/data-view="cadence"/);assert.ok(!calls.some(c=>c[0]==='occurrences'));
 for(const f of ['app/(cockpit)/projects/[id]/(tabs)/calendar/page.tsx','components/publications/occurrence-calendar.tsx','lib/publications/occurrence-model.ts'])assert.doesNotMatch(src(f),/occurrences_ensure|ensureProjectOccurrences\(/,`${f}: display never prepares occurrences`);});

test('P3 scope: one additive migration, no P4 objects, no agent / OpenAI / Drive / cron in P3 code',()=>{
 const list=readdirSync(resolve(root,'supabase/migrations')).sort();assert.equal(list.length,22);assert.equal(list[11],'20261008000000_publications_channel_occurrences.sql');
 const sql=src('supabase/migrations/20261008000000_publications_channel_occurrences.sql').replace(/--[^\n]*/g,'');
 assert.doesNotMatch(sql,/\bdrop (table|column|function|trigger|index)|delete from|truncate (table )?public|security definer|editorial_group|insert into public\.publications|publication_deliveries|publication_jobs|alter table public\.publication_events/i);
 for(const f of ['lib/publications/occurrences.ts','lib/publications/occurrence-model.ts','app/(cockpit)/publications/occurrence-actions.ts','components/publications/occurrence-calendar.tsx','components/publications/occurrence-prepare-form.tsx'])
  assert.doesNotMatch(src(f).replace(/\/\/[^\n]*/g,''),/openai|drive|editorial_group|agent-service|cron|setInterval/i,f);
 assert.deepEqual([...new Set([...src('lib/publications/occurrences.ts').matchAll(/rpc\('([a-z_]+)'/g)].map(m=>m[1]))],['publication_channel_occurrences_ensure']);
 assert.match(src('lib/publications/project-channels.ts'),/source==='configured'\)return 'Ce projet utilise le planning par canal/,'legacy calendar generation refused for configured projects');});
