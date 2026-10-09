import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

const native=createRequire(import.meta.url),root=resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'));
function load(file,mocks={}){const cache=new Map();const find=base=>[base+'.ts',base+'.tsx'].find(p=>existsSync(p))??base;
 function read(path){if(cache.has(path))return cache.get(path);const exports={};cache.set(path,exports);
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{exports,Intl,Date,URL,URLSearchParams,Map,Set,FormData,File,Uint8Array,console,setTimeout,clearTimeout,require:name=>{if(name in mocks)return mocks[name];if(name==='react/jsx-runtime')return jsx;if(name==='server-only')return {};
   if(name.startsWith('@/'))return read(find(resolve(root,name.slice(2))));if(name.startsWith('.'))return read(find(resolve(dirname(path),name)));return native(name);}});
  return exports;}
 return read(resolve(root,file));}
const json=value=>JSON.parse(JSON.stringify(value));
const src=file=>readFileSync(resolve(root,file),'utf8');
const uuidPattern=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,visible=html=>html.replace(/<[^>]+>/g,' ');
const uid=(prefix,n)=>`${prefix}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const C1=uid(1,1),P1=uid(3,1),PUB=uid(4,1),R1=uid(7,1),R2=uid(7,2),ASSET=uid(9,1),OTHER=uid(4,9);
const signed=path=>`https://project.supabase.co/storage/v1/object/sign/publication-images/${path}?token=short-lived`;
const storagePath=`${C1}/${PUB}/${ASSET}`;
const query=load('lib/publications/board-query.ts'),detailModule=load('lib/publications/publication-detail.ts');
const q=(search={})=>query.parseBoardQuery(search);

// Workspace double in the exact shape returned by getWorkspace.
function workspace({status='pending_review',revision=R2,platforms=['facebook','instagram'],media='ok',reviews=[],events=[],withTitle=true}={}){
 const publication={id:PUB,client_id:C1,project_id:P1,status,current_revision_id:revision,subject:'Entretien de toiture',target_date:'2026-10-14',editorial_week:'2026-10-12',creation_origin:'system',updated_at:'2026-10-07T10:00:00Z'};
 const revisions=revision?[{id:R2,publication_id:PUB,revision_number:2,origin:'regenerated',created_at:'2026-10-07T09:00:00Z',angle:'Angle',source_content:'Source',model:'gpt-4.1-mini-2025-04-14',estimated_cost:0.003},
  {id:R1,publication_id:PUB,revision_number:1,origin:'generated',created_at:'2026-10-06T09:00:00Z',angle:'Angle',source_content:'Source',model:'gpt-4.1-mini-2025-04-14',estimated_cost:0.002}]:[];
 const variants=revision?[...platforms.map(p=>({id:`v-${p}`,revision_id:R2,publication_id:PUB,platform:p,text_content:`Texte ${p}.`,metadata:withTitle&&p==='facebook'?{title:'Entretien de toiture',cta:'Contactez-nous.'}:{}})),
  {id:'v-old',revision_id:R1,publication_id:PUB,platform:'facebook',text_content:'Ancien texte.',metadata:{}}]:[];
 const links=media==='missing'?[]:platforms.map(p=>({variant_id:`v-${p}`,asset_id:ASSET,client_id:C1,sort_order:0}));
 const assets=media==='missing'?[]:[{id:ASSET,client_id:C1,storage_path:storagePath,preview:media==='ok'?signed(storagePath):null}];
 return {publication,revisions,variants,reviews,events,links,assets};}
const build=(w,{slot=null,deliveries=[],debug=null}={})=>detailModule.buildPublicationDetail({publication:w.publication,clientName:'Jrenov',projectName:'Réseaux Jrenov',workspace:w,slot,deliveries,debug});
const combos={fb:['facebook'],ig:['instagram'],gbp:['google_business_profile'],fb_ig:['facebook','instagram'],fb_gbp:['facebook','google_business_profile'],ig_gbp:['instagram','google_business_profile'],all:['facebook','instagram','google_business_profile']};
const labels={facebook:'Facebook',instagram:'Instagram',google_business_profile:'Google Business Profile'};

const router={replaced:[],pushed:[],replace(h){this.replaced.push(h);},push(h){this.pushed.push(h);}};
const drawerActions={saveFromDrawerAction:async()=>({}),stageMediaAction:async()=>({}),approveFromDrawerAction:async()=>({}),rejectFromDrawerAction:async()=>({}),archiveFromDrawerAction:async()=>({})};
const drawerUi=()=>load('components/publications/publication-drawer.tsx',{'next/navigation':{useRouter:()=>router},'@/app/(cockpit)/publications/drawer-actions':drawerActions,
 '@/app/(cockpit)/publications/board-actions':{hideFromBoardAction:async()=>{},restoreToBoardAction:async()=>{}},'@/app/(cockpit)/publications/agent-actions':{prepareAgentAction:async()=>({}),configureAgentAction:async()=>({})}});
const renderDrawer=(load,closeHref='/publications?client='+C1)=>renderToStaticMarkup(jsx.jsx(drawerUi().PublicationDrawer,{load,closeHref}));
const ok=detail=>({state:'ok',detail});

test('URL: opening adds only publication=<id>, closing removes only it, every filter is kept exactly',()=>{
 const search={q:'toiture',client:C1,project:P1,status:'draft',platform:'instagram',origin:'agent',media:'with',from:'2026-10-01',to:'2026-10-31',sort:'updated',published:'1',hidden:'1',page:'2',debug:'1'};
 const base=q(search),open=query.drawerHref(base,PUB),params=Object.fromEntries(new URL('http://x'+open).searchParams);
 assert.deepEqual(params,{...search,publication:PUB});
 const closed=Object.fromEntries(new URL('http://x'+query.closeDrawerHref(q({...search,publication:PUB}))).searchParams);assert.deepEqual(closed,search,'closing keeps q/client/project/status/platform/... and the page');
 assert.equal(query.closeDrawerHref(q({publication:PUB})),'/publications');
 assert.equal(q({publication:PUB.toUpperCase()}).publication,PUB,'uuid normalized');
 for(const bad of ['abc','javascript:alert(1)',`${PUB}x`,'',' ',['a','b']])assert.equal(q({publication:bad}).publication,'',String(bad));
 assert.equal(query.applyFilterChange(q({publication:PUB,client:C1}),'status','draft').includes('publication='),false,'a filter change closes the drawer');
 assert.equal(query.boardHref(q({publication:PUB}),{status:'ready'}).includes('publication='),false,'quick views and pagination never carry the drawer');});

