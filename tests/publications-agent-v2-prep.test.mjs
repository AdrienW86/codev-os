import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {resolve,dirname,join} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const native=createRequire(import.meta.url),root=resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'));
function load(file,mocks={}){const cache=new Map();const find=base=>[base+'.ts',base+'.tsx'].find(p=>existsSync(p))??base;
 function read(path){if(cache.has(path))return cache.get(path);const exports={};cache.set(path,exports);
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{exports,Map,Set,Object,JSON,Number,Date,console,require:name=>{if(name in mocks)return mocks[name];if(name==='server-only')return {};
   if(name.startsWith('@/'))return read(find(resolve(root,name.slice(2))));if(name.startsWith('.'))return read(find(resolve(dirname(path),name)));return native(name);}});
  return exports;}
 return read(resolve(root,file));}
const json=value=>JSON.parse(JSON.stringify(value));
const src=file=>readFileSync(resolve(root,file),'utf8');
const uid=(prefix,n)=>`${prefix}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const P=uid(3,1),C=uid(1,1),now=new Date('2026-10-12T00:00:00Z');
const sel=load('lib/publications/agent-v2/selection.ts');
const occ=(n,platform,at,extra={})=>({occurrenceId:uid(5,n),projectId:P,clientId:C,platform,date:at.slice(0,10),time:at.slice(11,16),timezone:'Europe/Paris',scheduledFor:at,...extra});

test('selection: one idea = earliest open occurrence + the earliest other platforms within the window, one per platform',()=>{
 const candidates=[occ(1,'facebook','2026-10-16T10:00:00Z'),occ(2,'instagram','2026-10-13T16:00:00Z'),occ(3,'facebook','2026-10-12T10:00:00Z'),occ(4,'google_business_profile','2026-10-14T10:00:00Z'),
  occ(5,'instagram','2026-10-17T09:00:00Z'),occ(6,'facebook','2026-10-11T10:00:00Z'),occ(7,'google_business_profile','2026-10-30T10:00:00Z')];
 assert.deepEqual(json(sel.futureOccurrences(candidates,now).map(c=>c.occurrenceId.slice(-1))),['3','2','4','1','5','7'],'past occurrence excluded, chronological');
 assert.deepEqual(json(sel.selectIdeaBatch(candidates,now).map(c=>[c.platform,c.occurrenceId.slice(-1)])),[['facebook','3'],['instagram','2'],['google_business_profile','4']],'anchor + one per other platform');
 assert.deepEqual(json(sel.selectIdeaBatch(candidates,now,1.5).map(c=>c.platform)),['facebook','instagram'],'window respected (GBP at +48 h excluded)');assert.deepEqual(json(sel.selectIdeaBatch(candidates,now,1).map(c=>c.platform)),['facebook'],'Instagram at +30 h outside a 1-day window');
 assert.deepEqual(json(sel.selectIdeaBatch([],now)),[]);assert.deepEqual(json(sel.selectIdeaBatch([occ(9,'facebook','2026-10-01T10:00:00Z')],now)),[],'only past occurrences: nothing');
 const tie=[occ(11,'instagram','2026-10-13T10:00:00Z'),occ(10,'facebook','2026-10-13T10:00:00Z')];assert.equal(sel.selectIdeaBatch(tie,now)[0].platform,'facebook','deterministic tie-break');
 assert.deepEqual(json(sel.selectIdeaBatch([occ(1,'facebook','2026-10-13T10:00:00Z'),occ(2,'instagram','2026-10-13T11:00:00Z',{projectId:uid(3,2)})],now).map(c=>c.platform)),['facebook'],'never mixes projects');});

test('generator output: exactly one valid publication per selected occurrence, platform and media checked, fail closed',()=>{
 const input={occurrences:[occ(1,'facebook','2026-10-13T10:00:00Z'),occ(2,'instagram','2026-10-14T10:00:00Z')],media:[{id:'m1',categories:['toiture'],used:false},{id:'m2',categories:[],used:true}]};
 const good={idea:{subject:' Toiture ',angle:'Entretien'},publications:[{occurrenceId:uid(5,1),platform:'facebook',text:' Texte FB ',cta:' Appelez ',mediaId:'m1'},{occurrenceId:uid(5,2),platform:'instagram',text:'Texte IG',cta:null,mediaId:'m1'}]};
 const r=sel.validateGeneratorOutput(input,good);assert.equal(r.ok,true);assert.equal(r.value.idea.subject,'Toiture');assert.equal(r.value.publications[0].text,'Texte FB');assert.equal(r.value.publications[0].cta,'Appelez');
 const cases={invalid_output:null,invalid_idea:{...good,idea:{subject:'',angle:'x'}},publication_count:{...good,publications:[good.publications[0]]},
  unknown_or_duplicate_occurrence:{...good,publications:[good.publications[0],good.publications[0]]},platform_mismatch:{...good,publications:[{...good.publications[0],platform:'instagram'},good.publications[1]]},
  invalid_text:{...good,publications:[{...good.publications[0],text:' '},good.publications[1]]},invalid_media:{...good,publications:[{...good.publications[0],mediaId:'m2'},{...good.publications[1],mediaId:'m2'}]}};
 for(const [reason,output] of Object.entries(cases))assert.deepEqual(json(sel.validateGeneratorOutput(input,output)),{ok:false,reason},reason);});

test('open occurrence loader: admin first, unlinked / not skipped / future only, paginated, fail closed',async()=>{
 const rows=Array.from({length:130},(_,i)=>({id:uid(5,i+1),client_id:C,project_id:P,platform:'facebook',local_date:'2026-10-13',local_time:'12:00:00',timezone:'Europe/Paris',scheduled_for:'2026-10-13T10:00:00Z',publication_id:null,skipped_at:null}));
 rows.push({...rows[0],id:uid(5,999),publication_id:uid(4,1)},{...rows[0],id:uid(5,998),skipped_at:'x'});
 const make=(fail=false)=>{const log=[],calls=[];const db={from(table){const f=[];const q={select:()=>q,order:()=>q,eq(k,v){f.push(r=>r[k]===v);return q;},is(k,v){log.push(['is',k]);f.push(r=>r[k]===v);return q;},
  gte(k,v){f.push(r=>r[k]>=v);return q;},lte(k,v){f.push(r=>r[k]<=v);return q;},range:async(a,z)=>{log.push(['range',table,a]);return fail?{data:null,error:{message:'down'}}:{data:json(rows.filter(r=>f.every(x=>x(r))).slice(a,z+1)),error:null};}};return q;}};
  return {log,calls,m:load('lib/publications/agent-v2/open-occurrences.ts',{'@/lib/require-admin':{requireAdmin:async()=>{calls.push('admin');}},'@/lib/supabase/server':{getSupabaseServerClient:()=>db}})};};
 const s=make();const open=await s.m.getOpenOccurrencesForAgent(P,28,now);assert.equal(s.calls[0],'admin');assert.equal(open.length,130,'linked and skipped excluded');
 assert.deepEqual(json(s.log.filter(x=>x[0]==='is').map(x=>x[1])),['publication_id','skipped_at','publication_id','skipped_at'],'filters applied on every page');assert.deepEqual(json(s.log.filter(x=>x[0]==='range').map(x=>x[2])),[0,100]);
 assert.deepEqual(json(open[0]),{occurrenceId:uid(5,1),projectId:P,clientId:C,platform:'facebook',date:'2026-10-13',time:'12:00',timezone:'Europe/Paris',scheduledFor:'2026-10-13T10:00:00Z'});
 await assert.rejects(()=>make(true).m.getOpenOccurrencesForAgent(P,28,now),/indisponibles/);await assert.rejects(()=>make().m.getOpenOccurrencesForAgent('bad'),/indisponibles/);await assert.rejects(()=>make().m.getOpenOccurrencesForAgent(P,200),/indisponibles/);});

test('P7-prep → P7: contract with raw output and usage, the real generator is the only AI entry point, Agent v1 untouched',()=>{
 assert.match(src('lib/publications/agent-v2/contract.ts'),/export interface PublicationsAgentV2Generator\{generate\(input:AgentV2GeneratorInput\):Promise<\{output:unknown;usage:AgentV2Usage\}>\}/);
 const dir=resolve(root,'lib/publications/agent-v2');for(const f of readdirSync(dir).filter(f=>f!=='openai-generator.ts')){const code=readFileSync(join(dir,f),'utf8').replace(/\/\/[^\n]*/g,'');
  assert.doesNotMatch(code,/publications-openai|googleapis|drive-oauth|publications-drive|setInterval|cron|fetch\(/i,f);}
 assert.match(src('lib/publications/agent-v2/openai-generator.ts'),/structuredResponse\(AGENT_V2_INSTRUCTIONS/);
 assert.doesNotMatch(src('lib/publications/agent-service.ts'),/agent-v2/,'Agent v1 unchanged');});
