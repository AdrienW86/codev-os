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
  vm.runInNewContext(code,{exports,Intl,Date,URL,URLSearchParams,Map,Set,FormData,Uint8Array,console,setTimeout,clearTimeout,require:name=>{if(name in mocks)return mocks[name];if(name==='react/jsx-runtime')return jsx;if(name==='server-only')return {};
   if(name.startsWith('@/'))return read(find(resolve(root,name.slice(2))));if(name.startsWith('.'))return read(find(resolve(dirname(path),name)));return native(name);}});
  return exports;}
 return read(resolve(root,file));}
const json=value=>JSON.parse(JSON.stringify(value));
const src=file=>readFileSync(resolve(root,file),'utf8');
const uuidPattern=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,visible=html=>html.replace(/<[^>]+>/g,' ');
const uid=(prefix,n)=>`${prefix}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const C1=uid(1,1),C2=uid(1,2),P1=uid(3,1),P2=uid(3,2);
const P={prepare:uid(4,1),pending:uid(4,2),manual:uid(4,3),ready:uid(4,4),published:uid(4,5),partial:uid(4,6),rejected:uid(4,7)};
const R={pending:uid(7,2),manual:uid(7,3),ready:uid(7,4),published:uid(7,5),partial:uid(7,6),rejectedOld:uid(7,70),rejected:uid(7,7)};
const imagePath=`${C1}/${P.pending}/${uid(9,1)}`;
const clients={[C1]:{name:'Jrenov'},[C2]:{name:'CODE-V'}},projects={[P1]:{id:P1,name:'Réseaux Jrenov'},[P2]:{id:P2,name:'Fiche Google CODE-V'}};
const pub=(id,client,project,status,rev,subject,date,updated,origin='manual')=>({id,client_id:client,project_id:project,status,current_revision_id:rev,subject,target_date:date,editorial_week:'2026-10-05',creation_origin:origin,updated_at:updated,client:clients[client],project:projects[project]});
const empty=()=>({publications:[],publication_revisions:[],publication_variants:[],publication_variant_assets:[],publication_assets:[],publication_deliveries:[],publication_events:[]});
function fixtures(){return {...empty(),
 publications:[pub(P.prepare,C1,P1,'draft',null,'Contenu à préparer','2026-10-20','2026-10-01T10:00:00Z','system'),
  pub(P.pending,C1,P1,'pending_review',R.pending,'Entretien de toiture avant l’hiver','2026-10-14','2026-10-06T10:00:00Z','system'),
  pub(P.manual,C2,P2,'draft',R.manual,'Horaires de la fiche','2026-10-10','2026-10-05T10:00:00Z'),
  pub(P.ready,C1,P1,'approved',R.ready,'Chantier façade terminé','2026-10-12','2026-10-04T10:00:00Z'),
  pub(P.published,C1,P1,'approved',R.published,'Peinture intérieure','2026-10-01','2026-10-02T10:00:00Z'),
  pub(P.partial,C1,P1,'approved',R.partial,'Démoussage à Décines','2026-10-03','2026-10-03T10:00:00Z'),
  pub(P.rejected,C2,P2,'rejected',R.rejected,'Avis clients','2026-10-16','2026-10-07T10:00:00Z')],
 publication_revisions:[{id:R.pending,publication_id:P.pending,origin:'generated',revision_number:1},{id:R.manual,publication_id:P.manual,origin:'manual',revision_number:1},
  {id:R.ready,publication_id:P.ready,origin:'manual',revision_number:1},{id:R.published,publication_id:P.published,origin:'generated',revision_number:1},
  {id:R.partial,publication_id:P.partial,origin:'generated',revision_number:1},{id:R.rejectedOld,publication_id:P.rejected,origin:'generated',revision_number:1},{id:R.rejected,publication_id:P.rejected,origin:'manual',revision_number:2}],
 publication_variants:[{id:'v-pending-ig',revision_id:R.pending,platform:'instagram',text_content:'Version Instagram toiture.'},{id:'v-pending-fb',revision_id:R.pending,platform:'facebook',text_content:'Avant l’hiver, faites vérifier votre   toiture.\nNous intervenons à Décines.'},
  {id:'v-manual',revision_id:R.manual,platform:'google_business_profile',text_content:'Nouveaux horaires.'},{id:'v-ready',revision_id:R.ready,platform:'facebook',text_content:'Façade terminée.'},
  {id:'v-pub-fb',revision_id:R.published,platform:'facebook',text_content:'Peinture.'},{id:'v-pub-ig',revision_id:R.published,platform:'instagram',text_content:'Peinture IG.'},
  {id:'v-part-fb',revision_id:R.partial,platform:'facebook',text_content:'Démoussage.'},{id:'v-part-ig',revision_id:R.partial,platform:'instagram',text_content:'Démoussage IG.'},
  {id:'v-old',revision_id:R.rejectedOld,platform:'google_business_profile',text_content:'Ancien texte confidentiel.'},{id:'v-rej',revision_id:R.rejected,platform:'google_business_profile',text_content:'Merci pour vos avis.'}],
 publication_variant_assets:[{variant_id:'v-pending-fb',asset_id:'a1',sort_order:0},{variant_id:'v-pending-ig',asset_id:'a1',sort_order:0},{variant_id:'v-old',asset_id:'a-old',sort_order:0}],
 publication_assets:[{id:'a1',storage_path:imagePath},{id:'a-old',storage_path:'old/path'}],
 publication_deliveries:[{publication_id:P.published,variant_id:'v-pub-fb',platform:'facebook',status:'published'},{publication_id:P.published,variant_id:'v-pub-ig',platform:'instagram',status:'published'},
  {publication_id:P.partial,variant_id:'v-part-fb',platform:'facebook',status:'published'},{publication_id:P.partial,variant_id:'v-part-ig',platform:'instagram',status:'retryable_error'}]};}

// Minimal PostgREST double: every range()/await/maybeSingle() is one HTTP round trip. Writes are recorded.
function fakeDb(tables,{signFails=false}={}){const requests=[],signs=[],writes=[];
 const db={from(table){const filters=[];let inSize=null;const run=()=>json((tables[table]??[]).filter(r=>filters.every(f=>f(r))));
  const b={select:()=>b,order:()=>b,eq(k,v){filters.push(r=>r[k]===v);return b;},in(k,vs){inSize=Math.max(inSize??0,vs.length);filters.push(r=>vs.includes(r[k]));return b;},
   range(a,z){requests.push({table,inSize});return Promise.resolve({data:run().slice(a,z+1),error:null});},
   then(resolveFn,rejectFn){requests.push({table,inSize});return Promise.resolve({data:run(),error:null}).then(resolveFn,rejectFn);},
   maybeSingle(){requests.push({table,inSize});return Promise.resolve({data:run()[0]??null,error:null});},
   insert(row){writes.push(['insert',table,json(row)]);(tables[table]??=[]).push(json(row));return Promise.resolve({error:null});},
   update(){writes.push(['update',table]);return b;},delete(){writes.push(['delete',table]);return b;},upsert(){writes.push(['upsert',table]);return b;}};return b;},
  rpc:async(name,args)=>{writes.push(['rpc',name,json(args)]);return {data:null,error:null};},
  storage:{from:bucket=>({getPublicUrl:()=>{throw Error('public URL requested');},remove:async()=>{writes.push(['remove',bucket]);return {error:null};},
   createSignedUrls:async(paths,ttl)=>{signs.push({bucket,paths,ttl});return {data:paths.map(p=>signFails?{path:p,signedUrl:null,error:'Object not found'}:{path:p,signedUrl:`https://project.supabase.co/storage/v1/object/sign/${bucket}/${p}?token=short-lived`,error:null}),error:null};}})}};
 return {db,requests,signs,writes};}