test('navigation: rows push the drawer URL, X and Escape replace it with the closed URL, back closes it',()=>{
 const board=src('components/publications/publications-board.tsx');assert.match(board,/<Link href=\{drawerHref\(query,row\.id\)\} scroll=\{false\}/);assert.doesNotMatch(board,/replace/,'opening is a push: the browser Back button returns to the closed view');
 const drawer=src('components/publications/publication-drawer.tsx');
 assert.match(drawer,/const close=\(\)=>router\.replace\(closeHref,\{scroll:false\}\);/);assert.match(drawer,/onCancel=\{e=>\{e\.preventDefault\(\);close\(\);\}\}/,'Escape (dialog cancel) closes through the URL');
 assert.match(drawer,/<button type="button" onClick=\{close\} aria-label="Fermer le panneau"/);assert.match(drawer,/showModal\(\)/);});

function pageSetup(){const calls=[];let props=null;
 const page=load('app/(cockpit)/publications/page.tsx',{'next/link':{__esModule:true,default:({href,children})=>jsx.jsx('a',{href,children})},'@/lib/require-admin':{requireAdmin:async()=>{calls.push('admin');return {userId:'user_admin'};}},
  '@/lib/publications/data':{getPublicationSettingsState:async()=>null},'@/lib/publications/board':{listPublicationBoardRows:async()=>({rows:[],total:0,page:1,pageCount:1,counts:{all:0,to_prepare:0,draft:0,ready:0,rejected:0,published:0}})},
  '@/lib/publications/drawer':{loadPublicationDetail:async(id,options)=>{calls.push(['detail',id,options.debug]);return {state:'not_found'};}},'@/lib/clients/data':{listClients:async()=>[]},'@/lib/projects/data':{listProjects:async()=>[]},
  '@/components/ui/primitives':{PageHeading:()=>null},'@/components/publications/settings-panel':{PublicationSettingsPanel:()=>null},'@/components/publications/publications-board':{PublicationsBoard:()=>null,PublicationsNav:()=>null},
  '@/lib/publications/project-channels':{publicationProjectOptions:async()=>[]},
  '@/lib/simulation/server':{getActiveScenario:async()=>null},'@/components/simulation/views/sim-publications':{SimPublications:()=>null},
  '@/components/publications/publication-drawer':{PublicationDrawer:p=>{props=p;return jsx.jsx('div',{'data-drawer-open':p.closeHref});}}});
 return {page,calls,props:()=>props};}
test('a shared URL opens the drawer directly; no param or an invalid uuid never opens it',async()=>{
 const shared=pageSetup();const html=renderToStaticMarkup(await shared.page.default({searchParams:Promise.resolve({client:C1,status:'draft',publication:PUB})}));
 assert.deepEqual(json(shared.calls),['admin',['detail',PUB,false]]);assert.equal(shared.props().closeHref,`/publications?client=${C1}&status=draft`);assert.match(html,/data-drawer-open/);
 const none=pageSetup();const closed=renderToStaticMarkup(await none.page.default({searchParams:Promise.resolve({client:C1})}));assert.equal(none.calls.some(c=>c[0]==='detail'),false);assert.doesNotMatch(closed,/data-drawer-open|data-invalid-publication-link/);
 const invalid=pageSetup();const bad=renderToStaticMarkup(await invalid.page.default({searchParams:Promise.resolve({publication:'not-a-uuid'})}));
 assert.equal(invalid.calls.some(c=>c[0]==='detail'),false,'the loader is never called with an invalid id');assert.match(bad,/data-invalid-publication-link="true"/);assert.match(visible(bad),/Lien de publication invalide/);assert.doesNotMatch(bad,/data-drawer-open/);
 const debug=pageSetup();await debug.page.default({searchParams:Promise.resolve({publication:PUB,debug:'1'})});assert.deepEqual(json(debug.calls[1]),['detail',PUB,true]);});

