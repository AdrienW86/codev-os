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
function load(file,mocks={}){const cache=new Map();const find=base=>[base+'.ts',base+'.tsx'].find(p=>existsSync(p))??base;
 function read(path){if(cache.has(path))return cache.get(path);const exports={};cache.set(path,exports);
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{exports,Intl,Date,URL,FormData,console,require:name=>{if(name in mocks)return mocks[name];if(name==='react/jsx-runtime')return jsx;if(name==='server-only')return {};
   if(name.startsWith('@/'))return read(find(resolve(root,name.slice(2))));if(name.startsWith('.'))return read(find(resolve(dirname(path),name)));return native(name);}});
  return exports;}
 return read(resolve(root,file));}
const json=value=>JSON.parse(JSON.stringify(value));
const uuid=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,visible=html=>html.replace(/<[^>]+>/g,' ');
const id=n=>`${n}0000000-0000-4000-8000-000000000001`;
const ids={client:id(1),project:id(3),pending:id(4),rejected:'40000000-0000-4000-8000-000000000002',approved:'40000000-0000-4000-8000-000000000003',gbp:'40000000-0000-4000-8000-000000000004',r1:'70000000-0000-4000-8000-000000000001',r2:'70000000-0000-4000-8000-000000000002',r5:'70000000-0000-4000-8000-000000000005',r6:'70000000-0000-4000-8000-000000000006',r7:'70000000-0000-4000-8000-000000000007',asset:'90000000-0000-4000-8000-000000000001',run:'60000000-0000-4000-8000-000000000001'};
const signed='https://project.supabase.co/storage/v1/object/sign/publication-images/fixture?token=short-lived';
const storagePath=`${ids.client}/${ids.pending}/${ids.asset}`;
const pub=(pid,status,rev,subject,date)=>({id:pid,client_id:ids.client,project_id:ids.project,status,current_revision_id:rev,subject,target_date:date,editorial_week:date,client:{name:'CODE-V'},project:{name:'Réseaux sociaux CODE-V'}});
const publications=[pub(ids.pending,'pending_review',ids.r2,'Automatisation IA : les points à vérifier','2026-10-09'),pub(ids.rejected,'rejected',ids.r5,'SEO local','2026-10-12'),pub(ids.approved,'approved',ids.r6,'Déjà validée','2026-10-02'),pub(ids.gbp,'pending_review',ids.r7,'Fiche Google','2026-10-15')];
const rev=(rid,pid,n,origin,created)=>({id:rid,publication_id:pid,revision_number:n,origin,created_at:created,angle:'Angle',source_content:'Source',model:'gpt-4.1-mini-2025-04-14',estimated_cost:0.0028});
const variant=(vid,rid,platform,text,metadata={})=>({id:vid,revision_id:rid,platform,text_content:text,metadata});
const workspaces={
 [ids.pending]:{publication:publications[0],revisions:[rev(ids.r2,ids.pending,2,'regenerated','2026-10-06T12:00:00Z'),rev(ids.r1,ids.pending,1,'generated','2026-10-05T12:00:00Z')],
  variants:[variant('vf',ids.r2,'facebook','Texte Facebook validé.',{title:'Automatisation IA : les points à vérifier',cta:'Contactez-nous pour parler de votre besoin.'}),variant('vi',ids.r2,'instagram','Texte Instagram.'),variant('old',ids.r1,'facebook','Ancien texte.')],
  reviews:[{revision_id:ids.r1,decision:'rejected',reason:'Trop générique',variant_id:null}],links:[{variant_id:'vf',asset_id:ids.asset,sort_order:0},{variant_id:'vi',asset_id:ids.asset,sort_order:0}],
  assets:[{id:ids.asset,storage_path:storagePath,preview:signed}]},
 [ids.rejected]:{publication:publications[1],revisions:[rev(ids.r5,ids.rejected,1,'generated','2026-10-06T09:00:00Z')],variants:[variant('vr',ids.r5,'facebook','Texte rejeté.')],reviews:[{revision_id:ids.r5,decision:'rejected',reason:'Le ton est trop vague pour ce client.',variant_id:'vr'}],links:[],assets:[]},
 [ids.approved]:{publication:publications[2],revisions:[],variants:[],reviews:[],links:[],assets:[]},
 [ids.gbp]:{publication:publications[3],revisions:[rev(ids.r7,ids.gbp,1,'manual','2026-10-06T08:00:00Z')],variants:[variant('vg',ids.r7,'google_business_profile','Texte fiche Google.')],reviews:[],links:[{variant_id:'vg',asset_id:'missing',sort_order:0}],assets:[{id:'missing',storage_path:'x',preview:null}]}};