function board(tables=fixtures(),{deny=false,signFails=false}={}){const fake=fakeDb(tables,{signFails}),calls=[];
 const m=load('lib/publications/board.ts',{'@/lib/supabase/server':{getSupabaseServerClient:()=>fake.db},'@/lib/require-admin':{requireAdmin:async()=>{calls.push('admin');if(deny)throw Error('denied');return {userId:'user_local'};}},'@/lib/supabase/read-error':{safeSupabaseReadError:()=>({})}});
 return {m,...fake,calls};}
const query=load('lib/publications/board-query.ts');
const q=(search={})=>query.parseBoardQuery(search);
async function rows(search={},tables,options){const b=board(tables,options);return {...b,result:await b.m.listPublicationBoardRows(q(search))};}
const ids=result=>json(result.rows.map(r=>r.id));
const router={pushed:[],replaced:[],push(href){this.pushed.push(href);},replace(href){this.replaced.push(href);}};
const boardActions={hideFromBoardAction:async()=>{},restoreToBoardAction:async()=>{}};
const component=()=>load('components/publications/publications-board.tsx',{'next/link':{__esModule:true,default:({href,children,...props})=>jsx.jsx('a',{href,...props,children})},'next/navigation':{useRouter:()=>router},'@/app/(cockpit)/publications/board-actions':boardActions});
const options={clients:[{id:C1,name:'Jrenov'},{id:C2,name:'CODE-V'}],projects:[{id:P1,name:'Réseaux Jrenov',client_id:C1},{id:P2,name:'Fiche Google CODE-V',client_id:C2}]};
async function html(search={},tables,opts){const {result}=await rows(search,tables,opts);const {PublicationsBoard}=component();return renderToStaticMarkup(jsx.jsx(PublicationsBoard,{result,query:q(search),...options}));}
const rowHtml=(out,id)=>out.match(new RegExp(`<tr data-board-row="${id}"[\\s\\S]*?</tr>`))[0];

// Every platform combination, each with its own media.
const combos={fb:['facebook'],ig:['instagram'],gbp:['google_business_profile'],fb_ig:['facebook','instagram'],fb_gbp:['facebook','google_business_profile'],ig_gbp:['instagram','google_business_profile'],all:['facebook','instagram','google_business_profile']};
function comboTables(){const t=empty();Object.entries(combos).forEach(([name,platforms],i)=>{const id=uid(5,i+1),rev=uid(6,i+1);
 t.publications.push(pub(id,C1,P1,'pending_review',rev,`Combinaison ${name}`,`2026-11-0${i+1}`,'2026-10-06T10:00:00Z'));t.publication_revisions.push({id:rev,publication_id:id,origin:'generated',revision_number:1});
 for(const p of platforms){t.publication_variants.push({id:`${name}-${p}`,revision_id:rev,platform:p,text_content:`Texte ${p} ${name}`});t.publication_variant_assets.push({variant_id:`${name}-${p}`,asset_id:`asset-${name}`,sort_order:0});}
 t.publication_assets.push({id:`asset-${name}`,storage_path:`${C1}/${id}/asset`});});return t;}
const comboId=name=>uid(5,Object.keys(combos).indexOf(name)+1);

