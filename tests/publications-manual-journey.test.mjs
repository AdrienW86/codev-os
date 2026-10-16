import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

const native=createRequire(import.meta.url),root=resolve('.');
function load(file,mocks={}){const cache=new Map(),find=base=>[base+'.ts',base+'.tsx'].find(p=>existsSync(p))??base;
 function read(path){if(cache.has(path))return cache.get(path);const exports={};cache.set(path,exports);const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{exports,FormData,File,Uint8Array,Intl,Date,Map,Set,URL,URLSearchParams,console,require:name=>{if(name in mocks)return mocks[name];if(name==='server-only')return {};if(name==='react/jsx-runtime')return jsx;if(name.startsWith('@/'))return read(find(resolve(root,name.slice(2))));if(name.startsWith('.'))return read(find(resolve(dirname(path),name)));return native(name);}});return exports;}
 return read(resolve(root,file));}
const C='10000000-0000-4000-8000-000000000001',OTHER='10000000-0000-4000-8000-000000000002',P='30000000-0000-4000-8000-000000000001',PUB='40000000-0000-4000-8000-000000000001',R='70000000-0000-4000-8000-000000000001';
const link={__esModule:true,default:({href,children,...props})=>jsx.jsx('a',{href,...props,children})};
const clients=[{id:C,name:'Protection Nuisibles'},{id:OTHER,name:'Autre client'}],projects=[{id:P,client_id:C,name:'Publications client',platforms:['facebook','instagram']}];
const mocks={'next/link':link,'@/app/(cockpit)/publications/actions':{savePublicationAction:async()=>({})}};
const render=node=>renderToStaticMarkup(node);

