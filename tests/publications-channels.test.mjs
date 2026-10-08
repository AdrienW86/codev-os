import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync,statSync} from 'node:fs';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {resolve,dirname,relative,join} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

const native=createRequire(import.meta.url),root=resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'));
function load(file,mocks={}){const cache=new Map();const find=base=>[base+'.ts',base+'.tsx'].find(p=>existsSync(p))??base;
 function read(path){if(cache.has(path))return cache.get(path);const exports={};cache.set(path,exports);
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{exports,Intl,Date,URL,URLSearchParams,Map,Set,FormData,File,Uint8Array,Object,console,require:name=>{if(name in mocks)return mocks[name];if(name==='react/jsx-runtime')return jsx;if(name==='server-only')return {};
   if(name.startsWith('@/'))return read(find(resolve(root,name.slice(2))));if(name.startsWith('.'))return read(find(resolve(dirname(path),name)));return native(name);}});
  return exports;}
 return read(resolve(root,file));}
const json=value=>JSON.parse(JSON.stringify(value));
const src=file=>readFileSync(resolve(root,file),'utf8');
const legacy=load('lib/publications/legacy-channels.ts'),channels=load('lib/publications/channels.ts');
const uid=(prefix,n)=>`${prefix}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const C=uid(1,1),SOCIAL=uid(3,1),GBP=uid(3,2),WEB=uid(3,3),PUB=uid(4,1),REV=uid(7,1);
const admin={'@/lib/require-admin':{requireAdmin:async()=>({userId:'user_admin'})}};

// In-memory Supabase double: filters (eq/in), thenable queries, RPC/storage spies and per-table failures.
function mockDb(tables,{fail=[]}={}){const log=[];
 const db={log,from(table){const f=[];const rows=()=>fail.includes(table)?{data:null,error:{message:'down'}}:{data:json((tables[table]??[]).filter(r=>f.every(x=>x(r)))),error:null};
  const q={select:()=>q,order:()=>q,eq(k,v){f.push(r=>r[k]===v);return q;},in(k,vs){log.push(['in',table,vs.length]);f.push(r=>vs.includes(r[k]));return q;},
   maybeSingle:async()=>{const r=rows();return {data:r.data?.[0]??null,error:r.error};},single:async()=>{const r=rows();return {data:r.data?.[0]??null,error:r.error??(r.data?.length?null:{message:'none'})};},
   range:async(a,z)=>{const r=rows();return {data:r.data?.slice(a,z+1)??null,error:r.error};},then(ok,ko){log.push(['read',table]);return Promise.resolve(rows()).then(ok,ko);}};return q;},
  rpc:async name=>{log.push(['rpc',name]);return {data:name==='publication_ensure_calendar'?{slots_created:0,placeholders_created:0,conflicts:0}:PUB,error:null};},
  storage:{from:()=>({upload:async()=>{log.push(['upload']);return {error:null};},remove:async()=>({error:null}),createSignedUrl:async p=>({data:{signedUrl:`signed:${p}`},error:null})})}};
 return db;}
const projectRows=[{id:SOCIAL,client_id:C,type:'Réseaux sociaux'},{id:GBP,client_id:C,type:'Google Business Profile'},{id:WEB,client_id:C,type:'Site web'}];
const channelRows=(project,spec)=>Object.entries(spec).map(([platform,enabled])=>({project_id:project,client_id:C,platform,enabled}));
function serviceWith(tables,options){const db=mockDb(tables,options),calls=[];
 const m=load('lib/publications/project-channels.ts',{'@/lib/require-admin':{requireAdmin:async()=>{calls.push('admin');return {userId:'user_admin'};}},'@/lib/supabase/server':{getSupabaseServerClient:()=>{calls.push('db');return db;}}});
 return {m,db,calls};}

test('legacy fallback keeps exactly the historical type → platforms behaviour',()=>{
 assert.deepEqual(json(legacy.legacyPublicationChannelsForType('Réseaux sociaux')),[{platform:'facebook',enabled:true},{platform:'instagram',enabled:true}]);
 assert.deepEqual(json(legacy.legacyPublicationChannelsForType('Google Business Profile')),[{platform:'google_business_profile',enabled:true}]);
 for(const other of ['Site web','SEO','Google Ads','Autre','',null,undefined,'constructor','toString','__proto__','réseaux sociaux'])assert.deepEqual(json(legacy.legacyPublicationChannelsForType(other)),[],String(other));});

test('capabilities: enabled platforms in a stable order; workspace vs production predicates',()=>{
 const c=channels.publicationCapabilities([{platform:'instagram',enabled:true},{platform:'google_business_profile',enabled:false},{platform:'facebook',enabled:true},{platform:'facebook',enabled:true},{platform:'tiktok',enabled:true}],'configured');
 assert.deepEqual(json(c.platforms),['facebook','instagram']);assert.equal(c.source,'configured');assert.equal(c.channels.length,4,'unknown platforms are dropped');assert.equal(c.legacyAligned,true,'default; set by the server boundary only');
 assert.equal(channels.projectSupportsPublications(c),true);assert.equal(channels.projectAllowsPlatform(c,'instagram'),true);assert.equal(channels.projectAllowsPlatform(c,'google_business_profile'),false,'a disabled channel is not allowed');assert.equal(channels.projectAllowsPlatform(c,'tiktok'),false);
 const suspended=channels.publicationCapabilities([{platform:'facebook',enabled:false},{platform:'instagram',enabled:false},{platform:'google_business_profile',enabled:false}],'configured');
 assert.deepEqual(json(suspended.platforms),[]);assert.equal(channels.projectHasPublicationsWorkspace(suspended),true,'configured + 0 active: workspace kept');assert.equal(channels.projectSupportsPublications(suspended),false,'no production');
 const none=channels.publicationCapabilities([],'legacy');assert.equal(channels.projectHasPublicationsWorkspace(none),false,'non-Publications project');assert.equal(channels.projectSupportsPublications(none),false);
 const legacySocial=channels.publicationCapabilities(legacy.legacyPublicationChannelsForType('Réseaux sociaux'),'legacy');assert.equal(channels.projectHasPublicationsWorkspace(legacySocial),true);assert.equal(channels.projectSupportsPublications(legacySocial),true);
 for(const [name,list] of Object.entries({fb:['facebook'],ig:['instagram'],gbp:['google_business_profile'],fb_gbp:['facebook','google_business_profile'],all:['google_business_profile','instagram','facebook']}))
  assert.deepEqual(json(channels.publicationCapabilities(list.map(platform=>({platform,enabled:true})),'configured').platforms),['facebook','instagram','google_business_profile'].filter(p=>list.includes(p)),name);});

test('transitional production block and channel lock messages',()=>{
 const caps=(list,aligned=true)=>({...channels.publicationCapabilities(list.map(platform=>({platform,enabled:true})),'configured'),legacyAligned:aligned});
 assert.equal(channels.legacyProductionBlock(caps(['facebook','instagram']),'calendar'),null);
 assert.equal(channels.legacyProductionBlock(caps(['facebook','instagram','google_business_profile'],false),'calendar'),'Le nouveau planning par canal sera disponible après la migration du calendrier.');
 assert.equal(channels.legacyProductionBlock(caps(['facebook','instagram','google_business_profile'],false),'agent'),'L’agent Publications sera disponible pour cette configuration après sa migration multi-canal.');
 assert.equal(channels.legacyProductionBlock(caps([],false),'agent'),'Publications suspendues : aucun canal actif.');
 assert.equal(channels.channelLockMessage(caps(['facebook','instagram','google_business_profile']),['facebook','instagram']),null,'adding GBP never locks an FB+IG publication');
 assert.match(channels.channelLockMessage(caps(['facebook']),['facebook','instagram']),/^Cette publication cible Instagram, canal désactivé pour ce projet\. Elle est conservée telle quelle\./);
 assert.match(channels.channelLockMessage(caps([]),['facebook','instagram']),/Facebook, Instagram, canaux désactivés/);});

test('server service: configured rows win (even all disabled), legacy only without rows, admin first, batched reads',async()=>{
 const tables={projects:projectRows,publication_project_channels:[...channelRows(SOCIAL,{facebook:true,instagram:true,google_business_profile:true}),...channelRows(GBP,{google_business_profile:false}),
  {project_id:WEB,client_id:uid(1,9),platform:'facebook',enabled:true}]};
 const {m,calls,db}=serviceWith(tables);
 const social=await m.getPublicationProjectChannels(projectRows[0]);assert.equal(calls[0],'admin','admin before any read');
 assert.equal(social.source,'configured');assert.deepEqual(json(social.platforms),['facebook','instagram','google_business_profile'],'GBP added to a Réseaux sociaux project');assert.equal(social.legacyAligned,false);
 const gbp=await m.getPublicationProjectChannels(projectRows[1]);assert.equal(gbp.source,'configured');assert.deepEqual(json(gbp.platforms),[],'single disabled row: no fallback');assert.equal(channels.projectHasPublicationsWorkspace(gbp),true);assert.equal(channels.projectSupportsPublications(gbp),false);
 const web=await m.getPublicationProjectChannels(projectRows[2]);assert.equal(web.source,'legacy','a row of another client is ignored');assert.deepEqual(json(web.platforms),[]);
 const aligned=serviceWith({publication_project_channels:channelRows(SOCIAL,{facebook:true,instagram:true,google_business_profile:false})});
 const a=await aligned.m.getPublicationProjectChannels(projectRows[0]);assert.equal(a.legacyAligned,true,'enabled set = historical set');
 const legacyOnly=serviceWith({publication_project_channels:[]});const l=await legacyOnly.m.getPublicationProjectChannels(projectRows[0]);assert.equal(l.source,'legacy');assert.deepEqual(json(l.platforms),['facebook','instagram']);assert.equal(l.legacyAligned,true);
 const many=Array.from({length:250},(_,i)=>({id:uid(5,i+1),client_id:C,type:'Réseaux sociaux',name:'P'+i}));const batch=serviceWith({publication_project_channels:[]});
 const map=await batch.m.getPublicationCapabilitiesForProjects(many);assert.equal(map.size,250);assert.deepEqual(json(batch.db.log.filter(x=>x[0]==='in').map(x=>x[2])),[100,100,50],'one read per 100 projects');
 assert.equal((await batch.m.getPublicationCapabilitiesForProjects([])).size,0);
 const options=await m.publicationProjectOptions([{...projectRows[0],name:'Social',budget:1},{...projectRows[1],name:'Fiche'},{...projectRows[2],name:'Site'}]);
 assert.deepEqual(json(options),[{id:SOCIAL,client_id:C,name:'Social',type:'Réseaux sociaux',platforms:['facebook','instagram','google_business_profile']}],'suspended and non-Publications projects are not offered; no extra field');
 const broken=serviceWith({},{fail:['publication_project_channels']});await assert.rejects(()=>broken.m.getPublicationProjectChannels(projectRows[0]),/Canaux de publication indisponibles/,'read error throws, no silent fallback');
 void db;});

test('server guards: production block and publication channel lock fail closed',async()=>{
 const base={projects:projectRows,publications:[{id:PUB,project_id:SOCIAL,client_id:C,current_revision_id:REV}],publication_variants:[{revision_id:REV,client_id:C,platform:'facebook'},{revision_id:REV,client_id:C,platform:'instagram'}]};
 const notAligned=serviceWith({...base,publication_project_channels:channelRows(SOCIAL,{facebook:true,instagram:true,google_business_profile:true})});
 assert.equal(await notAligned.m.projectProductionBlock(SOCIAL,'calendar'),channels.CALENDAR_TRANSITION_MESSAGE);assert.equal(await notAligned.m.projectProductionBlock(SOCIAL,'agent'),channels.AGENT_TRANSITION_MESSAGE);
 assert.equal(await notAligned.m.publicationChannelLock(PUB),null,'adding GBP does not lock an FB+IG publication');
 const igOff=serviceWith({...base,publication_project_channels:channelRows(SOCIAL,{facebook:true,instagram:false})});
 assert.match(await igOff.m.publicationChannelLock(PUB),/cible Instagram, canal désactivé/);
 const aligned=serviceWith({...base,publication_project_channels:[]});assert.equal(await aligned.m.projectProductionBlock(SOCIAL,'agent'),null,'legacy fallback: aligned');assert.equal(await aligned.m.publicationChannelLock(PUB),null);
 const suspended=serviceWith({...base,publication_project_channels:channelRows(SOCIAL,{facebook:false,instagram:false})});assert.equal(await suspended.m.projectProductionBlock(SOCIAL,'calendar'),channels.SUSPENDED_PUBLICATIONS_MESSAGE);
 const broken=serviceWith(base,{fail:['publication_project_channels']});
 assert.match(await broken.m.projectProductionBlock(SOCIAL,'agent'),/action bloquée par sécurité/);assert.match(await broken.m.publicationChannelLock(PUB),/lecture seule par sécurité/);
 const unscoped=serviceWith({...base,publications:[{id:PUB,project_id:null,client_id:C,current_revision_id:REV}]});assert.equal(await unscoped.m.publicationChannelLock(PUB),null,'unscoped historical content is not locked');
 assert.equal(await notAligned.m.projectProductionBlock('bad','agent'),'Projet invalide.');});

function planningWith(tables){const db=mockDb(tables);return {db,m:load('lib/publications/planning.ts',{...admin,'@/lib/supabase/server':{getSupabaseServerClient:()=>db},'./data':{listPublications:async()=>[]},'@/lib/projects/data':{listProjects:async()=>[]}})};}
test('legacy calendar: no ensure_calendar call for any configured project (P3 occurrences replace it); legacy projects unchanged',async()=>{
 const configuredMessage='Ce projet utilise le planning par canal : utilisez « Préparer les prochaines semaines » dans le calendrier.';
 for(const [spec,message] of [[{facebook:true,instagram:true,google_business_profile:true},configuredMessage],[{facebook:false,instagram:true},configuredMessage],[{facebook:false,instagram:false},configuredMessage],[{facebook:true,instagram:true},configuredMessage]]){
  const {m,db}=planningWith({projects:projectRows,publication_project_channels:channelRows(SOCIAL,spec)});const r=await m.ensureCalendar(SOCIAL,'2026-10-12',true);
  assert.deepEqual(json(r),{ok:false,message},JSON.stringify(spec));assert.ok(!db.log.some(x=>x[0]==='rpc'),'no RPC, no slot');}
 const ok=planningWith({projects:projectRows,publication_project_channels:[]});assert.equal((await ok.m.ensureCalendar(SOCIAL,'2026-10-12',true)).ok,true,'legacy project: historical generation kept');assert.deepEqual(json(ok.db.log.filter(x=>x[0]==='rpc')),[['rpc','publication_ensure_calendar']]);
 const planning=src('lib/publications/planning.ts');assert.ok(planning.indexOf('legacyCalendarBlock(projectId)')>0&&planning.indexOf('legacyCalendarBlock(projectId)')<planning.indexOf('rpc("publication_ensure_calendar"'),'guard before the RPC');
 assert.match(planning,/if\(!project\|\|!projectable\(project\.id\)\)continue;/,'no legacy projection for configured projects; real slots stay listed');assert.match(planning,/c\.source==="legacy"&&!legacyProductionBlock/);});

test('Agent v1: refused before context, begin, reservation, Drive or AI for a non-aligned configuration',async()=>{
 const run=async spec=>{const db=mockDb({projects:projectRows,publications:[{id:PUB,project_id:SOCIAL,client_id:C,current_revision_id:REV}],publication_variants:[{revision_id:REV,client_id:C,platform:'facebook'}],publication_project_channels:channelRows(SOCIAL,spec)});const hits=[];
  const m=load('lib/publications/agent-service.ts',{...admin,'@/lib/supabase/server':{getSupabaseServerClient:()=>db},'./agent-context':{buildPublicationAgentContext:async()=>{hits.push('context');throw Error('stop');}},
   '@/lib/integrations/publications-drive':{driveReadProvider:()=>{hits.push('drive');}},'./ai/openai-provider':{openaiPublicationsProvider:()=>{hits.push('openai');}},'./ai/schemas':{},'./ai/provider':{MANUAL_RUN_RESERVE_EUR:.1},'./media/transform':{},'./media/matching':{},'./opportunities/types':{}});
  const ai={analyze:async()=>{hits.push('ai');},generate:async()=>{hits.push('ai');}},media={list:async()=>{hits.push('drive');return [];}};
  let result;try{result=await m.preparePublication(SOCIAL,PUB,{allowRealAI:false},{ai,media});}catch(error){result={thrown:error.message};}
  return {result,hits,rpc:db.log.filter(x=>x[0]==='rpc')};};
 for(const [spec,message] of [[{facebook:true,instagram:true,google_business_profile:true},channels.AGENT_TRANSITION_MESSAGE],[{facebook:true,instagram:false},channels.AGENT_TRANSITION_MESSAGE],[{facebook:false,instagram:false},channels.SUSPENDED_PUBLICATIONS_MESSAGE]]){
  const r=await run(spec);assert.equal(r.result.message,message);assert.deepEqual(r.hits,[],'no context, Drive or AI');assert.deepEqual(json(r.rpc),[],'no begin, no reservation');}
 const aligned=await run({facebook:true,instagram:true});assert.deepEqual(aligned.hits,['context'],'aligned configuration proceeds to the existing flow');assert.equal(aligned.result.thrown,'stop');
 const service=src('lib/publications/agent-service.ts');assert.ok(service.indexOf("projectProductionBlock(projectId,'agent')")<service.indexOf('buildPublicationAgentContext(projectId'),'guard before any context read');});

function workspaceWith(spec,extra={}){const tables={projects:projectRows,publications:[{id:PUB,project_id:SOCIAL,client_id:C,current_revision_id:REV,status:'draft'}],publication_variants:[{revision_id:REV,client_id:C,platform:'facebook'},{revision_id:REV,client_id:C,platform:'instagram'}],publication_project_channels:channelRows(SOCIAL,spec),...extra};
 const db=mockDb(tables);return {db,m:load('lib/publications/workspace.ts',{...admin,'@/lib/supabase/server':{getSupabaseServerClient:()=>db}})};}
const editForm=()=>{const f=new FormData();for(const [k,v] of Object.entries({publication_id:PUB,revision_id:REV,client_id:C,project_id:SOCIAL,title:'T',angle:'A',source:'S',facebook_enabled:'on',facebook_text:'F',instagram_enabled:'on',instagram_text:'I'}))f.set(k,v);return f;};
test('channel lock: save, media and approval refused server-side on a disabled channel; reject and history stay available',async()=>{
 const locked=workspaceWith({facebook:true,instagram:false});
 assert.match((await locked.m.saveDraft(editForm())).message,/cible Instagram/);
 const media=new FormData();for(const [k,v] of Object.entries({publication_id:PUB,revision_id:REV,rights:'on',provenance:'Client'}))media.set(k,v);media.set('image',new File([new Uint8Array(20)],'a.png',{type:'image/png'}));
 assert.match((await locked.m.uploadImage(media)).message,/cible Instagram/);
 const decision=d=>{const f=new FormData();f.set('publication_id',PUB);f.set('revision_id',REV);f.set('decision',d);if(d==='rejected')f.set('reason','Motif de rejet suffisant');return f;};
 assert.match((await locked.m.submitOrReview(decision('approved'))).message,/cible Instagram/);
 assert.deepEqual(json(locked.db.log.filter(x=>x[0]==='rpc'||x[0]==='upload')),[],'no RPC and no upload while locked');
 await locked.m.submitOrReview(decision('rejected'));assert.deepEqual(json(locked.db.log.filter(x=>x[0]==='rpc')),[['rpc','publication_review_manual']],'reject remains available');
 const gbpAdded=workspaceWith({facebook:true,instagram:true,google_business_profile:true});assert.equal((await gbpAdded.m.saveDraft(editForm())).id,PUB,'adding GBP keeps an FB+IG publication editable');
 const detail=load('lib/publications/publication-detail.ts');const w={variants:[],links:[],assets:[],revisions:[],reviews:[],events:[]};
 const built=detail.buildPublicationDetail({publication:{id:PUB,client_id:C,project_id:SOCIAL,current_revision_id:null,status:'draft',subject:'S',target_date:null,editorial_week:'2026-10-12',creation_origin:'manual'},clientName:'C',projectName:'P',workspace:w,slot:null,deliveries:[],debug:null,channelLock:'Cette publication cible Instagram, canal désactivé pour ce projet.'});
 assert.equal(built.readOnly,true);assert.match(built.readOnlyReason,/cible Instagram/);
 assert.match(src('lib/publications/drawer.ts'),/publicationChannelLock\(id\)/);assert.match(src('app/(cockpit)/publications/[id]/edit/page.tsx'),/channelLock\?<p role="status" data-channel-lock="true"/);});

test('defaultCadence and the editorial calendar take explicit platforms; legacy defaults are unchanged',()=>{
 const calendar=load('lib/publications/calendar.ts');const platformsOf=type=>channels.publicationCapabilities(legacy.legacyPublicationChannelsForType(type),'legacy').platforms;
 const gbp=calendar.defaultCadence(platformsOf('Google Business Profile')),social=calendar.defaultCadence(platformsOf('Réseaux sociaux'));
 assert.deepEqual([gbp.posts_per_week,json(gbp.preferred_weekdays),json(gbp.preferred_times)],[1,[1],['12:00']]);assert.deepEqual([social.posts_per_week,json(social.preferred_weekdays)],[2,[1,5]]);
 assert.equal(calendar.defaultCadence([]).posts_per_week,2,'same as the former defaultCadence(null)');
 const client={id:uid(1,1)},project={id:uid(3,1),client_id:client.id},cadence={...social,enabled:true,auto_create_slots:true};
 assert.throws(()=>calendar.buildEditorialCalendar(client,project,[],cadence,{start_week:'2026-10-12'}),/Périmètre/,'no channel, no calendar');
 const slots=calendar.buildEditorialCalendar(client,project,['instagram'],cadence,{start_week:'2026-10-12'});assert.deepEqual(json(slots[0].platforms),['instagram'],'platforms come from the capabilities');
 assert.doesNotMatch(src('lib/publications/calendar.ts'),/project\.type|projectType|import \{allowedPlatforms/);});

// Every Publications decision must go through the capabilities boundary; only legacy-channels.ts knows the type rule.
function files(dir){const abs=resolve(root,dir);if(!existsSync(abs))return [];if(statSync(abs).isFile())return [abs];return readdirSync(abs).flatMap(n=>files(join(dir,n)));}
const scanned=['lib/publications','components/publications','components/projects','app/(cockpit)/publications','app/(cockpit)/projects/[id]','lib/projects/workspace-view.ts'].flatMap(files).filter(f=>/\.tsx?$/.test(f));
test('architecture: no Publications module outside the legacy fallback decides platforms from the project type',()=>{
 assert.ok(scanned.length>40,'scan covers the Publications code');const legacyPath=resolve(root,'lib/publications/legacy-channels.ts');
 for(const file of scanned){if(file===legacyPath)continue;const name=relative(root,file);
  // Display labels of the GBP platform are allowed; quoted project-type literals (conditions, maps, arrays) are not.
  const code=readFileSync(file,'utf8').replace(/google_business_profile\s*:\s*["']Google Business Profile["']/g,'');
  assert.doesNotMatch(code,/allowedPlatforms/,name);assert.doesNotMatch(code,/["'`]Réseaux sociaux["'`]/,name);assert.doesNotMatch(code,/["'`]Google Business Profile["'`]/,name);assert.doesNotMatch(code,/\.type\s*[!=]==?\s*["'`]/,name);}
 const importers=[...['lib','app','components'].flatMap(files)].filter(f=>/\.tsx?$/.test(f)&&/from\s+['"][^'"]*legacy-channels['"]/.test(readFileSync(f,'utf8'))).map(f=>relative(root,f).replace(/\\/g,'/'));
 assert.deepEqual(importers,['lib/publications/project-channels.ts'],'the legacy rule has a single consumer');
 assert.match(src('lib/publications/legacy-channels.ts'),/'Réseaux sociaux':Object\.freeze\(\['facebook','instagram'\]/);
 assert.doesNotMatch(src('lib/publications/project-channels.ts'),/publication_channel_save|\.insert\(|\.update\(|\.delete\(/,'P1 TypeScript reads channels only');});

test('pages: workspace for configured projects (even suspended), production predicates elsewhere, transitional notices',()=>{
 const base='app/(cockpit)/projects/[id]/(tabs)/';
 for(const f of ['layout.tsx','page.tsx','review/page.tsx'])assert.match(src(base+f),/projectHasPublicationsWorkspace\(await getPublicationProjectChannels\(project\)\)/,f);
 for(const f of ['agent/page.tsx','calendar/page.tsx']){assert.match(src(base+f),/projectHasPublicationsWorkspace\(capabilities\)/,f);assert.match(src(base+f),/legacyProductionBlock\(capabilities,"(agent|calendar)"\)/,f);assert.match(src(base+f),/role="status" data-channel-transition=/,f);}
 assert.match(src(base+'calendar/page.tsx'),/defaultCadence\(capabilities\.platforms\)/);
 for(const f of ['app/(cockpit)/publications/page.tsx','app/(cockpit)/publications/new/page.tsx','app/(cockpit)/publications/[id]/edit/page.tsx'])assert.match(src(f),/publicationProjectOptions\(projects\)/,f);
 assert.match(src('lib/publications/workspace.ts'),/projectAllowsPlatform\(capabilities,v\.platform\)/);assert.match(src('lib/publications/agent-context.ts'),/\(await getPublicationProjectChannels\(project\.data\)\)\.platforms/);
 assert.match(src('lib/publications/planning.ts'),/getPublicationCapabilitiesForProjects\(projects\)/);assert.match(src('lib/publications/agent-planning-context.ts'),/getPublicationProjectChannels\(project\.data\)/);
 const form=load('components/publications/manual-form.tsx',{'@/app/(cockpit)/publications/actions':{savePublicationAction:async()=>({})}});
 const projects=[{id:uid(3,1),client_id:uid(1,1),name:'Fiche',type:'Google Business Profile',platforms:['google_business_profile','facebook']},{id:uid(3,2),client_id:uid(1,1),name:'Social',type:'Réseaux sociaux',platforms:['facebook','instagram']}];
 const html=renderToStaticMarkup(jsx.jsx(form.ManualPublicationForm,{clients:[{id:uid(1,1),name:'Jrenov'}],projects,publication:{id:uid(4,1),client_id:uid(1,1),project_id:uid(3,1),subject:'S',target_date:null}}));
 assert.ok(html.includes('name="google_business_profile_text"')&&html.includes('name="facebook_text"'),'configured platforms (GBP + FB) come from the capabilities');assert.ok(!html.includes('name="instagram_text"'));});

test('saveDraft validates platforms through the boundary (legacy fallback outcomes unchanged), admin first',async()=>{
 const project=(type)=>({id:uid(3,1),client_id:uid(1,1),type});const calls=[];
 const build=(p)=>{const db={from:()=>{const q={select:()=>q,eq:()=>q,in:async()=>({data:[],error:null}),maybeSingle:async()=>({data:p,error:null})};return q;},rpc:async(name)=>{calls.push(name);return {data:uid(4,1),error:null};}};
  return load('lib/publications/workspace.ts',{'@/lib/supabase/server':{getSupabaseServerClient:()=>db},...admin});};
 const form=platform=>{const f=new FormData();for(const [k,v] of Object.entries({client_id:uid(1,1),project_id:uid(3,1),title:'T',angle:'A',source:'S',[`${platform}_enabled`]:'on',[`${platform}_text`]:'Texte'}))f.set(k,v);return f;};
 for(const [type,platform,ok] of [['Réseaux sociaux','facebook',true],['Réseaux sociaux','instagram',true],['Réseaux sociaux','google_business_profile',false],['Google Business Profile','google_business_profile',true],['Google Business Profile','facebook',false],['Site web','facebook',false]]){
  calls.length=0;const result=await build(project(type)).saveDraft(form(platform));assert.equal(Boolean(result.id),ok,`${type} / ${platform}`);assert.equal(calls.length,ok?1:0);}});

test('getWorkspace finds media through database relations only, never through the storage path',async()=>{
 const P=uid(4,1),C=uid(1,1),R=uid(7,1),linked=uid(9,1),uploaded=uid(9,2),sibling=uid(9,3),orphan=uid(9,4);
 const tables={publications:[{id:P,client_id:C,current_revision_id:R}],publication_revisions:[{id:R,publication_id:P}],publication_variants:[{id:'v1',revision_id:R,publication_id:P,platform:'facebook'},{id:'v2',revision_id:R,publication_id:P,platform:'instagram'}],publication_reviews:[],
  publication_events:[{id:'e1',resource_id:P,action:'publication.media_uploaded',metadata:{asset_id:uploaded}},{id:'e2',resource_id:P,action:'publication.media_uploaded',metadata:{asset_id:'not-a-uuid'}},{id:'e3',resource_id:P,action:'publication.reviewed',metadata:{asset_id:orphan}}],
  publication_variant_assets:[{variant_id:'v1',asset_id:linked,client_id:C,sort_order:0},{variant_id:'v2',asset_id:sibling,client_id:C,sort_order:0}],
  publication_assets:[{id:linked,client_id:C,storage_path:`${C}/${P}/${linked}`},{id:uploaded,client_id:C,storage_path:`${C}/${P}/${uploaded}`},{id:sibling,client_id:C,storage_path:`${C}/${uid(4,9)}/${sibling}`},{id:orphan,client_id:C,storage_path:`${C}/${P}/${orphan}`}]};
 const reads=[];const db={from:table=>{const f=[];const q={select:()=>q,order:()=>q,eq(k,v){f.push(r=>r[k]===v);return q;},in(k,vs){reads.push([table,k]);f.push(r=>vs.includes(r[k]));return q;},like(){reads.push([table,'like']);return q;},
   maybeSingle:async()=>({data:json((tables[table]??[]).filter(r=>f.every(x=>x(r)))[0]??null),error:null}),range:async(a,z)=>({data:json((tables[table]??[]).filter(r=>f.every(x=>x(r))).slice(a,z+1)),error:null})};return q;},
  storage:{from:()=>({createSignedUrl:async path=>({data:{signedUrl:`signed:${path}`},error:null})})}};
 const w=await load('lib/publications/workspace.ts',{'@/lib/supabase/server':{getSupabaseServerClient:()=>db},...admin}).getWorkspace(P);
 assert.deepEqual(json(w.assets.map(a=>a.id)).sort(),[linked,uploaded,sibling].sort(),'linked, uploaded-for-this-publication and a shared sibling asset; never an unrelated file under the same prefix');
 assert.ok(!reads.some(r=>r[1]==='like'),'no storage-path discovery');assert.ok(reads.some(r=>r[0]==='publication_assets'&&r[1]==='id'));
 assert.doesNotMatch(src('lib/publications/workspace.ts'),/\.like\(/);assert.match(src('lib/publications/workspace.ts'),/path=`\$\{pub\.data\.client_id\}\/\$\{id\}\/\$\{asset\}`/,'upload path format unchanged');});

test('P1 migration: single file, explicit grants, no publication_events change, transitional guards documented',()=>{
 const dir=resolve(root,'supabase/migrations'),list=readdirSync(dir).sort();assert.equal(list.length,14);assert.equal(list[9],'20261007120000_publications_project_channels.sql');
 const sql=src('supabase/migrations/20261007120000_publications_project_channels.sql');
 const code=sql.replace(/--[^\n]*/g,'');assert.doesNotMatch(code,/alter table public\.publication_events|security definer|drop table|delete from|client_connections|publication_accounts\s+(add|alter|drop)/i);
 assert.match(sql,/revoke all on public\.publication_project_channels from public,anon,authenticated,service_role;\ngrant select,insert,update on public\.publication_project_channels to service_role;/);
 assert.match(sql,/TRANSITIONAL \(debt D-P1-ELIG\)/);assert.match(sql,/TRANSITIONAL \(debt D-P1-LEGACY\)/);
 assert.doesNotMatch(sql,/p_platform=any\(legacy/,'platforms are not limited by the project type');
 assert.match(sql,/where p\.id is null[^\n]*\n\s+or \(/,'post-condition OR fully parenthesized under the candidate scope');});