test('detail model: neutral statuses, media states, read-only rule and calendar-driven date',()=>{
 const draft=build(workspace());assert.equal(draft.status,'draft');assert.equal(draft.readOnly,false);assert.equal(draft.dateEditable,true);assert.equal(draft.media.state,'ok');assert.deepEqual(json(draft.missingMedia),[]);
 assert.deepEqual(json(draft.variants.map(v=>[v.platform,v.title,v.cta,v.assetIds,v.media.state])),[['facebook','Entretien de toiture','Contactez-nous.',[ASSET],'ok'],['instagram',null,null,[ASSET],'ok']]);
 assert.ok(!draft.variants.some(v=>v.text==='Ancien texte.'),'only the current revision');
 assert.equal(build(workspace({media:'unavailable'})).media.state,'unavailable');assert.deepEqual(json(build(workspace({media:'unavailable'})).missingMedia),[],'an unavailable preview is not a missing media');
 assert.equal(build(workspace({media:'missing'})).media.state,'missing');assert.deepEqual(json(build(workspace({media:'missing'})).missingMedia),['facebook','instagram']);
 const slotBound=build(workspace(),{slot:{platforms:['facebook','instagram']}});assert.equal(slotBound.dateEditable,false);
 const toPrepare=build(workspace({status:'draft',revision:null}),{slot:{platforms:['google_business_profile']}});
 assert.equal(toPrepare.status,'to_prepare');assert.equal(toPrepare.revisionId,null);assert.deepEqual(json(toPrepare.variants),[]);assert.deepEqual(json(toPrepare.platforms),['google_business_profile']);assert.equal(toPrepare.origin,'planning');
 const rejected=build(workspace({status:'rejected',reviews:[{revision_id:R2,decision:'rejected',reason:'Ton trop vague pour ce client.',variant_id:null}]}));
 assert.equal(rejected.status,'rejected');assert.equal(rejected.rejection,'Ton trop vague pour ce client.');assert.equal(rejected.versions[0].decision,'Rejetée');
 const ready=build(workspace({status:'approved'}));assert.equal(ready.status,'ready');assert.equal(ready.readOnly,false,'À publier stays editable without any sent delivery');
 const one=status=>[{variant_id:'v-facebook',platform:'facebook',status}];
 assert.equal(build(workspace({status:'approved'}),{deliveries:[]}).readOnly,false,'no delivery → editable');
 const cancelled=build(workspace({status:'approved'}),{deliveries:[{variant_id:'v-facebook',platform:'facebook',status:'cancelled'},{variant_id:'v-old',platform:'facebook',status:'cancelled'}]});assert.equal(cancelled.readOnly,false,'cancelled only → editable');assert.equal(cancelled.readOnlyReason,null);
 for(const [status,message] of [['scheduled','Cette publication possède déjà un envoi planifié : lecture seule.'],['processing','Un envoi est en cours ou incertain : lecture seule par sécurité.'],['published','Publication déjà publiée : lecture seule.'],
  ['retryable_error','Une tentative de publication est en attente de reprise : lecture seule.'],['uncertain','Un envoi est en cours ou incertain : lecture seule par sécurité.'],['blocked','Une diffusion existe déjà pour cette publication : lecture seule.'],['something_new','Une diffusion existe déjà pour cette publication : lecture seule.']]){
  const d=build(workspace({status:'approved'}),{deliveries:one(status)});assert.equal(d.readOnly,true,status);assert.equal(d.dateEditable,false,status);assert.equal(d.readOnlyReason,message,status);assert.ok(!d.readOnlyReason.includes(status),'no raw SQL status');}
 assert.equal(build(workspace(),{deliveries:[{variant_id:'v-old',platform:'facebook',status:'scheduled'}]}).readOnly,true,'a delivery of an older variant also locks: it could still send the old version');
 assert.equal(build(workspace(),{deliveries:[{variant_id:'v-facebook',platform:'facebook',status:'cancelled'},{variant_id:'v-instagram',platform:'instagram',status:'blocked'}]}).readOnly,true,'one non-cancelled delivery is enough');
 assert.deepEqual(json([...detailModule.EDITABLE_DELIVERY_STATES]),['cancelled']);
 const published=build(workspace({status:'approved'}),{deliveries:[{variant_id:'v-facebook',platform:'facebook',status:'published'},{variant_id:'v-instagram',platform:'instagram',status:'published'}]});
 assert.equal(published.status,'published');assert.equal(published.readOnly,true);assert.match(published.readOnlyReason,/déjà publiée/);
 const hidden=build(workspace({events:[{resource_id:PUB,action:'publication.board_hidden',created_at:'2026-10-07T10:00:00Z'}]}));assert.equal(hidden.hidden,true);});

test('detail model and drawer handle every platform combination without assuming Facebook and Instagram together',()=>{
 for(const [name,platforms] of Object.entries(combos)){const d=build(workspace({platforms}));assert.deepEqual(json(d.platforms),platforms,name);
  const html=renderDrawer(ok(d)),panels=[...html.matchAll(/role="tabpanel" data-platform="([a-z_]+)"/g)].map(m=>m[1]);
  assert.deepEqual(panels.slice(0,platforms.length),platforms,name);for(const p of Object.keys(labels))assert.equal(html.includes(`name="${p}_text"`),platforms.includes(p),`${name}: ${p}`);}});

test('to prepare: a dedicated panel with the agent preparation, no fictitious editorial form and no decision',()=>{
 const html=renderDrawer(ok(build(workspace({status:'draft',revision:null}),{slot:{platforms:['facebook','instagram']}}))),text=visible(html);
 assert.match(html,/data-drawer="to_prepare"/);assert.match(html,/data-to-prepare="true"/);for(const s of ['Créneau à préparer','Préparer avec l’agent','Jrenov','Réseaux Jrenov','Facebook · Instagram','14 oct. 2026'])assert.ok(text.includes(s),s);
 assert.match(html,/name="authorize_ai"/);for(const s of ['data-drawer-editor','name="title"','<textarea','data-decision','Enregistrer','À publier','Rejeter','Régénérer'])assert.ok(!html.includes(s),s);});

test('draft: editable texts, subject, date and media; Enregistrer; À publier and Rejeter on the saved revision',()=>{
 const html=renderDrawer(ok(build(workspace()))),text=visible(html);
 assert.match(html,/data-drawer="draft"/);assert.match(html,/data-drawer-editor="true"/);
 for(const [name,value] of [['publication_id',PUB],['revision_id',R2],['project_id',P1],['client_id',C1],['angle','Angle'],['source','Source'],['facebook_enabled','on'],['instagram_enabled','on'],['facebook_assets',ASSET],['instagram_assets',ASSET]])
  assert.ok(html.includes(`name="${name}" value="${value}"`),name);
 assert.match(html,/<input[^>]*name="title"[^>]*value="Entretien de toiture"/);assert.match(html,/<input[^>]*type="date"[^>]*name="target_date"[^>]*value="2026-10-14"/);
 assert.match(html,/<textarea[^>]*name="facebook_text"[^>]*>Texte facebook\.<\/textarea>/);assert.match(html,/name="facebook_title"/);assert.match(html,/name="facebook_cta"/);assert.ok(!html.includes('name="instagram_title"'),'no empty title field invented');
 assert.match(html,/<button disabled=""[^>]*>Enregistrer<\/button>/,'nothing to save before an edit');assert.match(html,/<button[^>]*>À publier<\/button>/);assert.doesNotMatch(html,/<button disabled=""[^>]*>À publier/);
 for(const s of ['Rejeter…','Motif du rejet','Historique des versions (2)','Version 2 · Régénération IA','Version 1 · IA','actuelle','Retirer du tableau…'])assert.ok(text.includes(s),s);
 assert.match(html,/<textarea[^>]*name="reason"[^>]*required=""[^>]*minLength="10"[^>]*maxLength="3000"|<textarea[^>]*minLength="10"/);assert.ok(!html.includes('data-regenerate'));
 const locked=renderDrawer(ok(build(workspace(),{slot:{platforms:['facebook','instagram']}})));assert.match(locked,/data-date-locked="true"/);assert.ok(visible(locked).includes('Cette date est pilotée par le calendrier.'));assert.doesNotMatch(locked,/type="date"/);assert.ok(locked.includes('name="target_date" value="2026-10-14"'),'the unchanged date is resubmitted');});

