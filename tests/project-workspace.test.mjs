import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

const native=createRequire(import.meta.url),root=resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'));
// Loads TS/TSX modules; mocked imports win, other "@/" and relative imports load the real (pure) modules.
function load(file,mocks={}){const cache=new Map();
 const find=base=>[base+'.ts',base+'.tsx'].find(p=>existsSync(p))??base;
 function read(path){if(cache.has(path))return cache.get(path);const exports={};cache.set(path,exports);
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{exports,Intl,Date,URL,console,require:name=>{if(name in mocks)return mocks[name];if(name==='react/jsx-runtime')return jsx;if(name==='server-only')return {};
   if(name.startsWith('@/'))return read(find(resolve(root,name.slice(2))));if(name.startsWith('.'))return read(find(resolve(dirname(path),name)));return native(name);}});
  return exports;}
 return read(resolve(root,file));}

const ids={project:'30000000-0000-4000-8000-000000000001',client:'10000000-0000-4000-8000-000000000001',pending:'40000000-0000-4000-8000-000000000001',rejected:'40000000-0000-4000-8000-000000000002',placeholder:'40000000-0000-4000-8000-000000000003',agent:'50000000-0000-4000-8000-000000000001',run:'60000000-0000-4000-8000-000000000001'};
const uuid=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// Visible text only: tags and attributes (hrefs, keys) are not shown to the user.
const visible=html=>html.replace(/<[^>]+>/g,' ');
const calendar=load('lib/publications/calendar.ts'),today=calendar.parisToday(),inDays=n=>calendar.addDays(today,n);
const Link=({href,children,...rest})=>jsx.jsx('a',{href,...rest,children});
let segment=null;
const navigation={notFound:()=>{throw Error('NEXT_NOT_FOUND');},useSelectedLayoutSegment:()=>segment};
const social={id:ids.project,client_id:ids.client,name:'Réseaux sociaux CODE-V',type:'Réseaux sociaux',status:'En cours',progress:40,responsible:'Adrien',client:{name:'CODE-V'}};
const website={...social,name:'Refonte site',type:'Site web'};
const config={project_id:ids.project,client_id:ids.client,agent_id:ids.agent,enabled:true,drive_folder_id:'1eE3mcOIKWp-ddz0ZQRFuE7m7vAhJmB3j',rights_confirmed:true,verified_services:['Création de site web','Référencement SEO'],editorial_rules:'Photo-first.',updated_at:'2026-10-06T10:00:00Z'};
const publications=[
 {id:ids.pending,client_id:ids.client,project_id:ids.project,subject:'Création de site web : les points à vérifier',status:'pending_review',target_date:inDays(-2),editorial_week:inDays(-2),current_revision_id:'70000000-0000-4000-8000-000000000001'},
 {id:ids.rejected,client_id:ids.client,project_id:ids.project,subject:'SEO local',status:'rejected',target_date:inDays(3),editorial_week:inDays(3),current_revision_id:'70000000-0000-4000-8000-000000000002'},
 {id:ids.placeholder,client_id:ids.client,project_id:ids.project,subject:'Contenu à préparer',status:'draft',target_date:inDays(2),editorial_week:inDays(2),current_revision_id:null}];