function cardsModule(){const calls=[];const m=load('lib/publications/review-cards.ts',{'./workspace':{getWorkspace:async pid=>{calls.push(['workspace',pid]);return workspaces[pid];}},'./agent-data':{getGenerationDetails:async r=>{calls.push(['details',r]);return {run_id:ids.run,selected_opportunity:{subject:'Automatisation IA',score:87},media_id:'drive-media',factual_basis:['Phrase vérifiée.'],generation_summary:'Sujet et photo compatibles ; validation humaine requise.'};},getAiRunForRevision:async r=>{calls.push(['run',r]);return {id:ids.run,model:'gpt-4.1-mini-2025-04-14',input_tokens:4090,output_tokens:386,estimated_cost_eur:0.0028};}}});return {m,calls};}
const reviewActions={approveFromCardAction:async()=>({}),rejectFromCardAction:async()=>({}),editFromCardAction:async()=>({})};
const agentActions={configureAgentAction:async()=>({}),prepareAgentAction:async()=>({})};
const card=()=>load('components/publications/review-card.tsx',{'@/app/(cockpit)/publications/review-actions':reviewActions,'@/app/(cockpit)/publications/agent-actions':agentActions});
async function cards(debug=false){const {m}=cardsModule();return m.buildReviewCards(publications,{debug});}
const render=element=>renderToStaticMarkup(element);

test('review cards include pending and rejected publications and leave approved ones out',async()=>{const c=await cards();
 assert.deepEqual(json(c.map(x=>[x.subject,x.status])),[['Automatisation IA : les points à vérifier','pending_review'],['SEO local','rejected'],['Fiche Google','pending_review']]);});
test('cards expose the current revision variants with title and CTA, and only the platforms present',async()=>{const [pending,rejected,gbp]=await cards();
 assert.deepEqual(json(pending.variants.map(v=>[v.platform,v.title,v.cta,v.assetIds])),[['facebook','Automatisation IA : les points à vérifier','Contactez-nous pour parler de votre besoin.',[ids.asset]],['instagram',null,null,[ids.asset]]]);
 assert.ok(!pending.variants.some(v=>v.text==='Ancien texte.'));assert.deepEqual(json(gbp.variants.map(v=>v.platform)),['google_business_profile']);assert.equal(rejected.rejection,'Le ton est trop vague pour ce client.');
 assert.deepEqual(json(pending.versions.map(v=>[v.number,v.origin,v.decision,v.reason,v.current])),[[2,'Régénération IA',null,null,true],[1,'IA','Rejetée','Trop générique',false]]);
 assert.deepEqual(json(pending.editorial),{title:'Automatisation IA : les points à vérifier',angle:'Angle',source:'Source',targetDate:'2026-10-09'});});
test('the image is the existing short-lived signed preview; a missing preview gives no image and no storage path leaks',async()=>{const [pending,,gbp]=await cards();
 assert.equal(pending.image,signed);assert.equal(gbp.image,null);assert.ok(!JSON.stringify(pending).includes(storagePath));
 const workspace=readFileSync(resolve(root,'lib/publications/workspace.ts'),'utf8'),editor=readFileSync(resolve(root,'lib/publications/editor.ts'),'utf8');
 assert.match(workspace,/createSignedUrl\(asset\.storage_path,IMAGE_URL_TTL\)/);assert.match(editor,/IMAGE_URL_TTL=120;/);
 for(const f of ['lib/publications/review-cards.ts','components/publications/review-card.tsx','components/publications/review-queue.tsx','lib/publications/workspace.ts'])assert.doesNotMatch(readFileSync(resolve(root,f),'utf8'),/getPublicUrl|public:\s*true/,f);});