test('À publier is blocked without media; an unavailable preview is shown as such and does not block',()=>{
 const missing=renderDrawer(ok(build(workspace({media:'missing'}))));assert.match(missing,/<button disabled=""[^>]*>À publier<\/button>/);assert.match(missing,/data-approve-blocked="true"[^>]*>Média requis : ajoutez une photo avant de valider\./);
 assert.match(missing,/data-media="missing"/);assert.ok(!missing.includes('name="facebook_assets"'));
 const unavailable=renderDrawer(ok(build(workspace({media:'unavailable'}))));assert.match(unavailable,/data-media="unavailable"/);assert.ok(visible(unavailable).includes('Média indisponible'));assert.doesNotMatch(unavailable,/data-approve-blocked/);
 assert.match(src('components/publications/publication-drawer.tsx'),/dirty\?'Enregistrez vos modifications avant de valider\.'/,'unsaved changes disable À publier');});

test('rejected: reason visible, editable, regeneration with explicit AI authorization, no direct decision',()=>{
 const html=renderDrawer(ok(build(workspace({status:'rejected',reviews:[{revision_id:R2,decision:'rejected',reason:'Ton trop vague pour ce client.',variant_id:null}]})))),text=visible(html);
 for(const s of ['Rejeté','Motif du rejet :','Ton trop vague pour ce client.','Régénérer','J’autorise un appel IA réel pour régénérer cette publication'])assert.ok(text.includes(s),s);
 assert.match(html,/data-drawer-editor="true"/);assert.match(html,/data-regenerate="true"/);const consent=html.match(/<input type="checkbox"[^>]*name="authorize_ai"[^>]*>/)[0];assert.match(consent,/required=""/);
 assert.ok(!html.includes('data-decision'),'no À publier / Rejeter on a rejected version');
 for(const status of ['pending_review','approved'])assert.ok(!renderDrawer(ok(build(workspace({status})))).includes('data-regenerate'),status);});

test('À publier (approved): approved version shown, editing creates a new version to revalidate, no decision buttons',()=>{
 const html=renderDrawer(ok(build(workspace({status:'approved'})))),text=visible(html);
 assert.match(html,/data-drawer="ready"/);assert.ok(text.includes('Version approuvée. Toute modification crée une nouvelle version'));assert.match(html,/data-drawer-editor="true"/);assert.ok(!html.includes('data-decision'));});

test('published or any non-cancelled delivery: read-only, history and board removal kept, no edit, media or decision',()=>{
 const published=build(workspace({status:'approved'}),{deliveries:[{variant_id:'v-facebook',platform:'facebook',status:'published'},{variant_id:'v-instagram',platform:'instagram',status:'published'}]});
 for(const d of [published,...['processing','uncertain','scheduled','retryable_error','blocked','something_new'].map(status=>build(workspace(),{deliveries:[{variant_id:'v-instagram',platform:'instagram',status}]}))]){
  const html=renderDrawer(ok(d)),text=visible(html);assert.match(html,/data-read-only="true"/);
  for(const s of ['data-drawer-editor','data-stage-media','data-decision','data-regenerate','<textarea','type="file"','name="authorize_ai"'])assert.ok(!html.includes(s),s);
  for(const s of ['Historique des versions','Retirer du tableau…','Texte facebook.'])assert.ok(text.includes(s),s);}
 assert.ok(visible(renderDrawer(ok(published))).includes('Publication déjà publiée : lecture seule.'));});

test('board removal reuses the shared confirmed form; a removed publication offers Remettre dans le tableau',()=>{
 const html=renderDrawer(ok(build(workspace())));assert.match(html,/data-remove-from-board="true"/);const form=html.match(/<details data-remove-from-board="true">[\s\S]*?<\/details>/)[0];assert.match(form,/name="confirm"/);
 const hidden=renderDrawer(ok(build(workspace({events:[{resource_id:PUB,action:'publication.board_hidden',created_at:'2026-10-07T10:00:00Z'}]}))));
 assert.ok(visible(hidden).includes('Remettre dans le tableau'));assert.ok(visible(hidden).includes('Retirée du tableau'));
 for(const f of ['components/publications/publication-drawer.tsx','components/publications/publications-board.tsx'])assert.match(src(f),/BoardVisibilityForm/,f);
 assert.doesNotMatch(src('components/publications/publication-drawer.tsx'),/hideFromBoardAction|restoreToBoardAction|publication_events/,'no duplicated removal logic');});

