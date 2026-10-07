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
  vm.runInNewContext(code,{exports,Map,Set,Object,JSON,Number,FormData,URLSearchParams,console,require:name=>{if(name in mocks)return mocks[name];if(name==='react/jsx-runtime')return jsx;if(name==='react')return React;if(name==='server-only')return {};
   if(name.startsWith('@/'))return read(find(resolve(root,name.slice(2))));if(name.startsWith('.'))return read(find(resolve(dirname(path),name)));return native(name);}});
  return exports;}
 return read(resolve(root,file));}
const json=value=>JSON.parse(JSON.stringify(value));
const src=file=>readFileSync(resolve(root,file),'utf8');
const uid=(prefix,n)=>`${prefix}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const C=uid(1,1),P=uid(3,1),FB=uid(6,1),IG=uid(6,2),S1=uid(8,1),ACC=uid(9,1);
const model=load('lib/publications/channel-configuration-model.ts'),channels=load('lib/publications/channels.ts');
const caps=(source,platforms,aligned=true)=>({...channels.publicationCapabilities(platforms.map(platform=>({platform,enabled:true})),source),legacyAligned:aligned});
const sched=(slots,enabled=true,timezone='Europe/Paris')=>({scheduleId:S1,projectChannelId:FB,enabled,timezone,slots});
const slot=(weekday,localTime,enabled=true)=>({id:`${weekday}${localTime}`,weekday,localTime,enabled});

// In-memory Supabase double: eq/in filters, thenable queries, maybeSingle and an RPC log.
function mockDb(tables,{fail=[],rpcError=null}={}){const log=[];
 return {log,from(table){const f=[];const rows=()=>fail.includes(table)?{data:null,error:{message:'down'}}:{data:json((tables[table]??[]).filter(r=>f.every(x=>x(r)))),error:null};
   const q={select:()=>q,eq(k,v){f.push(r=>r[k]===v);return q;},in(k,vs){f.push(r=>vs.includes(r[k]));return q;},
    maybeSingle:async()=>{const r=rows();return {data:r.data?.[0]??null,error:r.error};},then(ok,ko){return Promise.resolve(rows()).then(ok,ko);}};return q;},
  rpc:async(name,args)=>{log.push([name,json(args)]);return rpcError?{data:null,error:rpcError}:{data:S1,error:null};}};}
const projectRow={id:P,client_id:C,type:'Réseaux sociaux'};
function serviceWith(tables,options){const db=mockDb({projects:[projectRow],...tables},options),calls=[];
 const mocks={'@/lib/require-admin':{requireAdmin:async()=>{calls.push('admin');return {userId:'user_admin'};}},'@/lib/supabase/server':{getSupabaseServerClient:()=>db}};
 return {db,calls,m:load('lib/publications/channel-configuration.ts',mocks)};}
const configuredTables=(extra={})=>({publication_project_channels:[{id:FB,project_id:P,client_id:C,platform:'facebook',enabled:true,publication_account_id:ACC,editorial_rules:'Ton chaleureux'},
  {id:IG,project_id:P,client_id:C,platform:'instagram',enabled:false,publication_account_id:null,editorial_rules:null}],
 publication_accounts:[{id:ACC,client_id:C,status:'connected',external_account_id:'secret-external',credential_reference:'ref:secret'}],
 publication_channel_schedules:[{id:S1,client_id:C,project_channel_id:FB,timezone:'Europe/Paris',enabled:true}],
 publication_channel_schedule_slots:[{id:'a',schedule_id:S1,client_id:C,weekday:5,local_time:'12:00:00',enabled:true},{id:'b',schedule_id:S1,client_id:C,weekday:1,local_time:'12:00:00',enabled:true},{id:'c',schedule_id:S1,client_id:C,weekday:3,local_time:'18:00:00',enabled:false}],...extra});

test('view model: legacy project shows inherited channels only, read-only, no schedule',()=>{
 const v=model.buildChannelConfiguration(caps('legacy',['facebook','instagram']),[]);
 assert.equal(v.legacy,true);assert.deepEqual(json(v.cards.map(c=>[c.label,c.state,c.schedule])),[['Facebook','legacy',null],['Instagram','legacy',null]]);
 assert.equal(v.suspended,null);assert.equal(v.calendarNotice,null);assert.equal(v.agentNotice,null);});

test('view model: FB / IG / GBP cards, sorted enabled slots, inactive history, derived posts per week, states',()=>{
 const explicit=[{platform:'facebook',enabled:true,accountConnected:true,rules:' Ton ',schedule:sched([slot(5,'12:00'),slot(1,'12:00'),slot(3,'18:00',false)])},
  {platform:'instagram',enabled:false,accountConnected:false,rules:null,schedule:sched([slot(2,'18:00'),slot(6,'11:00')],false)}];
 const v=model.buildChannelConfiguration(caps('configured',['facebook'],false),explicit);
 assert.deepEqual(json(v.cards.map(c=>[c.label,c.state,c.configured])),[['Facebook','active',true],['Instagram','inactive',true],['Google Business Profile','inactive',false]]);
 const fb=v.cards[0];assert.deepEqual(json(fb.schedule.slots),[{weekday:1,localTime:'12:00'},{weekday:5,localTime:'12:00'}],'Monday → Sunday then time');
 assert.deepEqual(json(fb.schedule.inactiveSlots),[{weekday:3,localTime:'18:00'}]);assert.equal(fb.postsPerWeek,2);assert.equal(fb.rules,'Ton');assert.equal(fb.accountConnected,true);
 assert.equal(v.cards[1].schedule.enabled,false,'disabled channel keeps its (disabled) schedule');assert.equal(v.cards[2].schedule,null,'no schedule yet');
 assert.equal(v.calendarNotice,null,'P3: per-channel calendar available, no calendar transition notice');assert.equal(v.agentNotice,'L’agent Publications sera disponible pour cette configuration après sa migration multi-canal.');
 assert.equal(model.postsPerWeekLabel(1),'1 publication / semaine');assert.equal(model.postsPerWeekLabel(0),'0 publication / semaine');assert.equal(model.postsPerWeekLabel(2),'2 publications / semaine');
 const aligned=model.buildChannelConfiguration(caps('configured',['facebook','instagram']),[]);assert.equal(aligned.calendarNotice,null);assert.equal(aligned.agentNotice,null);
 const suspended=model.buildChannelConfiguration({...caps('configured',[]),channels:[{platform:'facebook',enabled:false}]},[{platform:'facebook',enabled:false,accountConnected:false,rules:null,schedule:null}]);
 assert.equal(suspended.suspended,'Publications suspendues : aucun canal actif.');assert.equal(suspended.calendarNotice,null);});

test('slot editing rules: sort, duplicates, 28 maximum, complete payload of the rows kept on screen',()=>{
 assert.deepEqual(json(model.sortConfigurationSlots([{weekday:7,localTime:'08:00'},{weekday:1,localTime:'18:00'},{weekday:1,localTime:'09:00'}])),[{weekday:1,localTime:'09:00'},{weekday:1,localTime:'18:00'},{weekday:7,localTime:'08:00'}]);
 assert.equal(model.slotRowsError([{weekday:1,localTime:'12:00'},{weekday:1,localTime:'12:00'}]),'Créneau en double : Lundi 12:00.');
 assert.equal(model.slotRowsError(Array.from({length:29},(_,i)=>({weekday:1+(i%7),localTime:`${String(i%24).padStart(2,'0')}:00`}))),'28 créneaux maximum.');
 assert.equal(model.slotRowsError(Array.from({length:28},(_,i)=>({weekday:1+(i%7),localTime:`${String(Math.floor(i/7)).padStart(2,'0')}:00`}))),null,'28 is allowed');
 assert.match(model.slotRowsError([{weekday:1,localTime:''}]),/jour et une heure valides/);assert.equal(model.slotRowsError([]),null,'0 slot is valid');
 assert.deepEqual(json(model.scheduleSlotsPayload([{weekday:5,localTime:'12:00',key:2},{weekday:1,localTime:'12:00',key:1}])),[{weekday:1,local_time:'12:00',enabled:true},{weekday:5,local_time:'12:00',enabled:true}],'removed rows are simply absent: the RPC disables them');
 assert.deepEqual(json(model.WEEKDAY_LABELS),['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche']);});

test('loading the page never writes: legacy stays legacy; configured data read in batch without account secrets',async()=>{
 const legacy=serviceWith({publication_project_channels:[]});const capsLegacy=caps('legacy',['facebook','instagram']);
 const l=await legacy.m.loadChannelConfiguration(projectRow,capsLegacy);assert.equal(l.view.legacy,true);assert.deepEqual(legacy.db.log,[],'no RPC on display');assert.equal(legacy.calls[0],'admin');
 const s=serviceWith(configuredTables());const r=await s.m.loadChannelConfiguration(projectRow,caps('configured',['facebook'],false));
 assert.deepEqual(s.db.log,[],'no RPC on display');assert.equal(r.view.cards[0].accountConnected,true);assert.deepEqual(json(r.view.cards[0].schedule.slots.map(x=>x.weekday)),[1,5]);
 assert.ok(!JSON.stringify(r.view).includes('secret')&&!JSON.stringify(r.view).includes(ACC)&&!JSON.stringify(r.view).includes(FB),'no identifier or account data in the view');
 await assert.rejects(()=>serviceWith(configuredTables(),{fail:['publication_project_channels']}).m.loadChannelConfiguration(projectRow,caps('configured',['facebook'])),/indisponible/,'fail closed');});

test('confirmation is an explicit action: one P1 RPC call materializes the inherited channels',async()=>{
 const legacy=serviceWith({publication_project_channels:[]});const r=await legacy.m.confirmLegacyChannels(P);
 assert.deepEqual(json(r),{ok:true,message:'Canaux confirmés : vous pouvez maintenant les personnaliser.'});
 assert.deepEqual(legacy.db.log,[['publication_channel_save',{p_project_id:P,p_platform:'facebook',p_enabled:true,p_publication_account_id:null,p_editorial_rules:null,p_actor_id:'user_admin'}]]);
 const configured=serviceWith(configuredTables());assert.equal((await configured.m.confirmLegacyChannels(P)).ok,true);assert.deepEqual(configured.db.log,[],'already configured: no write');
 assert.deepEqual(json(await serviceWith({}).m.confirmLegacyChannels('nope')),{ok:false,message:'Projet invalide.'});
 const failing=serviceWith({publication_project_channels:[]},{rpcError:{code:'23514'}});assert.deepEqual(json(await failing.m.confirmLegacyChannels(P)),{ok:false,message:'Ce projet ne peut pas encore configurer ses canaux.'});});

test('channel activation: account and rules preserved, last channel can be disabled, legacy refused',async()=>{
 const s=serviceWith(configuredTables());assert.equal((await s.m.setChannelEnabled(P,'facebook',false)).message,'Canal désactivé. Son planning est conservé.');
 assert.deepEqual(s.db.log,[['publication_channel_save',{p_project_id:P,p_platform:'facebook',p_enabled:false,p_publication_account_id:ACC,p_editorial_rules:'Ton chaleureux',p_actor_id:'user_admin'}]],'existing account and rules sent back');
 const gbp=serviceWith(configuredTables());await gbp.m.setChannelEnabled(P,'google_business_profile',true);assert.deepEqual(gbp.db.log[0][1].p_platform,'google_business_profile');assert.equal(gbp.db.log[0][1].p_publication_account_id,null);
 const legacy=serviceWith({publication_project_channels:[]});assert.deepEqual(json(await legacy.m.setChannelEnabled(P,'facebook',false)),{ok:false,message:'Confirmez d’abord les canaux hérités.'});assert.deepEqual(legacy.db.log,[]);
 for(const [platform,enabled] of [['tiktok',true],['facebook','yes']]){const x=serviceWith(configuredTables());assert.equal((await x.m.setChannelEnabled(P,platform,enabled)).ok,false);assert.deepEqual(x.db.log,[]);}});

test('schedule save per channel: channel resolved server-side, P2-a RPC only, independent failures',async()=>{
 const s=serviceWith(configuredTables());const slots=[{weekday:1,local_time:'12:00',enabled:true}];
 assert.deepEqual(json(await s.m.saveScheduleForPlatform(P,'facebook',{enabled:true,timezone:'Europe/Paris',slots})),{ok:true,message:'Planning enregistré.'});
 assert.deepEqual(s.db.log,[['publication_channel_schedule_save',{p_project_channel_id:FB,p_timezone:'Europe/Paris',p_enabled:true,p_slots:slots,p_actor_id:'user_admin'}]]);
 const missing=serviceWith(configuredTables());assert.deepEqual(json(await missing.m.saveScheduleForPlatform(P,'google_business_profile',{enabled:true,timezone:'Europe/Paris',slots})),{ok:false,message:'Activez ou confirmez d’abord ce canal.'});assert.deepEqual(missing.db.log,[]);
 const dup=serviceWith(configuredTables());assert.equal((await dup.m.saveScheduleForPlatform(P,'facebook',{enabled:true,timezone:'Europe/Paris',slots:[slots[0],slots[0]]})).ok,false);assert.deepEqual(dup.db.log,[],'duplicate refused before the RPC');
 const many=serviceWith(configuredTables());assert.equal((await many.m.saveScheduleForPlatform(P,'facebook',{enabled:true,timezone:'Europe/Paris',slots:Array.from({length:29},(_,i)=>({weekday:1+(i%7),local_time:`${String(i%24).padStart(2,'0')}:00`,enabled:true}))})).ok,false);
 const off=serviceWith(configuredTables());await off.m.saveScheduleForPlatform(P,'instagram',{enabled:false,timezone:'Europe/Paris',slots:[]});assert.equal(off.db.log[0][1].p_enabled,false,'disabled schedule / 0 slot on a disabled channel is saved');assert.equal(off.db.log[0][1].p_project_channel_id,IG);
 const failing=serviceWith(configuredTables(),{rpcError:{code:'22023'}});assert.deepEqual(json(await failing.m.saveScheduleForPlatform(P,'facebook',{enabled:true,timezone:'Mars/Olympus',slots})),{ok:false,message:'Planning invalide (fuseau horaire ou créneaux).'});
 const down=serviceWith(configuredTables(),{fail:['publication_project_channels']});assert.deepEqual(json(await down.m.saveScheduleForPlatform(P,'facebook',{enabled:true,timezone:'Europe/Paris',slots})),{ok:false,message:'Configuration des canaux indisponible.'});});

test('server actions: admin first, project + platform only, JSON slots parsed server-side, revalidation without navigation',async()=>{
 const calls=[];const service={confirmLegacyChannels:async id=>{calls.push(['confirm',id]);return {ok:true,message:'ok'};},setChannelEnabled:async(...a)=>{calls.push(['toggle',...a]);return {ok:true,message:'ok'};},saveScheduleForPlatform:async(...a)=>{calls.push(['schedule',...a]);return {ok:false,message:'Planning invalide.'};}};
 const a=load('app/(cockpit)/publications/configuration-actions.ts',{'next/cache':{revalidatePath:p=>calls.push(['revalidate',p])},'@/lib/require-admin':{requireAdmin:async()=>{calls.push('admin');}},'@/lib/publications/channel-configuration':service});
 const form=entries=>{const f=new FormData();for(const [k,v] of Object.entries(entries))f.set(k,v);return f;};
 await a.setChannelEnabledAction({},form({project_id:P,platform:'facebook',enabled:'false'}));assert.deepEqual(json(calls.slice(0,2)),['admin',['toggle',P,'facebook',false]]);assert.ok(calls.some(c=>c[0]==='revalidate'&&c[1]===`/projects/${P}/configuration`));
 calls.length=0;await a.saveChannelScheduleAction({},form({project_id:P,platform:'instagram',timezone:'Europe/Paris',slots:'[{"weekday":2,"local_time":"18:00","enabled":true}]',enabled:'on'}));
 assert.deepEqual(json(calls),['admin',['schedule',P,'instagram',{enabled:true,timezone:'Europe/Paris',slots:[{weekday:2,local_time:'18:00',enabled:true}]}]],'failed save: no revalidation');
 calls.length=0;await a.saveChannelScheduleAction({},form({project_id:P,platform:'instagram',timezone:'Europe/Paris',slots:'not json'}));assert.equal(calls[1][3].slots,null);assert.equal(calls[1][3].enabled,false,'unchecked = disabled');
 calls.length=0;await a.confirmChannelsAction({},form({project_id:P}));assert.deepEqual(json(calls.slice(0,2)),['admin',['confirm',P]]);
 const source=src('app/(cockpit)/publications/configuration-actions.ts');assert.match(source,/^"use server";/);assert.doesNotMatch(source,/redirect\(|getSupabaseServerClient|\.rpc\(/);});

const actionsStub={confirmChannelsAction:async()=>({}),setChannelEnabledAction:async()=>({}),saveChannelScheduleAction:async()=>({})};
const component=()=>load('components/publications/channel-configuration.tsx',{'@/app/(cockpit)/publications/configuration-actions':actionsStub});
test('component: legacy banner, FB/IG/GBP cards, one save button per channel, slots, states, no identifiers',()=>{
 const {ChannelConfiguration}=component();
 const legacyHtml=renderToStaticMarkup(jsx.jsx(ChannelConfiguration,{projectId:P,view:model.buildChannelConfiguration(caps('legacy',['facebook','instagram']),[])}));
 assert.match(legacyHtml,/Configuration héritée/);assert.match(legacyHtml,/Confirmer \/ personnaliser les canaux/);assert.match(legacyHtml,/Confirmez les canaux pour configurer le planning/);assert.doesNotMatch(legacyHtml,/Enregistrer Facebook|Désactiver le canal/,'no edition before confirmation');
 const explicit=[{platform:'facebook',enabled:true,accountConnected:true,rules:'Ton chaleureux',schedule:sched([slot(5,'12:00'),slot(1,'12:00'),slot(3,'18:00',false)])},
  {platform:'instagram',enabled:false,accountConnected:false,rules:null,schedule:sched([],false)},{platform:'google_business_profile',enabled:true,accountConnected:false,rules:null,schedule:null}];
 const html=renderToStaticMarkup(jsx.jsx(ChannelConfiguration,{projectId:P,view:model.buildChannelConfiguration(caps('configured',['facebook','google_business_profile'],false),explicit)}));
 for(const label of ['Facebook','Instagram','Google Business Profile'])assert.match(html,new RegExp(`data-channel="[a-z_]+"[^>]*>[\\s\\S]*?${label}`));
 assert.equal((html.match(/>Enregistrer (Facebook|Instagram|Google Business Profile)</g)??[]).length,3,'one independent save per channel');assert.equal((html.match(/<form/g)??[]).length,6,'toggle + schedule form per card');
 assert.ok(html.indexOf('value="1"')>-1);const fb=html.slice(html.indexOf('data-channel="facebook"'),html.indexOf('data-channel="instagram"'));
 assert.match(fb,/2 publications \/ semaine/);assert.match(fb,/Réactiver Mercredi 18:00/);assert.match(fb,/Compte connecté/);assert.match(fb,/Ton chaleureux/);assert.match(fb,/Europe\/Paris/);assert.match(fb,/>Actif</);
 assert.ok(fb.indexOf('<option value="1" selected')<fb.lastIndexOf('<option value="5" selected'),'Monday row before Friday row');
 const ig=html.slice(html.indexOf('data-channel="instagram"'),html.indexOf('data-channel="google_business_profile"'));
 assert.match(ig,/>Inactif</);assert.match(ig,/Planning désactivé/);assert.match(ig,/Aucun créneau/);assert.match(ig,/Canal inactif : ce planning est conservé mais n’est pas utilisé/);assert.match(ig,/0 publication \/ semaine/);
 assert.doesNotMatch(html,/Le nouveau planning par canal sera disponible/);assert.match(html,new RegExp(`href="/projects/${P}/calendar">Préparer les prochaines semaines depuis le calendrier`));assert.match(html,/L’agent Publications sera disponible pour cette configuration après sa migration multi-canal\./);
 for(const id of [FB,IG,S1,ACC])assert.ok(!html.includes(id),'no channel, schedule or account identifier rendered (only the project id of the URL)');
 assert.ok(!/resource_type|project_channel|legacy_materialized|source=/.test(html),'no internal value rendered');
 const suspended=renderToStaticMarkup(jsx.jsx(ChannelConfiguration,{projectId:P,view:model.buildChannelConfiguration({...caps('configured',[]),channels:[{platform:'facebook',enabled:false}]},[{platform:'facebook',enabled:false,accountConnected:false,rules:null,schedule:null}])}));
 assert.match(suspended,/Publications suspendues : aucun canal actif\./);assert.match(suspended,/Activer le canal/);
 assert.match(renderToStaticMarkup(jsx.jsx(ChannelConfiguration,{projectId:P,view:null})),/Configuration des canaux indisponible/);});

test('page: admin guard, workspace rule (0 active channel keeps the tab), no write on display, debug only on request',async()=>{
 const calls=[];const project={id:P,client_id:C,type:'Réseaux sociaux',name:'Social'};
 const page=(capabilities,deny=false)=>load('app/(cockpit)/projects/[id]/(tabs)/configuration/page.tsx',{'next/navigation':{notFound:()=>{throw Error('NEXT_NOT_FOUND');}},
  '@/lib/require-admin':{requireAdmin:async()=>{calls.push('admin');if(deny)throw Error('denied');}},'@/lib/projects/data':{getProjectById:async id=>id===P?project:null},
  '@/lib/publications/project-channels':{getPublicationProjectChannels:async()=>capabilities},'@/lib/publications/channel-configuration':{loadChannelConfiguration:async(p,c)=>({view:model.buildChannelConfiguration(c,[]),debug:{project_id:p.id}})},
  '@/components/publications/channel-configuration':{ChannelConfiguration:({view})=>jsx.jsx('section',{'data-legacy':String(view.legacy),children:view.cards.map(c=>c.label).join('|')})}}).default;
 const props=(search={})=>({params:Promise.resolve({id:P}),searchParams:Promise.resolve(search)});
 await assert.rejects(()=>page(caps('legacy',['facebook','instagram']),true)(props()),/denied/);assert.deepEqual(calls,['admin'],'admin before any read');
 const html=renderToStaticMarkup(await page(caps('legacy',['facebook','instagram']))(props()));assert.match(html,/data-legacy="true"/);assert.doesNotMatch(html,/data-debug/);
 const suspended={...caps('configured',[]),channels:[{platform:'facebook',enabled:false}]};assert.match(renderToStaticMarkup(await page(suspended)(props())),/Facebook\|Instagram\|Google Business Profile/,'0 active channel: page still reachable');
 await assert.rejects(async()=>page(caps('legacy',[]))(props()),/NEXT_NOT_FOUND/,'non-Publications project');
 assert.match(renderToStaticMarkup(await page(caps('legacy',['facebook']))(props({debug:'1'}))),/data-debug="true"/);});

test('P2-b scope: no migration, no client-side database access, no P3 / occurrences, tab under the project',()=>{
 assert.equal(readdirSync(resolve(root,'supabase/migrations')).length,12,'P2-b added none; 12 after P3');
 const client=src('components/publications/channel-configuration.tsx');assert.match(client,/^'use client';/);assert.doesNotMatch(client,/@\/lib\/supabase|getSupabaseServerClient|\.rpc\(|\.from\(|process\.env|server-only|@\/lib\/publications\/channel-configuration'/);
 for(const f of ['components/publications/channel-configuration.tsx','lib/publications/channel-configuration.ts','lib/publications/channel-configuration-model.ts','app/(cockpit)/publications/configuration-actions.ts'])assert.doesNotMatch(src(f),/openai|drive|publish_now|cron/i,f);// occurrences exist since P3
 const service=src('lib/publications/channel-configuration.ts');assert.deepEqual([...new Set([...service.matchAll(/rpc\('([a-z_]+)'/g)].map(m=>m[1]))],['publication_channel_save']);assert.match(service,/saveChannelSchedule\(/);assert.doesNotMatch(service,/\.insert\(|\.update\(|\.delete\(/);
 assert.match(src('lib/projects/workspace-view.ts'),/\{key:'configuration',label:'Configuration',segment:'configuration',publications:true\}/);});