const entry=(key,date,status,revision,publication_id)=>({key,date,time:'12:00',timezone:'Europe/Paris',client_id:ids.client,project_id:ids.project,client_name:'CODE-V',project_name:social.name,subject:status==='free'?'Contenu à préparer':'Sujet '+key,platforms:['facebook','instagram'],status,revision,validation:'Validation obligatoire',publication_id,origin:'calendar',conflict:false});
const entries=[entry('free',inDays(1),'free',null,null),entry('empty',inDays(2),'draft',null,ids.placeholder),entry('draft',inDays(4),'draft',1,'40000000-0000-4000-8000-000000000004'),entry('pending',inDays(5),'pending_review',1,ids.pending),entry('approved',inDays(6),'approved',2,'40000000-0000-4000-8000-000000000005'),entry('rejected',inDays(6),'rejected',1,ids.rejected),entry('published',inDays(7),'published',1,'40000000-0000-4000-8000-000000000006')];
const cadence={project_id:ids.project,client_id:ids.client,enabled:true,posts_per_week:2,preferred_weekdays:[1,5],preferred_times:['12:00','12:00'],timezone:'Europe/Paris',planning_horizon_weeks:4,auto_create_slots:true,require_manual_approval:true,updated_at:'2026-10-06T10:00:00Z'};
function mocks(project=social,overrides={}){const calls=[];return {calls,mocks:{
 'next/link':Link,'next/navigation':navigation,'@/lib/require-admin':{requireAdmin:async()=>({userId:'user_test'})},
 // Real channel boundary; no explicit channel row, so every project stays on the legacy fallback.
 '@/lib/supabase/server':{getSupabaseServerClient:()=>({from:()=>{const q={select:()=>q,in:async()=>({data:overrides.channels??[],error:null})};return q;}})},
 '@/lib/projects/data':{getProjectById:async id=>{calls.push(['project',id]);return id===project.id?project:null;}},
 '@/lib/tasks/data':{listTasksByProject:async()=>[{id:'80000000-0000-4000-8000-000000000001',title:'Préparer le brief',status:'À faire',due_date:inDays(10)}]},
 '@/lib/publications/data':{listPublications:async(client,project)=>{calls.push(['publications',client,project]);return publications;}},
 '@/lib/publications/agent-data':{getPublicationsAgentProject:async id=>{calls.push(['agent',id]);return overrides.agent??{ready:true,config,placeholders:publications.filter(p=>p.status==='draft')};}},
 '@/lib/publications/planning':{getCalendar:async filter=>{calls.push(['calendar',filter]);if(overrides.calendarError)throw Error('down');return entries;},getProjectCadence:async()=>overrides.cadence===undefined?cadence:overrides.cadence},
 './planning-form':{PlanningForm:props=>{calls.push(['PlanningForm',props]);return jsx.jsx('form',{'data-form':'planning'});}},
 './agent-forms':{AgentConfigurationForm:props=>{calls.push(['AgentConfigurationForm',props]);return jsx.jsx('form',{'data-form':'configuration'});},AgentPrepareForm:props=>{calls.push(['AgentPrepareForm',props]);return jsx.jsx('form',{'data-form':'prepare',children:(props.placeholders??[]).map(p=>jsx.jsx('option',{value:p.id,children:p.label},p.id))});}},
 '@/lib/agent-runs/data':{listAgentRuns:async()=>[{id:ids.run,status:'failed',summary:'preparation_failed',input_tokens:4090,output_tokens:386,estimated_cost_eur:0.1,started_at:'2026-10-06T12:17:08Z',agent:{name:'Agent Publications'},project_id:ids.project,project:{name:social.name}}]},
 '@/lib/recommendations/data':{listRecommendations:async()=>[]},'@/lib/actions/data':{listActions:async()=>[]},
 '@/lib/agents/project-assignments':{listAgentProjectAssignments:async()=>[{agent_id:ids.agent,enabled:true,agent:{name:'Agent Publications'}}]},
 '@/lib/reporting/data':{buildClientMonthlySummaryContext:async()=>({projects:[]})},'@/lib/reporting/period':{previousSummaryMonth:()=>'2026-09'},
 '@/components/work/project-context':{ProjectContext:()=>null},
 '@/lib/publications/review-cards':{buildReviewCards:async(list,options)=>{calls.push(['cards',list,options]);return list.filter(p=>['pending_review','rejected'].includes(p.status)).map(p=>({publicationId:p.id,status:p.status,subject:p.subject,debug:options.debug?{project_id:ids.project,publication_id:p.id}:null}));}},
 '@/components/publications/review-queue':{ReviewQueue:({cards,showContext})=>{calls.push(['queue',cards,showContext]);return jsx.jsx('section',{children:cards.map(c=>jsx.jsxs('article',{'data-card':c.status,children:[c.subject,c.debug?jsx.jsx('details',{'data-debug':'true',children:JSON.stringify(c.debug)}):null]},c.publicationId))});}},'@/lib/format-date':{formatDate:value=>String(value).slice(0,10)},
}};}
const props=(search={})=>({params:Promise.resolve({id:ids.project}),searchParams:Promise.resolve(search)});
async function page(file,project=social,search={},overrides={}){const m=mocks(project,overrides);const Page=load(file,m.mocks).default;return {html:renderToStaticMarkup(await Page(props(search))),calls:m.calls};}
const pages={overview:'app/(cockpit)/projects/[id]/(tabs)/page.tsx',calendar:'app/(cockpit)/projects/[id]/(tabs)/calendar/page.tsx',agent:'app/(cockpit)/projects/[id]/(tabs)/agent/page.tsx',review:'app/(cockpit)/projects/[id]/(tabs)/review/page.tsx',history:'app/(cockpit)/projects/[id]/(tabs)/history/page.tsx'};
const technical=html=>{const text=visible(html);return uuid.test(text)||/run_id|publication_ai_|\brpc\b|tokens?\b|estimated_cost|0,10 €|0\.1\b|score/i.test(text);};

