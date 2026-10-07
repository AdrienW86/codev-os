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
  vm.runInNewContext(code,{exports,Intl,Date,URL,URLSearchParams,Map,Set,FormData,Object,console,require:name=>{if(name in mocks)return mocks[name];if(name==='react/jsx-runtime')return jsx;if(name==='server-only')return {};
   if(name.startsWith('@/'))return read(find(resolve(root,name.slice(2))));if(name.startsWith('.'))return read(find(resolve(dirname(path),name)));return native(name);}});
  return exports;}
 return read(resolve(root,file));}
const json=value=>JSON.parse(JSON.stringify(value));
const src=file=>readFileSync(resolve(root,file),'utf8');
const legacy=load('lib/publications/legacy-channels.ts'),channels=load('lib/publications/channels.ts');
const uid=(prefix,n)=>`${prefix}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('legacy fallback keeps exactly the historical type → platforms behaviour',()=>{
 assert.deepEqual(json(legacy.legacyPublicationChannelsForType('Réseaux sociaux')),[{platform:'facebook',enabled:true},{platform:'instagram',enabled:true}]);
 assert.deepEqual(json(legacy.legacyPublicationChannelsForType('Google Business Profile')),[{platform:'google_business_profile',enabled:true}]);
 for(const other of ['Site web','SEO','Google Ads','Autre','',null,undefined,'constructor','toString','__proto__','réseaux sociaux'])assert.deepEqual(json(legacy.legacyPublicationChannelsForType(other)),[],String(other));});

test('capabilities: enabled, known and distinct platforms in a stable order, with support/allow predicates',()=>{
 const c=channels.publicationCapabilities([{platform:'instagram',enabled:true},{platform:'google_business_profile',enabled:false},{platform:'facebook',enabled:true},{platform:'facebook',enabled:true},{platform:'tiktok',enabled:true}],'configured');
 assert.deepEqual(json(c.platforms),['facebook','instagram']);assert.equal(c.source,'configured');assert.equal(c.channels.length,4,'unknown platforms are dropped');
 assert.equal(channels.projectSupportsPublications(c),true);assert.equal(channels.projectAllowsPlatform(c,'instagram'),true);assert.equal(channels.projectAllowsPlatform(c,'google_business_profile'),false,'a disabled channel is not allowed');assert.equal(channels.projectAllowsPlatform(c,'tiktok'),false);
 const none=channels.publicationCapabilities([],'legacy');assert.equal(channels.projectSupportsPublications(none),false);assert.deepEqual(json(none.platforms),[]);
 for(const [name,list] of Object.entries({fb:['facebook'],ig:['instagram'],gbp:['google_business_profile'],fb_gbp:['facebook','google_business_profile'],all:['google_business_profile','instagram','facebook']}))
  assert.deepEqual(json(channels.publicationCapabilities(list.map(platform=>({platform,enabled:true})),'configured').platforms),['facebook','instagram','google_business_profile'].filter(p=>list.includes(p)),name);});

function service(deny=false){const calls=[];return {calls,m:load('lib/publications/project-channels.ts',{'@/lib/require-admin':{requireAdmin:async()=>{calls.push('admin');if(deny)throw Error('denied');return {userId:'user_admin'};}}})};}
test('server service: admin first, legacy source before P1, batch and form options without extra project data',async()=>{
 const denied=service(true);await assert.rejects(()=>denied.m.getPublicationProjectChannels({id:'p',client_id:'c',type:'Réseaux sociaux'}),/denied/);await assert.rejects(()=>denied.m.publicationProjectOptions([]),/denied/);
 const s=service();const social=await s.m.getPublicationProjectChannels({id:'p',client_id:'c',type:'Réseaux sociaux'});assert.equal(social.source,'legacy');assert.deepEqual(json(social.platforms),['facebook','instagram']);assert.deepEqual(s.calls,['admin']);
 const projects=[{id:'s',client_id:'c',name:'Social',type:'Réseaux sociaux',budget:1},{id:'g',client_id:'c',name:'Fiche',type:'Google Business Profile'},{id:'w',client_id:'c',name:'Site',type:'Site web'}];
 const map=await s.m.getPublicationCapabilitiesForProjects(projects);assert.deepEqual(json([...map].map(([id,c])=>[id,c.platforms])),[['s',['facebook','instagram']],['g',['google_business_profile']],['w',[]]]);
 assert.deepEqual(json(await s.m.publicationProjectOptions(projects)),[{id:'s',client_id:'c',name:'Social',type:'Réseaux sociaux',platforms:['facebook','instagram']},{id:'g',client_id:'c',name:'Fiche',type:'Google Business Profile',platforms:['google_business_profile']}],'non-Publications projects excluded, no other field leaked');});

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
 assert.match(src('lib/publications/legacy-channels.ts'),/'Réseaux sociaux':Object\.freeze\(\['facebook','instagram'\]/);});

test('pages, forms and services use the boundary; visible behaviour stays identical',()=>{
 const base='app/(cockpit)/projects/[id]/(tabs)/';
 for(const f of ['layout.tsx','page.tsx','agent/page.tsx','calendar/page.tsx','review/page.tsx'])assert.match(src(base+f),/projectSupportsPublications\((await getPublicationProjectChannels\(project\)|capabilities)\)/,f);
 assert.match(src(base+'calendar/page.tsx'),/defaultCadence\(capabilities\.platforms\)/);
 for(const f of ['app/(cockpit)/publications/page.tsx','app/(cockpit)/publications/new/page.tsx','app/(cockpit)/publications/[id]/edit/page.tsx'])assert.match(src(f),/publicationProjectOptions\(projects\)/,f);
 assert.match(src('lib/publications/workspace.ts'),/projectAllowsPlatform\(capabilities,v\.platform\)/);assert.match(src('lib/publications/agent-context.ts'),/\(await getPublicationProjectChannels\(project\.data\)\)\.platforms/);
 assert.match(src('lib/publications/planning.ts'),/getPublicationCapabilitiesForProjects\(projects\)/);assert.match(src('lib/publications/agent-planning-context.ts'),/getPublicationProjectChannels\(project\.data\)/);
 const form=load('components/publications/manual-form.tsx',{'@/app/(cockpit)/publications/actions':{savePublicationAction:async()=>({})}});
 const projects=[{id:uid(3,1),client_id:uid(1,1),name:'Fiche',type:'Google Business Profile',platforms:['google_business_profile']},{id:uid(3,2),client_id:uid(1,1),name:'Social',type:'Réseaux sociaux',platforms:['facebook','instagram']}];
 const html=renderToStaticMarkup(jsx.jsx(form.ManualPublicationForm,{clients:[{id:uid(1,1),name:'Jrenov'}],projects,publication:{id:uid(4,1),client_id:uid(1,1),project_id:uid(3,1),subject:'S',target_date:null}}));
 assert.ok(html.includes('name="google_business_profile_text"'),'the selected project platforms come from its capabilities');assert.ok(!html.includes('name="facebook_text"'));assert.match(src('components/publications/manual-form.tsx'),/selected\?\.platforms\?\?\[\]/);});

test('saveDraft validates platforms through the boundary with the same outcomes, admin first',async()=>{
 const project=(type)=>({id:uid(3,1),client_id:uid(1,1),type});const calls=[];
 const build=(p)=>{const db={from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:p,error:null})};return q;},rpc:async(name)=>{calls.push(name);return {data:uid(4,1),error:null};}};
  return load('lib/publications/workspace.ts',{'@/lib/supabase/server':{getSupabaseServerClient:()=>db},'@/lib/require-admin':{requireAdmin:async()=>({userId:'user_admin'})}});};
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
 const w=await load('lib/publications/workspace.ts',{'@/lib/supabase/server':{getSupabaseServerClient:()=>db},'@/lib/require-admin':{requireAdmin:async()=>({userId:'user_admin'})}}).getWorkspace(P);
 assert.deepEqual(json(w.assets.map(a=>a.id)).sort(),[linked,uploaded,sibling].sort(),'linked, uploaded-for-this-publication and a shared sibling asset; never an unrelated file under the same prefix');
 assert.ok(!reads.some(r=>r[1]==='like'),'no storage-path discovery');assert.ok(reads.some(r=>r[0]==='publication_assets'&&r[1]==='id'));
 assert.doesNotMatch(src('lib/publications/workspace.ts'),/\.like\(/);assert.match(src('lib/publications/workspace.ts'),/path=`\$\{pub\.data\.client_id\}\/\$\{id\}\/\$\{asset\}`/,'upload path format unchanged');});
