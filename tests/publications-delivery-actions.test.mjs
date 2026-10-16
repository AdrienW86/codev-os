import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTs} from './helpers/load-ts.mjs';

const id='10000000-0000-4000-8000-000000000001';
function setup(denied=false){
 const calls=[];
 const actions=loadTs('app/(cockpit)/publications/delivery-actions.ts',{
  'next/cache':{revalidatePath:path=>calls.push(['refresh',path])},
  '@/lib/require-admin':{requireAdmin:async()=>{calls.push(['admin']);if(denied)throw Error('denied');}},
  '@/lib/publications/delivery/service':{},
  '@/lib/publications/delivery/registry':{
   reconcileDelivery:async value=>{calls.push(['check',value]);return {ok:true,result:'missing',message:'Vérification enregistrée.'};},
   confirmDeliveryNotPublished:async value=>{calls.push(['confirm',value]);return {ok:true,message:'Décision enregistrée.'};},
  },
 });
 return {actions,calls};
}
const form=()=>{const data=new FormData();data.set('delivery_id',id);return data;};
test('uncertain delivery confirmation requires an explicit single confirmation before any write',async()=>{
 for(const value of [null,'false','on,on']){
  const state=setup(),data=form();if(value!==null)data.set('confirm',value);
  assert.equal((await state.actions.confirmNotPublishedAction({},data)).ok,false);
  assert.deepEqual(state.calls,[['admin']]);
 }
 const duplicate=setup(),data=form();data.append('confirm','on');data.append('confirm','on');
 assert.equal((await duplicate.actions.confirmNotPublishedAction({},data)).ok,false);assert.deepEqual(duplicate.calls,[['admin']]);
 const valid=setup(),confirmed=form();confirmed.set('confirm','on');
 assert.equal((await valid.actions.confirmNotPublishedAction({},confirmed)).ok,true);assert.deepEqual(valid.calls.slice(0,2),[['admin'],['confirm',id]]);
 const denied=setup(true);await assert.rejects(()=>denied.actions.confirmNotPublishedAction({},confirmed),/denied/);assert.deepEqual(denied.calls,[['admin']]);
});
test('provider verification preserves its structured result, so an unknown result cannot enable confirmation',async()=>{
 const state=setup();const result=await state.actions.reconcileDeliveryAction({},form());
 assert.equal(result.result,'missing');assert.deepEqual(state.calls.slice(0,2),[['admin'],['check',id]]);
});
test('uncertain delivery UI disables confirmation until a recorded missing result and prevents overlapping actions',()=>{
 for(const [checked,pending,expected] of [[{},false,false],[{ok:true,result:'unknown'},false,false],[{ok:false,result:'missing'},false,false],[{ok:true,result:'missing'},true,false],[{ok:true,result:'missing'},false,true]]){
  let index=0;
  const ui=loadTs('components/publications/delivery-section.tsx',{
   react:{useActionState:()=>index++===0?[checked,()=>{},pending]:[{},()=>{},false]},
   '@/app/(cockpit)/publications/delivery-actions':{},'@/lib/format-date':{},
   '@/lib/publications/delivery/model':{DELIVERY_ENGINE_NOTICE:'Aucun envoi automatique.'},
  });
  const html=renderToStaticMarkup(React.createElement(ui.DeliverySection,{publicationId:id,diffusion:{canPrepare:false,deliveries:[{id,platformLabel:'Facebook',accountLabel:'Compte',status:'uncertain',statusLabel:'À vérifier',attempts:1,canRetry:false,canReconcile:true}]}}));
  assert.equal(/<button disabled=""[^>]*>Confirmer : non publiée/.test(html),!expected);
  assert.match(html,/<input(?=[^>]*name="confirm")(?=[^>]*required="")[^>]*>/);
  if(pending)assert.match(html,/<button disabled=""[^>]*>Vérification…/);
 }
});