test('Publications projects get the five tabs; other projects only get the relevant ones',()=>{const {projectTabs}=load('lib/projects/workspace-view.ts');
 assert.deepEqual(JSON.parse(JSON.stringify(projectTabs(ids.project,true).map(t=>[t.label,t.href]))),[['Vue d’ensemble',`/projects/${ids.project}`],['Calendrier',`/projects/${ids.project}/calendar`],['Agent Publications',`/projects/${ids.project}/agent`],['Validation',`/projects/${ids.project}/review`],['Historique',`/projects/${ids.project}/history`]]);
 assert.deepEqual(JSON.parse(JSON.stringify(projectTabs(ids.project,false).map(t=>t.key))),['overview','history']);});
test('layout renders the project header and tab navigation with the active tab from the route segment',async()=>{const m=mocks();const Layout=load('app/(cockpit)/projects/[id]/(tabs)/layout.tsx',m.mocks).default;
 for(const [seg,label] of [[null,'Vue d’ensemble'],['calendar','Calendrier'],['agent','Agent Publications'],['review','Validation'],['history','Historique']]){segment=seg;const html=renderToStaticMarkup(await Layout({...props(),children:jsx.jsx('main',{children:'contenu'})}));
  assert.match(html,new RegExp(`aria-current="page"[^>]*>${label}<`));assert.equal((html.match(/aria-current="page"/g)??[]).length,1);assert.ok(html.includes('contenu'));assert.ok(html.includes(`/projects/${ids.project}/edit`));}
 segment=null;const other=mocks(website);const html=renderToStaticMarkup(await load('app/(cockpit)/projects/[id]/(tabs)/layout.tsx',other.mocks).default({...props(),children:null}));
 assert.ok(html.includes('Historique'));for(const hidden of ['Calendrier','Agent Publications','Validation'])assert.ok(!html.includes(`>${hidden}<`),hidden);
 await assert.rejects(()=>load('app/(cockpit)/projects/[id]/(tabs)/layout.tsx',mocks({...social,id:'missing'}).mocks).default({...props(),children:null}),/NEXT_NOT_FOUND/);});
test('overview shows only the summary: status, progress, next content, pending count, agent status, useful alerts and compact tasks',async()=>{const {html,calls}=await page(pages.overview);const text=visible(html);
 for(const expected of ['En cours','Progression 40 %','Prochain contenu','Publications à valider','Actif','Préparer le brief','1 publication(s) à valider dont la date est dépassée.','créneau(x) sans contenu dans les 7 prochains jours.'])assert.ok(text.includes(expected),expected);
 assert.ok(text.includes('Brouillon'),'next content is the first slot with content');
 for(const removed of ['Enregistrer la cadence','Dossier de photos','Configuration de l’agent','Métriques enregistrées','data-form'])assert.ok(!html.includes(removed),removed);
 assert.equal(technical(html),false);assert.ok(!html.includes('data-debug'));assert.ok(calls.some(c=>c[0]==='calendar'&&c[1].project===ids.project));});