test('technical data is only loaded with the debug view',async()=>{const plain=cardsModule();const c=await plain.m.buildReviewCards(publications,{debug:false});assert.ok(c.every(x=>x.debug===null));assert.equal(plain.calls.some(x=>x[0]!=='workspace'),false);
 const dbg=cardsModule();const [pending]=await dbg.m.buildReviewCards(publications,{debug:true});
 for(const key of ['publication_id','revision_id','run_id','model','input_tokens','output_tokens','estimated_cost_eur','opportunity','media_id','asset_ids','storage_paths','factual_basis','generation_summary'])assert.ok(key in pending.debug,key);
 assert.equal(pending.debug.storage_paths[0],storagePath);assert.equal(pending.debug.input_tokens,4090);});
test('pending card shows image, long date, subject, status, platform tabs, texts, title and CTA, with the three actions and no technical data',async()=>{const [pending]=await cards();const {ReviewCard}=card();const html=render(jsx.jsx(ReviewCard,{card:pending}));const text=visible(html);
 for(const s of ['9 octobre 2026','À valider','Automatisation IA : les points à vérifier','Facebook','Instagram','Texte Facebook validé.','Texte Instagram.','Contactez-nous pour parler de votre besoin.','Modifier','Rejeter','Valider','Historique des versions','Régénération IA','Trop générique'])assert.ok(text.includes(s),s);
 assert.ok(html.includes(`src="${signed.replace(/&/g,'&amp;')}"`));assert.ok(!text.includes('Google Business Profile'));assert.match(html,/data-platform="instagram" hidden=""/);assert.doesNotMatch(html,/data-platform="facebook" hidden/);
 assert.equal(uuid.test(text),false);for(const s of [storagePath,'gpt-4.1','token','4090','/100','run_id','publication_ai'])assert.ok(!html.includes(s)||s==='token'&&!text.includes(s),s);assert.ok(!html.includes('data-debug'));assert.ok(!html.includes('Régénérer'));});
test('Google Business Profile card shows its own tab and a clean placeholder when the image is unavailable',async()=>{const [,,gbp]=await cards();const {ReviewCard}=card();const text=visible(render(jsx.jsx(ReviewCard,{card:gbp})));
 assert.ok(text.includes('Google Business Profile'));assert.ok(text.includes('Texte fiche Google.'));assert.ok(text.includes('Image indisponible'));assert.ok(!text.includes('Instagram'));});
test('rejected card shows the reason and a single-publication regeneration that requires explicit AI authorization',async()=>{const [,rejected]=await cards();const {ReviewCard}=card();const html=render(jsx.jsx(ReviewCard,{card:rejected}));const text=visible(html);
 for(const s of ['Rejeté','Motif du rejet','Le ton est trop vague pour ce client.','Régénérer','J’autorise un appel IA réel pour régénérer cette publication'])assert.ok(text.includes(s),s);
 assert.equal((html.match(/name="publication_id"/g)??[]).length,1);assert.ok(html.includes(`name="publication_id" value="${ids.rejected}"`));assert.match(html,/<input type="checkbox"[^>]*required=""[^>]*name="authorize_ai"/);assert.ok(!text.includes('Valider'));assert.ok(!html.includes('<select'));});
test('debug card renders technical details only when provided',async()=>{const [pending]=await cards(true);const {ReviewCard}=card();const html=render(jsx.jsx(ReviewCard,{card:pending}));assert.ok(html.includes('data-debug="true"'));assert.ok(html.includes(ids.run));assert.ok(html.includes('estimated_cost_eur'));});
test('edit form reuses the existing manual revision fields: texts, title, CTA, images and the expected revision',async()=>{const [pending]=await cards();const {ReviewEditForm}=card();const html=render(jsx.jsx(ReviewEditForm,{card:pending}));
 for(const [name,value] of [['publication_id',ids.pending],['revision_id',ids.r2],['project_id',ids.project],['client_id',ids.client],['title','Automatisation IA : les points à vérifier'],['angle','Angle'],['source','Source'],['target_date','2026-10-09'],['facebook_enabled','on'],['instagram_enabled','on'],['facebook_assets',ids.asset],['instagram_assets',ids.asset],['facebook_title','Automatisation IA : les points à vérifier'],['facebook_cta','Contactez-nous pour parler de votre besoin.']])assert.ok(html.includes(`name="${name}"`)&&html.includes(`value="${value}"`),name);
 assert.match(html,/<textarea[^>]*name="facebook_text"[^>]*>Texte Facebook validé.<\/textarea>/);assert.ok(!html.includes('name="instagram_title"'));assert.ok(!html.includes('google_business_profile_text'));
 const {parseEditorialForm}=load('lib/publications/editor.ts');const f=new FormData();for(const [k,v] of [['publication_id',ids.pending],['revision_id',ids.r2],['client_id',ids.client],['project_id',ids.project],['title','Automatisation IA : les points à vérifier'],['angle','Angle'],['source','Source'],['target_date','2026-10-09'],['facebook_enabled','on'],['facebook_text','Texte modifié.'],['facebook_title','Automatisation IA : les points à vérifier'],['facebook_cta','Contactez-nous pour parler de votre besoin.'],['facebook_assets',ids.asset],['instagram_enabled','on'],['instagram_text','Texte Instagram.'],['instagram_assets',ids.asset]])f.append(k,v);
 const draft=json(parseEditorialForm(f));assert.equal(draft.expected_revision_id,ids.r2);assert.deepEqual(draft.variants[0],{platform:'facebook',text_content:'Texte modifié.',asset_ids:[ids.asset],metadata:{title:'Automatisation IA : les points à vérifier',cta:'Contactez-nous pour parler de votre besoin.'}});assert.deepEqual(draft.variants[1].asset_ids,[ids.asset]);});
