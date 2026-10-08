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
const C=uid(1,1),P=uid(3,1),O=uid(5,1),G=uid(7,1),PUB=uid(4,1);
const model=load('lib/publications/occurrence-creation-model.ts');
const form=entries=>{const f=new FormData();for(const [k,v] of Object.entries(entries))f.set(k,v);return f;};
const base={occurrence_id:O,subject:'  Entretien toiture ',text:' Texte complet ',cta:'',group_mode:'none'};
const link={__esModule:true,default:({href,children,...p})=>jsx.jsx('a',{href,...p,children})};

test('creation form: strict parsing of subject, text, CTA and group mode (none / new / existing)',()=>{
 assert.deepEqual(json(model.parseCreationForm(form(base))),{occurrenceId:O,subject:'Entretien toiture',text:'Texte complet',cta:null,groupMode:'none',groupId:null,newGroupSubject:null});
 assert.deepEqual(json(model.parseCreationForm(form({...base,group_mode:'new',new_group_subject:' Idée commune '}))),{occurrenceId:O,subject:'Entretien toiture',text:'Texte complet',cta:null,groupMode:'new',groupId:null,newGroupSubject:'Idée commune'});
 assert.equal(model.parseCreationForm(form({...base,group_mode:'existing',group_id:G,cta:'Appelez-nous'})).groupId,G);
 for(const bad of [{...base,occurrence_id:'x'},{...base,subject:' '},{...base,subject:'s'.repeat(301)},{...base,text:''},{...base,text:'t'.repeat(10001)},{...base,group_mode:'other'},
  {...base,group_mode:'existing',group_id:'nope'},{...base,group_mode:'new',new_group_subject:''},{...base,subject:'bad\u0001'},{...base,cta:'c'.repeat(501)}])assert.equal(model.parseCreationForm(form(bad)),null,JSON.stringify(bad).slice(0,60));
 const dup=form(base);dup.append('subject','autre');assert.equal(model.parseCreationForm(dup),null,'duplicated field refused');});

test('groups and skip reasons: a group already holding the platform is not offered; reason bounded',()=>{
 const groups=[{groupId:G,subject:'Toiture',origin:'manual',sisters:[{platform:'instagram'}],missingPlatforms:[]},{groupId:uid(7,2),subject:'Isolation',origin:'manual',sisters:[{platform:'facebook'}],missingPlatforms:[]}];
 assert.deepEqual(json(model.groupChoices(groups,'facebook')),[{id:G,subject:'Toiture',platforms:['instagram'],available:true},{id:uid(7,2),subject:'Isolation',platforms:['facebook'],available:false}]);
 assert.equal(model.validSkipReason('  Jour férié '),'Jour férié');for(const bad of ['',' ','r'.repeat(501),'a\nb',null,3])assert.equal(model.validSkipReason(bad),null);
 assert.match(model.creationErrorMessage('23505'),/déjà une publication/);assert.match(model.creationErrorMessage('23514'),/créneau ignoré/);assert.match(model.skipErrorMessage('55000'),/déjà ignoré/);});

function mockDb(tables,{fail=[],rpc}={}){const log=[];
 return {log,from(table){const f=[];const rows=()=>fail.includes(table)?{data:null,error:{message:'down'}}:{data:json((tables[table]??[]).filter(r=>f.every(x=>x(r)))),error:null};
   const q={select:()=>q,order:()=>q,eq(k,v){f.push(r=>r[k]===v);return q;},in(k,vs){log.push(['in',table]);f.push(r=>vs.includes(r[k]));return q;},
    maybeSingle:async()=>{const r=rows();return {data:r.data?.[0]??null,error:r.error};},then(ok,ko){return Promise.resolve(rows()).then(ok,ko);}};return q;},
  rpc:async(name,args)=>{log.push(['rpc',name,json(args)]);return rpc?rpc(name,args):{data:{publication_id:PUB,revision_id:uid(6,1),editorial_group_id:null,editorial_group_created:false},error:null};}};}
