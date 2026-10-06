import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

function load(path,mocks={}) {
 const exports={};
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>name==='react/jsx-runtime'?jsx:mocks[name]??(()=>{throw Error(name)})()});
 return exports;
}
const model=load('lib/publications/review-decisions.ts');
const timestamp='2026-10-05T20:18:54.869589+00:00';
const variants=[{id:'facebook',revision_id:'rev1',platform:'facebook',metadata:{}},{id:'instagram',revision_id:'rev1',platform:'instagram',metadata:{}}];
const reviews=variants.map((v,i)=>({id:`review${i}`,variant_id:v.id,publication_id:'pub',revision_id:'rev1',client_id:'client',decision:'rejected',reason:'texte invalide',actor_id:'user_fixture',created_at:timestamp}));
const events=[{id:'event',resource_id:'pub',client_id:'client',action:'publication.reviewed',actor_id:'user_fixture',created_at:timestamp,metadata:{revision_id:'rev1',decision:'rejected'}}];

test('legacy manual transaction reconstructs one decision from its recorded event, preserving input rows',()=>{
 const result=model.reviewDecisions(reviews,events,variants);
 assert.equal(result.length,1);assert.equal(result[0].id,'event');assert.equal(result[0].variant_id,null);
 assert.equal(reviews.length,2);assert.equal(reviews[0].variant_id,'facebook');
});
test('partial, conflicting, unrelated or independently audited variant reviews never collapse',()=>{
 for(const [rows,journal] of [[reviews.slice(0,1),events],[reviews.map((r,i)=>({...r,reason:i?'different':r.reason})),events],[reviews,[]],[reviews,[...events,{...events[0],id:'other'}]],[reviews,[{...events[0],metadata:{...events[0].metadata,variant_id:'facebook'}}]]]) {
  assert.equal(model.reviewDecisions(rows,journal,variants).length,rows.length);
 }
 const global={...reviews[0],id:'global',variant_id:null};
 assert.equal(model.reviewDecisions([global],events,variants)[0].id,'global');
});
async function render(current) {
 const workspace={publication:{id:'pub',client_id:'client',current_revision_id:current,status:current==='rev1'?'rejected':'draft',subject:'Publication',editorial_week:'2026-10-05'},revisions:[{id:'rev1',revision_number:1},{id:'rev2',revision_number:2}],variants,reviews:model.reviewDecisions(reviews,events,variants),events,assets:[],links:[]};
 const primitive=({children,...props})=>jsx.jsx('section',{...props,children});
 const page=load('app/(cockpit)/publications/[id]/page.tsx',{
  'next/link':{default:({href,children})=>jsx.jsx('a',{href,children})},'next/navigation':{notFound:()=>{throw Error('notFound')}},
  '@/lib/require-admin':{requireAdmin:async()=>({userId:'user_fixture'})},'@/lib/publications/workspace':{getWorkspace:async()=>workspace},
  '@/lib/publications/actor-label':load('lib/publications/actor-label.ts'),'@/lib/projects/data':{listProjects:async()=>[]},'@/lib/clients/data':{listClients:async()=>[]},'@/lib/publications/editor':{platformLabels:{facebook:'Facebook',instagram:'Instagram'}},
  '@/components/publications/workflow-forms':{PublicationReviewForm:()=>null,PublicationUploadForm:()=>null},
  '@/components/publications/agent-forms':{AgentPrepareForm:()=>null},
  '@/components/ui/primitives':{Panel:primitive,Badge:primitive,PageHeading:()=>null},'@/lib/format-date':{formatDate:()=> '05 oct. 2026'},
 });
 return renderToStaticMarkup(await page.default({params:Promise.resolve({id:'pub'})}));
}
test('current refusal is rendered once and moves once into history after a new revision',async()=>{
 for(const revision of ['rev1','rev2']) {
  const html=await render(revision);
  assert.equal(html.split('texte invalide').length-1,1);
  assert.equal(html.split('user_fixture').length-1,0); // technical identifiers stay in the journal data only
  assert.equal(html.split('Décision de validation enregistrée').length-1,1);
  assert.match(html,/Créer une nouvelle révision/);
 }
});