test('reject form requires a reason of at least ten characters',async()=>{const [pending]=await cards();const {ReviewRejectForm}=card();const html=render(jsx.jsx(ReviewRejectForm,{card:pending}));assert.match(html,/<textarea[^>]*name="reason"[^>]*required=""[^>]*minLength="10"|<textarea[^>]*minLength="10"[^>]*required=""/i);assert.ok(visible(html).includes('Motif du rejet'));});

function actionsSetup({save={id:ids.pending},current={revision_id:ids.r6,status:'draft'},submit='Révision soumise à validation.',review='Révision approuvée.',deny=false}={}){const calls=[];
 const m=load('app/(cockpit)/publications/review-actions.ts',{'next/cache':{revalidatePath:p=>calls.push(['revalidate',p])},'@/lib/require-admin':{requireAdmin:async()=>{calls.push(['admin']);if(deny)throw Error('denied');return {userId:'user_local'};}},
  '@/lib/publications/workspace':{saveDraft:async f=>{calls.push(['saveDraft',Object.fromEntries(f)]);return save;},currentRevision:async pid=>{calls.push(['currentRevision',pid]);return current;},submitOrReview:async f=>{const d=Object.fromEntries(f);calls.push(['submitOrReview',d]);return {message:d.decision==='submit'?submit:review};}},
  '@/lib/publications/validation':{isPublicationUuid:s=>typeof s==='string'&&uuid.test(s)}});return {m,calls};}
