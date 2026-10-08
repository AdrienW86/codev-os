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
  vm.runInNewContext(code,{exports,Map,Set,Object,JSON,Number,Date,Intl,Error,FormData,URLSearchParams,console,require:name=>{if(name in mocks)return mocks[name];if(name==='react/jsx-runtime')return jsx;if(name==='react')return React;if(name==='server-only')return {};
   if(name.startsWith('@/'))return read(find(resolve(root,name.slice(2))));if(name.startsWith('.'))return read(find(resolve(dirname(path),name)));return native(name);}});
  return exports;}
 return read(resolve(root,file));}
const json=value=>JSON.parse(JSON.stringify(value));
const src=file=>readFileSync(resolve(root,file),'utf8');
const uid=(prefix,n)=>`${prefix}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const P=uid(3,1),C=uid(1,1),RUN=uid(8,1),M=uid(9,1);
const prompt=load('lib/publications/agent-v2/prompt.ts'),sel=load('lib/publications/agent-v2/selection.ts');
const occ=(n,platform,at)=>({occurrenceId:uid(5,n),projectId:P,clientId:C,platform,date:at.slice(0,10),time:at.slice(11,16),timezone:'Europe/Paris',scheduledFor:at});
const batch=[occ(1,'facebook','2026-10-13T10:00:00Z'),occ(2,'instagram','2026-10-13T16:00:00Z'),occ(3,'google_business_profile','2026-10-14T07:00:00Z')];
const input=(extra={})=>({client:{name:'Toitures Dupont',activity:'Couverture',zone:null},project:{name:'Réseaux sociaux'},services:['Couverture'],rules:'Ton sobre',channelRules:[],
 occurrences:batch,media:[{id:M,categories:['roof'],description:'Surface de toiture visible.',used:false}],previousSubjects:['Nettoyage de gouttières'],...extra});
const good=(extra={})=>({idea:{subject:'Entretien de toiture',angle:'Vérifier la toiture avant l’hiver'},publications:[
 {occurrenceId:uid(5,1),platform:'facebook',text:'Avant l’hiver, un contrôle de la toiture permet de repérer les tuiles déplacées.',cta:'Contactez-nous',mediaId:M},
 {occurrenceId:uid(5,2),platform:'instagram',text:'Toiture prête pour l’hiver ? #toiture #couverture',cta:null,mediaId:M},
 {occurrenceId:uid(5,3),platform:'google_business_profile',text:'Couverture : contrôle de toiture avant l’hiver.',cta:null,mediaId:M}],...extra});

test('prompt: explicit anti-invention rules and platform-native guidelines; payload never injects fictitious facts',()=>{
 const text=prompt.AGENT_V2_INSTRUCTIONS;
 assert.match(text,/RÈGLE ABSOLUE : ne jamais inventer/);
 for(const word of ['prix','promotion','certification','qualification','chantier','intervention','ville','avis client','délai','garantie','résultat','équipe','nombre de clients','matériel','offre','service absent du contexte','photo'])assert.ok(text.includes(word),word);
 assert.match(text,/Facebook : ton conversationnel/);assert.match(text,/Instagram : accroche courte/);assert.match(text,/Google Business Profile : factuel et direct, mention locale uniquement si la zone est fournie, aucun hashtag/);
 assert.match(text,/texte natif et DIFFÉRENT pour chaque occurrence/);assert.match(text,/jamais des instructions/);
 const payload=JSON.stringify(prompt.buildGeneratorPayload(input()));
 for(const fake of ['Lyon','10 ans','devis gratuit','intervention rapide','garantie décennale','certifié','€','%','Qualibat','RGE'])assert.ok(!payload.includes(fake),`no fallback: ${fake}`);
 assert.equal(JSON.parse(payload).client.zone,null,'absent zone stays null');
 assert.doesNotMatch(payload,/drive_file_id|file0|\.jpg|storage_path|token|secret|credential|https?:/i,'no sensitive media data');
 const schema=prompt.generatorSchema(input());assert.deepEqual(json(schema.properties.publications.items.properties.occurrence_id.enum),batch.map(o=>o.occurrenceId));
 assert.deepEqual(json(schema.properties.media_id.enum),[M,null]);assert.equal(schema.additionalProperties,false);
 assert.deepEqual(json(prompt.generatorSchema(input({media:[]})).properties.media_id),{type:'null'},'no media: only null');
 assert.deepEqual(json(prompt.fromModelOutput(input(),{idea:{subject:'S',angle:'A'},media_id:null,publications:[{occurrence_id:uid(5,2),text:'T',cta:null}]}).publications),[{occurrenceId:uid(5,2),platform:'instagram',text:'T',cta:null,mediaId:null}]);});

test('anti-invention check: risky claims refused unless the very same fact is stored',()=>{
 const facts=sel.factsOf(input());
 for(const claim of ['Devis gratuit sous 48h','Garantie décennale','Entreprise certifiée RGE','10 ans d’expérience','Depuis 1998','-20 % ce mois-ci','À partir de 99 €','4,9 étoiles sur Google','Plus de 500 clients satisfaits','Intervention rapide','Promotion de printemps'])
  assert.ok(sel.unsupportedClaims(claim,facts).length>0,claim);
 assert.deepEqual(json(sel.unsupportedClaims('Un contrôle de la toiture avant l’hiver.',facts)),[]);
 assert.deepEqual(json(sel.unsupportedClaims('Garantie décennale',facts+'\nGarantie décennale')),[],'stored fact allowed');
 const r=sel.validateGeneratorOutput(input(),good());assert.equal(r.ok,true);
 assert.deepEqual(json(sel.validateGeneratorOutput(input(),good({publications:good().publications.map((p,i)=>i===0?{...p,text:p.text+' Devis gratuit !'}:p)}))),{ok:false,reason:'unsupported_claim'});
 assert.deepEqual(json(sel.validateGeneratorOutput(input(),good({publications:good().publications.map(p=>({...p,text:'Même texte'}))}))),{ok:false,reason:'identical_texts'});
 assert.deepEqual(json(sel.validateGeneratorOutput(input(),good({idea:{subject:'',angle:'A'}}))),{ok:false,reason:'invalid_idea'});
 assert.deepEqual(json(sel.validateGeneratorOutput(input(),good({idea:{subject:'s'.repeat(301),angle:'A'}}))),{ok:false,reason:'invalid_idea'});
 assert.deepEqual(json(sel.validateGeneratorOutput(input(),good({publications:good().publications.map((p,i)=>i===0?{...p,text:'t'.repeat(10001)}:p)}))),{ok:false,reason:'invalid_text'});
 assert.deepEqual(json(sel.validateGeneratorOutput(input(),good({publications:good().publications.map((p,i)=>i===0?{...p,mediaId:null}:p)}))),{ok:false,reason:'invalid_media'},'one media for the whole idea');
 assert.deepEqual(json(sel.validateGeneratorOutput(input(),good({publications:good().publications.map(p=>({...p,mediaId:uid(9,9)}))}))),{ok:false,reason:'invalid_media'},'unknown media');});

function contextWith(tables,{fail=[]}={}){const log=[],calls=[];
 const db={from(table){log.push(table);const f=[];const rows=()=>fail.includes(table)?{data:null,error:{message:'down'}}:{data:json((tables[table]??[]).filter(r=>f.every(x=>x(r)))),error:null};
  const q={select:()=>q,order:()=>q,limit:()=>q,eq(k,v){f.push(r=>r[k]===v);return q;},in(k,vs){f.push(r=>vs.includes(r[k]));return q;},
   maybeSingle:async()=>{const r=rows();return {data:r.data?.[0]??null,error:r.error};},then(ok,ko){return Promise.resolve(rows()).then(ok,ko);}};return q;}};
 return {log,calls,m:load('lib/publications/agent-v2/context.ts',{'@/lib/require-admin':{requireAdmin:async()=>{calls.push('admin');}},'@/lib/supabase/server':{getSupabaseServerClient:()=>db}})};}
const ctxTables=()=>({projects:[{id:P,client_id:C,name:'Réseaux sociaux'}],clients:[{id:C,name:'Toitures Dupont',activity:'Couverture',geographic_area:null,notes:'Note privée',website:'https://x'}],
 publication_agent_projects:[{project_id:P,client_id:C,enabled:true,rights_confirmed:true,verified_services:['Couverture'],editorial_rules:'Ton sobre',drive_folder_id:'folder00000001'}],
 publication_project_channels:[{project_id:P,client_id:C,platform:'facebook',enabled:true,editorial_rules:'Pas d’emoji'},{project_id:P,client_id:C,platform:'instagram',enabled:false,editorial_rules:'X'}],
 publication_client_settings:[{client_id:C,editorial_brief:'Brief client'}],publications:[{project_id:P,client_id:C,subject:'Ancien sujet'}],
 publication_drive_media:[{id:M,client_id:C,drive_folder_id:'folder00000001',analysis:{scene:'roof',usable:true},claimed_run_id:null,drive_file_id:'file0000000001',name:'chantier-lyon.jpg'},
  {id:uid(9,2),client_id:C,drive_folder_id:'folder00000001',analysis:{scene:'roof',usable:false},claimed_run_id:null},{id:uid(9,3),client_id:C,drive_folder_id:'folder00000001',analysis:{scene:'paint',usable:true},claimed_run_id:null}],
 publication_media_uses:[{client_id:C,media_id:uid(9,3)}]});

test('context: admin first, each table read once (no N+1), only stored facts, no sensitive media data, fail closed',async()=>{
 const c=contextWith(ctxTables());const {input:i,clientId}=await c.m.buildAgentV2Context(P,batch);
 assert.equal(c.calls[0],'admin');assert.equal(clientId,C);
 assert.deepEqual([...new Set(c.log)].length,c.log.length,'every table read exactly once');
 assert.deepEqual(json(i.client),{name:'Toitures Dupont',activity:'Couverture',zone:null},'absent zone stays null, no fallback');
 assert.equal(i.rules,'Ton sobre\nBrief client');assert.deepEqual(json(i.channelRules),[{platform:'facebook',rules:'Pas d’emoji'}],'disabled channel rules ignored');
 assert.deepEqual(json(i.media),[{id:M,categories:['roof'],description:'Surface de toiture visible.',used:false},{id:uid(9,3),categories:['paint'],description:'Surface peinte ou matériel de peinture visible.',used:true}],'unusable excluded, used flagged');
 assert.deepEqual(json(i.previousSubjects),['Ancien sujet']);
 const all=JSON.stringify(i);for(const s of ['file0000000001','chantier-lyon','Note privée','https://x','folder00000001'])assert.ok(!all.includes(s),`never sent: ${s}`);
 for(const table of ['projects','clients','publication_agent_projects','publication_project_channels','publication_drive_media','publication_media_uses'])
  await assert.rejects(()=>contextWith(ctxTables(),{fail:[table]}).m.buildAgentV2Context(P,batch),e=>e.code==='context_unavailable',table);
 const disabled=ctxTables();disabled.publication_agent_projects[0].rights_confirmed=false;await assert.rejects(()=>contextWith(disabled).m.buildAgentV2Context(P,batch),e=>e.code==='agent_disabled');
 await assert.rejects(()=>contextWith(ctxTables()).m.buildAgentV2Context(P,[]),e=>e.code==='context_unavailable');});

class ContextError extends Error{constructor(code){super(code);this.code=code;}}
function serviceWith({open=batch,context,generator,rpc={},source='configured',platforms=['facebook','instagram','google_business_profile']}={}){
 const log=[];const db={from(table){const q={select:()=>q,eq:()=>q,in:async()=>({data:[{id:uid(4,1),platform:'facebook',occurrence_id:uid(5,1)},{id:uid(4,2),platform:'instagram',occurrence_id:uid(5,2)},{id:uid(4,3),platform:'google_business_profile',occurrence_id:uid(5,3)}],error:null}),
  maybeSingle:async()=>{log.push(['read',table]);return {data:{id:P,client_id:C,type:'Réseaux sociaux'},error:null};}};return q;},
  rpc:async(name,args)=>{log.push([name,json(args)]);const fn=rpc[name];if(fn)return fn(args);
   return name==='publication_agent_v2_begin'?{data:{run_id:RUN,reused:false},error:null}:name==='publication_agent_v2_finish'?{data:{run_id:RUN,publication_ids:[uid(4,1),uid(4,2),uid(4,3)],editorial_group_id:uid(7,1)},error:null}:{data:null,error:null};}};
 const m=load('lib/publications/agent-v2/service.ts',{'@/lib/require-admin':{requireAdmin:async()=>{log.push('admin');return {userId:'user_admin'};}},'@/lib/supabase/server':{getSupabaseServerClient:()=>db},
  '../project-channels':{getPublicationProjectChannels:async()=>({source,channels:[],platforms,legacyAligned:true})},'./open-occurrences':{getOpenOccurrencesForAgent:async()=>{log.push('open');return open;}},
  './context':{AgentV2ContextError:ContextError,buildAgentV2Context:context??(async(_p,b)=>({clientId:C,input:input({occurrences:b})}))},'./openai-generator':{openaiAgentV2Generator:()=>{throw Error('real AI must not be used in tests');}},
  // Media step (P8) doubled here; its own behaviour is covered by publications-agent-v2-media.test.mjs.
  './media':{attachAgentV2Media:async run=>{log.push(['attach_media',run]);return {state:'attached'};}},'./media-runs':{getAgentV2RunMedia:async()=>null},
  '../media/source':{driveMediaSource:()=>({fetchMedia:async()=>{throw Error('Drive must not be used in tests');}})},'../media/transform':{adaptImage:async()=>{throw Error('unused');}}});
 return {m,log,generator:generator??{generate:async()=>({output:good(),usage:{input_tokens:1200,output_tokens:400,estimated_cost_eur:.0012,model:'gpt-4.1-mini-2025-04-14'}})}};}
const now=new Date('2026-10-12T00:00:00Z');

test('service: full batch → begin, strict validation, one atomic finish, drafts with links; no submission, no publication',async()=>{
 const s=serviceWith();const r=await s.m.prepareNextPublications(P,{allowRealAI:false,generator:s.generator,now});
 assert.equal(s.log[0],'admin');assert.equal(r.ok,true);assert.equal(r.message,'3 brouillons créés avec média. À relire et valider manuellement.');assert.equal(r.withMedia,true);assert.deepEqual(s.log.filter(x=>x[0]==='attach_media'),[['attach_media',RUN]]);
 assert.deepEqual(json(r.publications.map(p=>p.label)),['Facebook','Instagram','Google Business Profile']);
 const begin=s.log.find(x=>x[0]==='publication_agent_v2_begin');assert.deepEqual(begin[1],{p_project_id:P,p_occurrence_ids:batch.map(o=>o.occurrenceId),p_considered:3,p_actor_id:'user_admin'});
 const finish=s.log.find(x=>x[0]==='publication_agent_v2_finish');assert.equal(finish[1].p_media_id,M);assert.deepEqual(finish[1].p_usage,{input_tokens:1200,output_tokens:400,estimated_cost_eur:.0012});
 assert.deepEqual(finish[1].p_output.publications.map(p=>Object.keys(p).sort().join(',')),['cta,occurrence_id,text','cta,occurrence_id,text','cta,occurrence_id,text'],'only validated fields sent');
 assert.ok(!s.log.some(x=>/submit|review|delivery|job|publish/.test(String(x[0]))),'never submits, reviews, schedules or publishes');});

test('service: fail closed at every step, failures recorded, no AI without explicit authorization, legacy refused',async()=>{
 const fails=s=>s.log.filter(x=>x[0]==='publication_agent_v2_fail').map(x=>[x[1].p_error_code,x[1].p_usage.estimated_cost_eur]);
 const noAuth=serviceWith();assert.equal((await noAuth.m.prepareNextPublications(P,{allowRealAI:false,now})).ok,false);assert.ok(!noAuth.log.some(x=>x==='open'),'no read before authorization');
 const legacy=serviceWith({source:'legacy'});assert.match((await legacy.m.prepareNextPublications(P,{allowRealAI:true,generator:legacy.generator,now})).message,/Confirmez d’abord les canaux/);
 const suspended=serviceWith({platforms:[]});assert.match((await suspended.m.prepareNextPublications(P,{allowRealAI:true,generator:suspended.generator,now})).message,/Publications suspendues/);
 const empty=serviceWith({open:[]});const e=await empty.m.prepareNextPublications(P,{allowRealAI:true,generator:empty.generator,now});
 assert.equal(e.message,'Aucune occurrence ouverte. Préparez d’abord les prochaines semaines.');assert.ok(!empty.log.some(x=>x[0]==='publication_agent_v2_begin'));
 const ctx=serviceWith({context:async()=>{throw new ContextError('agent_disabled');}});assert.match((await ctx.m.prepareNextPublications(P,{allowRealAI:true,generator:ctx.generator,now})).message,/Activez et configurez/);assert.ok(!ctx.log.some(x=>String(x[0]).startsWith('publication_agent_v2')));
 const reused=serviceWith({rpc:{publication_agent_v2_begin:()=>({data:{run_id:RUN,reused:true},error:null})}});let calls=0;
 assert.equal((await reused.m.prepareNextPublications(P,{allowRealAI:true,generator:{generate:async()=>{calls++;return {output:good(),usage:{}};}},now})).message,'Une préparation est déjà en cours pour ce projet.');assert.equal(calls,0,'double click: no second generation');
 const budget=serviceWith({rpc:{publication_agent_v2_begin:()=>({data:null,error:{code:'55000',message:'Budget limit reached'}})}});assert.match((await budget.m.prepareNextPublications(P,{allowRealAI:true,generator:budget.generator,now})).message,/Budget mensuel/);
 const thrown=serviceWith({generator:{generate:async()=>{throw Error('down');}}});const t=await thrown.m.prepareNextPublications(P,{allowRealAI:true,generator:{generate:async()=>{throw Error('down');}},now});
 assert.equal(t.ok,false);assert.deepEqual(fails(thrown),[['generation_failed',.1]],'unknown usage: conservative reservation');
 const invalid=serviceWith();await invalid.m.prepareNextPublications(P,{allowRealAI:true,generator:{generate:async()=>({output:good({publications:good().publications.slice(0,2)}),usage:{input_tokens:5,output_tokens:5,estimated_cost_eur:.001,model:'m'}})},now});
 assert.deepEqual(fails(invalid),[['invalid_output',.001]]);assert.ok(!invalid.log.some(x=>x[0]==='publication_agent_v2_finish'),'invalid output never persisted');
 const claim=serviceWith();await claim.m.prepareNextPublications(P,{allowRealAI:true,generator:{generate:async()=>({output:good({publications:good().publications.map((p,i)=>i===1?{...p,text:'Devis gratuit !'}:p)}),usage:{input_tokens:5,output_tokens:5,estimated_cost_eur:.001,model:'m'}})},now});
 assert.deepEqual(fails(claim),[['unsupported_claim',.001]]);
 const race=serviceWith({rpc:{publication_agent_v2_finish:()=>({data:null,error:{code:'23505'}})}});const rr=await race.m.prepareNextPublications(P,{allowRealAI:true,generator:race.generator,now});
 assert.match(rr.message,/Une occurrence a changé/);assert.deepEqual(fails(race),[['occurrence_unavailable',.0012]]);
 const single=serviceWith({open:[batch[2]],rpc:{publication_agent_v2_finish:()=>({data:{publication_ids:[uid(4,3)],editorial_group_id:null},error:null})}});
 const one=await single.m.prepareNextPublications(P,{allowRealAI:true,generator:{generate:async i=>({output:{idea:{subject:'S',angle:'A'},publications:[{occurrenceId:i.occurrences[0].occurrenceId,platform:'google_business_profile',text:'Texte',cta:null,mediaId:null}]},usage:{input_tokens:1,output_tokens:1,estimated_cost_eur:0,model:'m'}})},now});
 assert.equal(one.message,'1 brouillon créé sans média. Média requis avant validation : ajoutez une photo à chaque brouillon.');assert.ok(!single.log.some(x=>x[0]==='attach_media'),'no media: no media step');});

test('real generator: Responses API integration with strict instructions and schema (mocked, never called for real)',async()=>{
 const calls=[];const g=load('lib/publications/agent-v2/openai-generator.ts',{'@/lib/integrations/publications-openai':{structuredResponse:async(instructions,payload,schema)=>{calls.push({instructions,payload:JSON.parse(payload),schema});
  return {value:{idea:{subject:'S',angle:'A'},media_id:M,publications:[{occurrence_id:uid(5,1),text:'T',cta:null}]},usage:{input_tokens:1,output_tokens:1,estimated_cost_eur:0,model:'m'}};}}}).openaiAgentV2Generator();
 const r=await g.generate(input());assert.equal(calls[0].instructions,prompt.AGENT_V2_INSTRUCTIONS);assert.equal(calls[0].payload.client.zone,null);assert.equal(calls[0].schema.additionalProperties,false);
 assert.deepEqual(json(r.output.publications),[{occurrenceId:uid(5,1),platform:'facebook',text:'T',cta:null,mediaId:M}]);});

test('action and UI: explicit AI authorization, admin first; configured → Agent v2, legacy → Agent v1; no database in client components',async()=>{
 const calls=[];const a=load('app/(cockpit)/publications/agent-v2-actions.ts',{'next/cache':{revalidatePath:p=>calls.push(['revalidate',p])},'@/lib/require-admin':{requireAdmin:async()=>{calls.push('admin');}},
  '@/lib/publications/agent-v2/service':{prepareNextPublications:async(p,o)=>{calls.push(['prepare',p,o.allowRealAI]);return {ok:true,message:'3 brouillons créés',publications:[],withMedia:false};}}});
 const form=e=>{const f=new FormData();for(const [k,v] of Object.entries(e))f.set(k,v);return f;};
 assert.match((await a.prepareNextPublicationsAction({},form({project_id:P}))).message,/Autorisez explicitement/);assert.ok(!calls.some(c=>c[0]==='prepare'));
 calls.length=0;assert.equal((await a.prepareNextPublicationsAction({},form({project_id:P,authorize_ai:'on'}))).ok,true);assert.deepEqual(json(calls.slice(0,2)),['admin',['prepare',P,true]]);
 const link={__esModule:true,default:({href,children,...p})=>jsx.jsx('a',{href,...p,children})};
 const {AgentV2Section}=load('components/publications/agent-v2-section.tsx',{'next/link':link,'./agent-forms':{AgentConfigurationForm:()=>jsx.jsx('form',{'data-config':'true'})},'./agent-v2-form':{AgentV2Form:p=>jsx.jsx('form',{'data-v2-form':String(p.disabled)})}});
 const html=renderToStaticMarkup(jsx.jsx(AgentV2Section,{projectId:P,status:'active',config:null,openCount:5,upcoming:[{key:'a',platformLabel:'Facebook',date:'2026-10-13',time:'12:00'},{key:'b',platformLabel:'Instagram',date:'2026-10-13',time:'18:00'}]}));
 assert.match(html,/Prochaines occurrences/);assert.match(html,/Facebook — /);assert.match(html,/data-v2-form="false"/);assert.match(html,/3 autre\(s\) occurrence\(s\) ouverte\(s\)/);assert.match(html,/sans média/);
 const none=renderToStaticMarkup(jsx.jsx(AgentV2Section,{projectId:P,status:'active',config:null,openCount:0,upcoming:[]}));assert.match(none,/Aucune occurrence ouverte\. Préparez d’abord les prochaines semaines/);assert.match(none,/data-v2-form="true"/);
 assert.match(renderToStaticMarkup(jsx.jsx(AgentV2Section,{projectId:P,status:'unconfigured',config:null,openCount:1,upcoming:[{key:'a',platformLabel:'Facebook',date:'2026-10-13',time:'12:00'}]})),/data-v2-form="true"/,'inactive agent: disabled');
 const {AgentV2Form}=load('components/publications/agent-v2-form.tsx',{'next/link':link,'@/app/(cockpit)/publications/agent-v2-actions':{prepareNextPublicationsAction:async()=>({})}});
 const formHtml=renderToStaticMarkup(jsx.jsx(AgentV2Form,{projectId:P,disabled:false})),consent=formHtml.match(/<input[^>]*name="authorize_ai"[^>]*>/)?.[0]??'';assert.match(consent,/required=""/);assert.match(consent,/type="checkbox"/);assert.match(formHtml,/Préparer les prochaines publications/);
 for(const f of ['components/publications/agent-v2-form.tsx','components/publications/agent-v2-section.tsx'])assert.doesNotMatch(src(f),/@\/lib\/supabase|getSupabaseServerClient|\.rpc\(|\.from\(|process\.env|server-only|agent-v2\/service/,f);
 const page=src('app/(cockpit)/projects/[id]/(tabs)/agent/page.tsx');assert.ok(page.indexOf('capabilities.source==="configured"')<page.indexOf('<AgentWorkspace'),'configured → v2 before the v1 fallback');assert.match(page,/<AgentV2Section /);});

test('overview: configured projects read their next content from channel occurrences; legacy unchanged',()=>{
 const m=load('lib/publications/occurrence-model.ts');
 assert.equal(m.occurrenceSlotDisplay({state:'open',publication:null}),'empty');assert.equal(m.occurrenceSlotDisplay({state:'linked',publication:{id:'p',subject:'s',status:'pending_review'}}),'pending_review');
 const page=src('app/(cockpit)/projects/[id]/(tabs)/page.tsx');assert.match(page,/capabilities\.source==="configured"/);assert.match(page,/getUpcomingProjectOccurrences\(id,20\)/);assert.match(page,/getCalendar\(\{from:today,to:addDays\(today,56\),project:id\}\)/,'legacy calendar kept for legacy projects');});

test('P7 scope: one migration, drafts only, no publisher / delivery / cron; agent v2 code never imports Drive or publishes',()=>{
 const list=readdirSync(resolve(root,'supabase/migrations')).sort();assert.equal(list.length,18);assert.equal(list[15],'20261008040000_publications_agent_v2.sql');assert.equal(list[16],'20261008050000_publications_agent_v2_media.sql');
 const sql=src('supabase/migrations/20261008040000_publications_agent_v2.sql').replace(/--[^\n]*/g,'');
 assert.doesNotMatch(sql,/\bdrop (table|column|index|function)|delete from|truncate (table )?public|security definer|insert into public\.publication_deliveries|insert into public\.publication_jobs|status='approved'|publication_submit_manual|publication_review_manual/i);
 for(const f of readdirSync(resolve(root,'lib/publications/agent-v2')))assert.doesNotMatch(src('lib/publications/agent-v2/'+f).replace(/\/\/[^\n]*/g,''),/publications-drive|google-drive|googleapis|setInterval|cron|submitOrReview|publication_deliveries/i,f);});