test('non-Publications projects show no Publications blocks and Publications tabs are not reachable',async()=>{const {html,calls}=await page(pages.overview,website);
 assert.ok(!visible(html).includes('Prochain contenu'));assert.ok(!html.includes('/calendar'));assert.equal(calls.some(c=>['agent','calendar','publications'].includes(c[0])),false);
 for(const key of ['calendar','agent','review'])await assert.rejects(()=>page(pages[key],website),/NEXT_NOT_FOUND/,key);
 assert.ok(visible((await page(pages.history,website)).html).includes('Activité du projet'));});
test('calendar shows a visual planning with the six statuses and the unchanged cadence form in a collapsible panel',async()=>{const {html,calls}=await page(pages.calendar);
 for(const [status,count] of [['empty',2],['draft',1],['pending_review',1],['approved',1],['rejected',1],['published',1]])assert.equal((html.match(new RegExp(`data-status="${status}"`,'g'))??[]).length,count,status);
 for(const label of ['Vide','Brouillon','À valider','Validé','Rejeté','Publié'])assert.ok(visible(html).includes(label),label);
 assert.match(html,/<details[^>]*><summary[^>]*>Paramètres du planning<\/summary><form data-form="planning">/);
 const form=calls.find(c=>c[0]==='PlanningForm')[1];assert.equal(form.projectId,ids.project);assert.equal(form.cadence,cadence);assert.match(form.startWeek,/^\d{4}-\d{2}-\d{2}$/);
 const filter=calls.find(c=>c[0]==='calendar')[1];assert.equal(filter.project,ids.project);assert.ok(filter.from<=today&&filter.to>=today);
 assert.equal(technical(html),false);assert.ok(html.includes('/publications/calendar?project='));
 const month=await page(pages.calendar,social,{mode:'month',date:'2026-10-15'});assert.deepEqual(JSON.parse(JSON.stringify(month.calls.find(c=>c[0]==='calendar')[1])),{from:'2026-10-01',to:'2026-10-31',project:ids.project});
 const failing=await page(pages.calendar,social,{},{calendarError:true,cadence:null});assert.ok(visible(failing.html).includes('Calendrier indisponible'));assert.match(failing.html,/<details open=""/);});
test('Agent Publications keeps the existing forms and data, with readable slot labels and no technical details',async()=>{const {html,calls}=await page(pages.agent);const text=visible(html);
 const configuration=calls.find(c=>c[0]==='AgentConfigurationForm')[1],prepare=calls.find(c=>c[0]==='AgentPrepareForm')[1];
 assert.equal(configuration.projectId,ids.project);assert.equal(configuration.config,config);assert.equal(prepare.projectId,ids.project);assert.equal(prepare.disabled,false);
 assert.deepEqual(JSON.parse(JSON.stringify(prepare.placeholders.map(p=>p.id))),[ids.placeholder]);assert.ok(!uuid.test(prepare.placeholders[0].label));
 for(const expected of ['Actif','Configuré','Confirmés','Création de site web','Référencement SEO','Photo-first.','Préparer un contenu','Configuration de l’agent'])assert.ok(text.includes(expected),expected);
 assert.ok(!text.includes(config.drive_folder_id));assert.equal(technical(html),false);
 const inactive=await page(pages.agent,social,{},{agent:{ready:true,config:{...config,enabled:false},placeholders:[]}});assert.equal(inactive.calls.find(c=>c[0]==='AgentPrepareForm')[1].disabled,true);
 const unconfigured=await page(pages.agent,social,{},{agent:{ready:true,config:null,placeholders:[]}});assert.match(unconfigured.html,/<details open=""[^>]*><summary[^>]*>Configuration de l’agent/);});
test('review tab renders the shared review queue with the project publications',async()=>{const {html,calls}=await page(pages.review);const text=visible(html);
 const built=calls.find(c=>c[0]==='cards');assert.equal(built[1],publications);assert.equal(built[2].debug,false);assert.ok(calls.some(c=>c[0]==='publications'&&c[2]===ids.project));
 const queue=calls.find(c=>c[0]==='queue');assert.equal(queue[1].length,2);assert.ok(!queue[2]);assert.ok(text.includes('Création de site web : les points à vérifier'));assert.ok(text.includes('SEO local'));assert.equal(technical(html),false);});
