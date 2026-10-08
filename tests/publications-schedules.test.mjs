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
  vm.runInNewContext(code,{exports,Map,Set,Object,console,require:name=>{if(name in mocks)return mocks[name];if(name==='server-only')return {};
   if(name.startsWith('@/'))return read(find(resolve(root,name.slice(2))));if(name.startsWith('.'))return read(find(resolve(dirname(path),name)));return native(name);}});
  return exports;}
 return read(resolve(root,file));}
const json=value=>JSON.parse(JSON.stringify(value));
const src=file=>readFileSync(resolve(root,file),'utf8');
const uid=(prefix,n)=>`${prefix}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const model=load('lib/publications/channel-schedule-model.ts');
const C=uid(1,1),FB=uid(6,1),IG=uid(6,2),GBP=uid(6,3),S1=uid(8,1),S2=uid(8,2);

function mockDb(tables,{fail=[]}={}){const log=[];
 return {log,from(table){const f=[];const q={select:()=>q,in(k,vs){log.push(['in',table,vs.length]);f.push(r=>vs.includes(r[k]));return q;},
   then(ok,ko){return Promise.resolve(fail.includes(table)?{data:null,error:{message:'down'}}:{data:json((tables[table]??[]).filter(r=>f.every(x=>x(r)))),error:null}).then(ok,ko);}};return q;},
  rpc:async(name,args)=>{log.push(['rpc',name,json(args)]);return {data:S1,error:null};}};}
function service(tables,options){const db=mockDb(tables,options),calls=[];
 return {db,calls,m:load('lib/publications/channel-schedules.ts',{'@/lib/require-admin':{requireAdmin:async()=>{calls.push('admin');return {userId:'user_admin'};}},'@/lib/supabase/server':{getSupabaseServerClient:()=>{calls.push('db');return db;}}})};}
const tables={publication_channel_schedules:[{id:S1,client_id:C,project_channel_id:FB,timezone:'Europe/Paris',enabled:true},{id:S2,client_id:C,project_channel_id:IG,timezone:'Europe/Paris',enabled:false}],
 publication_channel_schedule_slots:[{id:'b',schedule_id:S1,client_id:C,weekday:5,local_time:'12:00:00',enabled:true},{id:'a',schedule_id:S1,client_id:C,weekday:1,local_time:'18:00:00',enabled:false},
  {id:'c',schedule_id:S1,client_id:C,weekday:1,local_time:'09:30:00',enabled:true},{id:'x',schedule_id:S1,client_id:uid(1,9),weekday:2,local_time:'10:00:00',enabled:true},{id:'d',schedule_id:S2,client_id:C,weekday:2,local_time:'18:00:00',enabled:true}]};

test('reads a channel schedule with slots sorted by weekday then local time, admin first',async()=>{
 const {m,calls}=service(tables);const s=await m.getChannelSchedule(FB);assert.equal(calls[0],'admin');
 assert.deepEqual(json(s),{scheduleId:S1,projectChannelId:FB,enabled:true,timezone:'Europe/Paris',slots:[{id:'c',weekday:1,localTime:'09:30',enabled:true},{id:'a',weekday:1,localTime:'18:00',enabled:false},{id:'b',weekday:5,localTime:'12:00',enabled:true}]},'sorted; slot of another client ignored');
 assert.equal(await m.getChannelSchedule(GBP),null,'no schedule for this channel');
 assert.equal(model.postsPerWeek(s),2,'posts per week derived from enabled slots');});

test('batch loader: one schedules read and one slots read per 100 channels (no N+1)',async()=>{
 const ids=Array.from({length:150},(_,i)=>uid(6,i+1));const {m,db}=service(tables);const map=await m.getChannelSchedules([...ids,FB]);
 assert.equal(map.size,2);assert.deepEqual(json(db.log.filter(x=>x[0]==='in').map(x=>[x[1],x[2]])),[['publication_channel_schedules',100],['publication_channel_schedule_slots',2],['publication_channel_schedules',50]],'no slot read when a batch has no schedule');
 const empty=service(tables);assert.equal((await empty.m.getChannelSchedules([])).size,0);assert.equal(empty.db.log.length,0);});

test('read errors fail closed (throw), never a silent fallback',async()=>{
 for(const table of ['publication_channel_schedules','publication_channel_schedule_slots'])await assert.rejects(()=>service(tables,{fail:[table]}).m.getChannelSchedule(FB),/Planning des canaux indisponible/,table);
 await assert.rejects(()=>service(tables).m.getChannelSchedules(['not-a-uuid']),/Planning des canaux indisponible/);});

test('channelSchedulable: channel enabled AND schedule enabled AND at least one enabled slot',()=>{
 const slot=enabled=>({id:'s',weekday:1,localTime:'12:00',enabled});const schedule=(enabled,slots)=>({enabled,slots});
 assert.equal(model.channelSchedulable({enabled:true},schedule(true,[slot(true)])),true,'1 enabled slot');
 assert.equal(model.channelSchedulable({enabled:false},schedule(true,[slot(true)])),false,'channel disabled');
 assert.equal(model.channelSchedulable({enabled:true},schedule(false,[slot(true)])),false,'schedule disabled');
 assert.equal(model.channelSchedulable({enabled:true},schedule(true,[slot(false),slot(false)])),false,'0 enabled slot');
 assert.equal(model.channelSchedulable({enabled:true},schedule(true,[])),false,'no slot');
 assert.equal(model.channelSchedulable({enabled:true},null),false,'no schedule');assert.equal(model.channelSchedulable(null,schedule(true,[slot(true)])),false,'no channel');
 assert.equal(model.postsPerWeek(null),0);});

test('save: complete payload validated client-side, actor from the admin session, RPC errors mapped',async()=>{
 const valid=[{weekday:1,local_time:'12:00',enabled:true},{weekday:3,local_time:'18:00',enabled:false}];
 const {m,db}=service(tables);assert.deepEqual(json(await m.saveChannelSchedule({projectChannelId:FB,timezone:'Europe/Paris',enabled:true,slots:valid})),{ok:true,scheduleId:S1});
 assert.deepEqual(db.log.find(x=>x[0]==='rpc'),['rpc','publication_channel_schedule_save',{p_project_channel_id:FB,p_timezone:'Europe/Paris',p_enabled:true,p_slots:valid,p_actor_id:'user_admin'}]);
 for(const slots of [[{weekday:0,local_time:'12:00',enabled:true}],[{weekday:8,local_time:'12:00',enabled:true}],[{weekday:1.5,local_time:'12:00',enabled:true}],[{weekday:1,local_time:'24:00',enabled:true}],
  [{weekday:1,local_time:'12:00:00',enabled:true}],[{weekday:1,local_time:'12:00'}],[{weekday:1,local_time:'12:00',enabled:true,id:'x'}],[valid[0],{...valid[0],enabled:false}],'[]',null,Array.from({length:29},(_,i)=>({weekday:1+(i%7),local_time:`${String(i%24).padStart(2,'0')}:${i<24?'00':'30'}`,enabled:true}))]){
  const r=service(tables);const result=await r.m.saveChannelSchedule({projectChannelId:FB,timezone:'Europe/Paris',enabled:true,slots});assert.equal(result.ok,false,JSON.stringify(slots));assert.ok(!r.db.log.some(x=>x[0]==='rpc'),'no RPC on invalid payload');}
 assert.deepEqual(json(model.normalizeScheduleSlots([])),[],'empty payload is valid (disables every slot)');
 const failing=service(tables);failing.db.rpc=async()=>({data:null,error:{code:'23514'}});assert.deepEqual(json(await failing.m.saveChannelSchedule({projectChannelId:FB,timezone:'Europe/Paris',enabled:true,slots:valid})),{ok:false,message:'Canal introuvable ou hors périmètre.'});
 const tz=service(tables);tz.db.rpc=async()=>({data:null,error:{code:'22023'}});assert.match((await tz.m.saveChannelSchedule({projectChannelId:FB,timezone:'Mars/Olympus',enabled:true,slots:valid})).message,/fuseau horaire/);});

test('P2-a scope: additive migration, no UI, no occurrence, legacy calendar kept',()=>{
 const list=readdirSync(resolve(root,'supabase/migrations')).sort();assert.equal(list.length,19);assert.equal(list[10],'20261007130000_publications_channel_schedules.sql');
 const code=src('supabase/migrations/20261007130000_publications_channel_schedules.sql').replace(/--[^\n]*/g,'');
 assert.doesNotMatch(code,/drop (table|column|function|trigger|index)|delete from|truncate (table )?public|security definer|posts_per_week|publication_cadences|publication_calendar_slots|alter table public\.publication_events/i);
 assert.match(code,/revoke all on public\.publication_channel_schedules,public\.publication_channel_schedule_slots from public,anon,authenticated,service_role;\ngrant select,insert,update on public\.publication_channel_schedules,public\.publication_channel_schedule_slots to service_role;/);
 const service=src('lib/publications/channel-schedules.ts');assert.doesNotMatch(service,/\.insert\(|\.update\(|\.delete\(|openai|drive/i);
 for(const dir of ['app','components'])assert.ok(!JSON.stringify(readdirSync(resolve(root,dir),{recursive:true})).includes('channel-schedule'),'no P2-b UI yet in '+dir);});