const occurrence={id:O,client_id:C,project_id:P,platform:'facebook',local_date:'2026-10-12',local_time:'12:00:00',timezone:'Europe/Paris',scheduled_for:'2026-10-12T10:00:00Z',publication_id:null,skipped_at:null,skipped_reason:null};
function service(tables,options){const db=mockDb(tables,options),calls=[];
 return {db,calls,m:load('lib/publications/occurrence-publications.ts',{'@/lib/require-admin':{requireAdmin:async()=>{calls.push('admin');return {userId:'user_admin'};}},'@/lib/supabase/server':{getSupabaseServerClient:()=>db}})};}

test('server: occurrence read scoped to its project, groups batched, writes only through the RPCs, fail closed',async()=>{
 const tables={publication_channel_occurrences:[occurrence],publication_editorial_groups:[{id:G,client_id:C,project_id:P,subject:'Toiture',origin:'manual'}],publications:[{id:uid(4,9),editorial_group_id:G,platform:'facebook',client_id:C,project_id:P,subject:'x',status:'draft',occurrence_id:null,editorial_week:'2026-10-12'}]};
 const s=service(tables);const r=await s.m.getOccurrenceForCreation(O,P,new Date('2026-10-01T00:00:00Z'));assert.equal(s.calls[0],'admin');
 assert.deepEqual(json({...r.occurrence}),{id:O,projectId:P,platform:'facebook',platformLabel:'Facebook',date:'2026-10-12',time:'12:00',timezone:'Europe/Paris',state:'open',stateLabel:'À préparer',skippedReason:null,publication:null});
 assert.deepEqual(json(r.groups),[{id:G,subject:'Toiture',platforms:['facebook'],available:false}],'group already holding Facebook not available');
 assert.ok(!s.db.log.some(x=>x[0]==='rpc'),'reading never writes');
 assert.equal(await service(tables).m.getOccurrenceForCreation(O,uid(3,9)),null,'occurrence of another project not found');
 await assert.rejects(()=>service(tables,{fail:['publication_channel_occurrences']}).m.getOccurrenceForCreation(O,P),/Créneau indisponible/);
 const c=service(tables);const created=await c.m.createPublicationFromOccurrence({occurrenceId:O,subject:'S',text:'T',cta:'Appelez',groupMode:'new',groupId:null,newGroupSubject:'Idée'});
 assert.deepEqual(json(created),{ok:true,publicationId:PUB});
 assert.deepEqual(c.db.log.find(x=>x[0]==='rpc'),['rpc','publication_create_from_occurrence',{p_occurrence_id:O,p_editorial_group_id:null,p_new_group_subject:'Idée',p_subject:'S',p_text_content:'T',p_metadata:{cta:'Appelez'},p_actor_id:'user_admin'}]);
 assert.equal((await service(tables,{rpc:()=>({data:null,error:{code:'23505'}})}).m.createPublicationFromOccurrence({occurrenceId:O,subject:'S',text:'T',cta:null,groupMode:'none',groupId:null,newGroupSubject:null})).ok,false);
 assert.equal((await service(tables,{rpc:()=>({data:{},error:null})}).m.createPublicationFromOccurrence({occurrenceId:O,subject:'S',text:'T',cta:null,groupMode:'none',groupId:null,newGroupSubject:null})).ok,false,'unreadable result fails closed');
 const k=service(tables);assert.deepEqual(json(await k.m.skipOccurrence(O,' Jour férié ')),{ok:true,message:'Créneau ignoré. Il ne sera pas recréé.'});
 assert.deepEqual(k.db.log.find(x=>x[0]==='rpc'),['rpc','publication_occurrence_skip',{p_occurrence_id:O,p_reason:'Jour férié',p_actor_id:'user_admin'}]);
 const bad=service(tables);assert.equal((await bad.m.skipOccurrence(O,'')).ok,false);assert.equal((await bad.m.skipOccurrence('x','ok')).ok,false);assert.ok(!bad.db.log.some(x=>x[0]==='rpc'),'invalid skip never calls the RPC');
 assert.match((await service(tables,{rpc:()=>({data:null,error:{code:'55000'}})}).m.skipOccurrence(O,'x')).message,/déjà ignoré/);});