test('query params: defaults, strict parsing of unknown values and canonical URLs',()=>{
 assert.deepEqual(json(q()),{q:'',client:'',project:'',status:'',platform:'',origin:'',media:'',from:'',to:'',sort:'date_asc',published:false,hidden:false,page:1,debug:false});
 const bad=q({client:'not-a-uuid',status:'approved',platform:'tiktok',origin:'system',media:'maybe',from:'2026-13-45',sort:'drop table',page:'-2',published:'yes',hidden:'true',q:['a','b']});
 assert.deepEqual(json(bad),json(q()));
 const parsed=q({q:' toiture ',client:C1,status:'ready',platform:'instagram',origin:'agent',media:'with',from:'2026-10-01',to:'2026-10-31',sort:'updated',published:'1',hidden:'1',page:'3',debug:'1'});
 assert.equal(parsed.q,'toiture');assert.equal(parsed.page,3);assert.equal(parsed.published,true);assert.equal(parsed.hidden,true);
 const href=query.boardHref(parsed);assert.equal(href.startsWith('/publications?'),true);assert.equal(href.includes('page='),false,'changing a filter returns to page 1');
 assert.deepEqual(json(q(Object.fromEntries(new URL('http://x'+href).searchParams))),{...json(parsed),page:1});
 assert.equal(query.boardHref(parsed,{page:2}).includes('page=2'),true);assert.equal(query.boardHref(q()),'/publications');});

test('UX statuses map the unchanged SQL statuses, published requiring every current channel delivery',async()=>{
 const s=query.boardStatus;assert.equal(s({status:'draft',current_revision_id:null},[],new Set()),'to_prepare');
 assert.equal(s({status:'draft',current_revision_id:'r'},['facebook'],new Set()),'draft');assert.equal(s({status:'pending_review',current_revision_id:'r'},['facebook'],new Set()),'draft');
 assert.equal(s({status:'approved',current_revision_id:'r'},['facebook','instagram'],new Set(['facebook'])),'ready');assert.equal(s({status:'approved',current_revision_id:'r'},['facebook','instagram'],new Set(['facebook','instagram'])),'published');
 assert.equal(s({status:'rejected',current_revision_id:'r'},['facebook'],new Set()),'rejected');
 const {result}=await rows({published:'1'});const by=Object.fromEntries(result.rows.map(r=>[r.id,r.status]));
 assert.deepEqual(by,{[P.prepare]:'to_prepare',[P.pending]:'draft',[P.manual]:'draft',[P.ready]:'ready',[P.published]:'published',[P.partial]:'ready',[P.rejected]:'rejected'});
 assert.deepEqual(json(query.boardStatusLabels),{to_prepare:'À préparer',draft:'Brouillon',ready:'À publier',rejected:'Rejeté',published:'Publié'});});

test('batch rows carry client, project, current variants only, first media, platforms, origin and preview',async()=>{
 const {result}=await rows({published:'1'});const pending=result.rows.find(r=>r.id===P.pending),rejected=result.rows.find(r=>r.id===P.rejected),prepare=result.rows.find(r=>r.id===P.prepare);
 assert.deepEqual(json(pending.platforms),['facebook','instagram'],'platform order is stable');assert.equal(pending.preview,'Avant l’hiver, faites vérifier votre toiture. Nous intervenons à Décines.');
 assert.equal(pending.clientName,'Jrenov');assert.equal(pending.projectName,'Réseaux Jrenov');assert.equal(pending.origin,'agent');assert.equal(pending.image.includes('token=short-lived'),true);assert.equal(pending.hasMedia,true);
 assert.equal(rejected.origin,'agent');assert.equal(rejected.edited,true);assert.equal(rejected.image,null,'an image of an old revision is not shown');assert.equal(rejected.hasMedia,false);assert.equal(rejected.preview,'Merci pour vos avis.');
 assert.equal(prepare.origin,'planning');assert.equal(prepare.preview,'');assert.equal(result.rows.find(r=>r.id===P.manual).origin,'manual');
 for(const r of result.rows){assert.equal('imagePath' in r,false);assert.equal('search' in r,false);assert.equal(r.debug,null);}});

test('every platform combination is displayed as-is and filtered correctly, without assuming Facebook and Instagram go together',async()=>{
 const {result}=await rows({},comboTables());const by=Object.fromEntries(result.rows.map(r=>[r.subject.replace('Combinaison ',''),json(r.platforms)]));
 assert.deepEqual(by,{fb:['facebook'],ig:['instagram'],gbp:['google_business_profile'],fb_ig:['facebook','instagram'],fb_gbp:['facebook','google_business_profile'],ig_gbp:['instagram','google_business_profile'],all:['facebook','instagram','google_business_profile']});
 for(const platform of ['facebook','instagram','google_business_profile']){const expected=Object.entries(combos).filter(([,p])=>p.includes(platform)).map(([name])=>comboId(name)).sort();
  assert.deepEqual(ids((await rows({platform},comboTables())).result).sort(),expected,platform);}
 const out=await html({},comboTables());
 for(const [name,label] of [['fb','Facebook'],['ig','Instagram'],['gbp','Google Business Profile'],['fb_ig','Facebook · Instagram'],['fb_gbp','Facebook · Google Business Profile'],['ig_gbp','Instagram · Google Business Profile'],['all','Facebook · Instagram · Google Business Profile']])
  assert.ok(visible(rowHtml(out,comboId(name))).includes(` ${label} `),`${name}: ${label}`);
 for(const name of Object.keys(combos))assert.ok(!rowHtml(out,comboId(name)).includes('Média requis'),`${name} has media for each channel`);});