test('manual preparation defaults to a free draft, offers channel variants and never requires an API account',()=>{
 const {ManualPublicationForm}=load('components/publications/manual-form.tsx',mocks),html=render(jsx.jsx(ManualPublicationForm,{clients,projects,initialClient:C,initialProject:P}));
 assert.match(html,/name="creation_mode"[^>]*checked=""[^>]*value="unscheduled"|name="creation_mode"[^>]*value="unscheduled"[^>]*checked=""/);
 assert.match(html,/Brouillon libre/);assert.match(html,/name="facebook_text"/);assert.match(html,/name="instagram_text"/);assert.doesNotMatch(html,/name="slot"|name="week"|name="target_date"|name="credential|name="account_id"/);
 assert.match(html,/Enregistrer le brouillon/);assert.match(html,/API n’est nécessaire pour rédiger/);
 const empty=render(jsx.jsx(ManualPublicationForm,{clients,projects:[],initialClient:C}));assert.match(empty,new RegExp(`/clients/${C}\\?tab=publications`));assert.match(empty,/<button disabled=""/,'missing editorial channels show configuration, never fabricate an enabled platform');
});

test('new draft URL presets cannot bind a project to a different or absent client',async()=>{
 for(const [search,expected] of [[{client:C,project:P},[C,P]],[{client:OTHER,project:P},[OTHER,'']],[{project:P},['','']],[{client:'invalid',project:P},['','']],[{client:[C,OTHER],project:P},['','']]]){
  let formProps;const page=load('app/(cockpit)/publications/new/page.tsx',{'next/link':link,'@/lib/require-admin':{requireAdmin:async()=>({userId:'user_admin'})},'@/lib/clients/data':{listClients:async()=>clients},'@/lib/projects/data':{listProjects:async()=>projects},'@/lib/publications/project-channels':{publicationProjectOptions:async()=>projects},'@/components/ui/primitives':{PageHeading:()=>null,Panel:({children})=>children},'@/components/publications/manual-form':{ManualPublicationForm:props=>{formProps=props;return null;}}});
  render(await page.default({searchParams:Promise.resolve(search)}));assert.deepEqual([formProps.initialClient,formProps.initialProject],expected);
 }
});

function actionSetup({deny=false}={}){const calls=[],saved=kind=>async form=>{calls.push([kind,Object.fromEntries(form)]);return {id:PUB};};
 const actions=load('app/(cockpit)/publications/actions.ts',{'@/lib/require-admin':{requireAdmin:async()=>{calls.push(['admin']);if(deny)throw Error('denied');}},'@/lib/publications/workspace':{saveDraft:saved('scheduled'),saveUnscheduledDraft:saved('unscheduled')},'next/cache':{revalidatePath:path=>calls.push(['refresh',path])},'next/navigation':{redirect:path=>{throw Error('redirect:'+path);}}});return {actions,calls};}
const form=values=>{const f=new FormData();for(const [key,value] of Object.entries(values))f.set(key,value);return f;};
test('manual save uses the existing unscheduled transaction; the legacy schedule remains an explicit separate choice',async()=>{
 for(const mode of ['unscheduled','scheduled']){const r=actionSetup();await assert.rejects(()=>r.actions.savePublicationAction({},form({creation_mode:mode,title:'Sujet'})),new RegExp('redirect:/publications/'+PUB));assert.deepEqual(r.calls.filter(c=>['scheduled','unscheduled'].includes(c[0])).map(c=>c[0]),[mode]);assert.equal(r.calls[0][0],'admin');}
 for(const f of [form({creation_mode:'unknown'}),form({creation_mode:'unscheduled',publication_id:PUB}),(()=>{const f=form({creation_mode:'unscheduled'});f.append('creation_mode','scheduled');return f;})()]){const r=actionSetup();assert.match((await r.actions.savePublicationAction({},f)).message,/Mode de création invalide/);assert.deepEqual(r.calls,[['admin']]);}
 const denied=actionSetup({deny:true});await assert.rejects(()=>denied.actions.savePublicationAction({},form({creation_mode:'unscheduled'})),/denied/);assert.deepEqual(denied.calls,[['admin']]);
});

test('full publication page and editor share the current delivery lock and fail closed when state is unreadable',async()=>{
 for(const lock of [null,'Une diffusion est en cours : lecture seule.','Publication archivée : lecture seule.','unavailable']){
  const w={publication:{id:PUB,client_id:C,project_id:P,slot:1,status:'approved',current_revision_id:R,subject:'Conseils préventifs',creation_origin:'manual',updated_at:'2026-10-15T10:00:00Z',editorial_week:'2026-10-12',target_date:'2026-10-16'},revisions:[],variants:[],reviews:[],events:[],assets:[],links:[]},calls=[];
  const detail={publicationId:PUB,clientName:'Protection Nuisibles',projectName:'Publications client',readOnly:Boolean(lock),readOnlyReason:lock};
  const base={'next/link':link,'next/navigation':{notFound:()=>{throw Error('not-found');}},'@/lib/require-admin':{requireAdmin:async()=>({userId:'user_admin'})},'@/lib/publications/workspace':{getWorkspace:async()=>w},'@/lib/publications/drawer':{loadPublicationDetail:async(id,options)=>{assert.equal(id,PUB);assert.equal(options.workspace,w);return lock==='unavailable'?{state:'unavailable'}:{state:'ok',detail};}},'@/lib/publications/draft-scheduling':{getDraftSchedulingOptions:async()=>{calls.push('schedule');return null;}},'@/components/publications/publication-drawer':{PublicationWorkspace:props=>{calls.push(props.detail);return jsx.jsx('div',{'data-shared-locked':String(props.detail.readOnly)});}},'@/components/publications/schedule-draft-form':{ScheduleDraftForm:()=>null},'@/lib/publications/project-channels':{publicationProjectOptions:async()=>projects},'@/lib/clients/data':{listClients:async()=>clients},'@/lib/projects/data':{listProjects:async()=>projects},'@/components/publications/manual-form':{ManualPublicationForm:()=>jsx.jsx('form',{'data-manual-edit':'true'})}};
  const page=load('app/(cockpit)/publications/[id]/page.tsx',base),html=render(await page.default({params:Promise.resolve({id:PUB})}));
  assert.equal(html.includes('Créer une nouvelle révision'),!lock);assert.equal(calls.includes('schedule'),!lock);
  if(lock==='unavailable'){assert.match(html,/lecture seule par sécurité/);assert.equal(calls.some(c=>c===detail),false);}else{assert.ok(calls.includes(detail));assert.match(html,new RegExp('data-shared-locked="'+Boolean(lock)+'"'));}
  const editor=load('app/(cockpit)/publications/[id]/edit/page.tsx',base),editHtml=render(await editor.default({params:Promise.resolve({id:PUB})}));assert.equal(editHtml.includes('data-manual-edit'),!lock,'deep link editor has exactly the same delivery/archive lock');
 }
});