test('actions: admin first; creation redirects to the occurrence week only on success; skip requires confirmation',async()=>{
 const calls=[];const a=load('app/(cockpit)/publications/occurrence-actions.ts',{'next/cache':{revalidatePath:p=>calls.push(['revalidate',p])},'next/navigation':{redirect:url=>{calls.push(['redirect',url]);throw Error('NEXT_REDIRECT');}},
  '@/lib/require-admin':{requireAdmin:async()=>{calls.push('admin');}},'@/lib/publications/occurrences':{ensureProjectOccurrences:async()=>({ok:true,message:'ok'})},
  '@/lib/publications/occurrence-publications':{createPublicationFromOccurrence:async i=>{calls.push(['create',i.occurrenceId]);return i.subject==='KO'?{ok:false,message:'Création impossible'}:{ok:true,publicationId:PUB};},
   skipOccurrence:async(o,r)=>{calls.push(['skip',o,r]);return {ok:true,message:'Créneau ignoré.'};}}});
 await assert.rejects(()=>a.createFromOccurrenceAction({},form({...base,project_id:P,date:'2026-10-12'})),/NEXT_REDIRECT/);
 assert.equal(calls[0],'admin');assert.deepEqual(json(calls.find(c=>c[0]==='redirect')),['redirect',`/projects/${P}/calendar?date=2026-10-12`]);assert.ok(calls.some(c=>c[1]===`/projects/${P}/calendar`));
 calls.length=0;assert.deepEqual(json(await a.createFromOccurrenceAction({},form({...base,subject:'KO',project_id:P,date:'2026-10-12'}))),{ok:false,message:'Création impossible'});assert.ok(!calls.some(c=>c[0]==='redirect'||c[0]==='revalidate'));
 calls.length=0;assert.equal((await a.createFromOccurrenceAction({},form({...base,subject:'',project_id:P,date:'2026-10-12'}))).ok,false);assert.ok(!calls.some(c=>c[0]==='create'),'invalid form: no service call');
 calls.length=0;assert.match((await a.skipOccurrenceAction({},form({project_id:P,occurrence_id:O,reason:'x'}))).message,/Cochez la confirmation/);assert.ok(!calls.some(c=>c[0]==='skip'));
 calls.length=0;assert.equal((await a.skipOccurrenceAction({},form({project_id:P,occurrence_id:O,reason:'Fermé',confirm:'on'}))).ok,true);assert.deepEqual(json(calls.find(c=>c[0]==='skip')),['skip',O,'Fermé']);});