const form=extra=>{const f=new FormData();f.set('publication_id',ids.pending);f.set('revision_id',ids.r2);f.set('project_id',ids.project);for(const [k,v] of Object.entries(extra??{}))f.set(k,v);return f;};
const writes=calls=>calls.filter(c=>c[0]==='saveDraft'||c[0]==='submitOrReview').map(c=>c[0]==='saveDraft'?'saveDraft':c[1].decision);
test('Modifier creates a new manual revision through the existing save, then submits that new revision for review',async()=>{const r=actionsSetup();const result=await r.m.editFromCardAction({},form({facebook_text:'Texte modifié.'}));
 assert.equal(result.ok,true);assert.deepEqual(writes(r.calls),['saveDraft','submit']);const save=r.calls.find(c=>c[0]==='saveDraft')[1],submit=r.calls.find(c=>c[0]==='submitOrReview')[1];
 assert.equal(save.revision_id,ids.r2);assert.equal(save.facebook_text,'Texte modifié.');assert.deepEqual(json(submit),{publication_id:ids.pending,revision_id:ids.r6,decision:'submit'});
 assert.ok(r.calls.some(c=>c[0]==='revalidate'&&c[1]===`/projects/${ids.project}/review`));assert.ok(r.calls.some(c=>c[0]==='revalidate'&&c[1]==='/publications/review'));
 const source=readFileSync(resolve(root,'app/(cockpit)/publications/review-actions.ts'),'utf8');assert.doesNotMatch(source,/getSupabaseServerClient|@supabase|\.rpc\(|\.from\(/);});
test('Modifier never submits when the save fails, and never resubmits the old revision',async()=>{const failed=actionsSetup({save:{message:'La publication a changé. Rechargez avant de modifier.'}});assert.match((await failed.m.editFromCardAction({},form())).message,/a changé/);assert.deepEqual(writes(failed.calls),['saveDraft']);
 const stale=actionsSetup({current:{revision_id:ids.r2,status:'pending_review'}});assert.equal((await stale.m.editFromCardAction({},form())).ok,false);assert.deepEqual(writes(stale.calls),['saveDraft']);
 const unsubmitted=actionsSetup({submit:'Opération non confirmée. Rechargez la fiche et réessayez.'});assert.match((await unsubmitted.m.editFromCardAction({},form())).message,/brouillon/);});
test('Valider calls the existing review decision for the current revision only',async()=>{const r=actionsSetup();const result=await r.m.approveFromCardAction({},form({reason:'ignoré'}));assert.equal(result.ok,true);assert.deepEqual(json(r.calls.find(c=>c[0]==='submitOrReview')[1]),{publication_id:ids.pending,revision_id:ids.r2,project_id:ids.project,decision:'approved'});});
test('Rejeter without a sufficient reason is impossible; with a reason it records the existing rejection',async()=>{for(const reason of [undefined,'','   ','court','  neuf car  ']){const r=actionsSetup();const result=await r.m.rejectFromCardAction({},form(reason===undefined?{}:{reason}));assert.equal(result.ok,false);assert.deepEqual(writes(r.calls),[]);}
 const r=actionsSetup({review:'Révision refusée. Créez une nouvelle révision pour la retravailler.'});const result=await r.m.rejectFromCardAction({},form({reason:'Le ton est trop vague pour ce client.'}));assert.equal(result.ok,true);const sent=r.calls.find(c=>c[0]==='submitOrReview')[1];assert.equal(sent.decision,'rejected');assert.equal(sent.reason,'Le ton est trop vague pour ce client.');});
test('card actions deny a non-admin before any workflow call',async()=>{for(const name of ['approveFromCardAction','rejectFromCardAction','editFromCardAction']){const r=actionsSetup({deny:true});await assert.rejects(()=>r.m[name]({},form({reason:'Motif suffisamment long'})),/denied/);assert.deepEqual(writes(r.calls),[]);}});
test('Régénérer goes through the existing preparation action: explicit authorization, one exact publication',async()=>{const calls=[];const a=load('app/(cockpit)/publications/agent-actions.ts',{'next/cache':{revalidatePath:()=>{}},'@/lib/require-admin':{requireAdmin:async()=>({userId:'user_local'})},'@/lib/publications/agent-service':{configurePublicationsAgent:async()=>({}),preparePublication:async(...args)=>{calls.push(args);return {message:'Prepared'};}},'@/lib/publications/validation':{isPublicationUuid:s=>typeof s==='string'&&uuid.test(s)}});
 const f=new FormData();f.set('project_id',ids.project);f.set('publication_id',ids.rejected);assert.match((await a.prepareAgentAction({},f)).message,/Autorisez/);assert.equal(calls.length,0);
 f.set('authorize_ai','on');await a.prepareAgentAction({},f);assert.equal(calls.length,1);assert.equal(calls[0][1],ids.rejected);assert.equal(calls[0][2].allowRealAI,true);
 // The previous rejection reason is read from the workspace by preparePublication itself (covered by "regeneration receives the exact previous refusal").
 assert.match(readFileSync(resolve(root,'lib/publications/agent-service.ts'),'utf8'),/rejection:refused\?\.reason\?\?null/);});
test('project and global review pages share the single ReviewQueue/ReviewCard UI',()=>{const queue=readFileSync(resolve(root,'components/publications/review-queue.tsx'),'utf8');assert.match(queue,/<ReviewCard /);
 for(const f of ['app/(cockpit)/projects/[id]/(tabs)/review/page.tsx','app/(cockpit)/publications/review/page.tsx']){const s=readFileSync(resolve(root,f),'utf8');assert.match(s,/ReviewQueue/,f);assert.match(s,/buildReviewCards/,f);assert.doesNotMatch(s,/PublicationReviewForm|getGenerationDetails|score/,f);}
 assert.match(readFileSync(resolve(root,'app/(cockpit)/publications/review/page.tsx'),'utf8'),/<ReviewQueue cards=\{cards\} showContext\/>/);});