test('normal view exposes no technical data; debug=1 only through the loader',()=>{
 const html=renderDrawer(ok(build(workspace()))),text=visible(html);assert.equal(uuidPattern.test(text),false);
 // A Supabase signed URL embeds the object key (/object/sign/<bucket>/<key>?token=…); outside those URLs the key never appears.
 const outsideSigned=html.replace(/https:\/\/project\.supabase\.co\/storage\/v1\/object\/sign\/[^"]+/g,'');assert.ok(!outsideSigned.includes(storagePath),'no storage path outside the signed preview URL');
 for(const s of ['storage_path','gpt-4.1','token','0.003','run_id','pending_review','data-debug'])assert.ok(!html.includes(s)||s==='token'&&!text.includes(s),s);
 const debug=renderDrawer(ok(build(workspace(),{debug:{publication_id:PUB,run_id:'run-1'}})));assert.match(debug,/data-debug="true"/);assert.ok(debug.includes('run-1'));});

test('accessible dialog: labelled title, close button, error states for missing or unavailable publications',()=>{
 const html=renderDrawer(ok(build(workspace())));assert.match(html,/<dialog[^>]*aria-labelledby="publication-drawer-title"/);assert.match(html,/<h2 id="publication-drawer-title"[^>]*>Entretien de toiture<\/h2>/);
 assert.match(html,/aria-label="Fermer le panneau"/);for(const label of ['Sujet','Date de publication','Texte Facebook','Provenance'])assert.ok(visible(html).includes(label),label);assert.match(html,/role="tablist" aria-label="Plateformes"/);
 assert.match(visible(renderDrawer({state:'not_found'})),/Publication introuvable/);assert.match(visible(renderDrawer({state:'unavailable'})),/Publication indisponible pour le moment/);});

test('staged image: rendered from the signed preview with the unsaved label, never with a storage path',()=>{
 const {MediaBox}=load('components/publications/publication-drawer.tsx',{'next/navigation':{useRouter:()=>router},'@/app/(cockpit)/publications/drawer-actions':drawerActions,'@/app/(cockpit)/publications/board-actions':{},'@/app/(cockpit)/publications/agent-actions':{}});
 const html=renderToStaticMarkup(jsx.jsx(MediaBox,{state:'ok',preview:signed('x'),label:'Nouvelle image — modifications non enregistrées'}));
 assert.ok(html.includes(`src="${signed('x')}"`));assert.ok(visible(html).includes('Nouvelle image — modifications non enregistrées'));
 const drawer=src('components/publications/publication-drawer.tsx');assert.match(drawer,/<MediaBox state="ok" preview=\{media\.staged\.previewUrl\} label="Nouvelle image — modifications non enregistrées"\/>/);
 assert.match(drawer,/media\.mode==='staged'\?\[media\.staged\.assetId\]:media\.mode==='detached'\?\[\]:v\.assetIds/,'staged → the new asset; detached → none; otherwise unchanged');
 assert.match(drawer,/accept="image\/jpeg,image\/png,image\/webp"/);assert.doesNotMatch(drawer,/vidéo|video\//i);});

// Fake Supabase for the real workflow functions; every write is recorded.
function fakeDb(tables,{rpcError=null,registerError=false}={}){const reads=[],writes=[];
 const db={from(table){const filters=[];const run=()=>json((tables[table]??[]).filter(r=>filters.every(f=>f(r))));let inArg=null;
  const b={select:()=>b,order:()=>b,eq(k,v){filters.push(r=>r[k]===v);return b;},like(k,pattern){const prefix=pattern.replace(/%$/,'');filters.push(r=>String(r[k]).startsWith(prefix));return b;},in(k,vs){inArg=[k,vs.length];filters.push(r=>vs.includes(r[k]));return b;},
   range(a,z){reads.push({table,inArg});return Promise.resolve({data:run().slice(a,z+1),error:null});},then(f,r){reads.push({table,inArg});return Promise.resolve({data:run(),error:null}).then(f,r);},
   maybeSingle(){reads.push({table,inArg});return Promise.resolve({data:run()[0]??null,error:null});},single(){reads.push({table});return Promise.resolve({data:run()[0]??null,error:null});},
   insert(){writes.push(['insert',table]);return Promise.resolve({error:null});},update(){writes.push(['update',table]);return b;},delete(){writes.push(['delete',table]);return b;}};return b;},
  rpc:async(name,args)=>{writes.push(['rpc',name,json(args)]);if(name==='publication_register_image'&&registerError)return {error:{message:'x'}};return rpcError&&name==='publication_save_draft'?{data:null,error:rpcError}:{data:PUB,error:null};},
  storage:{from:bucket=>({upload:async(path)=>{writes.push(['upload',bucket,path]);return {error:null};},remove:async(paths)=>{writes.push(['remove',bucket,paths]);return {error:null};},
   createSignedUrl:async(path,ttl)=>({data:{signedUrl:signed(path)+`&ttl=${ttl}`},error:null}),getPublicUrl:()=>{throw Error('public URL requested');}})}};
 return {db,reads,writes};}
const realWorkspace=(fake,deny=false)=>load('lib/publications/workspace.ts',{'@/lib/supabase/server':{getSupabaseServerClient:()=>fake.db},'@/lib/require-admin':{requireAdmin:async()=>{if(deny)throw Error('denied');return {userId:'user_admin'};}},'node:crypto':{randomUUID:()=>ASSET,createHash:()=>({update:()=>({digest:()=>'a'.repeat(64)})})}});
const draftForm=(extra={})=>{const f=new FormData();for(const [k,v] of Object.entries({publication_id:PUB,revision_id:R2,client_id:C1,project_id:P1,title:'Entretien de toiture',angle:'Angle',source:'Source',target_date:'2026-10-14',facebook_enabled:'on',facebook_text:'Texte modifié.',...extra}))f.set(k,v);return f;};

test('Enregistrer: one saveDraft RPC with the expected revision creates a new manual revision; nothing is updated in place',async()=>{
 const fake=fakeDb({projects:[{id:P1,client_id:C1,type:'Réseaux sociaux'}]});const w=realWorkspace(fake);
 const f=draftForm();f.append('facebook_assets',ASSET);const result=await w.saveDraft(f);assert.equal(result.id,PUB);
 assert.equal(fake.writes.length,1);const [kind,name,args]=fake.writes[0];assert.equal(kind,'rpc');assert.equal(name,'publication_save_draft');
 assert.equal(args.p_expected_revision_id,R2,'stale protection');assert.equal(args.p_publication_id,PUB);assert.equal(args.p_target_date,'2026-10-14');
 assert.deepEqual(args.p_variants,[{platform:'facebook',text_content:'Texte modifié.',asset_ids:[ASSET],metadata:{}}]);
 assert.ok(!fake.writes.some(w=>w[0]==='update'||w[0]==='delete'),'no in-place update of any revision');
 const detached=fakeDb({projects:[{id:P1,client_id:C1,type:'Réseaux sociaux'}]});await realWorkspace(detached).saveDraft(draftForm());assert.deepEqual(detached.writes[0][2].p_variants[0].asset_ids,[],'a detached image gives a revision without media');
 for(const [error,message] of [[{code:'55000',message:'Explicit rescheduling required'},'Cette date est pilotée par le calendrier.'],[{code:'55000',message:'Resolve deliveries first'},'Un envoi est en cours ou terminé : modification impossible.'],[{code:'40001',message:'Stale draft'},'La publication a changé. Rechargez avant de modifier.']]){
  const failing=fakeDb({projects:[{id:P1,client_id:C1,type:'Réseaux sociaux'}]},{rpcError:error});const r=await realWorkspace(failing).saveDraft(draftForm());assert.equal(r.id,undefined);assert.equal(r.message,message);assert.ok(!r.message.includes(error.message));}});

test('upload: private bucket, byte check, rights, returns assetId + short-lived preview + mime and never the storage path',async()=>{
 const png=new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0,0,0,0,0]);
 const form=(extra={})=>{const f=new FormData();f.set('publication_id',PUB);f.set('revision_id',R2);f.set('image',new File([png],'photo.png',{type:'image/png'}));f.set('provenance','Photo du client');f.set('rights','on');for(const [k,v] of Object.entries(extra))f.set(k,v);return f;};
 const fake=fakeDb({publications:[{id:PUB,client_id:C1,current_revision_id:R2}]});const result=await realWorkspace(fake).uploadImage(form());
 assert.deepEqual(json(result.staged),{assetId:ASSET,previewUrl:signed(storagePath)+'&ttl=120',mime:'image/png'});
 assert.deepEqual(fake.writes.map(w=>w.slice(0,2)),[['upload','publication-images'],['rpc','publication_register_image']]);assert.equal(fake.writes[1][2].p_path,storagePath);
 assert.ok(!JSON.stringify(Object.keys(result.staged)).includes('path'));
 const noRights=fakeDb({publications:[{id:PUB,client_id:C1,current_revision_id:R2}]});assert.equal((await realWorkspace(noRights).uploadImage(form({rights:''}))).staged,undefined);assert.equal(noRights.writes.length,0);
 const fakeImage=fakeDb({publications:[{id:PUB,client_id:C1,current_revision_id:R2}]});const f=form();f.set('image',new File([new Uint8Array([0,0,0,0x18,0x66,0x74,0x79,0x70,0,0,0,0,0,0,0,0])],'clip.mp4',{type:'image/png'}));
 assert.equal((await realWorkspace(fakeImage).uploadImage(f)).staged,undefined,'MP4 bytes are refused');assert.equal(fakeImage.writes.length,0);
 const failed=fakeDb({publications:[{id:PUB,client_id:C1,current_revision_id:R2}]},{registerError:true});assert.equal((await realWorkspace(failed).uploadImage(form())).staged,undefined);assert.deepEqual(json(failed.writes.at(-1)),['remove','publication-images',[storagePath]],'cleanup when registration fails');});

test('getWorkspace reads only the media links of this publication’s variants, with unchanged results',async()=>{
 const w=workspace();const tables={publications:[w.publication],publication_revisions:w.revisions,publication_variants:w.variants,publication_reviews:[],publication_events:[],
  publication_variant_assets:[...w.links,{variant_id:'foreign-variant',asset_id:'foreign',client_id:C1,sort_order:0}],publication_assets:[{id:ASSET,client_id:C1,storage_path:storagePath},{id:'foreign',client_id:C1,storage_path:`${C1}/${OTHER}/foreign`}]};
 const fake=fakeDb(tables);const result=await realWorkspace(fake).getWorkspace(PUB);
 assert.deepEqual(json(result.links.map(l=>l.variant_id)).sort(),['v-facebook','v-instagram']);assert.deepEqual(json(result.assets.map(a=>a.id)),[ASSET]);
 const linkReads=fake.reads.filter(r=>r.table==='publication_variant_assets');assert.equal(linkReads.length,1);assert.deepEqual(json(linkReads[0].inArg),['variant_id',3],'scoped to the 3 variants of this publication');
 assert.match(src('lib/publications/workspace.ts'),/\.in\("variant_id",batch\)/);});

function actionSetup({current={revision_id:R2,status:'pending_review'},submit='Révision soumise à validation.',decision='Révision approuvée.',deny=false,lock=null,save={id:PUB},upload={message:'ok',staged:{assetId:ASSET,previewUrl:'https://signed',mime:'image/png'}}}={}){const calls=[];
 const m=load('app/(cockpit)/publications/drawer-actions.ts',{'next/cache':{revalidatePath:p=>calls.push(['revalidate',p])},'@/lib/require-admin':{requireAdmin:async()=>{calls.push(['admin']);if(deny)throw Error('denied');return {userId:'user_admin'};}},
  '@/lib/publications/drawer':{deliveryLock:async id=>{calls.push(['lock',id]);return lock;}},
  '@/lib/publications/workspace':{saveDraft:async f=>{calls.push(['saveDraft',Object.fromEntries(f)]);return save;},uploadImage:async()=>{calls.push(['uploadImage']);return upload;},currentRevision:async id=>{calls.push(['currentRevision',id]);return current;},
   submitOrReview:async f=>{const d=Object.fromEntries(f);calls.push(['submitOrReview',d]);return {message:d.decision==='submit'?submit:decision};}}});
 return {m,calls};}
const writes=calls=>calls.filter(c=>['saveDraft','uploadImage','submitOrReview'].includes(c[0])).map(c=>c[0]==='submitOrReview'?`${c[0]}:${c[1].decision}`:c[0]);
const decisionForm=(extra={})=>{const f=new FormData();for(const [k,v] of Object.entries({publication_id:PUB,revision_id:R2,project_id:P1,...extra}))f.set(k,v);return f;};

test('À publier: pending_review → decision only; draft → submit then decision; never a direct status update',async()=>{
 const pending=actionSetup();const r=await pending.m.approveFromDrawerAction({},decisionForm());assert.equal(r.ok,true);assert.match(r.message,/À publier/);assert.deepEqual(writes(pending.calls),['submitOrReview:approved']);
 assert.deepEqual(json(pending.calls.find(c=>c[0]==='submitOrReview')[1]),{publication_id:PUB,revision_id:R2,decision:'approved'});
 const draft=actionSetup({current:{revision_id:R2,status:'draft'}});assert.equal((await draft.m.approveFromDrawerAction({},decisionForm())).ok,true);assert.deepEqual(writes(draft.calls),['submitOrReview:submit','submitOrReview:approved']);
 const stale=actionSetup({current:{revision_id:R1,status:'pending_review'}});const s=await stale.m.approveFromDrawerAction({},decisionForm());assert.equal(s.ok,false);assert.match(s.message,/a changé/);assert.deepEqual(writes(stale.calls),[]);
 for(const status of ['approved','rejected']){const done=actionSetup({current:{revision_id:R2,status}});assert.equal((await done.m.approveFromDrawerAction({},decisionForm())).ok,false);assert.deepEqual(writes(done.calls),[]);}
 const missing=actionSetup({current:null});assert.match((await missing.m.approveFromDrawerAction({},decisionForm())).message,/introuvable/);
 const submitFails=actionSetup({current:{revision_id:R2,status:'draft'},submit:'Opération non confirmée. Rechargez.'});assert.equal((await submitFails.m.approveFromDrawerAction({},decisionForm())).ok,false);assert.deepEqual(writes(submitFails.calls),['submitOrReview:submit'],'no decision after a failed submit');
 const secondFails=actionSetup({current:{revision_id:R2,status:'draft'},decision:'Opération non confirmée. Rechargez.'});const second=await secondFails.m.approveFromDrawerAction({},decisionForm());
 assert.equal(second.ok,false);assert.match(second.message,/Validation non confirmée\. La version reste à valider : un nouveau clic relancera uniquement la décision\./);
 const media=actionSetup({decision:'Média requis avant validation : ajoutez une photo avant de passer à « À publier » (Instagram).'});const noMedia=await media.m.approveFromDrawerAction({},decisionForm());assert.equal(noMedia.ok,false);assert.match(noMedia.message,/^Média requis avant validation : ajoutez une photo/);
 assert.doesNotMatch(src('app/(cockpit)/publications/drawer-actions.ts'),/\.update\(|\.from\(|\.rpc\(/,'only the existing workflow functions');});

test('Rejeter: reason of 10 to 3000 characters; pending → rejection; draft → submit then rejection; never for other states',async()=>{
 for(const reason of [undefined,'','   ','court','  neuf car ','x'.repeat(3001)]){const r=actionSetup();const result=await r.m.rejectFromDrawerAction({},decisionForm(reason===undefined?{}:{reason}));assert.equal(result.ok,false);assert.deepEqual(writes(r.calls),[]);}
 const pending=actionSetup({decision:'Révision refusée.'});assert.equal((await pending.m.rejectFromDrawerAction({},decisionForm({reason:'  Le ton est trop vague.  '}))).ok,true);
 assert.deepEqual(json(pending.calls.find(c=>c[0]==='submitOrReview')[1]),{publication_id:PUB,revision_id:R2,decision:'rejected',reason:'Le ton est trop vague.'});
 const draft=actionSetup({current:{revision_id:R2,status:'draft'},decision:'Révision refusée.'});await draft.m.rejectFromDrawerAction({},decisionForm({reason:'Le ton est trop vague.'}));assert.deepEqual(writes(draft.calls),['submitOrReview:submit','submitOrReview:rejected']);
 const done=actionSetup({current:{revision_id:R2,status:'approved'}});assert.equal((await done.m.rejectFromDrawerAction({},decisionForm({reason:'Le ton est trop vague.'}))).ok,false);assert.deepEqual(writes(done.calls),[]);});

test('Enregistrer and image staging actions delegate to saveDraft and uploadImage and return safe data only',async()=>{
 const saved=actionSetup();const r=await saved.m.saveFromDrawerAction({},draftForm());assert.equal(r.ok,true);assert.deepEqual(writes(saved.calls),['saveDraft']);assert.ok(saved.calls.some(c=>c[0]==='revalidate'&&c[1]==='/publications'));
 const failed=actionSetup({save:{message:'La publication a changé. Rechargez avant de modifier.'}});assert.deepEqual(json(await failed.m.saveFromDrawerAction({},draftForm())),{ok:false,message:'La publication a changé. Rechargez avant de modifier.'});
 const staged=actionSetup();const s=await staged.m.stageMediaAction({},new FormData());assert.deepEqual(json(s),{ok:true,message:'Nouvelle image — modifications non enregistrées.',staged:{assetId:ASSET,previewUrl:'https://signed',mime:'image/png'}});
 const refused=actionSetup({upload:{message:'Opération non confirmée. Rechargez la fiche.'}});assert.deepEqual(json(await refused.m.stageMediaAction({},new FormData())),{ok:false,message:'Upload refusé : l’image n’a pas pu être enregistrée.'});});

test('every drawer action requires the admin guard before any workflow call',async()=>{
 for(const name of ['saveFromDrawerAction','stageMediaAction','approveFromDrawerAction','rejectFromDrawerAction','archiveFromDrawerAction']){const r=actionSetup({deny:true});await assert.rejects(()=>r.m[name]({},decisionForm({reason:'Motif suffisamment long'})),/denied/);assert.deepEqual(writes(r.calls),[]);assert.equal(r.calls.some(c=>c[0]==='currentRevision'||c[0]==='lock'),false);}
 const actions=src('app/(cockpit)/publications/drawer-actions.ts');assert.match(actions,/^"use server";/);assert.equal((actions.match(/export async function/g)??[]).length,5,'4 drawer actions + archive (P5)');assert.equal((actions.match(/await requireAdmin\(\)/g)??[]).length,5);});

test('read-only server guard: a locked publication can never get a new revision, media, submission or decision',async()=>{
 for(const name of ['saveFromDrawerAction','stageMediaAction','approveFromDrawerAction','rejectFromDrawerAction']){
  const r=actionSetup({lock:'Cette publication possède déjà un envoi planifié : lecture seule.',current:{revision_id:R2,status:'draft'}});const result=await r.m[name]({},decisionForm({reason:'Motif suffisamment long',...Object.fromEntries(draftForm())}));
  assert.deepEqual(json(result),{ok:false,message:'Cette publication possède déjà un envoi planifié : lecture seule.'},name);assert.deepEqual(writes(r.calls),[],name);assert.equal(r.calls.some(c=>c[0]==='currentRevision'||c[0]==='revalidate'),false,name);
  assert.deepEqual(json(r.calls.find(c=>c[0]==='lock')),['lock',PUB],`${name} checks this publication`);}
 const open=actionSetup();await open.m.saveFromDrawerAction({},draftForm());assert.deepEqual(json(open.calls.slice(0,2)),[['admin'],['lock',PUB]],'admin, then the delivery guard, then the workflow');
 const guard=(rows,{error=false,deny=false}={})=>{const reads=[];const db={from:table=>{const filters=[];const b={select:()=>b,eq(k,v){filters.push([k,v]);return b;},then(f,r){reads.push({table,filters:json(filters)});return Promise.resolve(error?{data:null,error:{message:'down'}}:{data:json(rows.filter(x=>filters.every(([k,v])=>x[k]===v))),error:null}).then(f,r);}};return b;}};
  return {reads,m:load('lib/publications/drawer.ts',{'@/lib/require-admin':{requireAdmin:async()=>{if(deny)throw Error('denied');}},'@/lib/supabase/server':{getSupabaseServerClient:()=>db},'./workspace':{getWorkspace:async()=>null},'./agent-data':{}})};};
 const rows=[{publication_id:OTHER,status:'scheduled'},{publication_id:PUB,status:'cancelled'}];
 const g=guard(rows);assert.equal(await g.m.deliveryLock(PUB),null,'only this publication deliveries count; cancelled only stays editable');assert.deepEqual(g.reads,[{table:'publication_deliveries',filters:[['publication_id',PUB]]}]);
 assert.equal(await guard(rows).m.deliveryLock(OTHER),'Cette publication possède déjà un envoi planifié : lecture seule.');
 assert.equal(await guard([]).m.deliveryLock(PUB),null,'no delivery → editable');
 assert.equal(await guard([],{error:true}).m.deliveryLock(PUB),'Vérification des envois impossible : lecture seule par sécurité.','a read failure locks');
 const invalid=guard(rows);assert.equal(await invalid.m.deliveryLock('nope'),null);assert.equal(invalid.reads.length,0);
 await assert.rejects(()=>guard(rows,{deny:true}).m.deliveryLock(PUB),/denied/);
 const actions=src('app/(cockpit)/publications/drawer-actions.ts');assert.equal((actions.match(/const lock=await locked\(form\);if\(lock\)return \{ok:false,message:lock\};/g)??[]).length,3,'save, staging and the shared decision path');});

test('loader: strict id, admin first, one publication only, targeted reads, debug data only on request, no secret in props',async()=>{
 const w=workspace();const calls=[];const tables={publications:[{id:PUB,client:{name:'Jrenov'},project:{name:'Réseaux Jrenov'}}],publication_calendar_slots:[{publication_id:PUB,platforms:['facebook','instagram']}],publication_deliveries:[]};
 const fake=fakeDb(tables);const loader=(deny=false)=>load('lib/publications/drawer.ts',{'@/lib/require-admin':{requireAdmin:async()=>{calls.push('admin');if(deny)throw Error('denied');}},'@/lib/supabase/server':{getSupabaseServerClient:()=>fake.db},
  './workspace':{getWorkspace:async id=>{calls.push(['workspace',id]);return json(w);}},'./project-channels':{publicationChannelLock:async id=>{calls.push(['channel-lock',id]);return null;}},'./agent-data':{getGenerationDetails:async()=>{calls.push('details');return {run_id:'run-1'};},getAiRunForRevision:async()=>{calls.push('run');return {model:'gpt-4.1-mini-2025-04-14',input_tokens:10};}}});
 assert.deepEqual(json(await loader().loadPublicationDetail('nope',{debug:false})),{state:'not_found'});assert.deepEqual(calls,['admin']);
 await assert.rejects(()=>loader(true).loadPublicationDetail(PUB,{debug:false}),/denied/);
 calls.length=0;const result=await loader().loadPublicationDetail(PUB,{debug:false});assert.equal(result.state,'ok');assert.deepEqual(json(calls),['admin',['workspace',PUB],['channel-lock',PUB]],'channel lock of this publication only');
 assert.equal(result.detail.dateEditable,false,'slot-bound publication');assert.equal(result.detail.debug,null);
 const props=JSON.stringify(result),unsigned=props.replace(/https:\/\/project\.supabase\.co\/storage\/v1\/object\/sign\/[^"]+/g,'');assert.ok(!unsigned.includes(storagePath),'the key only appears inside the short-lived signed URL');
 for(const s of ['storage_path','sb_','secret','credential_reference','refresh','gpt-4.1','estimated_cost'])assert.ok(!props.includes(s),s);
 calls.length=0;const debug=await loader().loadPublicationDetail(PUB,{debug:true});assert.ok(calls.includes('details')&&calls.includes('run'));assert.equal(debug.detail.debug.run_id,'run-1');assert.deepEqual(json(debug.detail.debug.storage_paths),[storagePath]);
 for(const t of ['publication_calendar_slots','publication_deliveries'])assert.equal(fake.reads.filter(r=>r.table===t).length,2,t+' once per successful load (invalid id and denied admin read nothing)');
 const drawer=src('components/publications/publication-drawer.tsx');assert.match(drawer,/^\/\*[^\n]*\*\/\n'use client';/);assert.doesNotMatch(drawer,/@\/lib\/supabase|getSupabaseServerClient|process\.env|server-only/);
 for(const line of drawer.split('\n').filter(l=>l.includes("from '@/lib/publications/drawer'")||l.includes("from '@/lib/publications/workspace'")))assert.match(line,/^import type /,line);});

test('review cards and the drawer share one variant/history/media builder; no migration added',()=>{
 const cards=src('lib/publications/review-cards.ts');assert.match(cards,/currentVariants\(w,revisionId\)/);assert.match(cards,/versionHistory\(w,revisionId\)/);assert.match(src('lib/publications/publication-detail.ts'),/export function currentVariants/);
 assert.equal(readdirSync(resolve(root,'supabase/migrations')).length,23,'9 + Lot 4.3 P1 … P5 + P7 … P13');});