const actionsStub={createFromOccurrenceAction:async()=>({}),skipOccurrenceAction:async()=>({}),prepareOccurrencesAction:async()=>({})};
test('components: creation form (platform text, groups) and skip form (reason + confirmation), no database access client-side',()=>{
 const {OccurrencePublicationForm}=load('components/publications/occurrence-publication-form.tsx',{'@/app/(cockpit)/publications/occurrence-actions':actionsStub});
 const html=renderToStaticMarkup(jsx.jsx(OccurrencePublicationForm,{projectId:P,occurrenceId:O,date:'2026-10-12',platformLabel:'Instagram',groups:[{id:G,subject:'Toiture',platforms:['facebook'],available:true},{id:uid(7,2),subject:'Isolation',platforms:['instagram'],available:false}]}));
 assert.match(html,/Texte Instagram/);assert.match(html,/name="occurrence_id" value="[^"]+"/);assert.match(html,/name="group_mode"( checked="")? value="none"|value="none" checked=""/);assert.match(html,/<input type="radio" name="group_mode" checked="" value="none"\/>|value="none" checked=""/,'"none" selected by default');assert.match(html,/Enregistrer en brouillon/);
 assert.match(html,/Les groupes ayant déjà une publication Instagram ne sont pas proposés/);assert.doesNotMatch(html,/name="platform"/,'platform is never chosen by the form');
 const {OccurrenceSkipForm}=load('components/publications/occurrence-skip-form.tsx',{'@/app/(cockpit)/publications/occurrence-actions':actionsStub});
 const skip=renderToStaticMarkup(jsx.jsx(OccurrenceSkipForm,{projectId:P,occurrenceId:O}));
 assert.match(skip,/<details/);const reason=skip.match(/<input[^>]*name="reason"[^>]*>/)?.[0]??'',confirm=skip.match(/<input[^>]*name="confirm"[^>]*>/)?.[0]??'';
 assert.match(reason,/required=""/);assert.match(reason,/maxLength="500"/);assert.match(confirm,/type="checkbox"/);assert.match(confirm,/required=""/);assert.match(skip,/ne pourra pas être rétabli/);
 for(const f of ['components/publications/occurrence-publication-form.tsx','components/publications/occurrence-skip-form.tsx']){assert.match(src(f),/^'use client';/);
  assert.doesNotMatch(src(f),/@\/lib\/supabase|getSupabaseServerClient|\.rpc\(|\.from\(|process\.env|server-only|occurrence-publications'/,f);}});

test('creation page: configured project only, linked / skipped / open states, display never writes',async()=>{
 const state=(extra)=>({occurrence:{id:O,projectId:P,platform:'facebook',platformLabel:'Facebook',date:'2026-10-12',time:'12:00',timezone:'Europe/Paris',state:'open',stateLabel:'À préparer',skippedReason:null,publication:null,...extra},groups:[]});
 const page=(caps,data)=>load('app/(cockpit)/projects/[id]/(tabs)/calendar/occurrences/[occurrenceId]/page.tsx',{'next/navigation':{notFound:()=>{throw Error('NEXT_NOT_FOUND');}},'next/link':link,
  '@/lib/require-admin':{requireAdmin:async()=>{}},'@/lib/projects/data':{getProjectById:async()=>({id:P,client_id:C,type:'Réseaux sociaux'})},'@/lib/publications/project-channels':{getPublicationProjectChannels:async()=>caps},
  '@/lib/publications/occurrence-publications':{getOccurrenceForCreation:async()=>data},'@/components/publications/occurrence-publication-form':{OccurrencePublicationForm:()=>jsx.jsx('form',{'data-form':'create'})}}).default;
 const props={params:Promise.resolve({id:P,occurrenceId:O})},configured={source:'configured'};
 assert.match(renderToStaticMarkup(await page(configured,state({}))(props)),/data-form="create"/);
 const linked=renderToStaticMarkup(await page(configured,state({state:'linked',publication:{id:PUB,subject:'Toiture',status:'draft'}}))(props));assert.match(linked,new RegExp(`href="/publications/${PUB}"[^>]*>Toiture`));assert.doesNotMatch(linked,/data-form/);
 const skipped=renderToStaticMarkup(await page(configured,state({state:'skipped',skippedReason:'Fermé'}))(props));assert.match(skipped,/Créneau ignoré : Fermé/);assert.doesNotMatch(skipped,/data-form/);
 await assert.rejects(async()=>(await page({source:'legacy'},state({})))(props),/NEXT_NOT_FOUND/);await assert.rejects(async()=>(await page(configured,null))(props),/NEXT_NOT_FOUND/);
 assert.doesNotMatch(src('app/(cockpit)/projects/[id]/(tabs)/calendar/occurrences/[occurrenceId]/page.tsx'),/createPublicationFromOccurrence|skipOccurrence|\.rpc\(/);});

test('board / drawer: native platform for mono-platform publications, legacy derived from variants; occurrence date fixed',()=>{
 const detail=load('lib/publications/publication-detail.ts');const w={variants:[{id:'v',revision_id:'r',platform:'facebook',text_content:'T',metadata:{}}],links:[],assets:[],revisions:[{id:'r',revision_number:1,origin:'manual',created_at:'x'}],reviews:[],events:[]};
 const base={id:PUB,client_id:C,project_id:P,current_revision_id:'r',status:'draft',subject:'S',target_date:'2026-10-12',editorial_week:'2026-10-12',creation_origin:'manual',updated_at:'x'};
 const p4=detail.buildPublicationDetail({publication:{...base,platform:'facebook',occurrence_id:O},clientName:'C',projectName:'P',workspace:w,slot:null,deliveries:[],debug:null});
 assert.deepEqual(json(p4.platforms),['facebook']);assert.equal(p4.dateEditable,false,'occurrence date fixed');assert.equal(p4.occurrenceBound,true);assert.equal(p4.variants.length,1);
 const legacy=detail.buildPublicationDetail({publication:base,clientName:'C',projectName:'P',workspace:{...w,variants:[...w.variants,{id:'v2',revision_id:'r',platform:'instagram',text_content:'I',metadata:{}}]},slot:null,deliveries:[],debug:null});
 assert.deepEqual(json(legacy.platforms),['facebook','instagram']);assert.equal(legacy.dateEditable,true);assert.equal(legacy.occurrenceBound,false);
 const board=src('lib/publications/board.ts');assert.match(board,/const publicationColumns='id,client_id,project_id,platform,/);assert.match(board,/const platforms=p\.platform\?\[p\.platform\]:own\.map\(v=>v\.platform\)/);
 assert.match(src('components/publications/publication-drawer.tsx'),/Date et plateforme fixées par le créneau du canal/);});

test('saveDraft on a mono-platform publication: one variant on its platform, same project, occurrence date kept',async()=>{
 const pub={platform:'facebook',occurrence_id:O,target_date:'2026-10-12',project_id:P};const calls=[];
 const db={from:table=>{const q={select:()=>q,eq:()=>q,in:async()=>({data:[],error:null}),maybeSingle:async()=>({data:table==='publications'?pub:{id:P,client_id:C,type:'Réseaux sociaux'},error:null}),
  then:(ok)=>Promise.resolve({data:[],error:null}).then(ok)};return q;},rpc:async n=>{calls.push(n);return {data:PUB,error:null};}};
 const w=load('lib/publications/workspace.ts',{'@/lib/supabase/server':{getSupabaseServerClient:()=>db},'@/lib/require-admin':{requireAdmin:async()=>({userId:'user_admin'})},'./project-channels':{publicationChannelLock:async()=>null,getPublicationProjectChannels:async()=>({source:'configured',channels:[],platforms:['facebook','instagram'],legacyAligned:true})}});
 const edit=extra=>form({publication_id:PUB,revision_id:uid(6,1),client_id:C,project_id:P,title:'T',angle:'A',source:'S',target_date:'2026-10-12',facebook_enabled:'on',facebook_text:'F',...extra});
 assert.match((await w.saveDraft(edit({instagram_enabled:'on',instagram_text:'I'}))).message,/seul le texte Facebook/);
 assert.match((await w.saveDraft(edit({target_date:'2026-10-20'}))).message,/date d’une publication liée à un créneau ne peut pas changer/);
 assert.deepEqual(calls,[],'refused before any RPC');
 assert.equal((await w.saveDraft(edit({}))).id,PUB);assert.deepEqual(calls,['publication_save_draft']);});

test('P4-b scope: one migration, legacy save_draft identical except the occurrence filter, no delivery / publisher / agent',()=>{
 const list=readdirSync(resolve(root,'supabase/migrations')).sort();assert.equal(list.length,21);assert.equal(list[13],'20261008020000_publications_occurrence_publications.sql');
 const sql=src('supabase/migrations/20261008020000_publications_occurrence_publications.sql'),cal=src('supabase/migrations/20261005205057_publications_editorial_calendar.sql');
 const original=cal.slice(cal.indexOf('create or replace function public.publication_save_draft('),cal.indexOf('end $$;',cal.indexOf('create or replace function public.publication_save_draft('))+7);
 const redefined=sql.slice(sql.indexOf('create or replace function public.publication_save_draft('),sql.indexOf('end $$;',sql.indexOf('create or replace function public.publication_save_draft('))+7);
 assert.equal(redefined.replace(' and publications.occurrence_id is null)',')'),original,'only the slot search changes');
 const code=sql.replace(/--[^\n]*/g,'');assert.doesNotMatch(code,/\bdrop (table|column|index|function)|delete from|truncate (table )?public|security definer|publication_deliveries\(|publication_jobs\(|alter table/i);
 for(const f of ['lib/publications/occurrence-publications.ts','lib/publications/occurrence-creation-model.ts','components/publications/occurrence-publication-form.tsx','components/publications/occurrence-skip-form.tsx'])
  assert.doesNotMatch(src(f).replace(/\/\/[^\n]*/g,''),/openai|drive|publisher|cron|setInterval|agent-service/i,f);
 assert.deepEqual([...new Set([...src('lib/publications/occurrence-publications.ts').matchAll(/rpc\('([a-z_]+)'/g)].map(m=>m[1]))].sort(),['publication_create_from_occurrence','publication_occurrence_skip']);});