test('thumbnails are signed in one short-lived batch for the displayed page only, never through a public URL',async()=>{
 const {result,signs}=await rows();assert.equal(signs.length,1);assert.deepEqual(json(signs[0]),{bucket:'publication-images',paths:[imagePath],ttl:120});
 assert.equal(result.rows.filter(r=>r.image).length,1);
 const paged=await rows({media:'without'});assert.equal(paged.signs.length,0,'no signing request when no displayed row has media');
 for(const f of ['lib/publications/board.ts','lib/publications/board-query.ts','components/publications/publications-board.tsx','components/publications/board-filter-bar.tsx','app/(cockpit)/publications/page.tsx'])assert.doesNotMatch(src(f),/getPublicUrl|public:\s*true/,f);
 const broken=fakeDb(fixtures());broken.db.storage.from=()=>({createSignedUrls:async()=>({data:null,error:{message:'down'}})});
 const m=load('lib/publications/board.ts',{'@/lib/supabase/server':{getSupabaseServerClient:()=>broken.db},'@/lib/require-admin':{requireAdmin:async()=>({})},'@/lib/supabase/read-error':{safeSupabaseReadError:()=>({})}});
 const fallback=await m.listPublicationBoardRows(q());assert.equal(fallback.rows.every(r=>r.image===null),true,'a signing failure falls back to the placeholder');});