test('history gathers activity, runs, publications and metrics with readable run summaries',async()=>{const {html}=await page(pages.history);const text=visible(html);
 for(const expected of ['Activité du projet','Agent Publications','Préparation interrompue, aucun contenu soumis.','Publications du projet','À valider','Rejeté','Métriques enregistrées'])assert.ok(text.includes(expected),expected);
 assert.ok(!text.includes('preparation_failed'));assert.equal(technical(html),false);});
test('technical data is only rendered with ?debug=1',async()=>{for(const key of Object.keys(pages)){const normal=await page(pages[key]);assert.ok(!normal.html.includes('data-debug'),key);
  for(const value of ['1','true','0'])if(value!=='1')assert.ok(!(await page(pages[key],social,{debug:value})).html.includes('data-debug'),key+value);
  const debug=await page(pages[key],social,{debug:'1'});assert.ok(debug.html.includes('data-debug="true"'),key);assert.ok(debug.html.includes(ids.project),key);}
 const history=await page(pages.history,social,{debug:'1'});assert.ok(history.html.includes('estimated_cost_eur'));assert.ok(history.html.includes('preparation_failed'));
 const agent=await page(pages.agent,social,{debug:'1'});assert.ok(agent.html.includes('manual_run_reserve_eur'));assert.ok(agent.html.includes(config.drive_folder_id));});
test('existing actions keep their behavior and also refresh the new project tabs',async()=>{const calls=[];const cache={revalidatePath:path=>calls.push(path)};
 const agent=load('app/(cockpit)/publications/agent-actions.ts',{'next/cache':cache,'@/lib/require-admin':{requireAdmin:async()=>({userId:'user_local'})},'@/lib/publications/agent-service':{configurePublicationsAgent:async()=>({message:'Configured'}),preparePublication:async()=>({message:'Prepared'})},'@/lib/publications/validation':{isPublicationUuid:s=>typeof s==='string'&&uuid.test(s)}});
 const form=new FormData();form.set('project_id',ids.project);form.set('publication_id',ids.placeholder);
 assert.equal((await agent.configureAgentAction({},form)).message,'Configured');assert.ok(calls.includes(`/projects/${ids.project}`)&&calls.includes(`/projects/${ids.project}/agent`));
 calls.length=0;form.set('authorize_ai','on');assert.equal((await agent.prepareAgentAction({},form)).message,'Prepared');for(const path of [`/projects/${ids.project}`,`/projects/${ids.project}/agent`,`/projects/${ids.project}/calendar`,`/projects/${ids.project}/review`,'/publications/review','/publications/calendar',`/publications/${ids.placeholder}`])assert.ok(calls.includes(path),path);
 calls.length=0;const planning=load('app/(cockpit)/publications/calendar/actions.ts',{'next/cache':cache,'@/lib/require-admin':{requireAdmin:async()=>({userId:'user_local'})},'@/lib/publications/planning':{saveCadence:async()=>({ok:true,message:'Saved'}),ensureCalendar:async()=>({ok:true,message:'Reserved'})},'@/lib/publications/validation':{isPublicationUuid:s=>typeof s==='string'&&uuid.test(s)}});
 const generate=new FormData();generate.set('project_id',ids.project);generate.set('start_week','2026-10-05');generate.set('placeholders','on');assert.equal((await planning.generatePlanning({message:''},generate)).message,'Reserved');assert.ok(calls.includes(`/projects/${ids.project}/calendar`)&&calls.includes('/publications/calendar'));});
test('agent forms keep their field names and no longer show identifiers or costs in labels',()=>{const src=readFileSync(resolve(root,'components/publications/agent-forms.tsx'),'utf8');
 for(const name of ['project_id','folder','services','rules','rights','enabled','publication_id','authorize_ai'])assert.ok(src.includes(`name="${name}"`)||src.includes(`name='${name}'`),name);
 assert.ok(!src.includes('p.id.slice'));assert.ok(!src.includes('0,10 €'));assert.ok(src.includes('{p.label??p.date}'));});