test('media states: empty slot, real publication without media and unavailable media are distinct',async()=>{
 const out=await html();
 const slot=rowHtml(out,P.prepare),missing=rowHtml(out,P.manual),withMedia=rowHtml(out,P.pending);
 assert.match(slot,/data-media="slot"/);assert.ok(visible(slot).includes('À préparer'));assert.ok(!slot.includes('Média requis'),'an empty slot is not a publication without media');assert.ok(!visible(slot).includes('Sans média'));
 assert.match(missing,/data-media="missing"/);assert.ok(visible(missing).includes('Sans média'));assert.ok(visible(missing).includes('Média requis'));
 assert.match(withMedia,/<img src="https:\/\/project\.supabase\.co\/storage\/v1\/object\/sign\/publication-images\//);assert.ok(!withMedia.includes('Média requis'));
 const unavailable=rowHtml(await html({},fixtures(),{signFails:true}),P.pending);assert.match(unavailable,/data-media="unavailable"/);assert.ok(visible(unavailable).includes('Média indisponible'));assert.ok(!unavailable.includes('Média requis'));
 assert.equal(query.needsMedia({status:'to_prepare',missingMedia:['facebook']}),false);assert.equal(query.needsMedia({status:'draft',missingMedia:['instagram']}),true);assert.equal(query.needsMedia({status:'draft',missingMedia:[]}),false);
 assert.deepEqual(ids((await rows({media:'with'})).result),[P.pending]);assert.equal(ids((await rows({media:'without'})).result).includes(P.pending),false);});

test('published publications are hidden by default and shown on request or through their view',async()=>{
 assert.equal(ids((await rows()).result).includes(P.published),false);assert.equal(ids((await rows({published:'1'})).result).includes(P.published),true);
 assert.deepEqual(ids((await rows({status:'published'})).result),[P.published]);
 const {result}=await rows();assert.equal(result.total,6);assert.deepEqual(json(result.counts),{all:6,to_prepare:1,draft:2,ready:2,rejected:1,published:1});});

test('filters by client, project, status, platform, origin, media and period',async()=>{
 assert.deepEqual(ids((await rows({client:C2})).result).sort(),[P.manual,P.rejected].sort());
 assert.deepEqual(ids((await rows({project:P2,status:'rejected'})).result),[P.rejected]);
 assert.deepEqual(ids((await rows({status:'draft'})).result).sort(),[P.pending,P.manual].sort());
 assert.deepEqual(ids((await rows({status:'to_prepare'})).result),[P.prepare]);
 assert.deepEqual(ids((await rows({platform:'instagram'})).result).sort(),[P.pending,P.partial].sort());
 assert.deepEqual(ids((await rows({platform:'google_business_profile'})).result).sort(),[P.manual,P.rejected].sort());
 assert.deepEqual(ids((await rows({origin:'manual'})).result).sort(),[P.manual,P.ready].sort());
 assert.equal(ids((await rows({origin:'agent'})).result).includes(P.prepare),false,'placeholders are neither agent nor manual');
 assert.deepEqual(ids((await rows({from:'2026-10-10',to:'2026-10-14'})).result),[P.manual,P.ready,P.pending]);
 const scoped=board();await scoped.m.listPublicationBoardRows(q({client:C2}));assert.equal(scoped.requests.filter(r=>r.table==='publications').length,1);});

test('search covers subject, current texts, client and project, ignoring case and accents but not old revisions',async()=>{
 for(const [term,expected] of [['TOITURE',[P.pending]],['decines',[P.pending,P.partial]],['jrenov',[P.prepare,P.pending,P.ready,P.partial]],['fiche google',[P.manual,P.rejected]],['merci pour',[P.rejected]],['confidentiel',[]]])
  assert.deepEqual(ids((await rows({q:term})).result).sort(),expected.sort(),term);});

test('sorting by date, client, status and last modification is deterministic',async()=>{
 assert.deepEqual(ids((await rows()).result),[P.partial,P.manual,P.ready,P.pending,P.rejected,P.prepare]);
 assert.deepEqual(ids((await rows({sort:'date_desc'})).result),[P.prepare,P.rejected,P.pending,P.ready,P.manual,P.partial]);
 assert.deepEqual(ids((await rows({sort:'client'})).result),[P.manual,P.rejected,P.partial,P.ready,P.pending,P.prepare]);
 assert.deepEqual(json((await rows({sort:'status'})).result.rows.map(r=>r.status)),['to_prepare','draft','draft','ready','ready','rejected']);
 assert.deepEqual(ids((await rows({sort:'updated'})).result),[P.rejected,P.pending,P.manual,P.ready,P.partial,P.prepare]);});

test('no N+1: the number of round trips depends on chunks of 100, not on the number of rows',async()=>{
 const many=n=>{const t=empty();
  for(let i=0;i<n;i++){const id=uid(5,i),rev=uid(6,i);t.publications.push(pub(id,C1,P1,'pending_review',rev,`Sujet ${i}`,'2026-10-14','2026-10-06T10:00:00Z'));t.publication_revisions.push({id:rev,publication_id:id,origin:'generated',revision_number:1});
   t.publication_variants.push({id:`v${i}`,revision_id:rev,platform:'facebook',text_content:`Texte ${i}`});t.publication_variant_assets.push({variant_id:`v${i}`,asset_id:`a${i}`,sort_order:0});t.publication_assets.push({id:`a${i}`,storage_path:`${C1}/${id}/a${i}`});}
  return t;};
 const small=await rows({},many(5)),large=await rows({},many(150));
 assert.equal(small.requests.length,7,'one request per table');assert.ok(large.requests.length<=14,`${large.requests.length} requests for 150 rows`);
 assert.ok(large.requests.every(r=>r.inSize===null||r.inSize<=100));assert.equal(large.signs.length,1);assert.equal(large.signs[0].paths.length,50,'only the displayed page is signed');
 assert.equal(large.result.rows.length,50);assert.equal(large.result.pageCount,3);
 assert.doesNotMatch(src('lib/publications/board.ts'),/getWorkspace|publicationSummaries/);
 const page=src('app/(cockpit)/publications/page.tsx');assert.match(page,/listPublicationBoardRows/);assert.doesNotMatch(page,/getWorkspace|publicationSummaries|listPublications\(/);});

test('the board loader requires the admin guard before any database or storage access',async()=>{
 const b=board(fixtures(),{deny:true});await assert.rejects(()=>b.m.listPublicationBoardRows(q()),/denied/);assert.equal(b.requests.length,0);assert.equal(b.signs.length,0);
 assert.match(src('app/(cockpit)/publications/page.tsx'),/await requireAdmin\(\)/);});

test('table renders the expected columns, signed thumbnails, UX statuses and previews',async()=>{
 const out=await html(),text=visible(out);
 for(const h of ['Photo','Client','Projet','Date','Statut','Sujet','Aperçu','Plateformes','Origine','Modifiée','Actions'])assert.ok(text.includes(h),h);
 for(const s of ['Entretien de toiture avant l’hiver','Jrenov','Réseaux Jrenov','14 oct. 2026','Brouillon','À publier','À préparer','Rejeté','Facebook · Instagram','Agent','Manuel','Planning','Sans média','modifiée','Avant l’hiver, faites vérifier votre toiture.'])assert.ok(text.includes(s),s);
 assert.match(out,/<img src="https:\/\/project\.supabase\.co\/storage\/v1\/object\/sign\/publication-images\/[^"]+token=short-lived"[^>]*loading="lazy"/);
 assert.match(out,/line-clamp-2/);assert.ok(!text.includes('Peinture intérieure'),'published rows are hidden by default');
 const shown=visible(await html({published:'1'}));assert.ok(shown.includes('Peinture intérieure'));assert.ok(shown.includes('Publié'));});

test('normal view exposes no identifiers, storage paths, costs or tokens; debug=1 keeps technical details',async()=>{
 const out=await html(),text=visible(out);assert.equal(uuidPattern.test(text),false);
 for(const s of ['storage_path','revision_id','creation_origin','pending_review','approved','gpt-','token','cost'])assert.ok(!text.includes(s),s);assert.ok(!out.includes('data-debug'));
 const debug=await html({debug:'1'});assert.ok(debug.includes('data-debug="true"'));assert.ok(debug.includes('storage_path'));assert.ok(debug.includes('pending_review'));assert.ok(debug.includes('name="debug" value="1"'));});

test('rows are clickable towards the existing detail page; the menu offers navigation and one confirmed removal form',async()=>{
 const out=await html(),row=rowHtml(out,P.pending);
 const links=[...row.matchAll(/<a href="([^"]+)"([^>]*)>/g)];assert.ok(links.filter(l=>l[1]===`/publications/${P.pending}`).length>=10,'every data cell opens the publication');
 assert.equal(links.filter(l=>l[1]===`/publications/${P.pending}`&&!l[2].includes('tabindex="-1"')).length,2,'subject link and menu Ouvrir are focusable');
 assert.match(row,/<details[\s\S]*<summary aria-label="Actions pour Entretien de toiture avant l’hiver"/);
 for(const href of [`/publications/${P.pending}/edit`,`/projects/${P1}/review`,`/projects/${P1}/calendar`])assert.ok(row.includes(`href="${href}"`),href);
 const forms=row.match(/<form[\s\S]*?<\/form>/g)??[];assert.equal(forms.length,1,'the only mutation is the board removal');
 assert.match(forms[0],/name="publication_id" value="40000000-0000-4000-8000-000000000002"/);const confirm=forms[0].match(/<input type="checkbox"[^>]*>/)[0];assert.match(confirm,/name="confirm"/);assert.match(confirm,/required=""/);
 for(const s of ['Retirer du tableau','Rien n’est supprimé','versions, validations, médias, coûts et historique sont conservés','Afficher les retirées'])assert.ok(visible(row).includes(s),s);
 assert.doesNotMatch(row,/Supprimer/,'no delete action for a real publication');
 const prepare=rowHtml(out,P.prepare);assert.ok(prepare.includes(`href="/projects/${P1}/agent"`));assert.ok(!prepare.includes('/edit"'));});

test('removal from the board is an audited, reversible masking that never deletes history',async()=>{
 const tables=fixtures();tables.publication_events=[{resource_type:'publication',resource_id:P.ready,action:'publication.board_hidden',created_at:'2026-10-07T09:00:00Z'},
  {resource_type:'publication',resource_id:P.manual,action:'publication.board_hidden',created_at:'2026-10-07T09:00:00Z'},{resource_type:'publication',resource_id:P.manual,action:'publication.board_restored',created_at:'2026-10-07T10:00:00Z'},
  {resource_type:'publication',resource_id:P.pending,action:'publication.reviewed',created_at:'2026-10-07T10:00:00Z'}];
 const def=await rows({},tables);assert.equal(ids(def.result).includes(P.ready),false,'hidden by default');assert.equal(ids(def.result).includes(P.manual),true,'the latest event wins');assert.equal(def.result.counts.ready,1);
 const shown=await rows({hidden:'1'},tables);assert.equal(ids(shown.result).includes(P.ready),true);
 const out=renderToStaticMarkup(jsx.jsx(component().PublicationsBoard,{result:shown.result,query:q({hidden:'1'}),...options})),row=rowHtml(out,P.ready);
 assert.ok(visible(row).includes('Retirée du tableau'));assert.ok(visible(row).includes('Remettre dans le tableau'));assert.ok(!row.includes('name="confirm"'));
 const v=load('lib/publications/board-visibility.ts',{});assert.deepEqual([...v.hiddenPublications(tables.publication_events)],[P.ready]);
 const visibility=(t,deny=false)=>{const fake=fakeDb(t),calls=[];return {...fake,calls,m:load('lib/publications/board-visibility.ts',{'@/lib/supabase/server':{getSupabaseServerClient:()=>fake.db},'@/lib/require-admin':{requireAdmin:async()=>{calls.push('admin');if(deny)throw Error('denied');return {userId:'user_admin'};}}})};};
 const form=(entries)=>{const f=new FormData();for(const [k,val] of entries)f.set(k,val);return f;};
 const noConfirm=visibility(fixtures());assert.equal((await noConfirm.m.setBoardVisibility(form([['publication_id',P.ready]]),true)).ok,false);assert.equal(noConfirm.writes.length,0,'no write without explicit confirmation');
 const invalid=visibility(fixtures());assert.equal((await invalid.m.setBoardVisibility(form([['publication_id','x'],['confirm','on']]),true)).ok,false);assert.equal(invalid.requests.length,0);
 const denied=visibility(fixtures(),true);await assert.rejects(()=>denied.m.setBoardVisibility(form([['publication_id',P.ready],['confirm','on']]),true),/denied/);assert.equal(denied.requests.length+denied.writes.length,0);
 const ok=visibility(fixtures());const result=await ok.m.setBoardVisibility(form([['publication_id',P.ready],['confirm','on']]),true);assert.equal(result.ok,true);
 assert.deepEqual(ok.writes,[['insert','publication_events',{actor_type:'admin',actor_id:'user_admin',action:'publication.board_hidden',client_id:C1,resource_type:'publication',resource_id:P.ready,metadata:{scope:'board'}}]],'one append-only audit event, nothing else');
 const restore=visibility(fixtures());assert.equal((await restore.m.setBoardVisibility(form([['publication_id',P.ready]]),false)).ok,true);assert.equal(restore.writes[0][2].action,'publication.board_restored');
 for(const f of ['lib/publications/board-visibility.ts','app/(cockpit)/publications/board-actions.ts','lib/publications/board.ts','components/publications/publications-board.tsx'])assert.doesNotMatch(src(f),/\.delete\(|\.update\(|\.upsert\(|\.remove\(|\.rpc\(/,f);
 const actions=src('app/(cockpit)/publications/board-actions.ts');assert.equal((actions.match(/await requireAdmin\(\)/g)??[]).length,2);assert.match(actions,/^"use server";/);
 assert.equal(readdirSync(resolve(root,'supabase/migrations')).length,9,'no migration added');});

test('filter bar: client-only, instant, no Filtrer button, reset kept, debounced search',async()=>{
 const out=await html({client:C1,status:'draft',q:'toiture'});const form=out.match(/<form[^>]*data-board-filters="instant"[^>]*>[\s\S]*?<\/form>/)[0];
 assert.match(form,/method="get"/);assert.match(form,/action="\/publications"/);
 for(const name of ['q','client','project','status','platform','origin','media','from','to','sort','published','hidden'])assert.match(form,new RegExp(`name="${name}"`),name);
 assert.doesNotMatch(visible(form),/Filtrer/);assert.doesNotMatch(form,/<button/,'no submit button');assert.match(form,/<a href="\/publications"[^>]*>Réinitialiser<\/a>/);
 for(const s of ['Afficher les publications publiées','Afficher les retirées','Avec média','Sans média'])assert.ok(visible(form).includes(s),s);
 assert.match(form,/<input type="checkbox" name="published" value="1"/);assert.ok(form.includes('value="toiture"'));
 const bar=src('components/publications/board-filter-bar.tsx');assert.match(bar,/^'use client';/);assert.match(bar,/router\.push\(href,\{scroll:false\}\)/);assert.match(bar,/router\.replace\(href,\{scroll:false\}\)/);
 assert.match(bar,/navigate\(applyFilterChange\(current,'q',value\),'replace'\)/,'typing replaces the history entry');
 const {SEARCH_DEBOUNCE_MS}=load('components/publications/board-filter-bar.tsx',{'next/navigation':{useRouter:()=>router}});assert.ok(SEARCH_DEBOUNCE_MS>=300&&SEARCH_DEBOUNCE_MS<=500);
 for(const f of ['components/publications/publications-board.tsx','app/(cockpit)/publications/page.tsx'])assert.doesNotMatch(src(f),/^['"]use client['"]/,`${f} stays server-rendered`);});

test('instant filter changes produce shareable URLs that keep the other params',()=>{
 const base=q({q:'toiture',client:C1,project:P1,platform:'facebook',sort:'updated',page:'4',debug:'1'}),apply=query.applyFilterChange;
 const url=(href)=>Object.fromEntries(new URL('http://x'+href).searchParams);
 assert.deepEqual(url(apply(base,'status','ready',options.projects)),{q:'toiture',client:C1,project:P1,status:'ready',platform:'facebook',sort:'updated',debug:'1'},'select change keeps the other params and resets the page');
 assert.equal(url(apply(base,'platform','',options.projects)).platform,undefined,'clearing a select removes the param');
 assert.equal(url(apply(base,'published','1')).published,'1');assert.equal(url(apply(q({published:'1'}),'published','')).published,undefined,'unchecking removes the param');
 assert.equal(url(apply(base,'hidden','1')).hidden,'1');
 assert.equal(url(apply(base,'client',C2,options.projects)).project,undefined,'a project of another client is cleared');assert.equal(url(apply(base,'client',C1,options.projects)).project,P1);
 assert.equal(url(apply(base,'status','approved')).status,undefined,'invalid values are dropped');assert.equal(url(apply(base,'from','2026-10-01')).from,'2026-10-01');
 assert.equal(url(apply(base,'q','  peinture  ')).q,'peinture');assert.equal(url(apply(base,'sort','date_desc')).sort,'date_desc');
 assert.ok(apply(base,'status','ready').startsWith('/publications?'),'always the internal board URL');});

test('search debounce runs only the last value after the delay, and can be cancelled',()=>{
 const {createDebounced}=load('components/publications/board-filter-bar.tsx',{'next/navigation':{useRouter:()=>router}});
 let now=0;const pending=new Map();let next=1;const timers={set:(fn,ms)=>{const h=next++;pending.set(h,{fn,at:now+ms});return h;},clear:h=>pending.delete(h)};
 const advance=ms=>{now+=ms;for(const [h,t] of [...pending])if(t.at<=now){pending.delete(h);t.fn();}};
 const calls=[];const d=createDebounced(v=>calls.push(v),400,timers);
 d.call('t');advance(100);d.call('to');advance(100);d.call('toit');advance(399);assert.deepEqual(calls,[]);advance(1);assert.deepEqual(calls,['toit']);
 d.call('x');d.cancel();advance(1000);assert.deepEqual(calls,['toit']);});

test('quick views keep the filters; pagination keeps the filters and changes only the page',async()=>{
 const out=await html({client:C1,status:'draft',q:'toiture'});const views=out.match(/<nav aria-label="Vues rapides"[\s\S]*?<\/nav>/)[0];
 for(const label of ['Toutes','À préparer','Brouillons','À publier','Rejetées','Publiées'])assert.ok(visible(views).includes(label),label);
 assert.ok(views.includes(`href="/publications?q=toiture&amp;client=${C1}&amp;status=ready"`));assert.match(views,/aria-current="page"[^>]*>Brouillons/);
 const many=empty();for(let i=0;i<120;i++)many.publications.push(pub(uid(5,i),C1,P1,'draft',null,`Créneau ${i}`,'2026-10-20','2026-10-01T10:00:00Z','system'));
 const b=board(many);const query2=q({client:C1,page:'2'});const result=await b.m.listPublicationBoardRows(query2);assert.equal(result.page,2);assert.equal(result.rows.length,50);
 const pageOut=renderToStaticMarkup(jsx.jsx(component().PublicationsBoard,{result,query:query2,clients:[],projects:[]}));
 assert.ok(pageOut.includes(`href="/publications?client=${C1}"`),'previous page');assert.ok(pageOut.includes(`href="/publications?client=${C1}&amp;page=3"`),'next page');assert.ok(visible(pageOut).includes('Page 2 / 3'));
 assert.equal((await board(many).m.listPublicationBoardRows(q({page:'99'}))).page,3);});

test('mobile shows compact cards with the same links while the dense table is desktop-only',async()=>{
 const out=await html();assert.match(out,/class="hidden overflow-x-auto md:block" data-board="table"/);assert.match(out,/class="divide-y divide-border md:hidden" data-board="cards"/);
 const card=out.match(new RegExp(`<li data-board-card="${P.pending}"[\\s\\S]*?</form></details></div></details></li>`))[0];
 assert.ok(card.includes(`href="/publications/${P.pending}"`));assert.ok(visible(card).includes('Entretien de toiture avant l’hiver'));assert.ok(visible(card).includes('Brouillon'));assert.ok(card.includes('token=short-lived'));
 const missing=out.match(new RegExp(`<li data-board-card="${P.manual}"[\\s\\S]*?</li>`))[0];assert.ok(visible(missing).includes('Sans média'));});

test('media rule: approval (Brouillon → À publier) is refused server-side while a channel has no media',async()=>{
 const rule=load('lib/publications/media-rule.ts');
 assert.deepEqual(json(rule.channelsWithoutMedia([{id:'a',platform:'facebook'},{id:'b',platform:'instagram'}],[{variant_id:'a'}])),['instagram']);
 const tables=()=>({...fixtures(),publication_variants:[{id:'fb',revision_id:R.pending,platform:'facebook'},{id:'ig',revision_id:R.pending,platform:'instagram'}],publication_variant_assets:[{variant_id:'fb',asset_id:'a1',sort_order:0}]});
 const workspace=t=>{const fake=fakeDb(t);return {...fake,m:load('lib/publications/workspace.ts',{'@/lib/supabase/server':{getSupabaseServerClient:()=>fake.db},'@/lib/require-admin':{requireAdmin:async()=>({userId:'user_admin'})}})};};
 const form=decision=>{const f=new FormData();f.set('publication_id',P.pending);f.set('revision_id',R.pending);f.set('decision',decision);return f;};
 const refused=workspace(tables());const message=(await refused.m.submitOrReview(form('approved'))).message;
 assert.match(message,/^Validation impossible : ajoutez une photo/);assert.match(message,/Instagram/);assert.equal(refused.writes.length,0,'no review RPC without media');
 const complete=tables();complete.publication_variant_assets.push({variant_id:'ig',asset_id:'a1',sort_order:0});const approved=workspace(complete);await approved.m.submitOrReview(form('approved'));
 assert.equal(approved.writes[0][1],'publication_review_manual');assert.equal(approved.writes[0][2].p_decision,'approved');
 const submitted=workspace(tables());await submitted.m.submitOrReview(form('submit'));assert.equal(submitted.writes[0][1],'publication_submit_manual','an incomplete draft can still be submitted');
 const rejected=workspace(tables());const f=form('rejected');f.set('reason','Texte à revoir');await rejected.m.submitOrReview(f);assert.equal(rejected.writes[0][1],'publication_review_manual');
 assert.match(src('app/(cockpit)/publications/review-actions.ts'),/!message\.startsWith\("Validation impossible"\)/,'the card reports the refusal as a failure');
 assert.match(src('lib/publications/data.ts'),/revisionChannelsWithoutMedia/,'the legacy review path applies the same rule');
 const card=load('components/publications/review-card.tsx',{'@/app/(cockpit)/publications/review-actions':{approveFromCardAction:async()=>({}),rejectFromCardAction:async()=>({}),editFromCardAction:async()=>({})},'@/app/(cockpit)/publications/agent-actions':{configureAgentAction:async()=>({}),prepareAgentAction:async()=>({})}});
 const data={publicationId:P.pending,revisionId:R.pending,projectId:P1,variants:[{platform:'facebook',assetIds:['a1']},{platform:'instagram',assetIds:[]}]};
 const without=renderToStaticMarkup(jsx.jsx(card.ReviewApproveForm,{card:data}));assert.ok(visible(without).includes('Média requis'));assert.doesNotMatch(without,/<button/);
 const withMedia=renderToStaticMarkup(jsx.jsx(card.ReviewApproveForm,{card:{...data,variants:[{platform:'facebook',assetIds:['a1']}]}}));assert.match(withMedia,/<button[^>]*>Valider<\/button>/);});

test('video audit: the current backend stores images only, so the UI never claims video support',()=>{
 const migrations=readdirSync(resolve(root,'supabase/migrations')).map(f=>src(`supabase/migrations/${f}`)).join('\n');
 assert.match(migrations,/mime_type text not null check \(mime_type in \('image\/jpeg','image\/png','image\/webp'\)\)/,'publication_assets accepts images only');
 assert.match(migrations,/'publication-images','publication-images',false,786432,array\['image\/jpeg','image\/png','image\/webp'\]/,'the private bucket accepts images only, 768 KB');
 assert.match(migrations,/'publication-originals','publication-originals',false,8388608,array\['image\/jpeg','image\/png','image\/webp'\]/);
 assert.doesNotMatch(migrations,/video\//);
 const editor=load('lib/publications/editor.ts');const mp4=new Uint8Array([0,0,0,0x18,0x66,0x74,0x79,0x70,0x6d,0x70,0x34,0x32,0,0,0,0]);assert.equal(editor.imageMime(mp4),null,'byte sniffing rejects MP4');
 for(const f of ['components/publications/publications-board.tsx','components/publications/board-filter-bar.tsx','lib/publications/media-rule.ts'])assert.doesNotMatch(src(f),/[Vv]idéo|video\//,f);
 assert.match(src('lib/publications/media-rule.ts'),/images only \(JPEG, PNG, WebP\); video support requires a migration/);});

test('the global calendar offers the same Tableau / Calendrier switch',()=>{
 const {PublicationsNav}=component();const b=renderToStaticMarkup(jsx.jsx(PublicationsNav,{current:'board'})),c=renderToStaticMarkup(jsx.jsx(PublicationsNav,{current:'calendar'}));
 assert.match(b,/href="\/publications" aria-current="page"/);assert.match(c,/href="\/publications\/calendar" aria-current="page"/);
 assert.match(src('app/(cockpit)/publications/calendar/page.tsx'),/<PublicationsNav current="calendar"\/>/);});
